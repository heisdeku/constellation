#!/usr/bin/env bash
# Collects a universal build into release assets: a zip of the app, the disk image,
# checksums, and the Homebrew cask filled in for this version.
#
#   scripts/package-release.sh <version> <output-dir>
set -euo pipefail

version=$1
out=$2
bundle=src-tauri/target/universal-apple-darwin/release/bundle
name="System-Manager-$version-macos-universal"

rm -rf "$out"
mkdir -p "$out"
ditto -c -k --keepParent "$bundle/macos/System Manager.app" "$out/$name.zip"
cp "$bundle"/dmg/*.dmg "$out/$name.dmg"

(cd "$out" && shasum -a 256 "$name.zip" "$name.dmg" > checksums.txt)

sha=$(shasum -a 256 "$out/$name.zip" | cut -d' ' -f1)
sed -e "s/__VERSION__/$version/" -e "s/__SHA256__/$sha/" \
  packaging/homebrew/system-manager.rb > "$out/system-manager.rb"
