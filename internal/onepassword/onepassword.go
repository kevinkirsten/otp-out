// Package onepassword saves OTP accounts into 1Password through its CLI, op.
//
// It is optional (the --op flag) and is a port of the original otp-import
// flow: find similar items, ask where to save, ask before overwriting an
// existing one-time password, or create a new Login item.
//
// The otpauth URI reaches op as a command-line assignment, which is how op
// accepts field values without a template file. Every op error message
// goes through Redact before it is shown.
package onepassword

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/kevinkirsten/otp-out/internal/usererr"
)

// OTPFieldLabel is the label 1Password uses for a new OTP field.
const OTPFieldLabel = "one-time password"

// MaxCandidates limits the list of similar items.
const MaxCandidates = 15

// Result is the outcome of one op call.
type Result struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

// Runner runs op with the given arguments. Tests replace it with a fake.
type Runner func(args []string) (Result, error)

// DefaultRunner finds op in PATH (or the usual Homebrew folders) and runs it.
func DefaultRunner(args []string) (Result, error) {
	path, err := exec.LookPath("op")
	if err != nil {
		for _, p := range []string{"/opt/homebrew/bin/op", "/usr/local/bin/op"} {
			if _, statErr := os.Stat(p); statErr == nil {
				path, err = p, nil
				break
			}
		}
	}
	if err != nil {
		return Result{}, usererr.New("the 1Password CLI (op) was not found; install it from https://developer.1password.com/docs/cli/")
	}
	cmd := exec.Command(path, args...)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	code := 0
	if runErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(runErr, &exitErr) {
			return Result{}, usererr.New("could not run the 1Password CLI (op)")
		}
		code = exitErr.ExitCode()
	}
	return Result{ExitCode: code, Stdout: stdout.String(), Stderr: stderr.String()}, nil
}

var otpauthPattern = regexp.MustCompile(`otpauth(-migration)?://\S+`)

// Redact removes the given secrets and any otpauth URI from text.
func Redact(text string, secrets ...string) string {
	for _, s := range secrets {
		if s != "" {
			text = strings.ReplaceAll(text, s, "[redacted]")
		}
	}
	return otpauthPattern.ReplaceAllString(text, "[redacted]")
}

var ssoPattern = regexp.MustCompile(`(?i)sso[ _-]?login|sign[ -]?in with`)

