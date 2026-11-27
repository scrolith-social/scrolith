package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultTLSAddress    = "0.0.0.0:13310"
	defaultHealthAddress = "0.0.0.0:8080"
	defaultClamdAddress  = "127.0.0.1:3310"
	defaultMaxClients    = 4
	defaultMaxStreamSize = 10 * 1024 * 1024
	defaultIdleTimeout   = 45 * time.Second
	maxHandshakeTimeout  = 5 * time.Second
)

type config struct {
	TLSAddress    string
	HealthAddress string
	ClamdAddress  string
	MaxClients    int
	MaxStreamSize int64
	IdleTimeout   time.Duration
	TLS           *tls.Config
}

func decodeBase64Env(name string) ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" || len(value)%4 != 0 {
		return nil, fmt.Errorf("required TLS configuration is missing or invalid")
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != value || len(decoded) == 0 {
		return nil, fmt.Errorf("required TLS configuration is missing or invalid")
	}
	return decoded, nil
}

func envAddress(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func loadConfig() (config, error) {
	certPEM, err := decodeBase64Env("BRIDGE_TLS_SERVER_CERT_B64")
	if err != nil {
		return config{}, err
	}
	keyPEM, err := decodeBase64Env("BRIDGE_TLS_SERVER_KEY_B64")
	if err != nil {
		return config{}, err
	}
	clientCAPEM, err := decodeBase64Env("BRIDGE_TLS_CLIENT_CA_B64")
	if err != nil {
		return config{}, err
	}

	serverCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return config{}, errors.New("TLS server certificate configuration is invalid")
	}
	clientCAs := x509.NewCertPool()
	if !clientCAs.AppendCertsFromPEM(clientCAPEM) {
		return config{}, errors.New("TLS client CA configuration is invalid")
	}

	maxClients := defaultMaxClients
	if value := strings.TrimSpace(os.Getenv("BRIDGE_MAX_CLIENTS")); value != "" {
		parsed, parseErr := strconv.Atoi(value)
		if parseErr != nil || parsed < 1 || parsed > 8 {
			return config{}, errors.New("bridge concurrency configuration is invalid")
		}
		maxClients = parsed
	}

	idleTimeout := defaultIdleTimeout
	if value := strings.TrimSpace(os.Getenv("BRIDGE_IDLE_TIMEOUT_MS")); value != "" {
		parsed, parseErr := strconv.Atoi(value)
		if parseErr != nil || parsed < 1_000 || parsed > 120_000 {
			return config{}, errors.New("bridge timeout configuration is invalid")
		}
		idleTimeout = time.Duration(parsed) * time.Millisecond
	}

	maxStreamSize := int64(defaultMaxStreamSize)
	if value := strings.TrimSpace(os.Getenv("BRIDGE_MAX_INSTREAM_BYTES")); value != "" {
		parsed, parseErr := strconv.ParseInt(value, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 10*1024*1024 {
			return config{}, errors.New("bridge stream size configuration is invalid")
		}
		maxStreamSize = parsed
	}

	return config{
		TLSAddress:    envAddress("BRIDGE_TLS_ADDRESS", defaultTLSAddress),
		HealthAddress: envAddress("BRIDGE_HEALTH_ADDRESS", defaultHealthAddress),
		ClamdAddress:  envAddress("CLAMD_UPSTREAM_ADDRESS", defaultClamdAddress),
		MaxClients:    maxClients,
		MaxStreamSize: maxStreamSize,
		IdleTimeout:   idleTimeout,
		TLS: &tls.Config{
			Certificates: []tls.Certificate{serverCert},
			ClientAuth:   tls.RequireAndVerifyClientCert,
			ClientCAs:    clientCAs,
			MinVersion:   tls.VersionTLS12,
		},
	}, nil
}

func pingClamd(address string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write([]byte("zPING\x00")); err != nil {
		return false
	}
	response := make([]byte, 64)
	n, err := conn.Read(response)
	if err != nil {
		return false
	}
	return strings.TrimRight(string(response[:n]), "\x00\r\n ") == "PONG"
}

func healthHandler(clamdAddress string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "OK\n")
	})
	ready := func(w http.ResponseWriter, r *http.Request) {
		if !pingClamd(clamdAddress, 1500*time.Millisecond) {
			http.Error(w, "NOT_READY", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "READY\n")
	}
	mux.HandleFunc("GET /startupz", ready)
	mux.HandleFunc("GET /readyz", ready)
	return mux
}

func closeWrite(conn net.Conn) {
	if halfCloser, ok := conn.(interface{ CloseWrite() error }); ok {
		_ = halfCloser.CloseWrite()
	}
}

func readWithIdleTimeout(src net.Conn, buffer []byte, idleTimeout time.Duration) error {
	if err := src.SetReadDeadline(time.Now().Add(idleTimeout)); err != nil {
		return err
	}
	_, err := io.ReadFull(src, buffer)
	return err
}

