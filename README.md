# otp-out

[Português](README.pt-BR.md)

`otp-out` takes the QR code that Google Authenticator shows when you export
your accounts and turns it into one standard `otpauth://` URI per account,
ready to add to 1Password, Bitwarden, Aegis, 2FAS, KeePassXC or any other
authenticator.

```
$ otp-out screenshot.png
otpauth://totp/Example:ana@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30
```

The export QR code contains an `otpauth-migration://offline?data=...` link, a
protobuf payload that other apps cannot read. `otp-out` reads the QR code from
a screenshot or photo (or takes the link directly), decodes it and prints the
accounts. It is one small program with no dependencies, it works offline, and
it never writes your secrets to disk.

There is also a web page that does the same in the browser, without sending
anything anywhere: <https://kevinkirsten.github.io/otp-out/>.

## Export the QR code from Google Authenticator

1. In Google Authenticator, open the menu and choose **Transfer accounts ›
   Export accounts**.
2. Select the accounts and tap **Next**. The app shows one QR code, or several
   ("1 of 3") when there are many accounts.
3. Save each QR code:
   - **iPhone:** take a screenshot of each one.
   - **Android:** the app blocks screenshots of this screen. Take a photo of the
     screen with another phone or a computer webcam, or copy the link with a QR
     scanner app and paste it into `otp-out` (see "Paste the link" below).
4. Pass all the images to `otp-out` at once. It warns you if a part of a
   multi-QR export is missing.

