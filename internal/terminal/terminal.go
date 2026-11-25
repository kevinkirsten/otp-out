// Package terminal reads answers and hidden input from the user's terminal.
//
// Prompts are written to stderr. Answers are read from stdin when it is a
// terminal, otherwise from the controlling terminal (/dev/tty, or CONIN$ on
// Windows), so stdin stays free for a piped link.
package terminal

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/term"
)

// ErrInterrupted is returned when the user presses Ctrl+C while typing.
var ErrInterrupted = errors.New("interrupted")

// ErrNoTerminal is returned when there is no terminal to ask.
var ErrNoTerminal = errors.New("no terminal")

// TTY is an open terminal for prompts.
type TTY struct {
	file   *os.File
	owned  bool
	reader *bufio.Reader
	out    io.Writer
}

// Open returns the terminal used for prompts: stdin when it is one, else
// the controlling terminal. It fails when neither is available.
func Open(stdin *os.File, out io.Writer) (*TTY, error) {
	if stdin != nil && term.IsTerminal(int(stdin.Fd())) {
		return &TTY{file: stdin, reader: bufio.NewReader(stdin), out: out}, nil
	}
	name := "/dev/tty"
	if runtime.GOOS == "windows" {
		name = "CONIN$"
	}
	f, err := os.OpenFile(name, os.O_RDWR, 0)
	if err != nil {
		return nil, ErrNoTerminal
	}
	if !term.IsTerminal(int(f.Fd())) {
		_ = f.Close()
		return nil, ErrNoTerminal
	}
	return &TTY{file: f, owned: true, reader: bufio.NewReader(f), out: out}, nil
}

// Close releases the controlling terminal if it was opened here.
func (t *TTY) Close() error {
	if t.owned {
		return t.file.Close()
	}
	return nil
}

// Ask prints prompt and reads one visible line.
func (t *TTY) Ask(prompt string) (string, error) {
	fmt.Fprint(t.out, prompt)
	line, err := t.reader.ReadString('\n')
	if err != nil {
		if errors.Is(err, io.EOF) && line != "" {
			return strings.TrimRight(line, "\r\n"), nil
		}
		return "", io.EOF
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// restore holds the function that puts the terminal back in normal mode
// while hidden input is being read, so a signal handler can call it.
var restore struct {
	sync.Mutex
	fn func()
}

// RestoreAll puts the terminal back in normal mode if hidden input is in
// progress. Safe to call at any time, from any goroutine.
func RestoreAll() {
	restore.Lock()
	fn := restore.fn
	restore.fn = nil
	restore.Unlock()
	if fn != nil {
		fn()
	}
}

// ReadHidden prints prompt and reads a line without echo. It uses raw mode
// instead of the usual line mode, because line mode limits a line to 1024
// bytes on macOS and a big export link is longer than that.
func (t *TTY) ReadHidden(prompt string) (string, error) {
	fmt.Fprint(t.out, prompt)
	fd := int(t.file.Fd())
	state, err := term.MakeRaw(fd)
	if err != nil {
		return "", ErrNoTerminal
	}
	restore.Lock()
	restore.fn = func() { _ = term.Restore(fd, state) }
	restore.Unlock()
	defer func() {
		RestoreAll()
		fmt.Fprint(t.out, "\r\n")
	}()
	return readHiddenLine(t.reader)
}

// readHiddenLine reads until Enter. Ctrl+C interrupts, Ctrl+D on an empty
// line is end of input, Backspace deletes, other control bytes are ignored.
func readHiddenLine(r io.ByteReader) (string, error) {
	var buf []byte
	for {
		b, err := r.ReadByte()
		if err != nil {
			if len(buf) > 0 {
				return string(buf), nil
			}
			return "", io.EOF
		}
		switch {
		case b == '\r' || b == '\n':
			return string(buf), nil
		case b == 0x03:
			return "", ErrInterrupted
		case b == 0x04:
			if len(buf) == 0 {
				return "", io.EOF
			}
			return string(buf), nil
		case b == 0x7F || b == 0x08:
			if len(buf) > 0 {
				_, size := utf8.DecodeLastRune(buf)
				buf = buf[:len(buf)-size]
			}
		case b < 0x20:
			// ignore other control bytes (escape sequences of arrow keys
			// leave printable bytes, which the link parser rejects)
		default:
			buf = append(buf, b)
		}
	}
}
