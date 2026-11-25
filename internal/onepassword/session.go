package onepassword

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/kevinkirsten/otp-out/internal/migration"
)

// Ask shows a prompt and returns the answer typed by the user.
type Ask func(prompt string) (string, error)

// Session runs the interactive flow. All text goes to Out (stderr in the
// CLI). Nothing shown contains a secret or a URI.
type Session struct {
	Client *Client
	Ask    Ask
	Out    io.Writer
}

func (s *Session) say(format string, args ...any) {
	fmt.Fprintf(s.Out, format+"\n", args...)
}

func (s *Session) confirm(question string) (bool, error) {
	answer, err := s.Ask(question + " [y/N] ")
	if err != nil {
		return false, err
	}
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "y", "yes":
		return true, nil
	}
	return false, nil
}

func (s *Session) chooseVault() (string, error) {
	vaults, err := s.Client.Vaults()
	if err != nil {
		return "", err
	}
	if len(vaults) <= 1 {
		if len(vaults) == 1 {
			return vaults[0].ID, nil
		}
		return "", nil
	}
	s.say("  Which vault?")
	for i, v := range vaults {
		s.say("    %d) %s", i+1, v.Name)
	}
	for {
		answer, err := s.Ask("  Vault: ")
		if err != nil {
			return "", err
		}
		if n, convErr := strconv.Atoi(strings.TrimSpace(answer)); convErr == nil && n >= 1 && n <= len(vaults) {
			return vaults[n-1].ID, nil
		}
		s.say("  Type the number of a vault.")
	}
}

// ImportAccount asks where to save the account. It returns true when the
// account was saved.
func (s *Session) ImportAccount(account migration.Account) (bool, error) {
	uri, err := account.URI()
	if err != nil {
		s.say("  Skipped: the %s algorithm is not supported.", account.Algorithm)
		return false, nil
	}
	secret := account.SecretBase32()
	items, err := s.Client.Items()
	if err != nil {
		return false, err
	}
	candidates := FindCandidates(items, SearchTerms(account.Issuer, account.Name))
	defaultTitle := account.Issuer
	if defaultTitle == "" {
		defaultTitle = account.Name
	}
	for {
		if len(candidates) > 0 {
			s.say("  Similar items in 1Password:")
			for i, it := range candidates {
				s.say("    %d) %s", i+1, it.Describe())
			}
		} else {
			s.say("  No similar item in 1Password.")
		}
		s.say("    n) create a new Login item %q", defaultTitle)
		s.say("    f) find with another term")
		s.say("    s) skip this account")
		answer, err := s.Ask("  Choice: ")
		if err != nil {
			return false, err
		}
		answer = strings.ToLower(strings.TrimSpace(answer))
		if n, convErr := strconv.Atoi(answer); convErr == nil && n >= 1 && n <= len(candidates) {
			item := candidates[n-1]
			fields, err := s.Client.ExistingOTPFields(item.ID)
			if err != nil {
				return false, err
			}
			label, section := OTPFieldLabel, ""
			if len(fields) > 0 {
				ok, err := s.confirm(fmt.Sprintf("  %q already has a one-time password. Overwrite it?", item.Title))
				if err != nil {
					return false, err
				}
				if !ok {
					s.say("  Left as it was. Choose again.")
					continue
				}
				label, section = fields[0].Label, fields[0].Section
			}
			if err := s.Client.SetOTP(item.ID, uri, secret, label, section); err != nil {
				return false, err
			}
			s.say("  Saved to %q.", item.Title)
			return true, nil
		}
		switch answer {
		case "n":
			title, err := s.Ask(fmt.Sprintf("  Title [%s]: ", defaultTitle))
			if err != nil {
				return false, err
			}
			title = strings.TrimSpace(title)
			if title == "" {
				title = defaultTitle
			}
			vaultID, err := s.chooseVault()
			if err != nil {
				return false, err
			}
			if err := s.Client.CreateLogin(title, vaultID, uri, secret); err != nil {
				return false, err
			}
			s.say("  Created item %q.", title)
			return true, nil
		case "f":
			term, err := s.Ask("  Find: ")
			if err != nil {
				return false, err
			}
			if term = strings.TrimSpace(term); term != "" {
				items, err := s.Client.Items()
				if err != nil {
					return false, err
				}
				candidates = FindCandidates(items, []string{term})
			}
		case "s":
			s.say("  Skipped.")
			return false, nil
		default:
			s.say("  Invalid option.")
		}
	}
}

// Run imports every account and returns how many were saved.
func (s *Session) Run(accounts []migration.Account) (int, error) {
	saved := 0
	for i, a := range accounts {
		s.say("")
		s.say("[%d/%d] %s", i+1, len(accounts), a.Describe())
		ok, err := s.ImportAccount(a)
		if err != nil {
			return saved, err
		}
		if ok {
			saved++
		}
	}
	s.say("")
	s.say("Saved: %d. Skipped: %d.", saved, len(accounts)-saved)
	return saved, nil
}
