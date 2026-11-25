package migration

import (
	"encoding/base64"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/kevinkirsten/otp-out/internal/usererr"
)

// Enum values of the Google Authenticator MigrationPayload. 0 means "not set".
var (
	algorithmNames = map[uint64]string{0: "SHA1", 1: "SHA1", 2: "SHA256", 3: "SHA512", 4: "MD5"}
	digitCounts    = map[uint64]int{0: 6, 1: 6, 2: 8}
	otpTypes       = map[uint64]string{0: "totp", 1: "hotp", 2: "totp"}
)

// Batch is one decoded export QR code. Big exports are split into several
// QR codes ("1 of 3"); they share ID and Size and differ in Index.
type Batch struct {
	Accounts []Account
	Size     int
	Index    int
	ID       uint64
}

// Scheme is the URI scheme of a Google Authenticator export.
const Scheme = "otpauth-migration"

// IsMigrationURI reports whether text looks like an export link
// (otpauth-migration:...), ignoring surrounding spaces and letter case.
func IsMigrationURI(text string) bool {
	text = strings.TrimSpace(text)
	return len(text) > len(Scheme) && strings.EqualFold(text[:len(Scheme)+1], Scheme+":")
}

// DecodeURI decodes an otpauth-migration://offline?data=... link.
func DecodeURI(uri string) (Batch, error) {
	uri = strings.TrimSpace(uri)
	if !IsMigrationURI(uri) {
		return Batch{}, usererr.New("this is not a Google Authenticator export link")
	}
	rest := uri[len(Scheme)+1:]
	if i := strings.IndexByte(rest, '#'); i >= 0 {
		rest = rest[:i]
	}
	query := ""
	if i := strings.IndexByte(rest, '?'); i >= 0 {
		query = rest[i+1:]
	}
	encoded, found, err := queryValue(query, "data")
	if err != nil {
		return Batch{}, err
	}
	if !found {
		return Batch{}, usererr.New("the export link has no data field")
	}
	raw, err := decodeBase64(encoded)
	if err != nil {
		return Batch{}, err
	}
	return parsePayload(raw)
}

// queryValue returns the first non-empty value of key, decoded like Python's
// parse_qs (which also turns "+" into a space). Base64 never contains a
// space, so spaces are turned back into "+": some QR readers deliver a raw
// "+" instead of "%2B".
func queryValue(query, key string) (string, bool, error) {
	for _, pair := range strings.Split(query, "&") {
		name, value, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		decodedName, err := url.QueryUnescape(name)
		if err != nil || decodedName != key {
			continue
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil {
			return "", false, usererr.New("the data field of the export link is not valid base64")
		}
		if decoded == "" {
			continue
		}
		return strings.TrimSpace(strings.ReplaceAll(decoded, " ", "+")), true, nil
	}
	return "", false, nil
}

func decodeBase64(encoded string) ([]byte, error) {
	invalid := usererr.New("the data field of the export link is not valid base64")
	for i := 0; i < len(encoded); i++ {
		c := encoded[i]
		isBase64 := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '='
		if !isBase64 {
			return nil, invalid
		}
	}
	if pad := len(encoded) % 4; pad != 0 {
		encoded += strings.Repeat("=", 4-pad)
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, invalid
	}
	return raw, nil
}

// ---------------------------------------------------------------- protobuf

// field is one protobuf field: number, wire type and either an integer
// (varint) or bytes (length-delimited, fixed32, fixed64).
type field struct {
	number   uint64
	wireType uint64
	varint   uint64
	bytes    []byte
}

func readVarint(data []byte, pos int) (uint64, int, error) {
	var result uint64
	var shift uint
	for {
		if pos >= len(data) {
			return 0, 0, usererr.New("the QR data is cut short (incomplete varint)")
		}
		b := data[pos]
		pos++
		if shift < 64 {
			result |= uint64(b&0x7F) << shift
		}
		if b&0x80 == 0 {
			return result, pos, nil
		}
		shift += 7
		if shift > 70 {
			return 0, 0, usererr.New("the QR data is invalid (varint too long)")
		}
	}
}

// parseFields walks a protobuf message by hand. No protobuf library is used.
func parseFields(data []byte) ([]field, error) {
	var fields []field
	pos := 0
	for pos < len(data) {
		key, next, err := readVarint(data, pos)
		if err != nil {
			return nil, err
		}
		pos = next
		f := field{number: key >> 3, wireType: key & 0x07}
		switch f.wireType {
		case 0:
			f.varint, pos, err = readVarint(data, pos)
			if err != nil {
				return nil, err
			}
		case 2:
			var length uint64
			length, pos, err = readVarint(data, pos)
			if err != nil {
				return nil, err
			}
			if length > uint64(len(data)-pos) {
				return nil, usererr.New("the QR data is cut short (incomplete field)")
			}
			f.bytes = data[pos : pos+int(length)]
			pos += int(length)
		case 1:
			if pos+8 > len(data) {
				return nil, usererr.New("the QR data is cut short (64-bit field)")
			}
			f.bytes = data[pos : pos+8]
			pos += 8
		case 5:
			if pos+4 > len(data) {
				return nil, usererr.New("the QR data is cut short (32-bit field)")
			}
			f.bytes = data[pos : pos+4]
			pos += 4
		default:
			return nil, usererr.New("the QR data is invalid (unknown field type)")
		}
		fields = append(fields, f)
	}
	return fields, nil
}

// text decodes UTF-8, replacing each invalid byte with U+FFFD.
func text(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		sb.WriteRune(r)
		b = b[size:]
	}
	return sb.String()
}

