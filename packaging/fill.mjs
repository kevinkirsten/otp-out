#!/usr/bin/env node
// Fills the release templates (Homebrew formula, winget manifests) with the
// version and the sha256 of each archive, read from GoReleaser's
// checksums.txt. It never touches the network.
//
// Usage:
//   node packaging/fill.mjs --version 0.1.0 --checksums dist/checksums.txt \
//     --template packaging/homebrew/otp-out.rb.tmpl --out Formula/otp-out.rb
//   node packaging/fill.mjs --version 0.1.0 --checksums dist/checksums.txt \
//     --template-dir packaging/winget --out-dir winget-out
//
// For a published release, get checksums.txt first, for example with
//   gh release download v0.1.0 --repo kevinkirsten/otp-out --pattern checksums.txt
//
// Placeholders:
//   {{VERSION}}                 0.1.0 (no "v")
//   {{RELEASE_DATE}}            --date, or today (UTC), as YYYY-MM-DD
//   {{SHA256_<OS>_<ARCH>}}      sha256 of otp-out_<version>_<os>_<arch>.<tar.gz|zip>,
//                               for example {{SHA256_DARWIN_ARM64}}
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} needs a value`);
    out[key.slice(2)] = value;
    i++;
  }
  return out;
}

export function readChecksums(text, version) {
  const sums = {};
  const pattern = new RegExp(`^otp-out_${version.replace(/[.+]/g, "\\$&")}_([a-z0-9]+)_([a-z0-9]+)\\.(tar\\.gz|zip)$`);
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (!m) continue;
    const name = m[2].trim();
    const parts = name.match(pattern);
    if (parts) sums[`SHA256_${parts[1].toUpperCase()}_${parts[2].toUpperCase()}`] = m[1];
  }
  return sums;
}

export function fill(template, values) {
  const missing = new Set();
  const result = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (all, key) => {
    if (!(key in values)) {
      missing.add(key);
      return all;
    }
    return values[key];
  });
  if (missing.size > 0) throw new Error(`no value for ${[...missing].join(", ")}`);
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = (args.version || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error("--version must look like 0.1.0");
  if (!args.checksums) throw new Error("--checksums is required");
  const date = args.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must look like 2026-01-31");
  const values = { VERSION: version, RELEASE_DATE: date, ...readChecksums(readFileSync(args.checksums, "utf8"), version) };

  if (args.template) {
    if (!args.out) throw new Error("--out is required with --template");
    writeFileSync(args.out, fill(readFileSync(args.template, "utf8"), values));
    console.error(`wrote ${args.out}`);
    return;
  }
  if (args["template-dir"]) {
    if (!args["out-dir"]) throw new Error("--out-dir is required with --template-dir");
    mkdirSync(args["out-dir"], { recursive: true });
    for (const name of readdirSync(args["template-dir"])) {
      if (!name.endsWith(".tmpl")) continue;
      const target = join(args["out-dir"], basename(name, ".tmpl"));
      writeFileSync(target, fill(readFileSync(join(args["template-dir"], name), "utf8"), values));
      console.error(`wrote ${target}`);
    }
    return;
  }
  throw new Error("pass --template or --template-dir");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`fill.mjs: ${error.message}`);
    process.exit(1);
  }
}