The screenshot gives full access to your accounts. Delete it when you are done
(see [Security](#security)).

## Install

| How | Command |
| --- | --- |
| Homebrew (macOS, Linux) | `brew install kevinkirsten/tap/otp-out` |
| winget (Windows) | `winget install KevinKirsten.otp-out` |
| npm, without installing | `npx otp-out screenshot.png` |
| pnpm, without installing | `pnpm dlx otp-out screenshot.png` |
| Go, without installing | `go run github.com/kevinkirsten/otp-out@latest screenshot.png` |
| Binary | download from [Releases](https://github.com/kevinkirsten/otp-out/releases) |
| Web page | <https://kevinkirsten.github.io/otp-out/> |

All of them run the same program with the same options.

**npx and pnpm dlx** download the newest version every time you run them. To
always run a version you have checked, pin it: `npx otp-out@0.1.0` or
`pnpm dlx otp-out@0.1.0`. The npm package has no install script: it only
contains a small launcher and the binary for your system, published from
GitHub Actions with npm provenance.

**Binaries from Releases** are not code-signed (signing costs money every
year). Check the download against `checksums.txt` from the same release:

```
shasum -a 256 -c checksums.txt --ignore-missing
```

- **macOS:** a file downloaded with a browser gets a quarantine flag, and
  Gatekeeper says it "cannot verify" the developer. Either remove the flag in
  Terminal with `xattr -d com.apple.quarantine ./otp-out`, or try to run it
  once and then click **Open Anyway** in *System Settings › Privacy & Security*.
  Homebrew installs do not get this flag.
- **Windows:** SmartScreen may show "Windows protected your PC". Click
  **More info › Run anyway**, or unblock the file in PowerShell with
  `Unblock-File .\otp-out.exe`. winget installs are not affected.

## Usage

```
otp-out [option] <image>...   read the export QR code(s) from screenshots or photos
otp-out [option]              paste the link, hidden
otp-out [option] -            read the link from stdin
otp-out [option] <link>       the link as an argument (stays in your shell history)
```

Images can be PNG, JPEG, WEBP, GIF or HEIC. The format is detected from the
content, not from the file name. The QR code can be a small part of a phone
screenshot, and one image can hold several QR codes.

### Print the URIs (default)

```
otp-out screenshot.png
otp-out part1.png part2.png part3.png
```

One full `otpauth://` URI per line on stdout. Status messages go to stderr,
so you can pipe the output.

### Check what is in the export: `--dry-run`

```
$ otp-out --dry-run screenshot.png
2 account(s) in the export:
Example / ana@example.com (TOTP)
Other / bia@example.com (HOTP)
```

Only issuer and account name. Never a secret.

### Copy one account at a time: `--clipboard`

```
otp-out --clipboard screenshot.png
```

Each URI goes to the clipboard, one account at a time, and nothing is shown on
screen. Paste it into your app (in 1Password: *Edit › + Add More › One-Time
Password*), press Enter, and the next account is copied. At the end the
clipboard is emptied, also when you press Ctrl+C or an error happens.

### Only the secrets: `--secrets`

```
otp-out --secrets screenshot.png
```

One base32 secret per line, for apps that ask for the key instead of a URI.

### JSON: `--json`

```
otp-out --json screenshot.png
```

```json
[
  {
    "issuer": "Example",
    "name": "ana@example.com",
    "type": "totp",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 30,
    "secret": "JBSWY3DPEHPK3PXP",
    "uri": "otpauth://totp/Example:ana@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30"
  }
]
```

HOTP accounts have `counter` instead of `period`.

### Save into 1Password: `--op`

```
otp-out --op screenshot.png
```

Uses the [1Password CLI](https://developer.1password.com/docs/cli/) (`op`),
with the 1Password app open and unlocked. For each account, `otp-out` lists the
items that look similar and asks where to save the one-time password: in one
of them, in a new Login item, or nowhere. It asks before replacing an existing
one-time password. Items that sign in with Google or another provider
(`ssoLogin`) cannot always be edited by `op`; when that happens, use
`--clipboard` and paste the code in the 1Password app.

### Paste the link

If you already have the `otpauth-migration://` link (from a QR scanner app, for
example), run `otp-out` without arguments and paste it. The text is not shown
and does not go to your shell history. You can also pipe it:

```
pbpaste | otp-out -            # macOS
Get-Clipboard | otp-out -      # Windows PowerShell
wl-paste | otp-out -           # Linux, Wayland
```

### Exit codes

`0` ok, `1` error, `2` usage error, `3` some accounts were skipped, `130`
interrupted. Accounts that use MD5 are skipped (the export format allows it,
but 1Password, Bitwarden and most apps refuse it): `otp-out` names them on
stderr, prints the others and exits with `3`.

## Security

What `otp-out` never does:

- It makes no network connections.
- It never writes a secret to a file, a log or a temporary file. The image is
  read in memory, and the secrets exist only in memory and in the output you
  asked for.
- Error messages never contain data from the QR code. An unexpected error
  shows only its type.
- It never passes a secret as a command-line argument to another program
  (other processes can read arguments). The clipboard tools get the text
  through their standard input. The one exception is `--op`: the 1Password CLI
  only accepts a field value as an argument (or a template file), so the URI
  is an argument of `op` for the second it runs. Messages from `op` are
  filtered before they are shown.
- It never deletes or changes your images.

What you should know:

- **The output contains the secrets.** The default output, `--secrets` and
  `--json` print them on your terminal, where they stay in the scrollback.
  Prefer `--clipboard`, or pipe the output straight to where it goes. If you
  redirect to a file, delete it after use.
- **Shell history.** A link passed as an argument (`otp-out
  'otpauth-migration://...'`) is saved in your shell history. Run `otp-out`
  without arguments and paste the link, or pipe it with `-`.
- **Clipboard history.** Clipboard managers can keep what was copied.
  `otp-out --clipboard` marks the content as sensitive where the system allows
  it without extra libraries:
  - macOS: the `org.nspasteboard.ConcealedType` and `TransientType` markers,
    which most clipboard managers respect, and "current host only", so
    Universal Clipboard does not send it to your other Apple devices.
  - Windows: the formats that ask Windows to keep it out of clipboard history
    (Win+V), cloud sync and clipboard monitors (set through PowerShell; if that
    fails, `clip.exe` is used without them).
  - Linux: no marker, because each clipboard manager has its own convention.
    Pause your clipboard manager while you copy.
  If marking fails, `otp-out` says so on screen.
- **npx and pnpm dlx** download and run the newest published version each
  time. Pin a version (`npx otp-out@0.1.0`) or install with Homebrew or winget.
- **Delete the screenshot** when you are done, on the computer and on the
  phone, including the "Recently Deleted" album and any cloud photo backup
  (iCloud Photos, Google Photos).
- After moving your accounts, consider removing them from Google
  Authenticator only after you have checked that the new app generates the
  same codes.

Found a security problem? See [SECURITY.md](SECURITY.md).

## Similar projects

| Project | What it does | Compared with otp-out |
| --- | --- | --- |
| [scito/extract_otp_secrets](https://github.com/scito/extract_otp_secrets) | Python, GPL-3. The most complete: reads images and the webcam, exports JSON, CSV, QR images and more. | More export formats and webcam support. Needs Python plus zbar or OpenCV, or a downloaded executable. No Homebrew or winget package, no clipboard mode, no 1Password. |
| [dim13/otpauth](https://github.com/dim13/otpauth) | Go, ISC. Converts the migration link into URIs, can generate QR codes and serve them locally. | Does not read images: you need another program to get the link out of the QR code first. |
| [Heimlane/ga-decoder](https://github.com/Heimlane/ga-decoder) | MIT web page. Upload or camera, one QR per account, JSON and CSV. | Browser only. otp-out has its own web page and a CLI with package managers. |

`otp-out` does not generate QR codes for each account or export CSV. If you
need those, use one of the projects above.

## Development

You need Go (the version in `go.mod`). Node and pnpm are only used for the
packaging scripts and the web page in `web/`.

```
go test ./...                              # all tests
go test -race ./...                        # with the race detector
go test -tags nodynamic,wasm2go ./...      # with the release build tags
pnpm run otp-out -- --dry-run print.png    # build and run your local copy
go build -o otp-out .                      # local binary
```

Layout:

- `main.go`: the command (kept in the repository root so `go run
  github.com/kevinkirsten/otp-out@latest` works).
- `internal/migration`: hand-written protobuf decoder for the export format,
  `otpauth://` URIs, multi-QR exports.
- `internal/qrimage`: image decoding (format from content) and QR reading with
  [gozxing](https://github.com/makiuchi-d/gozxing), with several strategies for
  small or cropped codes.
- `internal/clipboard`, `internal/terminal`, `internal/onepassword`,
  `internal/cli`.
- `testdata/vectors.json`: test cases shared with the web page. All secrets in
  it are fake.

Build tags:

- `nodynamic,wasm2go` (used by releases): HEIC is decoded by
  [gen2brain/heic](https://github.com/gen2brain/heic) transpiled to Go, with no
  attempt to load a system `libheif`. `go run ...@latest` uses the library's
  default (it may load `libheif` if installed, otherwise runs the decoder in
  WebAssembly with wazero).
- `noheic`: leaves HEIC out (about 3 MB smaller binary).

Tests use only fake secrets (`JBSWY3DPEHPK3PXP`, `GEZDGNBVGY3TQOJQ` and those in
`testdata/vectors.json`) and synthetic QR codes generated inside the tests.
They never call the real `op` or touch your clipboard (the macOS test writes to
a private, named pasteboard). Never add a real QR code or secret to this
repository. CI runs `gitleaks` with `.gitleaks.toml`.

### Releasing

Pushing a tag `v*` runs `.github/workflows/release.yml`: GoReleaser builds the
binaries and the release, then the workflow updates the Homebrew formula in
`kevinkirsten/homebrew-tap` (from `packaging/homebrew/otp-out.rb.tmpl`),
publishes the npm packages (built by `packaging/npm/build.mjs`) with npm
Trusted Publishing, and attaches the winget manifests (from
`packaging/winget/`, filled by `packaging/fill.mjs`) to the release for a
manual pull request to `microsoft/winget-pkgs`.

## License

[MIT](LICENSE), Kevin Kirsten.
