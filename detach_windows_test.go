//go:build windows

package main

import "syscall"

func detachedAttr() *syscall.SysProcAttr { return nil }
