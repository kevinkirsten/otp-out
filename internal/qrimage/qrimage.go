// Package qrimage reads QR codes from screenshots and photos.
//
// It is pure Go (gozxing for QR, the standard library and x/image for the
// image formats, an optional WASM HEIC decoder). Nothing is written to disk:
// the image is decoded in memory and the QR texts are returned to the caller.
// Errors never contain QR content.
package qrimage

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"

	"github.com/makiuchi-d/gozxing"
	multiqr "github.com/makiuchi-d/gozxing/multi/qrcode"
	"github.com/makiuchi-d/gozxing/qrcode"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"

	"github.com/kevinkirsten/otp-out/internal/usererr"
)

const (
	// MaxFileSize is the largest image file accepted (64 MiB).
	MaxFileSize = 64 << 20
	// maxPixels guards against decompression bombs (100 megapixels).
	maxPixels = 100_000_000
)

// Format is an image format detected from the file content.
type Format string

// Formats detected by Sniff.
const (
	PNG     Format = "PNG"
	JPEG    Format = "JPEG"
	WEBP    Format = "WEBP"
	GIF     Format = "GIF"
	HEIC    Format = "HEIC"
	AVIF    Format = "AVIF"
	Unknown Format = ""
)

// HEICSupported reports whether this build can decode HEIC images.
func HEICSupported() bool { return heicSupported }

// Sniff detects the image format from the first bytes. The file extension
// is never used.
func Sniff(data []byte) Format {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return PNG
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return JPEG
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return WEBP
	case bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")):
		return GIF
	case len(data) >= 12 && string(data[4:8]) == "ftyp":
		return sniffISOBMFF(data)
	}
	return Unknown
}

// sniffISOBMFF looks at the major and compatible brands of an ftyp box.
func sniffISOBMFF(data []byte) Format {
	size := int(data[0])<<24 | int(data[1])<<16 | int(data[2])<<8 | int(data[3])
	if size < 16 || size > len(data) {
		size = min(len(data), 64)
	}
	brands := []string{string(data[8:12])}
	for i := 16; i+4 <= size; i += 4 {
		brands = append(brands, string(data[i:i+4]))
	}
	heif := false
	for _, b := range brands {
		switch b {
		case "heic", "heix", "hevc", "hevx", "heim", "heis":
			return HEIC
		case "avif", "avis":
			return AVIF
		case "mif1", "msf1":
			heif = true
		}
	}
	if heif {
		return HEIC
	}
	return Unknown
}

// ReadFile reads every QR code text found in the image file at path.
func ReadFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, usererr.Newf("file not found: %s", path)
		}
		return nil, usererr.Newf("cannot open %s", path)
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, usererr.Newf("cannot read %s", path)
	}
	if info.IsDir() {
		return nil, usererr.Newf("%s is a folder, not an image", path)
	}
	data, err := io.ReadAll(io.LimitReader(f, MaxFileSize+1))
	if err != nil {
		return nil, usererr.Newf("cannot read %s", path)
	}
	if len(data) > MaxFileSize {
		return nil, usererr.Newf("%s is larger than 64 MB", path)
	}
	return ReadBytes(path, data)
}

// ReadBytes reads every QR code text found in an encoded image. name is
// only used in error messages.
func ReadBytes(name string, data []byte) ([]string, error) {
	img, err := DecodeImage(name, data)
	if err != nil {
		return nil, err
	}
	texts := Scan(img)
	if len(texts) == 0 {
		return nil, usererr.Newf("%s: no QR code found in the image", name)
	}
	return texts, nil
}

