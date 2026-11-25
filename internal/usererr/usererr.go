// Package usererr holds the one error type that is allowed to reach the user
// with its message.
//
// Every message is written by this program. It may name a file the user
// passed, but it never carries a secret, a URI or any other data read from a
// QR code. Any other error type is treated as unexpected and only its Go type
// is shown.
package usererr

import (
	"errors"
	"fmt"
)

// Error is an expected failure with a message that is safe to print.
type Error struct {
	msg string
}

func (e *Error) Error() string { return e.msg }

// New returns an expected error with a fixed message.
func New(msg string) error { return &Error{msg: msg} }

// Newf formats an expected error. Only pass values that are safe to show,
// such as a file name the user typed or a count. Never pass QR data.
func Newf(format string, args ...any) error { return &Error{msg: fmt.Sprintf(format, args...)} }

// Message returns the message of an expected error and true, or "" and false
// for any other error.
func Message(err error) (string, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e.msg, true
	}
	return "", false
}