// SplitLabel removes a repeated "Issuer:" prefix from the name, or takes the
// issuer from the name when the issuer field is empty.
func SplitLabel(name, issuer string) (string, string) {
	name = strings.TrimSpace(name)
	issuer = strings.TrimSpace(issuer)
	if issuer != "" && strings.HasPrefix(strings.ToLower(name), strings.ToLower(issuer)+":") {
		runes := []rune(name)
		cut := utf8.RuneCountInString(issuer) + 1
		if cut <= len(runes) {
			name = strings.TrimSpace(string(runes[cut:]))
		}
	} else if issuer == "" && strings.Contains(name, ":") {
		before, after, _ := strings.Cut(name, ":")
		issuer, name = strings.TrimSpace(before), strings.TrimSpace(after)
	}
	return name, issuer
}

func parseOTPParameters(data []byte) (Account, error) {
	fields, err := parseFields(data)
	if err != nil {
		return Account{}, err
	}
	var (
		secret                        []byte
		name, issuer                  string
		algorithm, digits, otp, count uint64
	)
	for _, f := range fields {
		switch {
		case f.number == 1 && f.wireType == 2:
			secret = append([]byte(nil), f.bytes...)
		case f.number == 2 && f.wireType == 2:
			name = text(f.bytes)
		case f.number == 3 && f.wireType == 2:
			issuer = text(f.bytes)
		case f.number == 4 && f.wireType == 0:
			algorithm = f.varint
		case f.number == 5 && f.wireType == 0:
			digits = f.varint
		case f.number == 6 && f.wireType == 0:
			otp = f.varint
		case f.number == 7 && f.wireType == 0:
			count = f.varint
		}
	}
	if len(secret) == 0 {
		return Account{}, usererr.New("an account in the QR code has no secret")
	}
	name, issuer = SplitLabel(name, issuer)
	account := Account{
		Issuer:    issuer,
		Name:      name,
		Algorithm: lookup(algorithmNames, algorithm, "SHA1"),
		Digits:    lookup(digitCounts, digits, 6),
		Type:      lookup(otpTypes, otp, "totp"),
		Counter:   count,
		secret:    secret,
	}
	return account, nil
}

func lookup[T any](table map[uint64]T, key uint64, fallback T) T {
	if v, ok := table[key]; ok {
		return v
	}
	return fallback
}

func parsePayload(data []byte) (Batch, error) {
	fields, err := parseFields(data)
	if err != nil {
		return Batch{}, err
	}
	batch := Batch{Size: 1}
	var size uint64 = 1
	for _, f := range fields {
		switch {
		case f.number == 1 && f.wireType == 2:
			account, err := parseOTPParameters(f.bytes)
			if err != nil {
				return Batch{}, err
			}
			batch.Accounts = append(batch.Accounts, account)
		case f.number == 3 && f.wireType == 0:
			size = f.varint
		case f.number == 4 && f.wireType == 0:
			batch.Index = clampInt(f.varint)
		case f.number == 5 && f.wireType == 0:
			batch.ID = f.varint
		}
	}
	batch.Size = max(clampInt(size), 1)
	return batch, nil
}

func clampInt(v uint64) int {
	const maxInt = int(^uint(0) >> 1)
	if v > uint64(maxInt) {
		return maxInt
	}
	return int(v)
}
