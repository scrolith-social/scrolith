package main

import (
	"bufio"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/binary"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func testCertificate(t *testing.T, ca *x509.Certificate, caKey *rsa.PrivateKey, subject string, dnsName string, usages []x509.ExtKeyUsage, isCA bool) (tls.Certificate, *x509.Certificate) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	cert := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: subject},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  usages,
		DNSNames:     nil,
		IsCA:         isCA,
		BasicConstraintsValid: true,
	}
	if dnsName != "" {
		cert.DNSNames = []string{dnsName}
	}
	parent, signer := ca, caKey
	if isCA {
		parent, signer = cert, key
		cert.KeyUsage |= x509.KeyUsageCertSign
	}
	der, err := x509.CreateCertificate(rand.Reader, cert, parent, &key.PublicKey, signer)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: parsed}, parsed
}

func testPKI(t *testing.T) (tls.Certificate, tls.Certificate, *x509.CertPool, *x509.CertPool, []byte) {
	t.Helper()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-only KYC bridge CA"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caParsed, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	serverCert, _ := testCertificate(t, caParsed, caKey, "bridge.test", "bridge.test", []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, false)
	clientCert, _ := testCertificate(t, caParsed, caKey, "api.test", "", []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, false)
	clientCAs := x509.NewCertPool()
	clientCAs.AddCert(caParsed)
	serverRoots := x509.NewCertPool()
	serverRoots.AddCert(caParsed)
	return serverCert, clientCert, clientCAs, serverRoots, caDER
}

func serveSyntheticClamd(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func() {
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
				reader := bufio.NewReader(conn)
				command, readErr := reader.ReadString(0)
				if readErr != nil {
					return
				}
				if command == "zPING\x00" {
					_, _ = conn.Write([]byte("PONG\x00"))
					return
				}
				if command != "zINSTREAM\x00" {
					return
				}
				infected := false
				for {
					var size [4]byte
					if _, readErr = reader.Read(size[:]); readErr != nil {
						return
					}
					length := binary.BigEndian.Uint32(size[:])
					if length == 0 {
						break
					}
					chunk := make([]byte, length)
					if _, readErr = io.ReadFull(reader, chunk); readErr != nil {
						return
					}
					if strings.Contains(string(chunk), "EICAR-SYNTHETIC-CANARY") {
						infected = true
					}
				}
				if infected {
					_, _ = conn.Write([]byte("stream: Eicar-Test-Signature FOUND\x00"))
				} else {
					_, _ = conn.Write([]byte("stream: OK\x00"))
				}
			}()
		}
	}()
	return listener.Addr().String(), func() { _ = listener.Close() }
}

func TestMTLSBridgeForwardsClamdProtocolAndRejectsUnauthenticatedClients(t *testing.T) {
	serverCert, clientCert, clientCAs, serverRoots, _ := testPKI(t)
	upstreamAddress, closeUpstream := serveSyntheticClamd(t)
	defer closeUpstream()

	bridgeListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    clientCAs,
		MinVersion:   tls.VersionTLS12,
	}
	cfg := config{ClamdAddress: upstreamAddress, MaxClients: 4, MaxStreamSize: 10 * 1024 * 1024, IdleTimeout: 3 * time.Second, TLS: tlsConfig}
	tlsListener := tls.NewListener(bridgeListener, tlsConfig)
	defer tlsListener.Close()
	go func() {
		for {
			conn, acceptErr := tlsListener.Accept()
			if acceptErr != nil {
				return
			}
			go proxyConnection(conn, cfg)
		}
	}()

	clientTLS := &tls.Config{RootCAs: serverRoots, Certificates: []tls.Certificate{clientCert}, ServerName: "bridge.test", MinVersion: tls.VersionTLS12}
	dial := func(withClientCert bool) (*tls.Conn, error) {
		options := clientTLS.Clone()
		if !withClientCert {
			options.Certificates = nil
		}
		return tls.Dial("tcp", bridgeListener.Addr().String(), options)
	}

	if conn, dialErr := dial(false); dialErr == nil {
		_ = conn.SetDeadline(time.Now().Add(time.Second))
		_, writeErr := conn.Write([]byte("zPING\x00"))
		var response [16]byte
		readCount := 0
		if writeErr == nil {
			readCount, _ = conn.Read(response[:])
		}
		_ = conn.Close()
		if readCount > 0 {
			t.Fatal("bridge returned a clamd response to a client without a certificate")
		}
	}
	pingConn, pingErr := dial(true)
	if pingErr != nil {
		t.Fatal("mTLS PING client could not connect")
	}
	_, _ = pingConn.Write([]byte("zPING\x00"))
	var pingResponse strings.Builder
	for {
		var next [1]byte
		if _, readErr := pingConn.Read(next[:]); readErr != nil {
			_ = pingConn.Close()
			t.Fatal("bridge did not return a bounded PING response")
		}
		pingResponse.WriteByte(next[0])
		if next[0] == 0 {
			break
		}
	}
	_ = pingConn.Close()
	if strings.TrimRight(pingResponse.String(), "\x00") != "PONG" {
		t.Fatal("bridge did not forward the clamd PING response")
	}

	for _, fixture := range []struct {
		body string
		want string
	}{
		{body: "synthetic-clean", want: "stream: OK"},
		{body: "EICAR-SYNTHETIC-CANARY", want: "stream: Eicar-Test-Signature FOUND"},
	} {
		conn, dialErr := dial(true)
		if dialErr != nil {
			t.Fatal("mTLS client could not connect")
		}
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		_, _ = conn.Write([]byte("zINSTREAM\x00"))
		var frame [4]byte
		binary.BigEndian.PutUint32(frame[:], uint32(len(fixture.body)))
		_, _ = conn.Write(frame[:])
		_, _ = conn.Write([]byte(fixture.body))
		binary.BigEndian.PutUint32(frame[:], 0)
		_, _ = conn.Write(frame[:])
		_ = conn.CloseWrite()
		response, readErr := io.ReadAll(conn)
		_ = conn.Close()
		if readErr != nil || !strings.Contains(string(response), fixture.want) {
			t.Fatalf("unexpected synthetic scanner response: %q", string(response))
		}
	}
}

