//go:build scrolithcore

package cmd

import "testing"

func TestScrolithCoreCLIExposesOnlyServe(t *testing.T) {
	commands := NewCLI().Commands()
	if len(commands) != 1 || commands[0].Name() != "serve" {
		names := make([]string, 0, len(commands))
		for _, command := range commands {
			names = append(names, command.Name())
		}
		t.Fatalf("Scrolith Core commands = %v, want only serve", names)
	}
}
