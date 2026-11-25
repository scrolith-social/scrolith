package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
)

const expectedModule = "github.com/ollama/ollama"
const expectedVersionPrefix = "v0.40.17+"

var reviewedAdvisories = map[string]struct{}{
	"GO-2025-3557": {},
	"GO-2025-3558": {},
	"GO-2025-3559": {},
	"GO-2025-3582": {},
	"GO-2025-3689": {},
	"GO-2025-3695": {},
	"GO-2025-3824": {},
	"GO-2025-4251": {},
	"GO-2026-5750": {},
}

type event struct {
	Config *struct {
		ScanMode string `json:"scan_mode"`
	} `json:"config"`
	Finding *struct {
		OSV   string `json:"osv"`
		Trace []struct {
			Module  string `json:"module"`
			Version string `json:"version"`
		} `json:"trace"`
	} `json:"finding"`
}

func verifyReport(input io.Reader) (int, []string, error) {
	decoder := json.NewDecoder(input)
	configuredBinaryScan := false
	count := 0
	seen := make(map[string]struct{})
	eventNumber := 0

	for {
		var raw json.RawMessage
		err := decoder.Decode(&raw)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return count, nil, fmt.Errorf("decode govulncheck JSON stream: %w", err)
		}
		eventNumber++
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) == 0 || trimmed[0] != '{' {
			return count, nil, fmt.Errorf("unexpected top-level JSON value at event %d", eventNumber)
		}
		var item event
		if err := json.Unmarshal(trimmed, &item); err != nil {
			return count, nil, fmt.Errorf("decode govulncheck event %d: %w", eventNumber, err)
		}
		if item.Config != nil {
			if item.Config.ScanMode != "binary" {
				return count, nil, fmt.Errorf("expected binary scan mode, got %q", item.Config.ScanMode)
			}
			configuredBinaryScan = true
		}
		if item.Finding == nil {
			continue
		}
		if _, ok := reviewedAdvisories[item.Finding.OSV]; !ok {
			return count, nil, fmt.Errorf("unreviewed Go advisory %q blocks the Core build", item.Finding.OSV)
		}
		if len(item.Finding.Trace) == 0 {
			return count, nil, fmt.Errorf("finding %q has no binary trace", item.Finding.OSV)
		}
		for _, trace := range item.Finding.Trace {
			if trace.Module != expectedModule || !strings.HasPrefix(trace.Version, expectedVersionPrefix) {
				return count, nil, fmt.Errorf("finding %q does not match the reviewed upstream module/version", item.Finding.OSV)
			}
		}
		seen[item.Finding.OSV] = struct{}{}
		count++
	}

	if !configuredBinaryScan {
		return count, nil, errors.New("govulncheck report has no binary scan configuration")
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return count, ids, nil
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: verify_govuln_report <govulncheck-json-stream>")
		os.Exit(2)
	}
	file, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot open govulncheck report")
		os.Exit(2)
	}
	defer file.Close()
	count, ids, err := verifyReport(file)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Go vulnerability report is not covered by the reviewed version-bound triage: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Unfiltered govulncheck binary report retained: %d finding records, reviewed IDs: %s\n", count, strings.Join(ids, ", "))
}
