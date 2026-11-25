// Package clipboard copies text to the system clipboard without cgo, by
// running the system's own tools. The text always goes through the tool's
// standard input, never as a command-line argument (arguments can be read by
// other processes).
//
// Where the system allows it without cgo, the content is also marked as
// sensitive for clipboard history managers:
//   - macOS: org.nspasteboard.ConcealedType and TransientType markers
//     (nspasteboard.org), and "current host only" so Universal Clipboard does
//     not send it to other Apple devices. Done with osascript (JavaScript for
//     Automation); falls back to pbcopy without markers.
//   - Windows: ExcludeClipboardContentFromMonitorProcessing,
//     CanIncludeInClipboardHistory=0 and CanUploadToCloudClipboard=0, set
//     through PowerShell and .NET; falls back to clip.exe without markers.
//   - Linux: wl-copy, xclip or xsel. No marker (each history manager has its
//     own convention).
package clipboard

import (
	"bytes"
	"os"
	"os/exec"
	"runtime"

	"github.com/kevinkirsten/otp-out/internal/usererr"
)

// Clipboard is what the CLI needs. Copy reports whether the content could be
// marked as sensitive.
type Clipboard interface {
	Copy(text string) (concealed bool, err error)
	Clear() error
}

// runner executes a tool with the given standard input. Standard output and
// error are discarded: they are never shown, and some tools (xclip, wl-copy)
// keep running in the background holding them open.
type runner func(path string, args []string, stdin []byte) error

func execRunner(path string, args []string, stdin []byte) error {
	cmd := exec.Command(path, args...)
	cmd.Stdin = bytes.NewReader(stdin)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Env = os.Environ()
	return cmd.Run()
}

// method is one way of writing to the clipboard.
type method struct {
	path      string
	copyArgs  []string
	clearArgs []string // nil: clear by copying an empty input
	concealed bool
	// encode transforms the text before it is written to stdin.
	encode func(string) []byte
	// clearInput is the stdin used to clear.
	clearInput func() []byte
}

type system struct {
	methods []method
	run     runner
}

var errNoTool = usererr.New("no clipboard tool found (install wl-clipboard, xclip or xsel)")

// New returns the system clipboard, or an error if no tool is available.
func New() (Clipboard, error) {
	methods := detect(runtime.GOOS, os.Getenv, exec.LookPath)
	if len(methods) == 0 {
		return nil, errNoTool
	}
	return &system{methods: methods, run: execRunner}, nil
}

func plain(s string) []byte { return []byte(s) }
func empty() []byte         { return nil }

func detect(goos string, getenv func(string) string, lookPath func(string) (string, error)) []method {
	exists := func(path string) bool {
		_, err := os.Stat(path)
		return err == nil
	}
	var methods []method
	switch goos {
	case "darwin":
		if exists(osascriptPath) {
			methods = append(methods, macOSMethod(""))
		}
		methods = append(methods, method{path: "/usr/bin/pbcopy", encode: plain, clearInput: empty})
	case "windows":
		root := getenv("SystemRoot")
		if root == "" {
			root = `C:\Windows`
		}
		methods = append(methods, windowsMethod(root+`\System32\WindowsPowerShell\v1.0\powershell.exe`))
		methods = append(methods, method{path: root + `\System32\clip.exe`, encode: plain, clearInput: empty})
	default:
		if getenv("WAYLAND_DISPLAY") != "" {
			if p, err := lookPath("wl-copy"); err == nil {
				methods = append(methods, method{path: p, encode: plain, clearArgs: []string{"--clear"}, clearInput: empty})
			}
		}
		if p, err := lookPath("xclip"); err == nil {
			methods = append(methods, method{path: p, copyArgs: []string{"-selection", "clipboard"}, encode: plain, clearInput: empty})
		}
		if p, err := lookPath("xsel"); err == nil {
			methods = append(methods, method{path: p, copyArgs: []string{"--clipboard", "--input"}, encode: plain, clearArgs: []string{"--clipboard", "--clear"}, clearInput: empty})
		}
	}
	return methods
}

// Copy tries each method in order until one works.
func (s *system) Copy(text string) (bool, error) {
	for _, m := range s.methods {
		if err := s.run(m.path, m.copyArgs, m.encode(text)); err == nil {
			return m.concealed, nil
		}
	}
	return false, usererr.New("could not write to the clipboard")
}

// Clear empties the clipboard with the first method that works.
func (s *system) Clear() error {
	var errs []error
	for _, m := range s.methods {
		args := m.clearArgs
		if args == nil {
			args = m.copyArgs
		}
		err := s.run(m.path, args, m.clearInput())
		if err == nil {
			return nil
		}
		errs = append(errs, err)
	}
	if len(errs) > 0 {
		return usererr.New("could not clear the clipboard; copy something else to replace it")
	}
	return nil
}
