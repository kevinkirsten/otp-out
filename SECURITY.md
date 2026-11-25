# Security policy

`otp-out` handles OTP secrets, so security reports are welcome.

## Reporting a vulnerability

Please report privately through
[GitHub security advisories](https://github.com/kevinkirsten/otp-out/security/advisories/new)
instead of opening a public issue. Include the version (`otp-out --version`),
your operating system and the steps to reproduce.

**Never send a real QR code, a real `otpauth-migration://` link or a real
secret**, not even in a private report. Reproduce the problem with a fake
secret such as `JBSWY3DPEHPK3PXP`.

## Supported versions

Only the latest release gets fixes.

## Scope

In scope: anything that makes `otp-out` reveal a secret where it should not
(error messages, logs, files, process arguments, `--dry-run` or
`--clipboard` output), network access, or a crash on a crafted image or link.

Out of scope: secrets visible in the output you asked for (the default
output, `--secrets`, `--json`), and the 1Password CLI receiving the URI as an
argument in `--op` mode (documented in the README).
