// Package cli is the otp-out command: argument parsing, inputs, output
// modes and error handling.
//
// Output contract: stdout only carries what the user asked for (URIs,
// secrets, JSON or the dry-run list). Every warning, question and status
// line goes to stderr, so stdout can be piped.
package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/kevinkirsten/otp-out/internal/clipboard"
	"github.com/kevinkirsten/otp-out/internal/migration"
	"github.com/kevinkirsten/otp-out/internal/onepassword"
	"github.com/kevinkirsten/otp-out/internal/terminal"
	"github.com/kevinkirsten/otp-out/internal/usererr"
)

// Exit codes.
const (
	ExitOK          = 0
	ExitError       = 1
	ExitUsage       = 2
	ExitSkipped     = 3 // some accounts use an algorithm that cannot be exported
	ExitInterrupted = 130
)

// Env is everything the command touches, so tests can replace it.
type Env struct {
	Args   []string
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer

	// StdinIsTerminal reports whether stdin is an interactive terminal.
	StdinIsTerminal func() bool
	// Prompter returns the terminal used for questions, or an error when
	// there is none (for example in a pipeline without a terminal).
	Prompter func() (Prompter, error)
	// ReadQR returns the texts of the QR codes in an image file.
	ReadQR func(path string) ([]string, error)
	// NewClipboard returns the system clipboard.
	NewClipboard func() (clipboard.Clipboard, error)
	// OpRunner runs the 1Password CLI.
	OpRunner onepassword.Runner
	// Interrupts delivers Ctrl+C and termination signals (nil: none).
	Interrupts <-chan os.Signal
	// Exit ends the process from the interrupt handler.
	Exit func(code int)
	// Version is printed by --version.
	Version string
}

// Prompter asks the user questions on the terminal.
type Prompter interface {
	Ask(prompt string) (string, error)
	ReadHidden(prompt string) (string, error)
}

type mode int

const (
	modeURIs mode = iota
	modeSecrets
	modeJSON
	modeDryRun
	modeClipboard
	modeOp
)

var modeFlags = map[string]mode{
	"--secrets":   modeSecrets,
	"--json":      modeJSON,
	"--dry-run":   modeDryRun,
	"--clipboard": modeClipboard,
	"--op":        modeOp,
}

type options struct {
	mode        mode
	modeFlag    string
	help        bool
	version     bool
	positionals []string
}

type usageError struct{ msg string }

func (e *usageError) Error() string { return e.msg }

func parseArgs(args []string) (options, error) {
	var o options
	onlyPositionals := false
	// A leading "--" is dropped: package runners pass it through
	// ("pnpm run otp-out -- --dry-run print.png").
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	for _, a := range args {
		if onlyPositionals || a == "-" || !strings.HasPrefix(a, "-") {
			o.positionals = append(o.positionals, a)
			continue
		}
		if a == "--" {
			onlyPositionals = true
			continue
		}
		switch a {
		case "-h", "--help", "-help":
			o.help = true
			continue
		case "-v", "--version", "-version":
			o.version = true
			continue
		}
		name := a
		if !strings.HasPrefix(name, "--") {
			name = "-" + name // accept -json like --json
		}
		m, ok := modeFlags[name]
		if !ok {
			return o, &usageError{fmt.Sprintf("unknown option %s (see otp-out --help)", a)}
		}
		if o.modeFlag != "" && o.modeFlag != name {
			return o, &usageError{fmt.Sprintf("%s and %s cannot be used together", o.modeFlag, name)}
		}
		o.mode, o.modeFlag = m, name
	}
	return o, nil
}

// state is shared with the interrupt handler.
type state struct {
	mu       sync.Mutex
	cleanups []func()
}

func (s *state) addCleanup(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanups = append(s.cleanups, fn)
}

func (s *state) runCleanups() {
	s.mu.Lock()
	fns := s.cleanups
	s.cleanups = nil
	s.mu.Unlock()
	for i := len(fns) - 1; i >= 0; i-- {
		fns[i]()
	}
}

// Run executes the command and returns the exit code.
func Run(env Env) (code int) {
	st := &state{}
	stop := make(chan struct{})
	defer close(stop)
	if env.Interrupts != nil {
		go func() {
			select {
			case <-env.Interrupts:
				terminal.RestoreAll()
				st.runCleanups()
				fmt.Fprintln(env.Stderr, "\nInterrupted.")
				if env.Exit != nil {
					env.Exit(ExitInterrupted)
				}
			case <-stop:
			}
		}()
	}
	defer func() {
		if r := recover(); r != nil {
			st.runCleanups()
			// Only the type: the value could carry QR data.
			fmt.Fprintf(env.Stderr, "Unexpected error (%T). Nothing from the QR code was shown.\n", r)
			code = ExitError
		}
	}()

	opts, err := parseArgs(env.Args)
	if err != nil {
		fmt.Fprintf(env.Stderr, "Error: %s\n", err)
		return ExitUsage
	}
	if opts.help {
		fmt.Fprint(env.Stdout, helpText)
		return ExitOK
	}
	if opts.version {
		fmt.Fprintf(env.Stdout, "otp-out %s\n", env.Version)
		return ExitOK
	}
	code, err = run(env, opts, st)
	st.runCleanups()
	if err != nil {
		return report(env.Stderr, err)
	}
	return code
}

