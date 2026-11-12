#!/usr/bin/env bash
# Installs or updates System Manager from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/heisdeku/constellation/main/scripts/install.sh | bash
#
# Options:
#   --version <x.y.z>  install a specific release instead of the latest
#   --no-open          don't launch the app afterwards
#   --uninstall        remove the app
#
# Environment:
#   SYSTEM_MANAGER_DIR          install somewhere other than /Applications
#   SYSTEM_MANAGER_RELEASE_URL  download from a mirror; must hold the zip and checksums.txt
set -euo pipefail

repo="heisdeku/constellation"
app="System Manager.app"
bundle_id="dev.oluwaferanmi.port-tracker"

version=""
open_after=1
uninstall=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="${2#v}"; shift 2 ;;
    --no-open) open_after=0; shift ;;
    --uninstall) uninstall=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "error: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "System Manager only runs on macOS."

if [ -n "${SYSTEM_MANAGER_DIR:-}" ]; then
  dir="$SYSTEM_MANAGER_DIR"
elif [ -w /Applications ]; then
  dir="/Applications"
else
  dir="$HOME/Applications"
fi
target="$dir/$app"

quit_running() {
  osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do
    pgrep -f "$target/Contents/MacOS/" >/dev/null || return 0
    sleep 0.25
  done
  fail "System Manager is still running. Quit it and try again."
}

if [ "$uninstall" = 1 ]; then
  [ -d "$target" ] || fail "System Manager isn't installed in $dir."
  quit_running
  rm -rf "$target"
  echo "Removed $target. Your settings stay in ~/Library in case you reinstall."
  exit 0
fi

if [ -z "$version" ]; then
  version=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$version" ] || fail "Couldn't find the latest release of $repo."
fi

name="System-Manager-$version-macos-universal.zip"
base="${SYSTEM_MANAGER_RELEASE_URL:-https://github.com/$repo/releases/download/v$version}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading System Manager $version..."
curl -fL --progress-bar -o "$tmp/$name" "$base/$name" || fail "Download failed: $base/$name"
curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt" || fail "Couldn't download checksums.txt."

expected=$(grep " $name\$" "$tmp/checksums.txt" | cut -d' ' -f1)
actual=$(shasum -a 256 "$tmp/$name" | cut -d' ' -f1)
[ -n "$expected" ] || fail "checksums.txt has no entry for $name."
[ "$expected" = "$actual" ] || fail "Checksum mismatch for $name. Nothing was installed."

ditto -x -k "$tmp/$name" "$tmp/unpacked"
[ -d "$tmp/unpacked/$app" ] || fail "The download didn't contain $app."

mkdir -p "$dir"
[ -d "$target" ] && quit_running
rm -rf "$target"
mv "$tmp/unpacked/$app" "$target"

# The app isn't notarised. Without this, macOS refuses to open it the first time.
xattr -dr com.apple.quarantine "$target" 2>/dev/null || true

echo "Installed System Manager $version to $target"
[ "$open_after" = 1 ] && open "$target"
exit 0
