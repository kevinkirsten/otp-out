package cli

// Every secret here is FAKE. The 1Password CLI is always a fake runner and
// the clipboard is always a fake: no test touches the real ones.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kevinkirsten/otp-out/internal/clipboard"
	"github.com/kevinkirsten/otp-out/internal/fixtures"
	"github.com/kevinkirsten/otp-out/internal/onepassword"
	"github.com/kevinkirsten/otp-out/internal/terminal"
	"github.com/kevinkirsten/otp-out/internal/usererr"
)

// ---------------------------------------------------------------- fakes

type scriptedPrompter struct {
	mu      sync.Mutex
	answers []string
	hidden  string
	asked   []string
	block   chan struct{} // when set, Ask waits on it
}

func (p *scriptedPrompter) Ask(prompt string) (string, error) {
	p.mu.Lock()
	p.asked = append(p.asked, prompt)
	block := p.block
	p.mu.Unlock()
	if block != nil {
		<-block
		return "", terminal.ErrInterrupted
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.answers) == 0 {
		return "", fmt.Errorf("unexpected question %q", prompt)
	}
	a := p.answers[0]
	p.answers = p.answers[1:]
	return a, nil
}

func (p *scriptedPrompter) ReadHidden(string) (string, error) { return p.hidden, nil }

type fakeClipboard struct {
	mu      sync.Mutex
	copied  []string
	cleared int
	failAt  int // 1-based copy that fails; 0 never
}

func (c *fakeClipboard) Copy(text string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.copied = append(c.copied, text)
	if c.failAt != 0 && len(c.copied) == c.failAt {
		return false, usererr.New("could not write to the clipboard")
	}
	return true, nil
}

func (c *fakeClipboard) Clear() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cleared++
	return nil
}

type fakeOp struct {
	items        []map[string]any
	vaults       []map[string]any
	otpItems     map[string]bool
	ssoItems     map[string]bool
	failEditWith string
	calls        [][]string
}

func (f *fakeOp) run(args []string) (onepassword.Result, error) {
	f.calls = append(f.calls, append([]string(nil), args...))
	js := func(v any) string { b, _ := json.Marshal(v); return string(b) }
	switch {
	case args[0] == "item" && args[1] == "list":
		return onepassword.Result{Stdout: js(f.items)}, nil
	case args[0] == "vault" && args[1] == "list":
		vaults := f.vaults
		if vaults == nil {
			vaults = []map[string]any{{"id": "vault1", "name": "Private"}}
		}
		return onepassword.Result{Stdout: js(vaults)}, nil
	case args[0] == "item" && args[1] == "get":
		fields := []map[string]any{{"id": "username", "type": "STRING", "label": "username"}}
		if f.otpItems[args[2]] {
			fields = append(fields, map[string]any{"id": "x", "type": "OTP", "label": "2FA", "value": "otpauth://totp/old?secret=OLDOLDOLD"})
		}
		item := map[string]any{"id": args[2], "fields": fields}
		if f.ssoItems[args[2]] {
			item["fields"] = append(fields, map[string]any{"id": "sso", "type": "SSOLOGIN", "label": "sign in with"})
		}
		return onepassword.Result{Stdout: js(item)}, nil
	case args[0] == "item" && (args[1] == "edit" || args[1] == "create"):
		if f.failEditWith != "" {
			return onepassword.Result{ExitCode: 1, Stderr: fmt.Sprintf(f.failEditWith, args[len(args)-1])}, nil
		}
		return onepassword.Result{Stdout: "{}"}, nil
	}
	return onepassword.Result{}, fmt.Errorf("unexpected op call %v", args)
}

func (f *fakeOp) writes() [][]string {
	var out [][]string
	for _, c := range f.calls {
		if c[0] == "item" && (c[1] == "edit" || c[1] == "create") {
			out = append(out, c)
		}
	}
	return out
}

