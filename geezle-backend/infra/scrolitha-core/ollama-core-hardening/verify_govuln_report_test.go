package main

import (
	"strings"
	"testing"
)

func TestVerifyReportAllowsOnlyReviewedModuleVersion(t *testing.T) {
	input := `{"config":{"scan_mode":"binary"}}
{"finding":{"osv":"GO-2025-3557","trace":[{"module":"github.com/ollama/ollama","version":"v0.40.17+dirty"}]}}`
	count, ids, err := verifyReport(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || len(ids) != 1 || ids[0] != "GO-2025-3557" {
		t.Fatalf("got count=%d ids=%v", count, ids)
	}
}

func TestVerifyReportRejectsUnknownAdvisory(t *testing.T) {
	input := `{"config":{"scan_mode":"binary"}}
{"finding":{"osv":"GO-2099-0001","trace":[{"module":"github.com/ollama/ollama","version":"v0.40.17+dirty"}]}}`
	if _, _, err := verifyReport(strings.NewReader(input)); err == nil {
		t.Fatal("expected unknown advisory to block")
	}
}

func TestVerifyReportRejectsDifferentVersion(t *testing.T) {
	input := `{"config":{"scan_mode":"binary"}}
{"finding":{"osv":"GO-2025-3557","trace":[{"module":"github.com/ollama/ollama","version":"v0.13.5"}]}}`
	if _, _, err := verifyReport(strings.NewReader(input)); err == nil {
		t.Fatal("expected unreviewed version to block")
	}
}

func TestVerifyReportRejectsNonBinaryScan(t *testing.T) {
	if _, _, err := verifyReport(strings.NewReader(`{"config":{"scan_mode":"source"}}`)); err == nil {
		t.Fatal("expected source report to be rejected")
	}
}
