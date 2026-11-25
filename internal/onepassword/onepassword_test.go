package onepassword

import (
	"errors"
	"strings"
	"testing"
)

func testItems() []Item {
	mk := func(id, title, category, href string) Item {
		it := Item{ID: id, Title: title, Category: category}
		if href != "" {
			it.URLs = append(it.URLs, struct {
				Href string `json:"href"`
			}{href})
		}
		return it
	}
	return []Item{
		mk("id-exemplo", "Exemplo", "LOGIN", "https://exemplo.com.br/login"),
		mk("id-git", "Repositório", "LOGIN", "github.com"),
		mk("id-other", "Banco Qualquer", "LOGIN", ""),
	}
}

func ids(items []Item) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.ID)
	}
	return out
}

func TestCandidatesMatchTitleAndHost(t *testing.T) {
	items := testItems()
	if got := ids(FindCandidates(items, []string{"Exemplo"})); strings.Join(got, ",") != "id-exemplo" {
		t.Errorf("Exemplo -> %v", got)
	}
	if got := ids(FindCandidates(items, []string{"GitHub"})); strings.Join(got, ",") != "id-git" {
		t.Errorf("GitHub -> %v", got)
	}
	if got := FindCandidates(items, []string{"Nada"}); len(got) != 0 {
		t.Errorf("Nada -> %v", ids(got))
	}
}

func TestCandidatesRanking(t *testing.T) {
	items := []Item{
		{ID: "contains", Title: "Exemplo Pessoal", Category: "PASSWORD"},
		{ID: "exact-note", Title: "Exemplo", Category: "SECURE_NOTE"},
		{ID: "exact-login", Title: "exemplo", Category: "LOGIN"},
	}
	got := strings.Join(ids(FindCandidates(items, []string{"Exemplo"})), ",")
	if got != "exact-login,exact-note,contains" {
		t.Errorf("ranking = %s", got)
	}
	var many []Item
	for i := 0; i < 30; i++ {
		many = append(many, Item{ID: "x", Title: "Exemplo"})
	}
	if n := len(FindCandidates(many, []string{"Exemplo"})); n != MaxCandidates {
		t.Errorf("got %d candidates", n)
	}
}

func TestSearchTerms(t *testing.T) {
	if got := strings.Join(SearchTerms("Outra Firma", "joao@x.com"), "|"); got != "Outra Firma|Outra|Firma" {
		t.Errorf("terms = %s", got)
	}
	if got := strings.Join(SearchTerms("", "ana@exemplo.com.br"), "|"); got != "exemplo.com.br|exemplo" {
		t.Errorf("terms = %s", got)
	}
	if got := SearchTerms("X", "a"); len(got) != 0 {
		t.Errorf("short terms = %v", got)
	}
}

func TestAssignmentEscapesFieldName(t *testing.T) {
	if got := Assignment("otpauth://x", OTPFieldLabel, ""); got != "one-time password[otp]=otpauth://x" {
		t.Errorf("got %q", got)
	}
	if got := Assignment("u", "2FA", "Seg.uro"); got != `Seg\.uro.2FA[otp]=u` {
		t.Errorf("got %q", got)
	}
	if got := EscapeFieldName(`a=b\c`); got != `a\=b\\c` {
		t.Errorf("got %q", got)
	}
}

func TestRedact(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP" // gitleaks:allow (fake)
	in := "bad value otpauth://totp/x?secret=" + secret + " and " + secret + " and otpauth-migration://offline?data=AAA"
	out := Redact(in, secret)
	if strings.Contains(out, secret) || strings.Contains(out, "otpauth") {
		t.Errorf("redact = %q", out)
	}
}

func TestOpErrorRedactsStderr(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP" // gitleaks:allow (fake)
	uri := "otpauth://totp/x?secret=" + secret
	c := New(func(args []string) (Result, error) {
		return Result{ExitCode: 1, Stderr: "[ERROR] invalid " + args[len(args)-1] + " raw " + secret}, nil
	})
	err := c.SetOTP("id", uri, secret, OTPFieldLabel, "")
	var opErr *OpError
	if !errors.As(err, &opErr) {
		t.Fatalf("err = %T", err)
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "otpauth") {
		t.Errorf("error leaks: %s", err)
	}
	if opErr.SSO {
		t.Error("unexpected SSO hint")
	}
}

func TestOpErrorWithSSOInStderr(t *testing.T) {
	c := New(func([]string) (Result, error) {
		return Result{ExitCode: 1, Stderr: "cannot edit an item with an ssoLogin field"}, nil
	})
	err := c.SetOTP("id", "otpauth://totp/x?secret=A", "A", OTPFieldLabel, "")
	if err == nil || !strings.Contains(err.Error(), "--clipboard") {
		t.Errorf("err = %v", err)
	}
}

func TestExistingOTPFieldsDropsValues(t *testing.T) {
	c := New(func([]string) (Result, error) {
		return Result{Stdout: `{"fields":[{"type":"OTP","label":"","value":"otpauth://totp/old?secret=OLD","section":{"label":"Sec"}},{"type":"STRING","label":"u"}]}`}, nil
	})
	fields, err := c.ExistingOTPFields("id")
	if err != nil {
		t.Fatal(err)
	}
	if len(fields) != 1 || fields[0].Label != OTPFieldLabel || fields[0].Section != "Sec" {
		t.Errorf("fields = %+v", fields)
	}
}

func TestItemDescribe(t *testing.T) {
	it := testItems()[0]
	it.AdditionalInformation = "ana@exemplo.com"
	it.Vault.Name = "Private"
	if got := it.Describe(); got != "Exemplo | ana@exemplo.com | vault Private | exemplo.com.br" {
		t.Errorf("describe = %q", got)
	}
	if got := (Item{}).Describe(); got != "(no title)" {
		t.Errorf("empty = %q", got)
	}
}