func report(w io.Writer, err error) int {
	var ue *usageError
	var opErr *onepassword.OpError
	switch {
	case errors.Is(err, terminal.ErrInterrupted), errors.Is(err, io.EOF):
		fmt.Fprintln(w, "\nInterrupted.")
		return ExitInterrupted
	case errors.As(err, &ue):
		fmt.Fprintf(w, "Error: %s\n", ue.msg)
		return ExitUsage
	case errors.As(err, &opErr):
		fmt.Fprintf(w, "Error: %s\n", opErr.Error())
		return ExitError
	}
	if msg, ok := usererr.Message(err); ok {
		fmt.Fprintf(w, "Error: %s\n", msg)
		return ExitError
	}
	// Unexpected error: only the type, the message could carry QR data.
	fmt.Fprintf(w, "Unexpected error (%T). Nothing from the QR code was shown.\n", err)
	return ExitError
}

const maxStdin = 1 << 20

func gatherSources(env Env, opts options) (sources []migration.Source, images []string, argumentLink bool, err error) {
	usedStdin := false
	for _, p := range opts.positionals {
		switch {
		case p == "-":
			if usedStdin {
				return nil, nil, false, &usageError{"- can only be given once"}
			}
			usedStdin = true
			data, readErr := io.ReadAll(io.LimitReader(env.Stdin, maxStdin+1))
			if readErr != nil {
				return nil, nil, false, usererr.New("could not read stdin")
			}
			if len(data) > maxStdin {
				return nil, nil, false, usererr.New("stdin is larger than 1 MB")
			}
			sources = append(sources, migration.Source{Name: "text read from stdin", Payloads: strings.Fields(string(data))})
		case migration.IsMigrationURI(p):
			argumentLink = true
			sources = append(sources, migration.Source{Name: "argument", Payloads: []string{p}})
		default:
			payloads, readErr := env.ReadQR(p)
			if readErr != nil {
				return nil, nil, false, readErr
			}
			images = append(images, p)
			sources = append(sources, migration.Source{Name: p, Image: true, Payloads: payloads})
		}
	}
	if len(opts.positionals) == 0 {
		if env.StdinIsTerminal == nil || !env.StdinIsTerminal() {
			return nil, nil, false, &usageError{"no input: pass a screenshot of the export QR code, the export link, or - to read the link from stdin"}
		}
		p, perr := env.Prompter()
		if perr != nil {
			return nil, nil, false, usererr.New("no terminal to read the link from; pass - to read it from stdin")
		}
		text, rerr := p.ReadHidden("Paste the otpauth-migration:// link and press Enter (it will not be shown): ")
		if rerr != nil {
			return nil, nil, false, rerr
		}
		fmt.Fprintf(env.Stderr, "Received %d characters.\n", len(strings.TrimSpace(text)))
		sources = append(sources, migration.Source{Name: "pasted text", Payloads: strings.Fields(text)})
	}
	return sources, images, argumentLink, nil
}

