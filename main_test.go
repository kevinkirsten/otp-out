package main

// End-to-end tests: build the real binary, write SYNTHETIC QR screenshots
// (fake secrets only) into t.TempDir() and check what the binary prints.

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/kevinkirsten/otp-out/internal/fixtures"
)

var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "otp-out-e2e-")
	if err != nil {
		panic(err)
	}
	binary = filepath.Join(dir, "otp-out")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		_, _ = os.Stderr.Write(out)
		panic("build failed")
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

type result struct {
	code   int
	stdout string
	stderr string
}

func runBinary(t *testing.T, stdin string, args ...string) result {
	t.Helper()
	cmd := exec.Command(binary, args...)
	cmd.Stdin = strings.NewReader(stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			t.Fatalf("run: %v", err)
		}
		code = exitErr.ExitCode()
	}
	return result{code, stdout.String(), stderr.String()}
}

func writeImage(t *testing.T, name string, img image.Image, encode func(image.Image) ([]byte, error)) string {
	t.Helper()
	data, err := encode(img)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func screenshot(t *testing.T, fraction float64, texts ...string) image.Image {
	t.Helper()
	img, err := fixtures.PhoneScreenshot(fraction, texts...)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func assertClean(t *testing.T, texts ...string) {
	t.Helper()
	for _, text := range texts {
		for _, bad := range []string{fixtures.FakeSecretB32, fixtures.OtherSecretB32, "otpauth"} {
			if strings.Contains(text, bad) {
				t.Errorf("output contains %q:\n%s", bad, text)
			}
		}
	}
}

var twoAccounts = fixtures.URI(fixtures.Payload([]fixtures.OTP{
	fixtures.TOTP(fixtures.FakeSecret, "ana@exemplo.com", "Exemplo"),
	{Secret: fixtures.OtherSecret, Name: "bia@exemplo.com", Issuer: "Outra", Algorithm: 1, Digits: 1, Type: 1, Counter: 5},
}, 1, 0, 4242))

const twoAccountsOutput = fixtures.SimpleOTPAuth + "\n" +
	"otpauth://hotp/Outra:bia@exemplo.com?secret=" + fixtures.OtherSecretB32 + "&issuer=Outra&algorithm=SHA1&digits=6&counter=5\n"

func TestBinaryReadsEachFormat(t *testing.T) {
	img := screenshot(t, 0.6, twoAccounts)
	for name, enc := range map[string]func(image.Image) ([]byte, error){
		"print.png":  fixtures.EncodePNG,
		"print.jpg":  fixtures.EncodeJPEG,
		"print.webp": fixtures.EncodeWEBP,
	} {
		t.Run(name, func(t *testing.T) {
			path := writeImage(t, name, img, enc)
			r := runBinary(t, "", path)
			if r.code != 0 {
				t.Fatalf("exit %d: %s", r.code, r.stderr)
			}
			if r.stdout != twoAccountsOutput {
				t.Errorf("stdout:\n%s", r.stdout)
			}
			assertClean(t, r.stderr)
		})
	}
}

func TestBinaryDryRunNeverShowsSecrets(t *testing.T) {
	path := writeImage(t, "print.png", screenshot(t, 0.6, twoAccounts), fixtures.EncodePNG)
	r := runBinary(t, "", "--dry-run", path)
	if r.code != 0 {
		t.Fatalf("exit %d: %s", r.code, r.stderr)
	}
	want := "Exemplo / ana@exemplo.com (TOTP)\nOutra / bia@exemplo.com (HOTP)\n"
	if r.stdout != want {
		t.Errorf("stdout = %q", r.stdout)
	}
	assertClean(t, r.stdout, r.stderr)
}

func TestBinaryDenseQRMatchesVectors(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Cases []struct {
			Name     string `json:"name"`
			Input    string `json:"input"`
			Accounts []struct {
				URI string `json:"uri"`
			} `json:"accounts"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Cases {
		if c.Name != "ten_accounts_dense" {
			continue
		}
		path := writeImage(t, "dense.png", screenshot(t, 0.7, c.Input), fixtures.EncodePNG)
		r := runBinary(t, "", "--json", path)
		if r.code != 0 {
			t.Fatalf("exit %d: %s", r.code, r.stderr)
		}
		var got []struct {
			URI string `json:"uri"`
		}
		if err := json.Unmarshal([]byte(r.stdout), &got); err != nil {
			t.Fatal(err)
		}
		if len(got) != len(c.Accounts) {
			t.Fatalf("got %d accounts, want %d", len(got), len(c.Accounts))
		}
		for i := range got {
			if got[i].URI != c.Accounts[i].URI {
				t.Errorf("account %d: %s", i, got[i].URI)
			}
		}
		return
	}
	t.Fatal("dense case not found")
}

func TestBinarySmallQRInBigScreenshot(t *testing.T) {
	path := writeImage(t, "small.jpg", screenshot(t, 0.25, fixtures.SimpleURI()), fixtures.EncodeJPEG)
	r := runBinary(t, "", "--secrets", path)
	if r.code != 0 || r.stdout != fixtures.FakeSecretB32+"\n" {
		t.Fatalf("exit %d, stdout %q, stderr %s", r.code, r.stdout, r.stderr)
	}
}

func TestBinaryBatchAndMissingPart(t *testing.T) {
	p1 := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "a", "x")}, 2, 0, 77))
	p2 := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.OtherSecret, "b", "y")}, 2, 1, 77))
	one := writeImage(t, "one.png", screenshot(t, 0.6, p1), fixtures.EncodePNG)
	two := writeImage(t, "two.png", screenshot(t, 0.6, p2), fixtures.EncodePNG)

	r := runBinary(t, "", one, two)
	if r.code != 0 || strings.Count(r.stdout, "otpauth://totp/") != 2 || strings.Contains(r.stderr, "Warning") {
		t.Fatalf("both parts: exit %d, stdout %q, stderr %s", r.code, r.stdout, r.stderr)
	}
	r = runBinary(t, "", "--dry-run", one)
	if r.code != 0 || !strings.Contains(r.stderr, "has 2 QR codes and only 1 were read") {
		t.Fatalf("missing part: exit %d, stderr %s", r.code, r.stderr)
	}
}

func TestBinaryStdin(t *testing.T) {
	r := runBinary(t, fixtures.SimpleURI()+"\n", "-")
	if r.code != 0 || r.stdout != fixtures.SimpleOTPAuth+"\n" {
		t.Fatalf("exit %d, stdout %q, stderr %s", r.code, r.stdout, r.stderr)
	}
}

func TestBinaryErrorsDoNotLeak(t *testing.T) {
	notExport := writeImage(t, "other.png", screenshot(t, 0.5, "https://exemplo.com/"+fixtures.FakeSecretB32), fixtures.EncodePNG)
	broken := filepath.Join(t.TempDir(), "broken.png")
	if err := os.WriteFile(broken, []byte("\x89PNG\r\n\x1a\n"+fixtures.SimpleURI()), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := [][]string{
		{notExport},
		{broken},
		{"otpauth-migration://offline?data=" + fixtures.FakeSecretB32 + "%%%"},
		{"--json", "--clipboard", notExport},
		{filepath.Join(t.TempDir(), "missing.png")},
		{"-"},
		{"--unknown-flag"},
	}
	for _, args := range cases {
		r := runBinary(t, "not a link "+fixtures.FakeSecretB32, args...)
		if r.code == 0 {
			t.Errorf("%v: expected failure", args)
		}
		assertClean(t, r.stdout, r.stderr)
	}
}

func TestBinaryClipboardWithoutTerminalFailsBeforeCopying(t *testing.T) {
	path := writeImage(t, "print.png", screenshot(t, 0.6, fixtures.SimpleURI()), fixtures.EncodePNG)
	if runtime.GOOS == "windows" {
		t.Skip("cannot start a process without a console portably on Windows")
	}
	cmd := exec.Command(binary, "--clipboard", path)
	cmd.Stdin = strings.NewReader("")
	cmd.SysProcAttr = detachedAttr()
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	_ = cmd.Run()
	if cmd.ProcessState.ExitCode() != 1 || !strings.Contains(stderr.String(), "needs an interactive terminal") {
		t.Errorf("exit %d, stderr %s", cmd.ProcessState.ExitCode(), stderr.String())
	}
	assertClean(t, stdout.String(), stderr.String())
}

func TestBinaryMD5ExitCode(t *testing.T) {
	md5 := fixtures.TOTP(fixtures.OtherSecret, "velho", "Legado")
	md5.Algorithm = 4
	uri := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "ana@exemplo.com", "Exemplo"), md5}, 1, 0, 1))
	r := runBinary(t, uri, "-")
	if r.code != 3 || r.stdout != fixtures.SimpleOTPAuth+"\n" || !strings.Contains(r.stderr, "Skipped Legado / velho") {
		t.Fatalf("exit %d, stdout %q, stderr %s", r.code, r.stdout, r.stderr)
	}
	assertClean(t, r.stderr)
}

func TestBinaryVersionAndHelp(t *testing.T) {
	if r := runBinary(t, "", "--version"); r.code != 0 || !strings.HasPrefix(r.stdout, "otp-out ") {
		t.Errorf("version: %d %q", r.code, r.stdout)
	}
	if r := runBinary(t, "", "--help"); r.code != 0 || !strings.Contains(r.stdout, "--clipboard") {
		t.Errorf("help: %d", r.code)
	}
}
