package terminal

import (
	"bufio"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestReadHiddenLine(t *testing.T) {
	long := strings.Repeat("A", 5000) // longer than the 1024-byte line limit of macOS
	cases := []struct {
		in      string
		want    string
		wantErr error
	}{
		{"abc\r", "abc", nil},
		{"abc\n", "abc", nil},
		{long + "\r", long, nil},
		{"abx\x7fc\r", "abc", nil},
		{"a\x1b[Ab\r", "a[Ab", nil},
		{"ab\x03", "", ErrInterrupted},
		{"\x04", "", io.EOF},
		{"", "", io.EOF},
		{"tail", "tail", nil},
	}
	for _, c := range cases {
		got, err := readHiddenLine(bufio.NewReader(strings.NewReader(c.in)))
		if !errors.Is(err, c.wantErr) || got != c.want {
			t.Errorf("readHiddenLine(%.20q) = %.20q, %v", c.in, got, err)
		}
	}
}

func TestRestoreAllIsSafeWhenIdle(t *testing.T) {
	RestoreAll()
	called := 0
	restore.Lock()
	restore.fn = func() { called++ }
	restore.Unlock()
	RestoreAll()
	RestoreAll()
	if called != 1 {
		t.Errorf("restore called %d times", called)
	}
}
