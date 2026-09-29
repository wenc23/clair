#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: package-linux.sh BUILD_DIR OUTPUT.tar.gz [TRANSCRIPTION_ASSETS_DIR]" >&2
  exit 2
fi
build_dir=$(realpath "$1")
output=$(realpath -m "$2")
assets_dir=$(realpath "${3:-$build_dir/transcription}")
for name in whisper-cli ggml-tiny-q5_1.bin; do
  [[ -f "$assets_dir/$name" ]] || { echo "Missing bundled transcription asset: $assets_dir/$name" >&2; exit 2; }
done
printf '%s  %s\n' '818710568DA3CA15689E31A743197B520007872FF9576237BDA97BD1B469C3D7' "$assets_dir/ggml-tiny-q5_1.bin" | sha256sum --check --status
if [[ -e "$output" || -e "${output}.sha256" ]]; then
  echo "Refusing to overwrite existing package: $output" >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
name=Clair-Desktop-Linux-x64-Preview-0.3.3
stage=$(mktemp -d "${TMPDIR:-/tmp}/clair-linux-package.XXXXXX")
cleanup() {
  if [[ "$stage" == "${TMPDIR:-/tmp}/clair-linux-package."* ]]; then
    rm -rf -- "$stage"
  fi
}
trap cleanup EXIT

cmake --install "$build_dir" --prefix "$stage/$name"
root="$stage/$name"
mkdir -p -- "$root/bin/transcription"
cp -- "$assets_dir/whisper-cli" "$assets_dir/ggml-tiny-q5_1.bin" "$root/bin/transcription/"
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
