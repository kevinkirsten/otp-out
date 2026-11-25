package clipboard

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

const fakeURI = "otpauth://totp/Exemplo:ana@exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=Exemplo" // gitleaks:allow (fake)

type call struct {
	path  string
	args  []string
	stdin string
}

type fakeRunner struct {
	calls []call
	fail  map[string]bool
}

func (f *fakeRunner) run(path string, args []string, stdin []byte) error {
	f.calls = append(f.calls, call{path, args, string(stdin)})
	if f.fail[path] {
		return errors.New("fail")
	}
	return nil
}

func TestTextGoesThroughStdinNeverArgs(t *testing.T) {
	for _, goos := range []string{"darwin", "windows", "linux"} {
		env := map[string]string{"WAYLAND_DISPLAY": "wayland-0", "SystemRoot": `C:\Windows`}
		methods := detect(goos, func(k string) string { return env[k] }, func(name string) (string, error) { return "/usr/bin/" + name, nil })
		if len(methods) == 0 {
			t.Fatalf("%s: no methods", goos)
		}
		fr := &fakeRunner{}
		s := &system{methods: methods, run: fr.run}
		if _, err := s.Copy(fakeURI); err != nil {
			t.Fatalf("%s: %v", goos, err)
		}
		if err := s.Clear(); err != nil {
			t.Fatalf("%s: clear: %v", goos, err)
		}
		for _, c := range fr.calls {
			for _, a := range c.args {
				if strings.Contains(a, "JBSWY3DPEHPK3PXP") || strings.Contains(a, "otpauth") {
					t.Errorf("%s: secret passed as argument to %s", goos, c.path)
				}
			}
		}
		first := fr.calls[0]
		got := first.stdin
		if goos == "windows" {
			raw, err := base64.StdEncoding.DecodeString(got)
			if err != nil {
				t.Fatalf("windows stdin is not base64")
			}
			got = string(raw)
		}
		if got != fakeURI {
			t.Errorf("%s: stdin = %q", goos, got)
		}
		if clear := fr.calls[len(fr.calls)-1]; clear.stdin != "" {
			t.Errorf("%s: clear stdin not empty", goos)
		}
	}
}

func TestFallbackWhenFirstMethodFails(t *testing.T) {
	methods := detect("darwin", os.Getenv, exec.LookPath)
	fr := &fakeRunner{fail: map[string]bool{osascriptPath: true}}
	s := &system{methods: methods, run: fr.run}
	concealed, err := s.Copy(fakeURI)
	if err != nil {
		t.Fatal(err)
	}
	if concealed {
		t.Error("pbcopy fallback cannot be concealed")
	}
	if fr.calls[len(fr.calls)-1].path != "/usr/bin/pbcopy" {
		t.Errorf("fallback = %s", fr.calls[len(fr.calls)-1].path)
	}
}

func TestAllMethodsFail(t *testing.T) {
	methods := detect("linux", func(string) string { return "" }, func(name string) (string, error) { return "/usr/bin/" + name, nil })
	fr := &fakeRunner{fail: map[string]bool{"/usr/bin/xclip": true, "/usr/bin/xsel": true}}
	s := &system{methods: methods, run: fr.run}
	_, err := s.Copy(fakeURI)
	if err == nil || strings.Contains(err.Error(), "otpauth") {
		t.Fatalf("err = %v", err)
	}
}

func TestLinuxWithoutTools(t *testing.T) {
	methods := detect("linux", func(string) string { return "" }, func(string) (string, error) { return "", errors.New("no") })
	if len(methods) != 0 {
		t.Fatal("expected no methods")
	}
}

func TestEncodePowerShell(t *testing.T) {
	enc := encodePowerShell("Ação")
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil || len(raw)%2 != 0 {
		t.Fatal("bad encoding")
	}
	u := make([]uint16, len(raw)/2)
	for i := range u {
		u[i] = uint16(raw[2*i]) | uint16(raw[2*i+1])<<8
	}
	if string(utf16.Decode(u)) != "Ação" {
		t.Error("round trip failed")
	}
}

// TestMacOSConcealedPasteboard runs the real osascript against a PRIVATE,
// named pasteboard (never the user's clipboard) and checks the text and the
// nspasteboard.org markers.
func TestMacOSConcealedPasteboard(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS only")
	}
	if _, err := os.Stat(osascriptPath); err != nil {
		t.Skip("no osascript")
	}
	name := fmt.Sprintf("otp-out-test-%d", time.Now().UnixNano())
	m := macOSMethod(name)
	s := &system{methods: []method{m}, run: execRunner}
	concealed, err := s.Copy(fakeURI)
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Skipf("no pasteboard in this CI session: %v", err)
		}
		t.Fatalf("copy: %v", err)
	}
	if !concealed {
		t.Error("expected concealed")
	}
	read := `
ObjC.import('AppKit');
function run(argv) {
  var pb = $.NSPasteboard.pasteboardWithName(argv[0]);
  var types = pb.types.js.map(function (t) { return t.js; });
  var s = pb.stringForType($.NSPasteboardTypeString);
  var text = s.isNil() ? '' : s.js;
  if (argv[1] === 'release') { pb.releaseGlobally; }
  return JSON.stringify({types: types, text: text});
}`
	out, err := exec.Command(osascriptPath, "-l", "JavaScript", "-e", read, name, "").Output()
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	got := string(out)
	for _, want := range []string{"org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType", "public.utf8-plain-text", fakeURI} {
		if !strings.Contains(got, want) {
			t.Errorf("pasteboard missing %q", want)
		}
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	out, err = exec.Command(osascriptPath, "-l", "JavaScript", "-e", read, name, "release").Output()
	if err != nil {
		t.Fatalf("read after clear: %v", err)
	}
	if strings.Contains(string(out), "otpauth") {
		t.Error("pasteboard not cleared")
	}
}
