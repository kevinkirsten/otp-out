// Package migration decodes the Google Authenticator export format
// (otpauth-migration://offline?data=...) and builds standard otpauth:// URIs.
//
// Security rule: nothing in this package puts a secret, a URI or any other
// data read from a QR code into an error message, a String() result or a
// formatted value. Error messages are fixed text.
package migration

import (
	"encoding/base32"
	"fmt"
	"strconv"
	"strings"

	"github.com/kevinkirsten/otp-out/internal/usererr"
)

const redacted = "[redacted]"

// Secret is the raw OTP key. Every fmt verb (%v, %s, %x, %d, %#v, ...) and
// String/GoString print "[redacted]", so a stray Printf or a %v in an error
// never shows it.
type Secret []byte

func (Secret) String() string   { return redacted }
func (Secret) GoString() string { return redacted }

// Format implements fmt.Formatter so that no verb can reach the bytes.
func (Secret) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(redacted)) }

// Base32 returns the secret in base32 without padding, the form OTP apps use.
func (s Secret) Base32() string {
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(s)
}

// Algorithms accepted in otpauth URIs by the apps this tool targets.
// MD5 exists in the export format but 1Password, Bitwarden and most others
// refuse it, so accounts that use it are reported and skipped.
var supportedAlgorithms = map[string]bool{"SHA1": true, "SHA256": true, "SHA512": true}

// Account is one OTP account from the export.
//
// The secret is an unexported field and Account implements fmt.Formatter, so
// printing an Account (or a slice or pointer of them) with any verb shows
// only the Describe text.
type Account struct {
	Issuer    string
	Name      string
	Algorithm string // SHA1, SHA256, SHA512 or MD5
	Digits    int    // 6 or 8
	Type      string // totp or hotp
	Counter   uint64 // only meaningful for hotp
	secret    Secret
}

// NewAccount builds an account. It exists for tests and for callers that
// already hold the raw secret.
func NewAccount(issuer, name, algorithm string, digits int, otpType string, counter uint64, secret []byte) Account {
	return Account{
		Issuer:    issuer,
		Name:      name,
		Algorithm: algorithm,
		Digits:    digits,
		Type:      otpType,
		Counter:   counter,
		secret:    append(Secret(nil), secret...),
	}
}

// Secret returns the raw secret.
func (a Account) Secret() Secret { return a.secret }

// SecretBase32 returns the secret in base32 without padding.
func (a Account) SecretBase32() string { return a.secret.Base32() }

// Supported reports whether the algorithm can be written in an otpauth URI
// that the target apps accept.
func (a Account) Supported() bool { return supportedAlgorithms[a.Algorithm] }

// String returns Describe(): issuer and name, never the secret.
func (a Account) String() string { return a.Describe() }

// GoString returns Describe() too.
func (a Account) GoString() string { return a.Describe() }

// Format implements fmt.Formatter: every verb prints Describe().
func (a Account) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(a.Describe())) }

// Describe is the safe one-line summary used on screen:
// "Issuer / name (TOTP, SHA256, 8 digits)". It never contains the secret.
func (a Account) Describe() string {
	issuer := a.Issuer
	if issuer == "" {
		issuer = "(no issuer)"
	}
	name := a.Name
	if name == "" {
		name = "(no name)"
	}
	details := []string{strings.ToUpper(a.Type)}
	if a.Algorithm != "SHA1" {
		details = append(details, a.Algorithm)
	}
	if a.Digits != 6 {
		details = append(details, strconv.Itoa(a.Digits)+" digits")
	}
	return issuer + " / " + name + " (" + strings.Join(details, ", ") + ")"
}

// Label returns "Issuer / name" without the details, for short messages.
func (a Account) Label() string {
	issuer := a.Issuer
	if issuer == "" {
		issuer = "(no issuer)"
	}
	name := a.Name
	if name == "" {
		name = "(no name)"
	}
	return issuer + " / " + name
}

// URI builds the otpauth:// URI:
//
//	otpauth://totp/Issuer:name?secret=...&issuer=Issuer&algorithm=SHA1&digits=6&period=30
//
// HOTP replaces period with counter=N. Without an issuer, the "Issuer:"
// prefix and the issuer parameter are left out. Percent-encoding matches
// Python's urllib.parse.quote: only A-Z a-z 0-9 _ . - ~ stay literal, plus
// "@" in the account name.
func (a Account) URI() (string, error) {
	if !a.Supported() {
		return "", usererr.Newf("algorithm %s is not supported by authenticator apps", a.Algorithm)
	}
	var b strings.Builder
	b.WriteString("otpauth://")
	b.WriteString(a.Type)
	b.WriteString("/")
	if a.Issuer != "" {
		b.WriteString(percentEncode(a.Issuer, ""))
		b.WriteString(":")
	}
	b.WriteString(percentEncode(a.Name, "@"))
	b.WriteString("?secret=")
	b.WriteString(a.SecretBase32())
	if a.Issuer != "" {
		b.WriteString("&issuer=")
		b.WriteString(percentEncode(a.Issuer, ""))
	}
	b.WriteString("&algorithm=")
	b.WriteString(a.Algorithm)
	b.WriteString("&digits=")
	b.WriteString(strconv.Itoa(a.Digits))
	if a.Type == "hotp" {
		b.WriteString("&counter=")
		b.WriteString(strconv.FormatUint(a.Counter, 10))
	} else {
		b.WriteString("&period=30")
	}
	return b.String(), nil
}

// percentEncode escapes every byte outside A-Z a-z 0-9 _ . - ~ and the
// extra safe characters, using uppercase hex, like urllib.parse.quote.
func percentEncode(s, safe string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if isUnreserved(c) || (c < 0x80 && strings.IndexByte(safe, c) >= 0) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&0x0F])
	}
	return b.String()
}

func isUnreserved(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
		c == '_' || c == '.' || c == '-' || c == '~'
}