// Item is the part of an op item list entry that is used here.
type Item struct {
	ID                    string `json:"id"`
	Title                 string `json:"title"`
	Category              string `json:"category"`
	AdditionalInformation string `json:"additional_information"`
	Vault                 struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"vault"`
	URLs []struct {
		Href string `json:"href"`
	} `json:"urls"`
}

// Vault is an op vault.
type Vault struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// OTPField is an existing OTP field: only its label and section, never its
// value.
type OTPField struct {
	Label   string
	Section string
}

// Client talks to op.
type Client struct {
	run   Runner
	items []Item
	// sso remembers items whose JSON shows a "sign in with" login, to
	// explain op failures on them.
	sso map[string]bool
}

// New returns a client that uses run (DefaultRunner when nil).
func New(run Runner) *Client {
	if run == nil {
		run = DefaultRunner
	}
	return &Client{run: run, sso: map[string]bool{}}
}

func (c *Client) call(args []string, secrets ...string) (string, error) {
	res, err := c.run(args)
	if err != nil {
		if msg, ok := usererr.Message(err); ok {
			return "", usererr.New(msg)
		}
		return "", usererr.New("could not run the 1Password CLI (op)")
	}
	if res.ExitCode != 0 {
		msg := strings.TrimSpace(Redact(res.Stderr, secrets...))
		if msg == "" {
			msg = "no message"
		}
		return "", &OpError{Command: args[0] + " " + args[1], Message: msg, SSO: ssoPattern.MatchString(res.Stderr)}
	}
	return res.Stdout, nil
}

// OpError is a failed op call. Message is already redacted.
type OpError struct {
	Command string
	Message string
	SSO     bool
}

func (e *OpError) Error() string {
	msg := "op failed (" + e.Command + "): " + e.Message
	if e.SSO {
		msg += "\nThis item signs in with Google or another provider (ssoLogin), and op may refuse to edit it. " +
			"Run otp-out again with --clipboard and paste the code in the 1Password app instead."
	}
	return msg
}

// Items lists the items once and caches them.
func (c *Client) Items() ([]Item, error) {
	if c.items != nil {
		return c.items, nil
	}
	out, err := c.call([]string{"item", "list", "--format", "json"})
	if err != nil {
		return nil, err
	}
	items := []Item{}
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &items); err != nil {
			return nil, usererr.New("unexpected output from op item list")
		}
	}
	c.items = items
	return items, nil
}

// Vaults lists the vaults.
func (c *Client) Vaults() ([]Vault, error) {
	out, err := c.call([]string{"vault", "list", "--format", "json"})
	if err != nil {
		return nil, err
	}
	vaults := []Vault{}
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &vaults); err != nil {
			return nil, usererr.New("unexpected output from op vault list")
		}
	}
	return vaults, nil
}

// ExistingOTPFields returns the labels and sections of the item's OTP
// fields. Values are dropped right here and never kept.
func (c *Client) ExistingOTPFields(itemID string) ([]OTPField, error) {
	out, err := c.call([]string{"item", "get", itemID, "--format", "json"})
	if err != nil {
		return nil, err
	}
	var item struct {
		Fields []struct {
			ID      string `json:"id"`
			Type    string `json:"type"`
			Label   string `json:"label"`
			Purpose string `json:"purpose"`
			Section *struct {
				Label string `json:"label"`
			} `json:"section"`
		} `json:"fields"`
	}
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &item); err != nil {
			return nil, usererr.New("unexpected output from op item get")
		}
	}
	if ssoPattern.MatchString(out) {
		c.sso[itemID] = true
	}
	var fields []OTPField
	for _, f := range item.Fields {
		if f.Type != "OTP" {
			continue
		}
		label := f.Label
		if label == "" {
			label = OTPFieldLabel
		}
		section := ""
		if f.Section != nil {
			section = f.Section.Label
		}
		fields = append(fields, OTPField{Label: label, Section: section})
	}
	return fields, nil
}

// SetOTP writes the URI into the item's OTP field.
func (c *Client) SetOTP(itemID, uri, secret, label, section string) error {
	_, err := c.call([]string{"item", "edit", itemID, Assignment(uri, label, section)}, uri, secret)
	var opErr *OpError
	if errors.As(err, &opErr) && c.sso[itemID] {
		opErr.SSO = true
	}
	return err
}

// CreateLogin creates a Login item with the OTP field.
func (c *Client) CreateLogin(title, vaultID, uri, secret string) error {
	args := []string{"item", "create", "--category", "Login", "--title", title}
	if vaultID != "" {
		args = append(args, "--vault", vaultID)
	}
	args = append(args, Assignment(uri, OTPFieldLabel, ""))
	if _, err := c.call(args, uri, secret); err != nil {
		return err
	}
	c.items = nil
	return nil
}

var fieldNameEscapes = regexp.MustCompile(`([.=\\])`)

// EscapeFieldName escapes dots, equals signs and backslashes, as op asks.
func EscapeFieldName(name string) string {
	return fieldNameEscapes.ReplaceAllString(name, `\$1`)
}

// Assignment builds "[section.]label[otp]=uri".
func Assignment(uri, label, section string) string {
	name := EscapeFieldName(label)
	if section != "" {
		name = EscapeFieldName(section) + "." + name
	}
	return name + "[otp]=" + uri
}

// ---------------------------------------------------------------- search

func normalize(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Hosts returns the host names of the item's URLs.
func (it Item) Hosts() []string {
	var hosts []string
	for _, u := range it.URLs {
		href := u.Href
		withScheme := href
		if !strings.Contains(href, "://") {
			withScheme = "https://" + href
		}
		host := ""
		if parsed, err := url.Parse(withScheme); err == nil {
			host = strings.ToLower(parsed.Hostname())
		}
		if host == "" {
			host = href
		}
		hosts = append(hosts, host)
	}
	return hosts
}

var wordSplit = regexp.MustCompile(`[\s.\-_:/()]+`)

// SearchTerms derives search terms from an account: the issuer (or the
// e-mail domain) and its longer words.
func SearchTerms(issuer, name string) []string {
	base := issuer
	if base == "" {
		parts := strings.Split(name, "@")
		base = parts[len(parts)-1]
	}
	candidates := []string{base}
	for _, w := range wordSplit.Split(base, -1) {
		if utf8.RuneCountInString(w) >= 4 {
			candidates = append(candidates, w)
		}
	}
	seen := map[string]bool{}
	var terms []string
	for _, t := range candidates {
		if seen[t] {
			continue
		}
		seen[t] = true
		if len(normalize(t)) >= 3 {
			terms = append(terms, t)
		}
	}
	return terms
}

// FindCandidates ranks items by how well their title or URL matches the
// terms: exact title, title containing the term (or the reverse), then URL.
// Login items get a small bonus.
func FindCandidates(items []Item, terms []string) []Item {
	var normalized []string
	for _, t := range terms {
		if n := normalize(t); len(n) >= 3 {
			normalized = append(normalized, n)
		}
	}
	type scored struct {
		score int // doubled, so the 0.5 bonus stays an integer
		item  Item
	}
	var list []scored
	for _, it := range items {
		title := normalize(it.Title)
		var hosts []string
		for _, h := range it.Hosts() {
			hosts = append(hosts, normalize(h))
		}
		score := 0
		for _, term := range normalized {
			switch {
			case title == term:
				score = max(score, 8)
			case strings.Contains(title, term) || (len(title) >= 3 && strings.Contains(term, title)):
				score = max(score, 6)
			default:
				for _, h := range hosts {
					if strings.Contains(h, term) {
						score = max(score, 4)
					}
				}
			}
		}
		if score > 0 {
			if it.Category == "LOGIN" {
				score++
			}
			list = append(list, scored{score, it})
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return strings.ToLower(list[i].item.Title) < strings.ToLower(list[j].item.Title)
	})
	var out []Item
	for i, s := range list {
		if i >= MaxCandidates {
			break
		}
		out = append(out, s.item)
	}
	return out
}

// Describe is the one-line summary of an item shown in the list.
func (it Item) Describe() string {
	title := it.Title
	if title == "" {
		title = "(no title)"
	}
	parts := []string{title}
	if it.AdditionalInformation != "" {
		parts = append(parts, it.AdditionalInformation)
	}
	if it.Vault.Name != "" {
		parts = append(parts, "vault "+it.Vault.Name)
	}
	if hosts := it.Hosts(); len(hosts) > 0 {
		parts = append(parts, hosts[0])
	}
	return strings.Join(parts, " | ")
}