func run(env Env, opts options, st *state) (int, error) {
	sources, images, argumentLink, err := gatherSources(env, opts)
	if err != nil {
		return ExitError, err
	}
	collection, err := migration.Collect(sources)
	if err != nil {
		return ExitError, err
	}
	for _, gap := range collection.Gaps {
		fmt.Fprintln(env.Stderr, gap.Warning())
	}

	var supported []migration.Account
	skipped := 0
	for _, a := range collection.Accounts {
		if a.Supported() {
			supported = append(supported, a)
			continue
		}
		skipped++
		fmt.Fprintf(env.Stderr, "Skipped %s: the %s algorithm is not supported by authenticator apps.\n", a.Label(), a.Algorithm)
	}

	switch opts.mode {
	case modeDryRun:
		fmt.Fprintf(env.Stderr, "%d account(s) in the export:\n", len(collection.Accounts))
		for _, a := range collection.Accounts {
			fmt.Fprintln(env.Stdout, a.Describe())
		}
	case modeURIs, modeSecrets:
		for _, a := range supported {
			if opts.mode == modeSecrets {
				fmt.Fprintln(env.Stdout, a.SecretBase32())
				continue
			}
			uri, uriErr := a.URI()
			if uriErr != nil {
				return ExitError, uriErr
			}
			fmt.Fprintln(env.Stdout, uri)
		}
		fmt.Fprintf(env.Stderr, "%d account(s) exported.\n", len(supported))
	case modeJSON:
		if err := writeJSON(env.Stdout, supported); err != nil {
			return ExitError, err
		}
		fmt.Fprintf(env.Stderr, "%d account(s) exported.\n", len(supported))
	case modeClipboard:
		if err := copyOneByOne(env, st, supported); err != nil {
			return ExitError, err
		}
	case modeOp:
		p, perr := env.Prompter()
		if perr != nil {
			return ExitError, usererr.New("--op needs an interactive terminal to ask where to save each account")
		}
		session := &onepassword.Session{Client: onepassword.New(env.OpRunner), Ask: p.Ask, Out: env.Stderr}
		if _, err := session.Run(supported); err != nil {
			return ExitError, err
		}
	}

	if argumentLink {
		fmt.Fprintln(env.Stderr, "Note: a link passed as an argument stays in your shell history. Next time run otp-out without arguments to paste it hidden, or pipe it with -.")
	}
	if len(images) > 0 && opts.mode != modeDryRun {
		fmt.Fprintln(env.Stderr, "Reminder: the screenshot contains these secrets. Delete it, and its copies in your phone's photos and cloud backup, when you are done.")
	}
	if skipped > 0 {
		return ExitSkipped, nil
	}
	return ExitOK, nil
}

type jsonAccount struct {
	Issuer    string  `json:"issuer"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Algorithm string  `json:"algorithm"`
	Digits    int     `json:"digits"`
	Counter   *uint64 `json:"counter,omitempty"`
	Period    *int    `json:"period,omitempty"`
	Secret    string  `json:"secret"`
	URI       string  `json:"uri"`
}

func writeJSON(w io.Writer, accounts []migration.Account) error {
	list := make([]jsonAccount, 0, len(accounts))
	for _, a := range accounts {
		uri, err := a.URI()
		if err != nil {
			return err
		}
		j := jsonAccount{Issuer: a.Issuer, Name: a.Name, Type: a.Type, Algorithm: a.Algorithm, Digits: a.Digits, Secret: a.SecretBase32(), URI: uri}
		if a.Type == "hotp" {
			counter := a.Counter
			j.Counter = &counter
		} else {
			period := 30
			j.Period = &period
		}
		list = append(list, j)
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(list); err != nil {
		return usererr.New("could not write the JSON output")
	}
	return nil
}

// copyOneByOne puts each URI on the clipboard, one at a time, without
// showing it, and empties the clipboard at the end, also on error and on
// Ctrl+C (through the cleanup registered in st).
func copyOneByOne(env Env, st *state, accounts []migration.Account) (err error) {
	p, perr := env.Prompter()
	if perr != nil {
		return usererr.New("--clipboard needs an interactive terminal to wait for Enter between accounts")
	}
	if len(accounts) == 0 {
		fmt.Fprintln(env.Stderr, "No account to copy.")
		return nil
	}
	clip, err := env.NewClipboard()
	if err != nil {
		return err
	}
	var once sync.Once
	clear := func() {
		once.Do(func() {
			if clearErr := clip.Clear(); clearErr != nil {
				fmt.Fprintln(env.Stderr, "Warning: could not clear the clipboard. Copy something else to replace it.")
				return
			}
			fmt.Fprintln(env.Stderr, "Clipboard cleared.")
		})
	}
	st.addCleanup(clear)
	defer clear()

	warned := false
	for i, a := range accounts {
		uri, uriErr := a.URI()
		if uriErr != nil {
			return uriErr
		}
		concealed, copyErr := clip.Copy(uri)
		if copyErr != nil {
			return copyErr
		}
		fmt.Fprintf(env.Stderr, "\n[%d/%d] %s: copied to the clipboard.\n", i+1, len(accounts), a.Describe())
		if !concealed && !warned {
			warned = true
			fmt.Fprintln(env.Stderr, "  Note: this system cannot mark the copied text as sensitive, so a clipboard history app may keep it.")
		}
		fmt.Fprintln(env.Stderr, "  Paste it in your authenticator app (1Password: Edit > + Add More > One-Time Password).")
		prompt := "  Press Enter for the next account... "
		if i == len(accounts)-1 {
			prompt = "  Press Enter to clear the clipboard... "
		}
		if _, askErr := p.Ask(prompt); askErr != nil {
			return askErr
		}
	}
	return nil
}
