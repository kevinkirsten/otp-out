#!/usr/bin/env node
// Launcher for `npx otp-out` and `pnpm dlx otp-out`.
//
// The real program is a Go binary shipped in a platform package
// (otp-out-darwin-arm64, otp-out-win32-x64, ...) that npm installs as an
// optional dependency matching this machine's os and cpu. There is no
// install script: this file only finds that binary and runs it with the same
// arguments, standard input, output and exit code.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const platforms = {
  "darwin-arm64": "otp-out-darwin-arm64",
  "darwin-x64": "otp-out-darwin-x64",
  "linux-arm64": "otp-out-linux-arm64",
  "linux-x64": "otp-out-linux-x64",
  "win32-arm64": "otp-out-win32-arm64",
  "win32-x64": "otp-out-win32-x64",
};

function findBinary() {
  const key = `${process.platform}-${process.arch}`;
  const pkg = platforms[key];
  if (!pkg) {
    throw new Error(`no prebuilt otp-out binary for ${key}. Install it with Go: go install github.com/kevinkirsten/otp-out@latest`);
  }
  const exe = process.platform === "win32" ? "otp-out.exe" : "otp-out";
  let file;
  try {
    file = require.resolve(`${pkg}/bin/${exe}`);
  } catch {
    throw new Error(
      `the package ${pkg} is missing. It is an optional dependency: reinstall without --no-optional / --omit=optional, ` +
        "or download the binary from https://github.com/kevinkirsten/otp-out/releases",
    );
  }
  if (process.platform !== "win32") {
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(file, 0o755);
      } catch {
        // Leave it; spawn will report the problem.
      }
    }
  }
  return path.resolve(file);
}

function main() {
  let binary;
  try {
    binary = findBinary();
  } catch (error) {
    process.stderr.write(`otp-out: ${error.message}\n`);
    process.exit(1);
  }
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit", windowsHide: false });
  // Ctrl+C reaches the child directly from the terminal; the child clears
  // the clipboard and exits. Keep this process alive until then, and pass
  // on signals sent only to this process. On Windows child.kill() would
  // terminate the child without cleanup, so nothing is forwarded there.
  const forward = (signal) => {
    if (process.platform === "win32") return;
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGHUP", () => forward("SIGHUP"));
  child.on("error", (error) => {
    process.stderr.write(`otp-out: could not start the binary (${error.code || "error"})\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(signal === "SIGINT" ? 130 : 1);
    }
    process.exit(code === null ? 1 : code);
  });
}

main();
