//go:build noheic

package qrimage

import (
	"errors"
	"image"
	"io"
)

// Built with -tags noheic: HEIC images are refused with a clear message.
const heicSupported = false

var errNoHEIC = errors.New("heic disabled")

func heicDecode(io.Reader) (image.Image, error)        { return nil, errNoHEIC }
func heicDecodeConfig(io.Reader) (image.Config, error) { return image.Config{}, errNoHEIC }
