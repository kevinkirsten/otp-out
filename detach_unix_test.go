//go:build !windows

package main

import "syscall"

// detachedAttr starts the child in a new session, without a controlling
// terminal, so /dev/tty cannot be opened.
func detachedAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setsid: true} }