var items = []map[string]any{
	{"id": "id-exemplo", "title": "Exemplo", "category": "LOGIN", "additional_information": "ana@exemplo.com",
		"vault": map[string]any{"name": "Private"}, "urls": []map[string]any{{"href": "https://exemplo.com.br/login"}}},
	{"id": "id-git", "title": "Repositório", "category": "LOGIN", "urls": []map[string]any{{"href": "github.com"}}},
	{"id": "id-other", "title": "Banco Qualquer", "category": "LOGIN"},
}

type harness struct {
	env      Env
	stdout   *bytes.Buffer
	stderr   *bytes.Buffer
	prompter *scriptedPrompter
	clip     *fakeClipboard
	op       *fakeOp
	readQR   func(string) ([]string, error)
	tty      bool
	noPrompt bool
}

func newHarness(args ...string) *harness {
	h := &harness{
		stdout:   &bytes.Buffer{},
		stderr:   &bytes.Buffer{},
		prompter: &scriptedPrompter{},
		clip:     &fakeClipboard{},
		op:       &fakeOp{items: items},
	}
	payload := fixtures.SimpleURI()
	h.readQR = func(string) ([]string, error) { return []string{payload}, nil }
	h.env = Env{
		Args:            args,
		Stdin:           strings.NewReader(""),
		Stdout:          h.stdout,
		Stderr:          h.stderr,
		StdinIsTerminal: func() bool { return h.tty },
		Prompter: func() (Prompter, error) {
			if h.noPrompt {
				return nil, terminal.ErrNoTerminal
			}
			return h.prompter, nil
		},
		ReadQR:       func(p string) ([]string, error) { return h.readQR(p) },
		NewClipboard: func() (clipboard.Clipboard, error) { return h.clip, nil },
		OpRunner:     func(a []string) (onepassword.Result, error) { return h.op.run(a) },
		Version:      "test",
	}
	return h
}

func (h *harness) run() int { return Run(h.env) }

func assertNoSecret(t *testing.T, texts ...string) {
	t.Helper()
	for _, text := range texts {
		for _, bad := range []string{fixtures.FakeSecretB32, fixtures.OtherSecretB32, "otpauth://", "otpauth-migration://", "OLDOLDOLD"} {
			if strings.Contains(text, bad) {
				t.Errorf("output contains %q:\n%s", bad, text)
			}
		}
	}
}

// ---------------------------------------------------------------- outputs

func TestDefaultPrintsURIs(t *testing.T) {
	h := newHarness("print.png")
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if h.stdout.String() != fixtures.SimpleOTPAuth+"\n" {
		t.Errorf("stdout = %q", h.stdout)
	}
	assertNoSecret(t, h.stderr.String())
	if !strings.Contains(h.stderr.String(), "Reminder: the screenshot contains these secrets") {
		t.Error("missing screenshot reminder")
	}
	if len(h.op.calls) != 0 {
		t.Error("op was called")
	}
}

func TestSecrets(t *testing.T) {
	h := newHarness("--secrets", "print.png")
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if h.stdout.String() != fixtures.FakeSecretB32+"\n" {
		t.Errorf("stdout = %q", h.stdout)
	}
}

func TestJSON(t *testing.T) {
	h := newHarness("print.png", "--json")
	hotp := fixtures.OTP{Secret: fixtures.OtherSecret, Name: "bia", Issuer: "Outra", Algorithm: 1, Digits: 1, Type: 1, Counter: 5}
	uri := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "ana@exemplo.com", "Exemplo"), hotp}, 1, 0, 1))
	h.readQR = func(string) ([]string, error) { return []string{uri}, nil }
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	var got []map[string]any
	if err := json.Unmarshal(h.stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d entries", len(got))
	}
	if got[0]["period"] != float64(30) || got[0]["counter"] != nil || got[0]["uri"] != fixtures.SimpleOTPAuth || got[0]["secret"] != fixtures.FakeSecretB32 {
		t.Errorf("totp entry = %v", got[0])
	}
	if got[1]["counter"] != float64(5) || got[1]["period"] != nil || got[1]["type"] != "hotp" {
		t.Errorf("hotp entry = %v", got[1])
	}
	keys := []string{"issuer", "name", "type", "algorithm", "digits", "secret", "uri"}
	for _, k := range keys {
		if _, ok := got[0][k]; !ok {
			t.Errorf("missing key %s", k)
		}
	}
	if strings.Contains(h.stdout.String(), `\u0026`) {
		t.Error("JSON escapes & in the URI")
	}
}

