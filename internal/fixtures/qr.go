package fixtures

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"

	"github.com/HugoSmits86/nativewebp"
	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

// QR renders text as a SYNTHETIC QR code of size x size pixels with a white
// margin. Only for tests, and only with fake secrets.
func QR(text string, size int) (image.Image, error) {
	hints := map[gozxing.EncodeHintType]any{
		gozxing.EncodeHintType_ERROR_CORRECTION: "M",
		gozxing.EncodeHintType_MARGIN:           4,
	}
	m, err := qrcode.NewQRCodeWriter().Encode(text, gozxing.BarcodeFormat_QR_CODE, size, size, hints)
	if err != nil {
		return nil, err
	}
	gray := image.NewGray(m.Bounds())
	draw.Draw(gray, gray.Bounds(), m, image.Point{}, draw.Src)
	return gray, nil
}

// PhoneScreenshot draws a 1170x2532 "phone screenshot" with a title bar,
// some text-like bars and the QR codes stacked in the middle, each about
// widthFraction of the screen wide, like the Google Authenticator export
// screen. Only for tests.
func PhoneScreenshot(widthFraction float64, texts ...string) (image.Image, error) {
	const w, h = 1170, 2532
	canvas := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{248, 249, 250, 255}), image.Point{}, draw.Src)
	// Status bar, title and fake text lines.
	fill := func(r image.Rectangle, c color.RGBA) {
		draw.Draw(canvas, r, image.NewUniform(c), image.Point{}, draw.Src)
	}
	fill(image.Rect(0, 0, w, 140), color.RGBA{32, 33, 36, 255})
	fill(image.Rect(80, 220, 900, 290), color.RGBA{60, 64, 67, 255})
	fill(image.Rect(80, 340, 1000, 370), color.RGBA{154, 160, 166, 255})
	fill(image.Rect(80, 400, 760, 430), color.RGBA{154, 160, 166, 255})
	fill(image.Rect(0, h-220, w, h), color.RGBA{232, 240, 254, 255})
	fill(image.Rect(w-420, h-180, w-80, h-60), color.RGBA{26, 115, 232, 255})

	size := int(float64(w) * widthFraction)
	y := 560
	for _, text := range texts {
		qr, err := QR(text, size)
		if err != nil {
			return nil, err
		}
		x := (w - qr.Bounds().Dx()) / 2
		draw.Draw(canvas, image.Rect(x, y, x+qr.Bounds().Dx(), y+qr.Bounds().Dy()), qr, image.Point{}, draw.Src)
		y += qr.Bounds().Dy() + 40
	}
	return canvas, nil
}

// EncodePNG, EncodeJPEG and EncodeWEBP serialize a test image.
func EncodePNG(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	err := png.Encode(&b, img)
	return b.Bytes(), err
}

// EncodeJPEG uses quality 90.
func EncodeJPEG(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90})
	return b.Bytes(), err
}

// EncodeWEBP writes a lossless WEBP with a pure Go encoder (test only).
func EncodeWEBP(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	err := nativewebp.Encode(&b, img, nil)
	return b.Bytes(), err
}
