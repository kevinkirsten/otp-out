package cli

const helpText = `otp-out turns a Google Authenticator export QR code into otpauth:// URIs,
one per account, to add them to another app (1Password, Bitwarden, Aegis...).

Usage:
  otp-out [option] <screenshot>...     read the export QR code(s) from images
  otp-out [option]                     paste the otpauth-migration:// link (hidden)
  otp-out [option] -                   read the link from stdin
  otp-out [option] <link>              link as an argument (stays in shell history)

Output (choose at most one):
  (none)        one full otpauth:// URI per line on stdout
  --secrets     only the base32 secrets, one per line
  --json        JSON array: issuer, name, type, algorithm, digits,
                counter (hotp) or period (totp), secret, uri
  --dry-run     only issuer and name of each account, never a secret
  --clipboard   copy one account at a time to the clipboard, show nothing,
                wait for Enter, empty the clipboard at the end
  --op          save into 1Password with the 1Password CLI (op)

Other:
  -h, --help    show this help
  -v, --version show the version

Images: PNG, JPEG, WEBP, GIF and HEIC, detected by content. The QR code can
be a small part of a phone screenshot. A large export comes as several QR
codes ("1 of 3"): pass all screenshots at once; otp-out warns if one is
missing.

Examples:
  otp-out --dry-run screenshot.png          check what is in the export
  otp-out screenshot.png                    print the URIs
  otp-out part1.png part2.png part3.png     export split in 3 QR codes
  otp-out --clipboard screenshot.png        paste each account by hand
  otp-out --json screenshot.png > out.json  JSON (keep that file safe)
  pbpaste | otp-out -                       link from the clipboard (macOS)
  otp-out                                   paste the link, hidden

Messages and questions go to stderr; stdout only has the output asked for.
otp-out makes no network connections. It never writes the secrets to a
file or a log: they exist only in memory and in the output you asked for.

Exit codes: 0 ok, 1 error, 2 usage error, 3 some accounts were skipped
(unsupported algorithm, such as MD5), 130 interrupted.

https://github.com/kevinkirsten/otp-out
`
