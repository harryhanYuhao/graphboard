#!/usr/bin/env bash

# set bash to return verbose errors
set -euo pipefail

# Get the script dir
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT_DIR="$REPO_ROOT/public/wasm/zxw"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack is not installed." >&2
  echo "  install with:  curl https://rustwasm.github.io/wasm-pack/installer/init.sh | sh" >&2
  exit 1
fi

echo "→ building zxw crate for web (wasm-pack)"

wasm-pack build \
  crates/zxw \
  --target web \
  --out-dir "$OUT_DIR" \
  --features wasm

echo "→ done. output: $OUT_DIR/"
