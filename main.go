// Command otp-out turns a Google Authenticator export QR code
// (otpauth-migration://offline?data=...) into otpauth:// URIs, one per
// account, to add them to another authenticator or password manager.
//
// The program is in the repository root so that
// "go run github.com/kevinkirsten/otp-out@latest" works; the logic is in
// internal/.
package main

import (
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	"golang.org/x/term"

	"github.com/kevinkirsten/otp-out/internal/cli"
	"github.com/kevinkirsten/otp-out/internal/clipboard"
	"github.com/kevinkirsten/otp-out/internal/onepassword"
	"github.com/kevinkirsten/otp-out/internal/qrimage"
	"github.com/kevinkirsten/otp-out/internal/terminal"
)

// version is set by the release build (-ldflags "-X main.version=...").
var version = "dev"

func currentVersion() string {
	if version != "dev" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return version
}

func main() {
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)

	var tty *terminal.TTY
	prompter := func() (cli.Prompter, error) {
		if tty != nil {
			return tty, nil
		}
		t, err := terminal.Open(os.Stdin, os.Stderr)
		if err != nil {
			return nil, err
		}
		tty = t
		return tty, nil
	}

	code := cli.Run(cli.Env{
		Args:            os.Args[1:],
		Stdin:           os.Stdin,
		Stdout:          os.Stdout,
		Stderr:          os.Stderr,
		StdinIsTerminal: func() bool { return term.IsTerminal(int(os.Stdin.Fd())) },
		Prompter:        prompter,
		ReadQR:          qrimage.ReadFile,
		NewClipboard:    clipboard.New,
		OpRunner:        onepassword.DefaultRunner,
		Interrupts:      interrupts,
		Exit:            os.Exit,
		Version:         currentVersion(),
	})
	if tty != nil {
		_ = tty.Close()
	}
	os.Exit(code)
}
