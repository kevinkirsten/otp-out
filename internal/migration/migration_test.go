package migration

// Every secret in these tests is FAKE (see internal/fixtures and
// testdata/vectors.json).

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kevinkirsten/otp-out/internal/fixtures"
	"github.com/kevinkirsten/otp-out/internal/usererr"
)

type vectorFile struct {
	RFC4648 []struct {
		ASCII  string `json:"ascii"`
		Base32 string `json:"base32"`
	} `json:"rfc4648_base32"`
	Cases []struct {
		Name  string `json:"name"`
		Input string `json:"input"`
		Error bool   `json:"error"`
		Batch *struct {
			Size  int    `json:"size"`
			Index int    `json:"index"`
			ID    uint64 `json:"id"`
		} `json:"batch"`
		Accounts []struct {
			Issuer    string  `json:"issuer"`
			Name      string  `json:"name"`
			Type      string  `json:"type"`
			Algorithm string  `json:"algorithm"`
			Digits    int     `json:"digits"`
			Counter   uint64  `json:"counter"`
			Secret    string  `json:"secret"`
			URI       *string `json:"uri"`
		} `json:"accounts"`
	} `json:"cases"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "vectors.json"))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var v vectorFile
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	if len(v.Cases) == 0 || len(v.RFC4648) == 0 {
		t.Fatal("vectors.json has no cases")
	}
	return v
}

func TestVectors(t *testing.T) {
	v := loadVectors(t)
	for _, tc := range v.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			batch, err := DecodeURI(tc.Input)
			if tc.Error {
				if err == nil {
					t.Fatal("expected an error")
				}
				if _, ok := usererr.Message(err); !ok {
					t.Fatalf("error is not a user error: %T", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.Batch != nil {
				if batch.Size != tc.Batch.Size || batch.Index != tc.Batch.Index || batch.ID != tc.Batch.ID {
					t.Errorf("batch = %d/%d/%d, want %d/%d/%d", batch.Size, batch.Index, batch.ID, tc.Batch.Size, tc.Batch.Index, tc.Batch.ID)
				}
			}
			if len(batch.Accounts) != len(tc.Accounts) {
				t.Fatalf("got %d accounts, want %d", len(batch.Accounts), len(tc.Accounts))
			}
			for i, want := range tc.Accounts {
				got := batch.Accounts[i]
				if got.Issuer != want.Issuer || got.Name != want.Name || got.Type != want.Type ||
					got.Algorithm != want.Algorithm || got.Digits != want.Digits || got.Counter != want.Counter {
					t.Errorf("account %d = %q %q %s %s %d %d, want %q %q %s %s %d %d", i,
						got.Issuer, got.Name, got.Type, got.Algorithm, got.Digits, got.Counter,
						want.Issuer, want.Name, want.Type, want.Algorithm, want.Digits, want.Counter)
				}
				if got.SecretBase32() != want.Secret {
					t.Errorf("account %d: secret mismatch", i)
				}
				uri, err := got.URI()
				if want.URI == nil {
					if err == nil || got.Supported() {
						t.Errorf("account %d: expected unsupported algorithm", i)
					}
					continue
				}
				if err != nil {
					t.Fatalf("account %d: URI error: %v", i, err)
				}
				if uri != *want.URI {
					t.Errorf("account %d: uri\n got %s\nwant %s", i, uri, *want.URI)
				}
			}
		})
	}
}

func TestBase32RFC4648(t *testing.T) {
	v := loadVectors(t)
	for _, tc := range v.RFC4648 {
		if got := Secret(tc.ASCII).Base32(); got != tc.Base32 {
			t.Errorf("base32(%q) = %q, want %q", tc.ASCII, got, tc.Base32)
		}
	}
	if got := Secret(fixtures.FakeSecret).Base32(); got != fixtures.FakeSecretB32 {
		t.Errorf("fake secret round trip = %q", got)
	}
}

func decodeOne(t *testing.T, otps []fixtures.OTP) Batch {
	t.Helper()
	batch, err := DecodeURI(fixtures.URI(fixtures.Payload(otps, 1, 0, 4242)))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	return batch
}

func mustURI(t *testing.T, a Account) string {
	t.Helper()
	uri, err := a.URI()
	if err != nil {
		t.Fatalf("uri: %v", err)
	}
	return uri
}

func TestDecodeOneAccount(t *testing.T) {
	batch, err := DecodeURI(fixtures.SimpleURI())
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Accounts) != 1 {
		t.Fatalf("got %d accounts", len(batch.Accounts))
	}
	a := batch.Accounts[0]
	if a.Issuer != "Exemplo" || a.Name != "ana@exemplo.com" {
		t.Errorf("label = %q %q", a.Issuer, a.Name)
	}
	if got := mustURI(t, a); got != fixtures.SimpleOTPAuth {
		t.Errorf("uri = %s", got)
	}
}

func TestDecodeTwoAccounts(t *testing.T) {
	batch := decodeOne(t, []fixtures.OTP{
		fixtures.TOTP(fixtures.FakeSecret, "ana@exemplo.com", "Exemplo"),
		fixtures.TOTP(fixtures.OtherSecret, "Outra Firma:joao@exemplo.com", "Outra Firma"),
	})
	if len(batch.Accounts) != 2 || batch.Accounts[1].Issuer != "Outra Firma" || batch.Accounts[1].Name != "joao@exemplo.com" {
		t.Fatalf("accounts = %v", batch.Accounts)
	}
	want := "otpauth://totp/Outra%20Firma:joao@exemplo.com?secret=" + fixtures.OtherSecretB32 +
		"&issuer=Outra%20Firma&algorithm=SHA1&digits=6&period=30"
	if got := mustURI(t, batch.Accounts[1]); got != want {
		t.Errorf("uri = %s", got)
	}
}

func TestDecodeHOTPWithCounter(t *testing.T) {
	otp := fixtures.OTP{Secret: fixtures.FakeSecret, Name: "ana", Issuer: "Exemplo", Algorithm: 1, Digits: 1, Type: 1, Counter: 300}
	a := decodeOne(t, []fixtures.OTP{otp}).Accounts[0]
	if a.Type != "hotp" || a.Counter != 300 {
		t.Fatalf("type/counter = %s %d", a.Type, a.Counter)
	}
	want := "otpauth://hotp/Exemplo:ana?secret=JBSWY3DPEHPK3PXP&issuer=Exemplo&algorithm=SHA1&digits=6&counter=300"
	if got := mustURI(t, a); got != want {
		t.Errorf("uri = %s", got)
	}
}

func TestDecodeSHA256EightDigits(t *testing.T) {
	otp := fixtures.OTP{Secret: fixtures.FakeSecret, Name: "ana", Issuer: "X", Algorithm: 2, Digits: 2, Type: 2}
	a := decodeOne(t, []fixtures.OTP{otp}).Accounts[0]
	if got := mustURI(t, a); !strings.Contains(got, "algorithm=SHA256&digits=8") {
		t.Errorf("uri = %s", got)
	}
	if a.Describe() != "X / ana (TOTP, SHA256, 8 digits)" {
		t.Errorf("describe = %q", a.Describe())
	}
}

func TestUnspecifiedEnumsDefault(t *testing.T) {
	otp := fixtures.OTP{Secret: fixtures.FakeSecret, Name: "ana", Issuer: "X"}
	a := decodeOne(t, []fixtures.OTP{otp}).Accounts[0]
	if a.Type != "totp" || a.Algorithm != "SHA1" || a.Digits != 6 {
		t.Errorf("defaults = %s %s %d", a.Type, a.Algorithm, a.Digits)
	}
}

func TestIssuerTakenFromName(t *testing.T) {
	a := decodeOne(t, []fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "Exemplo:ana", "")}).Accounts[0]
	if a.Issuer != "Exemplo" || a.Name != "ana" {
		t.Errorf("label = %q %q", a.Issuer, a.Name)
	}
}

func TestSplitLabel(t *testing.T) {
	cases := []struct{ name, issuer, wantName, wantIssuer string }{
		{"Exemplo:ana", "Exemplo", "ana", "Exemplo"},
		{"exemplo: ana ", "Exemplo", "ana", "Exemplo"},
		{" ana ", " Exemplo ", "ana", "Exemplo"},
		{"Exemplo:ana", "", "ana", "Exemplo"},
		{"a:b:c", "", "b:c", "a"},
		{"Ação:joão", "Ação", "joão", "Ação"},
		{"Other:ana", "Exemplo", "Other:ana", "Exemplo"},
		{"", "", "", ""},
	}
	for _, c := range cases {
		gotName, gotIssuer := SplitLabel(c.name, c.issuer)
		if gotName != c.wantName || gotIssuer != c.wantIssuer {
			t.Errorf("SplitLabel(%q, %q) = %q, %q; want %q, %q", c.name, c.issuer, gotName, gotIssuer, c.wantName, c.wantIssuer)
		}
	}
}

func TestPlusDecodedAsSpaceIsRestored(t *testing.T) {
	var secret []byte
	var raw string
	for i := 0; i < 256 && !strings.Contains(raw, "+"); i++ {
		secret = []byte{0xf8, byte(i), 0xf8, byte(i), 0xf8, byte(i), 0xf8, byte(i), 0xf8, byte(i)}
		payload := fixtures.Payload([]fixtures.OTP{fixtures.TOTP(secret, "ana", "Exemplo")}, 1, 0, 4242)
		raw = base64.StdEncoding.EncodeToString(payload)
	}
	if !strings.Contains(raw, "+") {
		t.Fatal("test payload should contain a plus sign")
	}
	batch, err := DecodeURI("otpauth-migration://offline?data=" + raw)
	if err != nil {
		t.Fatal(err)
	}
	if string(batch.Accounts[0].Secret()) != string(secret) {
		t.Error("secret changed")
	}
}

func TestBatchInfo(t *testing.T) {
	batch, err := DecodeURI(fixtures.URI(fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "a", "b")}, 3, 1, 77)))
	if err != nil {
		t.Fatal(err)
	}
	if batch.Size != 3 || batch.Index != 1 || batch.ID != 77 {
		t.Errorf("batch = %d %d %d", batch.Size, batch.Index, batch.ID)
	}
}

func TestMD5IsRefused(t *testing.T) {
	otp := fixtures.TOTP(fixtures.FakeSecret, "a", "b")
	otp.Algorithm = 4
	a := decodeOne(t, []fixtures.OTP{otp}).Accounts[0]
	if a.Supported() {
		t.Fatal("MD5 should not be supported")
	}
	_, err := a.URI()
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), fixtures.FakeSecretB32) {
		t.Error("error contains the secret")
	}
}

func TestInvalidInputs(t *testing.T) {
	payload := fixtures.Payload([]fixtures.OTP{fixtures.TOTP(fixtures.FakeSecret, "a", "b")}, 1, 0, 4242)
	inputs := []string{
		"otpauth://totp/x?secret=ABC",
		"otpauth-migration://offline?data=%%%",
		"otpauth-migration://offline?data=",
		"otpauth-migration://offline?data=@@@@",
		"otpauth-migration://offline",
		"",
		fixtures.URI(payload[:len(payload)-10]),
		fixtures.URI([]byte{0x0a, 0x05, 0x0a}),                 // nested field cut
		fixtures.URI([]byte{0x0b}),                             // wire type 3 (groups)
		fixtures.URI(append([]byte{0x18}, make([]byte, 0)...)), // varint missing
		fixtures.URI([]byte{0x18, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01}), // varint too long
	}
	for _, in := range inputs {
		_, err := DecodeURI(in)
		if err == nil {
			t.Errorf("DecodeURI(%q): expected error", in)
			continue
		}
		if _, ok := usererr.Message(err); !ok {
			t.Errorf("DecodeURI(%q): error type %T is not a user error", in, err)
		}
	}
}

func TestErrorsNeverCarryInput(t *testing.T) {
	// A payload whose account has a secret but whose name field is cut.
	inner := append(fixtures.FieldBytes(1, fixtures.FakeSecret), 0x12, 0x40, 'x')
	uri := fixtures.URI(fixtures.FieldBytes(1, inner))
	_, err := DecodeURI(uri)
	if err == nil {
		t.Fatal("expected error")
	}
	msg := err.Error()
	for _, bad := range []string{fixtures.FakeSecretB32, "otpauth", base64.StdEncoding.EncodeToString(fixtures.FakeSecret)} {
		if strings.Contains(msg, bad) {
			t.Errorf("error %q contains %q", msg, bad)
		}
	}
}

func TestFormattingNeverShowsSecret(t *testing.T) {
	batch, err := DecodeURI(fixtures.SimpleURI())
	if err != nil {
		t.Fatal(err)
	}
	a := batch.Accounts[0]
	secret := a.Secret()
	values := []any{a, &a, batch.Accounts, batch, &batch, secret, []Secret{secret}, struct{ A Account }{a}}
	verbs := []string{"%v", "%+v", "%#v", "%s", "%q", "%x", "%X", "%d", "%T"}
	forbidden := []string{
		fixtures.FakeSecretB32,
		fmt.Sprintf("%x", fixtures.FakeSecret),
		fmt.Sprintf("%X", fixtures.FakeSecret),
		fmt.Sprintf("%v", fixtures.FakeSecret),
		fmt.Sprintf("%q", fixtures.FakeSecret),
		"Hello!",
		"otpauth",
	}
	for _, v := range values {
		for _, verb := range verbs {
			out := fmt.Sprintf(verb, v)
			for _, bad := range forbidden {
				if strings.Contains(out, bad) {
					t.Errorf("Sprintf(%s, %T) = %q contains %q", verb, v, out, bad)
				}
			}
		}
	}
	if got := fmt.Sprint(a); got != "Exemplo / ana@exemplo.com (TOTP)" {
		t.Errorf("Sprint(account) = %q", got)
	}
	if secret.String() != "[redacted]" || secret.GoString() != "[redacted]" {
		t.Error("secret String/GoString not redacted")
	}
	data, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), fixtures.FakeSecretB32) || strings.Contains(string(data), base64.StdEncoding.EncodeToString(fixtures.FakeSecret)) {
		t.Errorf("json.Marshal(account) leaks the secret: %s", data)
	}
}

func TestDescribe(t *testing.T) {
	cases := map[string]Account{
		"Exemplo / ana (TOTP)":           NewAccount("Exemplo", "ana", "SHA1", 6, "totp", 0, fixtures.FakeSecret),
		"(no issuer) / (no name) (HOTP)": NewAccount("", "", "SHA1", 6, "hotp", 3, fixtures.FakeSecret),
		"X / y (TOTP, SHA512)":           NewAccount("X", "y", "SHA512", 6, "totp", 0, fixtures.FakeSecret),
		"X / y (TOTP, MD5, 8 digits)":    NewAccount("X", "y", "MD5", 8, "totp", 0, fixtures.FakeSecret),
	}
	for want, a := range cases {
		if got := a.Describe(); got != want {
			t.Errorf("Describe = %q, want %q", got, want)
		}
	}
}

func TestPercentEncode(t *testing.T) {
	cases := []struct{ in, safe, want string }{
		{"Outra Firma", "", "Outra%20Firma"},
		{"a@b", "", "a%40b"},
		{"a@b", "@", "a@b"},
		{"A-Z_a.z~0", "", "A-Z_a.z~0"},
		{"é/&?#:+=", "", "%C3%A9%2F%26%3F%23%3A%2B%3D"},
	}
	for _, c := range cases {
		if got := percentEncode(c.in, c.safe); got != c.want {
			t.Errorf("percentEncode(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func srcText(payloads ...string) Source { return Source{Name: "argument", Payloads: payloads} }

func TestCollectDeduplicatesAndReportsGaps(t *testing.T) {
	one := fixtures.TOTP(fixtures.FakeSecret, "a", "Exemplo")
	two := fixtures.TOTP(fixtures.OtherSecret, "b", "Outra")
	part1 := fixtures.URI(fixtures.Payload([]fixtures.OTP{one}, 3, 0, 9))
	part2 := fixtures.URI(fixtures.Payload([]fixtures.OTP{two}, 3, 1, 9))
	col, err := Collect([]Source{
		{Name: "p1.png", Image: true, Payloads: []string{part1, "https://exemplo.com"}},
		{Name: "p2.png", Image: true, Payloads: []string{part2}},
		{Name: "p1-again.png", Image: true, Payloads: []string{part1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(col.Accounts) != 2 {
		t.Fatalf("got %d accounts, want 2", len(col.Accounts))
	}
	if len(col.Gaps) != 1 || col.Gaps[0].Size != 3 || col.Gaps[0].Read != 2 {
		t.Fatalf("gaps = %+v", col.Gaps)
	}
	if !strings.Contains(col.Gaps[0].Warning(), "has 3 QR codes and only 2 were read") {
		t.Errorf("warning = %q", col.Gaps[0].Warning())
	}
}

func TestCollectCompleteBatchHasNoGap(t *testing.T) {
	a := fixtures.TOTP(fixtures.FakeSecret, "a", "x")
	b := fixtures.TOTP(fixtures.OtherSecret, "b", "y")
	col, err := Collect([]Source{
		srcText(fixtures.URI(fixtures.Payload([]fixtures.OTP{a}, 2, 0, 5))),
		srcText(fixtures.URI(fixtures.Payload([]fixtures.OTP{b}, 2, 1, 5))),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(col.Gaps) != 0 || len(col.Accounts) != 2 {
		t.Fatalf("collection = %d accounts, gaps %+v", len(col.Accounts), col.Gaps)
	}
}

func TestCollectImageWithoutExport(t *testing.T) {
	_, err := Collect([]Source{{Name: "print.png", Image: true, Payloads: []string{"https://exemplo.com"}}})
	if err == nil || !strings.Contains(err.Error(), "print.png has no Google Authenticator export QR code") {
		t.Fatalf("err = %v", err)
	}
}

func TestCollectBadPayloadInImageNamesFile(t *testing.T) {
	_, err := Collect([]Source{{Name: "print.png", Image: true, Payloads: []string{"otpauth-migration://offline?data=%%%"}}})
	if err == nil || !strings.HasPrefix(err.Error(), "print.png: ") {
		t.Fatalf("err = %v", err)
	}
}

func TestIsMigrationURI(t *testing.T) {
	for in, want := range map[string]bool{
		"otpauth-migration://offline?data=x": true,
		"  OTPAUTH-MIGRATION://offline":      true,
		"otpauth://totp/x":                   false,
		"otpauth-migration":                  false,
		"":                                   false,
	} {
		if got := IsMigrationURI(in); got != want {
			t.Errorf("IsMigrationURI(%q) = %v", in, got)
		}
	}
}
