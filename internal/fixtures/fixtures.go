// Package fixtures builds synthetic export links for tests.
//
// Every secret here is FAKE. Never put a real QR code or a real secret in
// this repository.
package fixtures

import (
	"encoding/base32"
	"encoding/base64"
	"net/url"
)

// Fake secrets (base32). Both are well known test values.
const (
	FakeSecretB32  = "JBSWY3DPEHPK3PXP" // gitleaks:allow (fake: base32 of "Hello!\xde\xad\xbe\xef")
	OtherSecretB32 = "GEZDGNBVGY3TQOJQ" // gitleaks:allow (fake: base32 of "1234567890")
)

// FakeSecret and OtherSecret are the raw bytes of the fake secrets.
var (
	FakeSecret  = mustB32(FakeSecretB32)
	OtherSecret = mustB32(OtherSecretB32)
)

func mustB32(s string) []byte {
	b, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
	if err != nil {
		panic("fixtures: bad base32 constant")
	}
	return b
}

// Varint encodes a protobuf varint.
func Varint(v uint64) []byte {
	var out []byte
	for {
		b := byte(v & 0x7F)
		v >>= 7
		if v != 0 {
			out = append(out, b|0x80)
			continue
		}
		return append(out, b)
	}
}

// FieldVarint encodes a varint field.
func FieldVarint(number, value uint64) []byte {
	return append(Varint(number<<3), Varint(value)...)
}

// FieldBytes encodes a length-delimited field.
func FieldBytes(number uint64, data []byte) []byte {
	out := Varint(number<<3 | 2)
	out = append(out, Varint(uint64(len(data)))...)
	return append(out, data...)
}

// OTP describes one account to encode. Zero values mean "not set" in the
// export format, except where noted.
type OTP struct {
	Secret    []byte
	Name      string
	Issuer    string
	Algorithm uint64 // 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
	Digits    uint64 // 1 six, 2 eight
	Type      uint64 // 1 hotp, 2 totp
	Counter   uint64
}

// TOTP returns a SHA1, 6-digit TOTP account.
func TOTP(secret []byte, name, issuer string) OTP {
	return OTP{Secret: secret, Name: name, Issuer: issuer, Algorithm: 1, Digits: 1, Type: 2}
}

// Encode encodes the OtpParameters message.
func (o OTP) Encode() []byte {
	data := FieldBytes(1, o.Secret)
	data = append(data, FieldBytes(2, []byte(o.Name))...)
	data = append(data, FieldBytes(3, []byte(o.Issuer))...)
	data = append(data, FieldVarint(4, o.Algorithm)...)
	data = append(data, FieldVarint(5, o.Digits)...)
	data = append(data, FieldVarint(6, o.Type)...)
	if o.Counter != 0 {
		data = append(data, FieldVarint(7, o.Counter)...)
	}
	return data
}

// Payload encodes a MigrationPayload.
func Payload(otps []OTP, batchSize, batchIndex, batchID uint64) []byte {
	var data []byte
	for _, o := range otps {
		data = append(data, FieldBytes(1, o.Encode())...)
	}
	data = append(data, FieldVarint(2, 1)...)
	data = append(data, FieldVarint(3, batchSize)...)
	data = append(data, FieldVarint(4, batchIndex)...)
	data = append(data, FieldVarint(5, batchID)...)
	return data
}

// URI wraps a payload in an otpauth-migration link, percent-encoded.
func URI(payload []byte) string {
	return "otpauth-migration://offline?data=" + url.QueryEscape(base64.StdEncoding.EncodeToString(payload))
}

// SimpleURI is a link with one account: Exemplo / ana@exemplo.com.
func SimpleURI() string {
	return URI(Payload([]OTP{TOTP(FakeSecret, "ana@exemplo.com", "Exemplo")}, 1, 0, 4242))
}

// SimpleOTPAuth is the otpauth URI expected for SimpleURI.
const SimpleOTPAuth = "otpauth://totp/Exemplo:ana@exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=Exemplo&algorithm=SHA1&digits=6&period=30"