func TestForwardClamdRequestRejectsUnsupportedCommandsAndOversizedStreams(t *testing.T) {
	unsupportedDst, unsupportedSrc := net.Pipe()
	go func() {
		_, _ = unsupportedSrc.Write([]byte("zSHUTDOWN\x00"))
		_ = unsupportedSrc.Close()
	}()
	if err := forwardClamdRequest(unsupportedDst, unsupportedSrc, 5, time.Second); err == nil {
		t.Fatal("bridge accepted an unsupported clamd command")
	}
	_ = unsupportedDst.Close()
	_ = unsupportedSrc.Close()

	oversizedDst, oversizedSrc := net.Pipe()
	go func() {
		_, _ = oversizedSrc.Write([]byte("zINSTREAM\x00"))
		var frame [4]byte
		binary.BigEndian.PutUint32(frame[:], 6)
		_, _ = oversizedSrc.Write(frame[:])
		_ = oversizedSrc.Close()
	}()
	go func() { _, _ = io.Copy(io.Discard, oversizedDst) }()
	err := forwardClamdRequest(oversizedDst, oversizedSrc, 5, time.Second)
	_ = oversizedDst.Close()
	_ = oversizedSrc.Close()
	if err == nil {
		t.Fatal("bridge accepted an INSTREAM payload above the configured maximum")
	}
}

func TestLoadConfigEnforcesMutualTLSAndTLS12(t *testing.T) {
	serverCert, _, _, _, caDER := testPKI(t)
	keyDER, err := x509.MarshalPKCS8PrivateKey(serverCert.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverCert.Certificate[0]})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	original := map[string]string{
		"BRIDGE_TLS_SERVER_CERT_B64": os.Getenv("BRIDGE_TLS_SERVER_CERT_B64"),
		"BRIDGE_TLS_SERVER_KEY_B64":  os.Getenv("BRIDGE_TLS_SERVER_KEY_B64"),
		"BRIDGE_TLS_CLIENT_CA_B64":    os.Getenv("BRIDGE_TLS_CLIENT_CA_B64"),
	}
	t.Cleanup(func() {
		for key, value := range original {
			if value == "" {
				_ = os.Unsetenv(key)
			} else {
				_ = os.Setenv(key, value)
			}
		}
	})
	_ = os.Setenv("BRIDGE_TLS_SERVER_CERT_B64", base64.StdEncoding.EncodeToString(certPEM))
	_ = os.Setenv("BRIDGE_TLS_SERVER_KEY_B64", base64.StdEncoding.EncodeToString(keyPEM))
	_ = os.Setenv("BRIDGE_TLS_CLIENT_CA_B64", base64.StdEncoding.EncodeToString(caPEM))

	cfg, err := loadConfig()
	if err != nil {
		t.Fatal("valid synthetic TLS material was rejected")
	}
	if cfg.TLS.ClientAuth != tls.RequireAndVerifyClientCert || cfg.TLS.MinVersion != tls.VersionTLS12 {
		t.Fatal("bridge TLS policy must require a client certificate and TLS 1.2 or newer")
	}
}

func TestBridgeHealthSeparatesLivenessFromScannerReadiness(t *testing.T) {
	address, closeClamd := serveSyntheticClamd(t)
	handler := healthHandler(address)

	liveness := httptest.NewRecorder()
	handler.ServeHTTP(liveness, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if liveness.Code != http.StatusOK {
		t.Fatalf("bridge liveness should be healthy: %d", liveness.Code)
	}
	ready := httptest.NewRecorder()
	handler.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if ready.Code != http.StatusOK {
		t.Fatalf("scanner readiness should follow clamd PING: %d", ready.Code)
	}
	closeClamd()
	notReady := httptest.NewRecorder()
	handler.ServeHTTP(notReady, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if notReady.Code != http.StatusServiceUnavailable {
		t.Fatalf("scanner outage must remain not-ready: %d", notReady.Code)
	}
}
