#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: package-linux.sh BUILD_DIR OUTPUT.tar.gz" >&2
  exit 2
fi
build_dir=$(realpath "$1")
output=$(realpath -m "$2")
if [[ -e "$output" || -e "${output}.sha256" ]]; then
  echo "Refusing to overwrite existing package: $output" >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
name=Clair-Desktop-Linux-x64-Preview-0.3.2
stage=$(mktemp -d "${TMPDIR:-/tmp}/clair-linux-package.XXXXXX")
cleanup() {
  if [[ "$stage" == "${TMPDIR:-/tmp}/clair-linux-package."* ]]; then
    rm -rf -- "$stage"
  fi
}
trap cleanup EXIT

cmake --install "$build_dir" --prefix "$stage/$name"
root="$stage/$name"
cp -- "$script_dir/PREVIEW_README_LINUX.md" "$root/README-试用.md"
cp -- "$script_dir/THEMES.md" "$script_dir/TRANSCRIPTION.md" "$script_dir/THIRD_PARTY_NOTICES.md" "$root/"
cp -- "$script_dir/../LICENSE" "$root/LICENSE-Clair-MIT.txt"
mkdir -p -- "$root/licenses" "$root/theme-skill/scripts"
cp -- "$script_dir"/licenses/*.txt "$root/licenses/"
cp -- "$script_dir/../.codex/skills/clair-theme-crop/SKILL.md" "$root/theme-skill/"
cp -- "$script_dir/../.codex/skills/clair-theme-crop/scripts/crop_theme.py" "$root/theme-skill/scripts/"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$stage" -czf "$output" "$name"
(cd -- "$(dirname -- "$output")" && sha256sum -- "$(basename -- "$output")") > "${output}.sha256"
echo "Package: $output"
cat -- "${output}.sha256"
