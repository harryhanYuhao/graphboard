#!/usr/bin/env bash
# scripts/build-wasm.sh
#
# Build the `zxw` Rust crate for the browser via wasm-pack. Output
# lands in `public/wasm/zxw/`
# Next.js dev server serves it as a static asset; the frontend
# `src/lib/compute/index.ts` lazy-imports it.
#
# Re-run this whenever Rust source changes. The Next.js dev server
# itself doesn't watch the wasm — restart it (or hard-refresh) after a
# rebuild.

set -euo pipefail

# Always resolve script-relative paths from the repo root, so the
# script is composable with `pnpm build:wasm` (no matter where the
# caller `cd`'d from).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$REPO_ROOT/public/wasm/zxw"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack is not installed." >&2
  echo "  install with:  curl https://rustwasm.github.io/wasm-pack/installer/init.sh | sh" >&2
  exit 1
fi

echo "→ building zxw crate for web (wasm-pack)"
# Two wasm-pack 0.15.0 CLI quirks this command works around:
#
# 1. clap's BuildOptions uses `allow_hyphen_values = true,
#    trailing_var_arg = true`. The first hyphen-prefixed token clap
#    sees gets eaten as the optional `path` positional, and EVERY
#    subsequent arg goes to `extra_options` (forwarded verbatim to
#    `cargo build`). The path positional must therefore come FIRST
#    in the arg list — otherwise unknown flags like `--features` get
#    mis-parsed, and known flags like `--out-dir` get forwarded to
#    cargo, which (since cargo 1.79) rejects `--out-dir` ("renamed
#    to `--artifact-dir`", and `--artifact-dir` is nightly-only on
#    stable).
#
# 2. The workspace root (`/Users/virus/dev/graph-board/Cargo.toml`)
#    declares a dummy `[package]` (`publish = false`) plus a stub
#    `src/lib.rs`, because wasm-pack walks up to the workspace root
#    and rejects a workspace-only root manifest ("missing field
#    `package`"). The `default-members = ["crates/zxw"]` line makes
#    cargo's "build the workspace" default point at the real crate
#    rather than the dummy root.
wasm-pack build \
  crates/zxw \
  --target web \
  --out-dir "$OUT_DIR" \
  --features wasm

echo "→ done. output: $OUT_DIR/"

