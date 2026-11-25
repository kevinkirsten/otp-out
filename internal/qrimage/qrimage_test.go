package qrimage

// All QR codes here are SYNTHETIC, generated inside the test with fake
// secrets. Image files are only written inside t.TempDir().

import (
	"encoding/json"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/kevinkirsten/otp-out/internal/fixtures"
)

func denseURI(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Cases []struct {
			Name  string `json:"name"`
			Input string `json:"input"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Cases {
		if c.Name == "ten_accounts_dense" {
			return c.Input
		}
	}
	t.Fatal("ten_accounts_dense not found")
	return ""
}

func mustImage(t *testing.T) func(image.Image, error) image.Image {
	return func(img image.Image, err error) image.Image {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return img
	}
}

func expectTexts(t *testing.T, got []string, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d texts, want %d", len(got), len(want))
	}
	for _, w := range want {
		found := false
		for _, g := range got {
			found = found || g == w
		}
		if !found {
			t.Errorf("missing expected QR text (length %d)", len(w))
		}
	}
}

func TestFormatsEndToEnd(t *testing.T) {
	uri := fixtures.SimpleURI()
	img := mustImage(t)(fixtures.PhoneScreenshot(0.6, uri))
	encoders := map[string]func(image.Image) ([]byte, error){
		"png":  fixtures.EncodePNG,
		"jpg":  fixtures.EncodeJPEG,
		"webp": fixtures.EncodeWEBP,
	}
	dir := t.TempDir()
	for name, enc := range encoders {
		t.Run(name, func(t *testing.T) {
			data, err := enc(img)
			if err != nil {
				t.Fatal(err)
			}
			// Wrong extension on purpose: the format comes from the content.
			path := filepath.Join(dir, "screenshot-"+name+".bin")
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}
			texts, err := ReadFile(path)
			if err != nil {
				t.Fatalf("ReadFile: %v", err)
			}
			expectTexts(t, texts, uri)
		})
	}
}

func TestDenseQR(t *testing.T) {
	uri := denseURI(t)
	img := mustImage(t)(fixtures.PhoneScreenshot(0.7, uri))
	data, err := fixtures.EncodePNG(img)
	if err != nil {
		t.Fatal(err)
	}
	texts, err := ReadBytes("dense.png", data)
	if err != nil {
		t.Fatal(err)
	}
	expectTexts(t, texts, uri)
}

func TestSmallQRInsideBigScreenshot(t *testing.T) {
	uri := fixtures.SimpleURI()
	// About 25% of the screen width: a small code in a big image.
	img := mustImage(t)(fixtures.PhoneScreenshot(0.25, uri))
	data, err := fixtures.EncodeJPEG(img)
	if err != nil {
		t.Fatal(err)
	}
	texts, err := ReadBytes("small.jpg", data)
	if err != nil {
		t.Fatal(err)
	}
	expectTexts(t, texts, uri)
}

func TestTwoQRCodesInOneImage(t *testing.T) {
	a := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "a", "x")}, 2, 0, 7))
	b := fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.OtherSecret, "b", "y")}, 2, 1, 7))
	img := mustImage(t)(fixtures.PhoneScreenshot(0.5, a, b))
	texts := Scan(img)
	expectTexts(t, texts, a, b)
}

func TestTightlyCroppedQR(t *testing.T) {
	uri := fixtures.SimpleURI()
	qr := mustImage(t)(fixtures.QR(uri, 400)).(*image.Gray)
	// Crop exactly at the dark modules: no quiet zone left at all.
	b := qr.Bounds()
	minX, minY, maxX, maxY := b.Max.X, b.Max.Y, b.Min.X, b.Min.Y
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if qr.GrayAt(x, y).Y < 128 {
				minX, minY = min(minX, x), min(minY, y)
				maxX, maxY = max(maxX, x+1), max(maxY, y+1)
			}
		}
	}
	cropped := qr.SubImage(image.Rect(minX, minY, maxX, maxY))
	if cropped.Bounds().Dx() >= b.Dx() {
		t.Fatal("crop did not remove the margin")
	}
	expectTexts(t, Scan(cropped), uri)
}

func TestInvertedQR(t *testing.T) {
	uri := fixtures.SimpleURI()
	qr := mustImage(t)(fixtures.QR(uri, 500)).(*image.Gray)
	for i := range qr.Pix {
		qr.Pix[i] = 255 - qr.Pix[i]
	}
	expectTexts(t, Scan(qr), uri)
}

func TestNoQR(t *testing.T) {
	img := image.NewGray(image.Rect(0, 0, 300, 300))
	data, err := fixtures.EncodePNG(img)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ReadBytes("blank.png", data)
	if err == nil || !strings.Contains(err.Error(), "no QR code found") {
		t.Fatalf("err = %v", err)
	}
}

func TestUnsupportedAndBrokenFiles(t *testing.T) {
	cases := map[string][]byte{
		"text":   []byte("otpauth-migration://offline?data=AAAA"),
		"avif":   append([]byte{0, 0, 0, 0x1c}, []byte("ftypavif\x00\x00\x00\x00avifmif1miaf")...),
		"broken": append([]byte("\x89PNG\r\n\x1a\n"), []byte("garbage that is not a png")...),
		"empty":  nil,
	}
	for name, data := range cases {
		_, err := ReadBytes(name, data)
		if err == nil {
			t.Errorf("%s: expected error", name)
			continue
		}
		if strings.Contains(err.Error(), "otpauth") {
			t.Errorf("%s: error leaks content: %v", name, err)
		}
	}
}

func TestReadFileErrors(t *testing.T) {
	dir := t.TempDir()
	if _, err := ReadFile(filepath.Join(dir, "missing.png")); err == nil || !strings.Contains(err.Error(), "file not found") {
		t.Errorf("missing: %v", err)
	}
	if _, err := ReadFile(dir); err == nil || !strings.Contains(err.Error(), "is a folder") {
		t.Errorf("folder: %v", err)
	}
}

func TestSniff(t *testing.T) {
	heic := append([]byte{0, 0, 0, 0x18}, []byte("ftypheic\x00\x00\x00\x00mif1heic")...)
	mif1 := append([]byte{0, 0, 0, 0x18}, []byte("ftypmif1\x00\x00\x00\x00mif1heic")...)
	cases := map[Format][]byte{
		PNG:     []byte("\x89PNG\r\n\x1a\nxxxx"),
		JPEG:    {0xFF, 0xD8, 0xFF, 0xE0},
		WEBP:    []byte("RIFF\x00\x00\x00\x00WEBPVP8L"),
		GIF:     []byte("GIF89a...."),
		HEIC:    heic,
		Unknown: []byte("hello world, not an image"),
	}
	for want, data := range cases {
		if got := Sniff(data); got != want {
			t.Errorf("Sniff(%s) = %q", want, got)
		}
	}
	if Sniff(mif1) != HEIC {
		t.Error("mif1 with heic brand should be HEIC")
	}
}

// TestHEIC converts a synthetic PNG to HEIC with macOS sips (the only HEIC
// encoder available without extra tools) and reads it back.
func TestHEIC(t *testing.T) {
	if !HEICSupported() {
		t.Skip("built with -tags noheic")
	}
	sips, err := exec.LookPath("sips")
	if runtime.GOOS != "darwin" || err != nil {
		t.Skip("needs macOS sips to create a HEIC file")
	}
	uri := fixtures.SimpleURI()
	img := mustImage(t)(fixtures.PhoneScreenshot(0.6, uri))
	data, err := fixtures.EncodePNG(img)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "in.png")
	dst := filepath.Join(dir, "out.heic")
	if err := os.WriteFile(src, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(sips, "-s", "format", "heic", src, "--out", dst).CombinedOutput(); err != nil {
		t.Skipf("sips could not write HEIC: %v %s", err, out)
	}
	heicData, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if Sniff(heicData) != HEIC {
		t.Fatalf("sips output not sniffed as HEIC")
	}
	texts, err := ReadBytes("out.heic", heicData)
	if err != nil {
		t.Fatalf("ReadBytes: %v", err)
	}
	expectTexts(t, texts, uri)
}
