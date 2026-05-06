#!/usr/bin/env bash
# Install latest livetv + livetv-supervisor from GitHub Releases into ~/.local/share/livetv/bin
# and symlinks into ~/.local/bin. Requires: curl, tar, python3, shasum (macOS) or sha256sum (Linux).
set -euo pipefail

REPO="${LIVETV_INSTALL_REPO:-benedyktdryl/live-tv}"
PREFIX="${LIVETV_INSTALL_PREFIX:-$HOME/.local/share/livetv}"
RUN_AFTER=0
if [[ "${1:-}" == "--run" ]]; then
  RUN_AFTER=1
  shift
fi

OS=$(uname -s)
ARCH=$(uname -m)
TARBALL=""
case "$OS" in
Darwin)
  case "$ARCH" in
  arm64) TARBALL="livetv-darwin-arm64.tar.gz" ;;
  x86_64) TARBALL="livetv-darwin-x64.tar.gz" ;;
  *)
    echo "Unsupported Mac architecture: $ARCH (expected arm64 or x86_64)" >&2
    exit 1
    ;;
  esac
  ;;
Linux)
  case "$ARCH" in
  x86_64 | amd64) TARBALL="livetv-linux-x64.tar.gz" ;;
  *)
    echo "Unsupported Linux architecture: $ARCH (only x86_64/amd64 for now)" >&2
    exit 1
    ;;
  esac
  ;;
*)
  echo "Unsupported OS: $OS (this script supports macOS and Linux only)" >&2
  exit 1
  ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found in PATH" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to read the GitHub API (install Xcode CLI tools on Mac: xcode-select --install)" >&2
  exit 1
fi

API_URL="https://api.github.com/repos/${REPO}/releases/latest"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: livetv-install-script" \
  "$API_URL" -o "$TMP/release.json"

URLS=$(
  python3 - "$TMP/release.json" "$TARBALL" <<'PY'
import json, sys
path, want = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
assets = {a["name"]: a["browser_download_url"] for a in data.get("assets", [])}
if want not in assets:
    sys.stderr.write(f"Asset {want!r} not found in latest release. Available: {sorted(assets)}\n")
    sys.exit(1)
if "SHA256SUMS" not in assets:
    sys.stderr.write("SHA256SUMS not found in release\n")
    sys.exit(1)
print(assets[want])
print(assets["SHA256SUMS"])
PY
)
ASSET_URL=$(printf '%s\n' "$URLS" | sed -n '1p')
SUMS_URL=$(printf '%s\n' "$URLS" | sed -n '2p')

curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS"
curl -fsSL "$ASSET_URL" -o "$TMP/$TARBALL"

cd "$TMP"
EXPECT=$(awk -v f="$TARBALL" '$2 == f { print $1; exit }' SHA256SUMS)
if [[ -z "$EXPECT" ]]; then
  echo "No SHA256 line for $TARBALL in SHA256SUMS" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  awk -v f="$TARBALL" '$2 == f { print; exit }' SHA256SUMS | sha256sum -c -
else
  GOT=$(shasum -a 256 "$TARBALL" | awk '{print $1}')
  if [[ "$EXPECT" != "$GOT" ]]; then
    echo "SHA256 mismatch for $TARBALL" >&2
    exit 1
  fi
fi

mkdir -p "$TMP/extract"
tar xzf "$TARBALL" -C "$TMP/extract"

BINDIR="$PREFIX/bin"
mkdir -p "$BINDIR" "$HOME/.local/bin"

CLI=""
SUP=""
for f in "$TMP/extract"/livetv-*; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f")
  [[ "$base" == *.txt ]] && continue
  if [[ "$base" == *supervisor* ]]; then
    SUP="$f"
  else
    CLI="$f"
  fi
done

if [[ -z "$CLI" || -z "$SUP" ]]; then
  echo "Could not find livetv and livetv-supervisor inside archive" >&2
  ls -la "$TMP/extract" >&2
  exit 1
fi

CLI_NAME=$(basename "$CLI")
SUP_NAME=$(basename "$SUP")
install -m0755 "$CLI" "$BINDIR/$CLI_NAME"
install -m0755 "$SUP" "$BINDIR/$SUP_NAME"
CLI_INST="$BINDIR/$CLI_NAME"
SUP_INST="$BINDIR/$SUP_NAME"

# Plain names beside versioned binaries so Bun's resolved execPath dirname finds the CLI.
ln -sf "$CLI_INST" "$BINDIR/livetv"
ln -sf "$SUP_INST" "$BINDIR/livetv-supervisor"

ln -sf "$CLI_INST" "$HOME/.local/bin/livetv"
ln -sf "$SUP_INST" "$HOME/.local/bin/livetv-supervisor"

echo ""
echo "Installed to $BINDIR and linked:"
echo "  $HOME/.local/bin/livetv"
echo "  $HOME/.local/bin/livetv-supervisor"
echo ""
echo "You need Docker running (AceStream engine) and VLC to watch."
echo "Start the app:"
echo "  $HOME/.local/bin/livetv-supervisor"
echo ""
echo "Or add ~/.local/bin to PATH once, then: livetv-supervisor"
echo ""

if [[ "$RUN_AFTER" -eq 1 ]]; then
  exec "$HOME/.local/bin/livetv-supervisor" "$@"
fi