func TestJSONEmptyIsArray(t *testing.T) {
	h := newHarness("--json", "print.png")
	md5 := fixtures.TOTP(fixtures.FakeSecret, "a", "b")
	md5.Algorithm = 4
	h.readQR = func(string) ([]string, error) {
		return []string{fixtures.URI(fixtures.Payload([]fixtures.OTP{md5}, 1, 0, 1))}, nil
	}
	if code := h.run(); code != ExitSkipped {
		t.Fatalf("exit %d", code)
	}
	if strings.TrimSpace(h.stdout.String()) != "[]" {
		t.Errorf("stdout = %q", h.stdout)
	}
}

func TestDryRunListsOnlyIssuerAndName(t *testing.T) {
	h := newHarness("print.png", "--dry-run")
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if h.stdout.String() != "Exemplo / ana@exemplo.com (TOTP)\n" {
		t.Errorf("stdout = %q", h.stdout)
	}
	if len(h.op.calls) != 0 || len(h.clip.copied) != 0 {
		t.Error("dry-run touched op or clipboard")
	}
	assertNoSecret(t, h.stdout.String(), h.stderr.String())
}

func TestMD5IsSkippedOthersEmitted(t *testing.T) {
	md5 := fixtures.TOTP(fixtures.OtherSecret, "velho", "Legado")
	md5.Algorithm = 4
	uri := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "ana@exemplo.com", "Exemplo"), md5}, 1, 0, 1))
	h := newHarness("print.png")
	h.readQR = func(string) ([]string, error) { return []string{uri}, nil }
	code := h.run()
	if code != ExitSkipped {
		t.Fatalf("exit %d, want %d", code, ExitSkipped)
	}
	if h.stdout.String() != fixtures.SimpleOTPAuth+"\n" {
		t.Errorf("stdout = %q", h.stdout)
	}
	if !strings.Contains(h.stderr.String(), "Skipped Legado / velho: the MD5 algorithm") {
		t.Errorf("stderr = %q", h.stderr)
	}
	assertNoSecret(t, h.stderr.String())
}

func TestPartialBatchWarning(t *testing.T) {
	uri := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "a", "Exemplo")}, 2, 0, 9))
	h := newHarness("--dry-run", "print.png")
	h.readQR = func(string) ([]string, error) { return []string{uri}, nil }
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "has 2 QR codes and only 1 were read") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

func TestSeveralImagesCompleteBatch(t *testing.T) {
	p1 := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "a", "x")}, 2, 0, 9))
	p2 := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.OtherSecret, "b", "y")}, 2, 1, 9))
	h := newHarness("one.png", "two.png")
	h.readQR = func(p string) ([]string, error) {
		if p == "one.png" {
			return []string{p1}, nil
		}
		return []string{p2}, nil
	}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if lines := strings.Split(strings.TrimSpace(h.stdout.String()), "\n"); len(lines) != 2 {
		t.Errorf("lines = %v", lines)
	}
	if strings.Contains(h.stderr.String(), "Warning") {
		t.Errorf("unexpected warning: %s", h.stderr)
	}
}

func TestQRThatIsNotAnExport(t *testing.T) {
	h := newHarness("--dry-run", "print.png")
	h.readQR = func(string) ([]string, error) { return []string{"https://exemplo.com"}, nil }
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "print.png has no Google Authenticator export QR code") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

func TestUnexpectedErrorHidesMessage(t *testing.T) {
	h := newHarness("--dry-run", "print.png")
	h.readQR = func(string) ([]string, error) {
		return nil, errors.New("otpauth-migration://offline?data=SEGREDO")
	}
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "*errors.errorString") || strings.Contains(h.stderr.String()+h.stdout.String(), "SEGREDO") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

func TestPanicHidesValue(t *testing.T) {
	h := newHarness("print.png")
	h.readQR = func(string) ([]string, error) { panic("otpauth-migration://offline?data=SEGREDO") }
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "Unexpected error (string)") || strings.Contains(h.stderr.String(), "SEGREDO") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

