//go:build !noheic

package qrimage

import (
	"image"
	"io"

	"github.com/gen2brain/heic"
)

// HEIC is decoded by gen2brain/heic: a Rust decoder compiled to WASM and run
// by wazero, without cgo. Release builds also set the "nodynamic" tag so the
// library never tries to load a system libheif at startup.
const heicSupported = true

func heicDecode(r io.Reader) (image.Image, error)        { return heic.Decode(r) }
func heicDecodeConfig(r io.Reader) (image.Config, error) { return heic.DecodeConfig(r) }
