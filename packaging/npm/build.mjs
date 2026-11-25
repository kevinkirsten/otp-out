#!/usr/bin/env node
// Builds the npm packages from GoReleaser's dist/ folder.
//
//   node packaging/npm/build.mjs [--dist dist] [--out npm-dist] [--version 0.1.0]
//
// Output, one folder per package, ready for `npm publish`:
//   npm-dist/otp-out-darwin-arm64/  package.json (os/cpu), bin/otp-out, LICENSE, README.md
//   ...                             (darwin x64, linux arm64/x64, win32 arm64/x64)
//   npm-dist/otp-out/               the launcher (bin/otp-out.js) with the six
//                                   platform packages as optionalDependencies
//
// No package has an install script. Publish the platform packages first,
// then otp-out (see .github/workflows/release.yml).
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

// Go GOOS/GOARCH to npm os/cpu.
const targets = [
  { goos: "darwin", goarch: "arm64", os: "darwin", cpu: "arm64" },
  { goos: "darwin", goarch: "amd64", os: "darwin", cpu: "x64" },
  { goos: "linux", goarch: "arm64", os: "linux", cpu: "arm64" },
  { goos: "linux", goarch: "amd64", os: "linux", cpu: "x64" },
  { goos: "windows", goarch: "arm64", os: "win32", cpu: "arm64" },
  { goos: "windows", goarch: "amd64", os: "win32", cpu: "x64" },
];

function parseArgs(argv) {
  const out = { dist: "dist", out: "npm-dist" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`bad arguments near ${key}`);
    out[key.slice(2)] = value;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = resolve(args.dist);
  const outDir = resolve(args.out);
  const metadata = JSON.parse(readFileSync(join(dist, "metadata.json"), "utf8"));
  const version = (args.version || metadata.version || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`invalid version "${version}"`);
  const artifacts = JSON.parse(readFileSync(join(dist, "artifacts.json"), "utf8"));

  const base = JSON.parse(readFileSync(join(here, "otp-out", "package.json"), "utf8"));
  const shared = {
    version,
    license: base.license,
    author: base.author,
    homepage: base.homepage,
    bugs: base.bugs,
    repository: base.repository,
  };

  rmSync(outDir, { recursive: true, force: true });
  const optionalDependencies = {};
  for (const t of targets) {
    const artifact = artifacts.find((a) => a.type === "Binary" && a.goos === t.goos && a.goarch === t.goarch);
    if (!artifact) throw new Error(`no binary for ${t.goos}/${t.goarch} in ${dist}/artifacts.json`);
    const name = `otp-out-${t.os}-${t.cpu}`;
    const exe = t.os === "win32" ? "otp-out.exe" : "otp-out";
    const pkgDir = join(outDir, name);
    mkdirSync(join(pkgDir, "bin"), { recursive: true });
    const source = resolve(dirname(dist), artifact.path);
    copyFileSync(source, join(pkgDir, "bin", exe));
    if (t.os !== "win32") chmodSync(join(pkgDir, "bin", exe), 0o755);
    copyFileSync(join(root, "LICENSE"), join(pkgDir, "LICENSE"));
    writeFileSync(
      join(pkgDir, "README.md"),
      `# ${name}\n\nThe ${t.os} ${t.cpu} binary of [otp-out](https://github.com/kevinkirsten/otp-out).\n` +
        "Do not install this package directly: run `npx otp-out` or `pnpm dlx otp-out`.\n",
    );
    const pkg = {
      name,
      ...shared,
      description: `The ${t.os} ${t.cpu} binary for otp-out.`,
      os: [t.os],
      cpu: [t.cpu],
      files: [`bin/${exe}`, "LICENSE", "README.md"],
      preferUnplugged: true,
    };
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    optionalDependencies[name] = version;
    console.error(`built ${name}@${version}`);
  }

  const mainDir = join(outDir, "otp-out");
  mkdirSync(join(mainDir, "bin"), { recursive: true });
  copyFileSync(join(here, "otp-out", "bin", "otp-out.js"), join(mainDir, "bin", "otp-out.js"));
  chmodSync(join(mainDir, "bin", "otp-out.js"), 0o755);
  copyFileSync(join(root, "LICENSE"), join(mainDir, "LICENSE"));
  copyFileSync(join(root, "README.md"), join(mainDir, "README.md"));
  const mainPkg = { ...base, version, optionalDependencies };
  delete mainPkg.scripts;
  writeFileSync(join(mainDir, "package.json"), JSON.stringify(mainPkg, null, 2) + "\n");
  console.error(`built otp-out@${version}`);
}

try {
  main();
} catch (error) {
  console.error(`build.mjs: ${error.message}`);
  process.exit(1);
}
