// Command sampleqr writes a synthetic "phone screenshot" PNG containing the
// export QR of one case from testdata/vectors.json. Every secret in that file
// is fake, so the image is safe to use for manual testing of the CLI and of
// the web page.
//
//	go run ./internal/tools/sampleqr two_accounts_issuer_repeated_in_name sample.png
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/kevinkirsten/otp-out/internal/fixtures"
)

type vectors struct {
	Cases []struct {
		Name  string `json:"name"`
		Input string `json:"input"`
		Error bool   `json:"error"`
	} `json:"cases"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "sampleqr:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 2 {
		return fmt.Errorf("usage: sampleqr <case name> <output.png> (run from the repository root)")
	}
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		return err
	}
	var doc vectors
	if err := json.Unmarshal(raw, &doc); err != nil {
		return err
	}
	for _, c := range doc.Cases {
		if c.Name != args[0] || c.Error {
			continue
		}
		img, err := fixtures.PhoneScreenshot(0.6, c.Input)
		if err != nil {
			return err
		}
		png, err := fixtures.EncodePNG(img)
		if err != nil {
			return err
		}
		return os.WriteFile(args[1], png, 0o600)
	}
	return fmt.Errorf("no decodable case named %q in testdata/vectors.json", args[0])
}