// DecodeImage decodes PNG, JPEG, WEBP, GIF and (when built in) HEIC,
// choosing the decoder by content.
func DecodeImage(name string, data []byte) (img image.Image, err error) {
	format := Sniff(data)
	type decoders struct {
		config func(io.Reader) (image.Config, error)
		decode func(io.Reader) (image.Image, error)
	}
	var d decoders
	switch format {
	case PNG:
		d = decoders{png.DecodeConfig, png.Decode}
	case JPEG:
		d = decoders{jpeg.DecodeConfig, jpeg.Decode}
	case WEBP:
		d = decoders{webp.DecodeConfig, webp.Decode}
	case GIF:
		d = decoders{gif.DecodeConfig, gif.Decode}
	case HEIC:
		if !heicSupported {
			return nil, usererr.Newf("%s: this build of otp-out cannot read HEIC images; convert it to PNG or JPEG first", name)
		}
		d = decoders{heicDecodeConfig, heicDecode}
	case AVIF:
		return nil, usererr.Newf("%s: AVIF images are not supported; convert it to PNG or JPEG first", name)
	default:
		return nil, usererr.Newf("%s: unsupported image format (use PNG, JPEG, WEBP, GIF or HEIC)", name)
	}
	// Decoders of untrusted files can panic; never let that crash the
	// program with a stack trace.
	defer func() {
		if r := recover(); r != nil {
			img, err = nil, usererr.Newf("%s: could not decode the %s image", name, format)
		}
	}()
	cfg, err := d.config(bytes.NewReader(data))
	if err != nil {
		return nil, usererr.Newf("%s: could not decode the %s image", name, format)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxPixels {
		return nil, usererr.Newf("%s: the image is too large or empty", name)
	}
	img, err = d.decode(bytes.NewReader(data))
	if err != nil || img == nil {
		return nil, usererr.Newf("%s: could not decode the %s image", name, format)
	}
	return img, nil
}

// ---------------------------------------------------------------- scanning

type binarizerKind int

const (
	hybrid binarizerKind = iota
	global
)

type attempt struct {
	variant   func(*image.Gray) *image.Gray
	binarizer binarizerKind
	inverted  bool
	pure      bool
}

// Scan returns the distinct QR texts found in img. It tries several
// strategies, cheapest first, and stops at the first one that finds
// anything: the image as is with two binarizers, then scaled copies (a
// small QR in a big phone screenshot, or a tiny image), a copy with a
// white margin (a tightly cropped QR), inverted colors (dark mode) and
// finally "pure barcode" mode.
func Scan(img image.Image) []string {
	gray := toGray(img)
	w, h := gray.Bounds().Dx(), gray.Bounds().Dy()
	longest := max(w, h)

	identity := func(g *image.Gray) *image.Gray { return g }
	var attempts []attempt
	add := func(v func(*image.Gray) *image.Gray, b binarizerKind, inv, pure bool) {
		attempts = append(attempts, attempt{v, b, inv, pure})
	}
	add(identity, hybrid, false, false)
	add(identity, global, false, false)
	for _, target := range []int{1600, 1000, 700} {
		if longest > target*5/4 {
			t := target
			add(func(g *image.Gray) *image.Gray { return scaleTo(g, t) }, hybrid, false, false)
			add(func(g *image.Gray) *image.Gray { return scaleTo(g, t) }, global, false, false)
		}
	}
	if longest < 600 {
		add(func(g *image.Gray) *image.Gray { return scaleNearest(g, 3) }, hybrid, false, false)
	}
	add(addMargin, hybrid, false, false)
	add(addMargin, global, false, false)
	add(identity, hybrid, true, false)
	if longest > 1250 {
		add(func(g *image.Gray) *image.Gray { return scaleTo(g, 1000) }, hybrid, true, false)
	}
	add(addMargin, hybrid, false, true)

	for _, a := range attempts {
		if texts := decode(a.variant(gray), a); len(texts) > 0 {
			return texts
		}
	}
	return nil
}

func decode(img *image.Gray, a attempt) (texts []string) {
	defer func() {
		if recover() != nil {
			texts = nil
		}
	}()
	source := gozxing.NewLuminanceSourceFromImage(img)
	if a.inverted {
		source = gozxing.NewInvertedLuminanceSource(source)
	}
	var binarizer gozxing.Binarizer
	if a.binarizer == global {
		binarizer = gozxing.NewGlobalHistgramBinarizer(source)
	} else {
		binarizer = gozxing.NewHybridBinarizer(source)
	}
	hints := map[gozxing.DecodeHintType]any{gozxing.DecodeHintType_TRY_HARDER: true}
	if a.pure {
		hints[gozxing.DecodeHintType_PURE_BARCODE] = true
	}
	seen := map[string]bool{}
	addText := func(t string) {
		if t != "" && !seen[t] {
			seen[t] = true
			texts = append(texts, t)
		}
	}
	if !a.pure {
		if bmp, err := gozxing.NewBinaryBitmap(binarizer); err == nil {
			if results, err := multiqr.NewQRCodeMultiReader().DecodeMultiple(bmp, hints); err == nil {
				for _, r := range results {
					addText(r.GetText())
				}
			}
		}
		if len(texts) > 0 {
			return texts
		}
	}
	if bmp, err := gozxing.NewBinaryBitmap(binarizer); err == nil {
		if r, err := qrcode.NewQRCodeReader().Decode(bmp, hints); err == nil {
			addText(r.GetText())
		}
	}
	return texts
}

// toGray flattens the image on a white background (for transparent PNGs)
// and converts it to 8-bit gray.
func toGray(img image.Image) *image.Gray {
	b := img.Bounds()
	if g, ok := img.(*image.Gray); ok && b.Min == (image.Point{}) {
		return g
	}
	rgba := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(rgba, rgba.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Over)
	gray := image.NewGray(rgba.Bounds())
	draw.Draw(gray, gray.Bounds(), rgba, image.Point{}, draw.Src)
	return gray
}

// scaleTo resizes so the longest side has target pixels.
func scaleTo(g *image.Gray, target int) *image.Gray {
	w, h := g.Bounds().Dx(), g.Bounds().Dy()
	longest := max(w, h)
	nw := max(1, w*target/longest)
	nh := max(1, h*target/longest)
	dst := image.NewGray(image.Rect(0, 0, nw, nh))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), g, g.Bounds(), xdraw.Src, nil)
	return dst
}

// scaleNearest enlarges a small image by an integer factor without blur.
func scaleNearest(g *image.Gray, factor int) *image.Gray {
	w, h := g.Bounds().Dx(), g.Bounds().Dy()
	dst := image.NewGray(image.Rect(0, 0, w*factor, h*factor))
	xdraw.NearestNeighbor.Scale(dst, dst.Bounds(), g, g.Bounds(), xdraw.Src, nil)
	return dst
}

// addMargin surrounds the image with a white border, which the QR finder
// needs when the screenshot was cropped right at the code's edge.
func addMargin(g *image.Gray) *image.Gray {
	w, h := g.Bounds().Dx(), g.Bounds().Dy()
	m := max(16, max(w, h)/8)
	dst := image.NewGray(image.Rect(0, 0, w+2*m, h+2*m))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(dst, image.Rect(m, m, m+w, m+h), g, g.Bounds().Min, draw.Src)
	return dst
}
