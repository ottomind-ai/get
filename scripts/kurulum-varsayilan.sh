#!/usr/bin/env bash
# {{name}} {{version}} installer: https://get.ottomind.ai/{{name}}
# Downloads the package, verifies its SHA-256 and unpacks it into ./{{name}} (or $OTTO_DIR). Stops on any mismatch.
# OTTO_GET overrides the download host (mirrors, tests).
#   curl -fsSL https://get.ottomind.ai/{{name}} | bash                 latest version
#   curl -fsSL https://get.ottomind.ai/{{name}}/{{version}} | bash     this exact version
set -euo pipefail

main() {
  local name="{{name}}" version="{{version}}"
  local dest="${OTTO_DIR:-./$name}" base="${OTTO_GET:-https://get.ottomind.ai}/$name/$version"
  local sha want got
  command -v curl >/dev/null || fail "curl is required"
  if command -v sha256sum >/dev/null; then sha="sha256sum"
  elif command -v shasum >/dev/null; then sha="shasum -a 256"
  else fail "sha256sum or shasum is required to verify the download"; fi
  [ -e "$dest" ] && fail "$dest already exists; remove it or set OTTO_DIR"

  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:-}"' EXIT
  curl -fsSL "$base/$name.zip" -o "$tmp/$name.zip" || fail "download failed: $base/$name.zip"
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "download failed: $base/SHA256SUMS"
  want="$(awk -v f="$name.zip" '$2 == f { print $1 }' "$tmp/SHA256SUMS")"
  [ -n "$want" ] || fail "$name.zip is not listed in SHA256SUMS"
  got="$($sha "$tmp/$name.zip" | awk '{ print $1 }')"
  [ "$want" = "$got" ] || fail "checksum mismatch for $name.zip (expected $want, got $got)"

  if command -v unzip >/dev/null; then unzip -q "$tmp/$name.zip" -d "$tmp/x"
  elif command -v python3 >/dev/null; then python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/$name.zip" "$tmp/x"
  else fail "unzip or python3 is required"; fi
  mkdir -p "$(dirname "$dest")"
  mv "$tmp/x/$name" "$dest"
  printf '✓ %s %s → %s (sha256 %s)\n' "$name" "$version" "$dest" "$got"
}

tmp=""
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

main "$@"