// ---------------------------------------------------------------- inputs

func TestIncoherentFlags(t *testing.T) {
	pairs := [][]string{{"--json", "--clipboard"}, {"--secrets", "--json"}, {"--dry-run", "--op"}, {"--clipboard", "--op"}}
	for _, p := range pairs {
		h := newHarness(append(p, "print.png")...)
		if code := h.run(); code != ExitUsage {
			t.Errorf("%v: exit %d", p, code)
		}
		if !strings.Contains(h.stderr.String(), "cannot be used together") {
			t.Errorf("%v: stderr = %q", p, h.stderr)
		}
	}
	h := newHarness("--json", "--json", "print.png")
	if code := h.run(); code != 0 {
		t.Errorf("repeated flag: exit %d", code)
	}
}

func TestLeadingDoubleDashFromPackageRunners(t *testing.T) {
	h := newHarness("--", "--dry-run", "print.png")
	if code := h.run(); code != 0 || !strings.Contains(h.stdout.String(), "Exemplo / ana") {
		t.Errorf("exit %d, stdout %q, stderr %q", code, h.stdout, h.stderr)
	}
	// A later "--" still ends the options.
	var seen []string
	h = newHarness("--dry-run", "--", "--odd-name.png")
	h.readQR = func(p string) ([]string, error) { seen = append(seen, p); return []string{fixtures.SimpleURI()}, nil }
	if code := h.run(); code != 0 || len(seen) != 1 || seen[0] != "--odd-name.png" {
		t.Errorf("exit %d, seen %v", code, seen)
	}
}

func TestUnknownFlag(t *testing.T) {
	h := newHarness("--nope", "print.png")
	if code := h.run(); code != ExitUsage || !strings.Contains(h.stderr.String(), "unknown option --nope") {
		t.Errorf("exit %d, stderr %q", code, h.stderr)
	}
}

func TestHelpAndVersion(t *testing.T) {
	h := newHarness("--help")
	if code := h.run(); code != 0 || !strings.Contains(h.stdout.String(), "Examples:") {
		t.Errorf("help: %d %q", code, h.stdout)
	}
	h = newHarness("--version")
	if code := h.run(); code != 0 || h.stdout.String() != "otp-out test\n" {
		t.Errorf("version: %d %q", code, h.stdout)
	}
}

func TestNoArgumentWithoutTerminal(t *testing.T) {
	h := newHarness()
	if code := h.run(); code != ExitUsage || !strings.Contains(h.stderr.String(), "no input") {
		t.Errorf("exit %d, stderr %q", code, h.stderr)
	}
}

func TestNoArgumentPromptsHidden(t *testing.T) {
	h := newHarness()
	h.tty = true
	h.prompter.hidden = "  " + fixtures.SimpleURI() + "  "
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if h.stdout.String() != fixtures.SimpleOTPAuth+"\n" {
		t.Errorf("stdout = %q", h.stdout)
	}
	assertNoSecret(t, h.stderr.String())
	if strings.Contains(h.stderr.String(), "shell history") || strings.Contains(h.stderr.String(), "screenshot") {
		t.Errorf("unexpected notes: %s", h.stderr)
	}
}

func TestStdinDash(t *testing.T) {
	h := newHarness("-", "--secrets")
	h.env.Stdin = strings.NewReader(fixtures.SimpleURI() + "\n")
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if h.stdout.String() != fixtures.FakeSecretB32+"\n" {
		t.Errorf("stdout = %q", h.stdout)
	}
}

func TestStdinNotALink(t *testing.T) {
	h := newHarness("-")
	h.env.Stdin = strings.NewReader("hello")
	if code := h.run(); code != 1 || !strings.Contains(h.stderr.String(), "text read from stdin is not") {
		t.Errorf("exit %d, stderr %q", code, h.stderr)
	}
}

func TestLinkArgumentWarnsAboutHistory(t *testing.T) {
	h := newHarness(fixtures.SimpleURI())
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "shell history") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