func writeWithIdleTimeout(dst net.Conn, buffer []byte, idleTimeout time.Duration) error {
	if err := dst.SetWriteDeadline(time.Now().Add(idleTimeout)); err != nil {
		return err
	}
	for written := 0; written < len(buffer); {
		count, err := dst.Write(buffer[written:])
		written += count
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

// forwardClamdRequest allows only the two commands used by the API and bounds
// the framed INSTREAM payload to the KYC upload limit.
func forwardClamdRequest(dst, src net.Conn, maxStreamSize int64, idleTimeout time.Duration) error {
	command := make([]byte, 0, 16)
	for len(command) < 32 {
		var next [1]byte
		if err := readWithIdleTimeout(src, next[:], idleTimeout); err != nil {
			return err
		}
		command = append(command, next[0])
		if next[0] == 0 {
			break
		}
	}
	if len(command) == 0 || command[len(command)-1] != 0 {
		return errors.New("clamd command frame is invalid")
	}
	if string(command) != "zPING\x00" && string(command) != "zINSTREAM\x00" {
		return errors.New("clamd command is not allowed")
	}
	if err := writeWithIdleTimeout(dst, command, idleTimeout); err != nil {
		return err
	}
	if string(command) == "zPING\x00" {
		return nil
	}

	var total int64
	for {
		var frame [4]byte
		if err := readWithIdleTimeout(src, frame[:], idleTimeout); err != nil {
			return err
		}
		length := int64(binary.BigEndian.Uint32(frame[:]))
		if length == 0 {
			return writeWithIdleTimeout(dst, frame[:], idleTimeout)
		}
		if length > maxStreamSize-total {
			return errors.New("clamd stream exceeds the configured size limit")
		}
		if err := writeWithIdleTimeout(dst, frame[:], idleTimeout); err != nil {
			return err
		}
		remaining := length
		buffer := make([]byte, 16*1024)
		for remaining > 0 {
			chunkSize := int64(len(buffer))
			if remaining < chunkSize {
				chunkSize = remaining
			}
			chunk := buffer[:int(chunkSize)]
			if err := readWithIdleTimeout(src, chunk, idleTimeout); err != nil {
				return err
			}
			if err := writeWithIdleTimeout(dst, chunk, idleTimeout); err != nil {
				return err
			}
			remaining -= chunkSize
		}
		total += length
	}
}

func forwardClamdResponse(dst, src net.Conn, idleTimeout time.Duration) error {
	response := make([]byte, 0, 128)
	for len(response) < 2048 {
		var next [1]byte
		if err := readWithIdleTimeout(src, next[:], idleTimeout); err != nil {
			return err
		}
		response = append(response, next[0])
		if next[0] == 0 {
			return writeWithIdleTimeout(dst, response, idleTimeout)
		}
	}
	return errors.New("clamd response frame is invalid")
}

func proxyConnection(raw net.Conn, cfg config) {
	defer raw.Close()

	tlsConn, ok := raw.(*tls.Conn)
	if !ok {
		return
	}
	_ = tlsConn.SetDeadline(time.Now().Add(maxHandshakeTimeout))
	if err := tlsConn.Handshake(); err != nil {
		return
	}

	upstream, err := net.DialTimeout("tcp", cfg.ClamdAddress, 2*time.Second)
	if err != nil {
		return
	}
	defer upstream.Close()
	_ = tlsConn.SetDeadline(time.Time{})

	if err := forwardClamdRequest(upstream, tlsConn, cfg.MaxStreamSize, cfg.IdleTimeout); err != nil {
		_ = tlsConn.Close()
		_ = upstream.Close()
		return
	}
	closeWrite(upstream)
	if err := forwardClamdResponse(tlsConn, upstream, cfg.IdleTimeout); err != nil {
		_ = tlsConn.Close()
		return
	}
	closeWrite(tlsConn)
}

func run(cfg config) error {
	healthListener, err := net.Listen("tcp", cfg.HealthAddress)
	if err != nil {
		return errors.New("bridge health listener could not start")
	}
	healthServer := &http.Server{
		Handler:           healthHandler(cfg.ClamdAddress),
		ReadHeaderTimeout: 2 * time.Second,
		WriteTimeout:      3 * time.Second,
		IdleTimeout:       5 * time.Second,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	go func() { _ = healthServer.Serve(healthListener) }()

	listener, err := net.Listen("tcp", cfg.TLSAddress)
	if err != nil {
		_ = healthServer.Close()
		return errors.New("bridge TLS listener could not start")
	}
	tlsListener := tls.NewListener(listener, cfg.TLS)
	slots := make(chan struct{}, cfg.MaxClients)
	for {
		conn, acceptErr := tlsListener.Accept()
		if acceptErr != nil {
			_ = healthServer.Close()
			return errors.New("bridge TLS accept failed")
		}
		select {
		case slots <- struct{}{}:
			go func(client net.Conn) {
				defer func() { <-slots }()
				proxyConnection(client, cfg)
			}(conn)
		default:
			_ = conn.Close()
		}
	}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "scanner bridge configuration is invalid")
		os.Exit(1)
	}
	if err := run(cfg); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "scanner bridge stopped")
		os.Exit(1)
	}
}
