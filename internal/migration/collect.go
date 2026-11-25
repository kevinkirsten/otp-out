package migration

import (
	"bytes"
	"fmt"

	"github.com/kevinkirsten/otp-out/internal/usererr"
)

// Source is one input: an image (with the texts of the QR codes found in
// it) or a link given as text.
type Source struct {
	// Name identifies the input in messages: a file path, "argument" or
	// "stdin". It is never QR data.
	Name string
	// Image is true when the payloads came from QR codes in an image.
	Image    bool
	Payloads []string
}

// Gap describes an export split in several QR codes where some were not read.
type Gap struct {
	Size int // QR codes in the export
	Read int // QR codes read
}

// Warning returns the message shown on stderr for this gap.
func (g Gap) Warning() string {
	return fmt.Sprintf("Warning: the export has %d QR codes and only %d were read. Pass all screenshots at once.", g.Size, g.Read)
}

// Collection is the result of reading every source.
type Collection struct {
	Accounts []Account
	Gaps     []Gap
}

// Collect decodes every export payload of every source, removes duplicate
// accounts (same issuer, name and secret) and reports exports with missing
// parts. A source without any export payload is an error.
func Collect(sources []Source) (Collection, error) {
	var result Collection
	type batchInfo struct {
		size    int
		indexes map[int]bool
	}
	batches := map[uint64]*batchInfo{}
	var order []uint64
	for _, source := range sources {
		found := false
		for _, payload := range source.Payloads {
			if !IsMigrationURI(payload) {
				continue
			}
			found = true
			batch, err := DecodeURI(payload)
			if err != nil {
				if source.Image {
					msg, _ := usererr.Message(err)
					return Collection{}, usererr.Newf("%s: %s", source.Name, msg)
				}
				return Collection{}, err
			}
			info, ok := batches[batch.ID]
			if !ok {
				info = &batchInfo{size: batch.Size, indexes: map[int]bool{}}
				batches[batch.ID] = info
				order = append(order, batch.ID)
			}
			info.indexes[batch.Index] = true
			for _, account := range batch.Accounts {
				if !containsAccount(result.Accounts, account) {
					result.Accounts = append(result.Accounts, account)
				}
			}
		}
		if !found {
			if source.Image {
				return Collection{}, usererr.Newf("%s has no Google Authenticator export QR code", source.Name)
			}
			return Collection{}, usererr.Newf("the %s is not a Google Authenticator export link", source.Name)
		}
	}
	for _, id := range order {
		info := batches[id]
		if len(info.indexes) < info.size {
			result.Gaps = append(result.Gaps, Gap{Size: info.size, Read: len(info.indexes)})
		}
	}
	return result, nil
}

func containsAccount(list []Account, a Account) bool {
	for _, b := range list {
		if b.Issuer == a.Issuer && b.Name == a.Name && bytes.Equal(b.secret, a.secret) {
			return true
		}
	}
	return false
}