func TestBadLinkErrorHasNoData(t *testing.T) {
	h := newHarness("otpauth-migration://offline?data=SEGREDO%%%")
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if strings.Contains(h.stderr.String(), "SEGREDO") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

// ---------------------------------------------------------------- clipboard

func TestClipboardCopiesWithoutShowingAndClears(t *testing.T) {
	h := newHarness("print.png", "--clipboard")
	h.prompter.answers = []string{""}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if len(h.clip.copied) != 1 || h.clip.copied[0] != fixtures.SimpleOTPAuth {
		t.Errorf("copied = %d items", len(h.clip.copied))
	}
	if h.clip.cleared != 1 {
		t.Errorf("cleared %d times", h.clip.cleared)
	}
	if h.stdout.Len() != 0 {
		t.Errorf("stdout not empty: %q", h.stdout)
	}
	if len(h.op.calls) != 0 {
		t.Error("op was called")
	}
	assertNoSecret(t, h.stdout.String(), h.stderr.String())
	if !strings.Contains(h.stderr.String(), "Clipboard cleared.") {
		t.Errorf("stderr = %q", h.stderr)
	}
}

func TestClipboardClearsOnError(t *testing.T) {
	two := fixtures.URI(fixtures.Payload([]fixtures.OTP{
		fixtures.TOTP(fixtures.FakeSecret, "a", "x"), fixtures.TOTP(fixtures.OtherSecret, "b", "y"),
	}, 1, 0, 1))
	h := newHarness("--clipboard", "print.png")
	h.readQR = func(string) ([]string, error) { return []string{two}, nil }
	h.clip.failAt = 2
	h.prompter.answers = []string{""}
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if h.clip.cleared != 1 {
		t.Errorf("cleared %d times", h.clip.cleared)
	}
	assertNoSecret(t, h.stdout.String(), h.stderr.String())
}

func TestClipboardClearsOnEOF(t *testing.T) {
	h := newHarness("--clipboard", "print.png")
	// No answers: Ask returns an error like Ctrl+D.
	h.prompter.answers = nil
	h.env.Prompter = func() (Prompter, error) { return eofPrompter{}, nil }
	if code := h.run(); code != ExitInterrupted {
		t.Fatalf("exit %d", code)
	}
	if h.clip.cleared != 1 {
		t.Errorf("cleared %d times", h.clip.cleared)
	}
}

type eofPrompter struct{}

func (eofPrompter) Ask(string) (string, error)        { return "", io.EOF }
func (eofPrompter) ReadHidden(string) (string, error) { return "", io.EOF }

func TestClipboardClearsOnInterrupt(t *testing.T) {
	h := newHarness("--clipboard", "print.png")
	block := make(chan struct{})
	h.prompter.block = block
	signals := make(chan os.Signal, 1)
	exited := make(chan int, 1)
	h.env.Interrupts = signals
	h.env.Exit = func(code int) { exited <- code }
	done := make(chan int, 1)
	go func() { done <- h.run() }()
	// Wait until the program is waiting for Enter.
	deadline := time.After(5 * time.Second)
	for {
		h.prompter.mu.Lock()
		n := len(h.prompter.asked)
		h.prompter.mu.Unlock()
		if n > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("never asked")
		case <-time.After(5 * time.Millisecond):
		}
	}
	signals <- os.Interrupt
	select {
	case code := <-exited:
		if code != ExitInterrupted {
			t.Errorf("exit %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("interrupt handler did not exit")
	}
	h.clip.mu.Lock()
	cleared := h.clip.cleared
	h.clip.mu.Unlock()
	if cleared != 1 {
		t.Errorf("cleared %d times before exit", cleared)
	}
	close(block)
	<-done
	h.clip.mu.Lock()
	defer h.clip.mu.Unlock()
	if h.clip.cleared != 1 {
		t.Errorf("cleared %d times in total", h.clip.cleared)
	}
}

func TestClipboardNeedsTerminal(t *testing.T) {
	h := newHarness("--clipboard", "print.png")
	h.noPrompt = true
	if code := h.run(); code != 1 || !strings.Contains(h.stderr.String(), "needs an interactive terminal") {
		t.Errorf("exit %d, stderr %q", code, h.stderr)
	}
	if len(h.clip.copied) != 0 {
		t.Error("copied without a terminal")
	}
}

// ---------------------------------------------------------------- 1Password

func TestOpEditExistingItemWithoutOTP(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.prompter.answers = []string{"1"}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	want := [][]string{{"item", "edit", "id-exemplo", "one-time password[otp]=" + fixtures.SimpleOTPAuth}}
	if fmt.Sprint(h.op.writes()) != fmt.Sprint(want) {
		t.Errorf("writes = %v", h.op.writes())
	}
	assertNoSecret(t, h.stdout.String(), h.stderr.String())
	if !strings.Contains(h.stderr.String(), "Reminder: the screenshot contains these secrets") {
		t.Error("missing reminder")
	}
}

func TestOpAsksBeforeOverwrite(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.op.otpItems = map[string]bool{"id-exemplo": true}
	// Refuse to overwrite first, then accept.
	h.prompter.answers = []string{"1", "n", "1", "y"}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if !strings.Contains(h.stderr.String(), "Left as it was") {
		t.Errorf("stderr = %q", h.stderr)
	}
	writes := h.op.writes()
	if len(writes) != 1 || !strings.HasPrefix(writes[0][3], "2FA[otp]=otpauth://") {
		t.Errorf("writes = %v", writes)
	}
	assertNoSecret(t, h.stderr.String())
}

func TestOpCreateNewItemWithVaultChoice(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.op.vaults = []map[string]any{{"id": "v1", "name": "Private"}, {"id": "v2", "name": "Shared"}}
	h.prompter.answers = []string{"n", "", "2"}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	create := h.op.writes()[0]
	if fmt.Sprint(create[:8]) != fmt.Sprint([]string{"item", "create", "--category", "Login", "--title", "Exemplo", "--vault", "v2"}) {
		t.Errorf("create = %v", create)
	}
	if !strings.HasPrefix(create[8], "one-time password[otp]=otpauth://totp/") {
		t.Errorf("assignment = %q", create[8])
	}
	assertNoSecret(t, h.stderr.String())
}

func TestOpSearchOtherTermThenSkip(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.prompter.answers = []string{"f", "banco", "s"}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if !strings.Contains(h.stderr.String(), "Banco Qualquer") || !strings.Contains(h.stderr.String(), "Skipped: 1") {
		t.Errorf("stderr = %q", h.stderr)
	}
	if len(h.op.writes()) != 0 {
		t.Error("unexpected write")
	}
}

func TestOpErrorIsRedacted(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.op.failEditWith = "invalid assignment %s"
	h.prompter.answers = []string{"1"}
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "[redacted]") {
		t.Errorf("stderr = %q", h.stderr)
	}
	assertNoSecret(t, h.stdout.String(), h.stderr.String())
}

func TestOpSSOItemSuggestsClipboard(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.op.ssoItems = map[string]bool{"id-exemplo": true}
	h.op.failEditWith = "cannot edit item: unsupported field %s"
	h.prompter.answers = []string{"1"}
	if code := h.run(); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(h.stderr.String(), "--clipboard") || !strings.Contains(h.stderr.String(), "ssoLogin") {
		t.Errorf("stderr = %q", h.stderr)
	}
	assertNoSecret(t, h.stderr.String())
}

func TestOpNeverDeletesTheImage(t *testing.T) {
	dir := t.TempDir()
	image := dir + "/print.png"
	if err := os.WriteFile(image, []byte("fake"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := newHarness(image, "--op")
	h.prompter.answers = []string{"1"}
	if code := h.run(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if _, err := os.Stat(image); err != nil {
		t.Error("the image was removed")
	}
}

func TestOpNeedsTerminal(t *testing.T) {
	h := newHarness("print.png", "--op")
	h.noPrompt = true
	if code := h.run(); code != 1 || !strings.Contains(h.stderr.String(), "--op needs an interactive terminal") {
		t.Errorf("exit %d, stderr %q", code, h.stderr)
	}
}
