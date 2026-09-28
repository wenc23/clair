"""Create a Clair Desktop v1 theme pack from one to three reference images."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import uuid
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError as exc:
    raise SystemExit("Pillow is required: python -m pip install Pillow") from exc


SLOTS = (("background", 1920, 1080), ("cover", 600, 600), ("sidebar", 480, 1080))
Image.MAX_IMAGE_PIXELS = 50_000_000


def parse_crop(value: str) -> tuple[str, tuple[float, float, float, float]]:
    try:
        slot, numbers = value.split(":", 1)
        rect = tuple(float(n) for n in numbers.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("crop must be SLOT:x,y,w,h") from exc
    if slot not in {item[0] for item in SLOTS} or len(rect) != 4:
        raise argparse.ArgumentTypeError("unknown slot or crop must contain four numbers")
    x, y, w, h = rect
    if not all(math.isfinite(n) for n in rect) or x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1 or y + h > 1:
        raise argparse.ArgumentTypeError("crop must fit within normalized image bounds")
    return slot, rect  # type: ignore[return-value]


def center_crop(width: int, height: int, target_aspect: float) -> tuple[float, float, float, float]:
    source_aspect = width / height
    w = min(1.0, target_aspect / source_aspect)
    h = min(1.0, source_aspect / target_aspect)
    return ((1 - w) / 2, (1 - h) / 2, w, h)


def render(image: Image.Image, rect: tuple[float, float, float, float], width: int, height: int) -> Image.Image:
    source_width, source_height = image.size
    x, y, w, h = rect
    left = round(x * source_width)
    top = round(y * source_height)
    right = min(source_width, left + round(w * source_width))
    bottom = min(source_height, top + round(h * source_height))
    area_width, area_height = right - left, bottom - top
    if area_width < 2 or area_height < 2:
        raise ValueError("crop is too small")
    desired = width / height
    if area_width / area_height > desired:
        trimmed_width = max(2, round(area_height * desired))
        left += (area_width - trimmed_width) // 2
        right = left + trimmed_width
    else:
        trimmed_height = max(2, round(area_width / desired))
        top += (area_height - trimmed_height) // 2
        bottom = top + trimmed_height
    return image.crop((left, top, right, bottom)).convert("RGBA").resize((width, height), Image.Resampling.LANCZOS)


def create_pack(name: str, images: list[Path], output: Path,
                crops: dict[str, tuple[float, float, float, float]]) -> Path:
    if not images or len(images) > 3:
        raise ValueError("provide one to three reference images")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    for path in images:
        if not path.is_file() or path.stat().st_size > 100 * 1024 * 1024:
            raise ValueError(f"image missing or larger than 100 MiB: {path}")
    output.mkdir(parents=True)
    try:
        originals: list[str] = []
        for index, path in enumerate(images):
            suffix = path.suffix.lower()
            if suffix not in {".jpg", ".jpeg", ".png", ".bmp"}:
                raise ValueError(f"unsupported image extension: {path}")
            stored = f"original-{index}{suffix}"
            shutil.copy2(path, output / stored)
            originals.append(stored)
        entries = {}
        for index, (slot, width, height) in enumerate(SLOTS):
            original = originals[min(index, len(originals) - 1)]
            with Image.open(output / original) as source:
                image = ImageOps.exif_transpose(source)
                if image.width * image.height > 50_000_000:
                    raise ValueError(f"image exceeds 50 million pixels: {original}")
                rect = crops.get(slot, center_crop(image.width, image.height, width / height))
                derivative = render(image, rect, width, height)
                derivative.save(output / f"{slot}.png", format="PNG", optimize=True)
            entries[slot] = {"original": original, "output": f"{slot}.png",
                             "crop": list(rect), "width": width, "height": height}
        manifest = {"version": 1, "id": str(uuid.uuid4()), "name": name.strip()[:80] or "Clair theme", "slots": entries}
        (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return output / "manifest.json"
    except BaseException:
        shutil.rmtree(output)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--images", required=True, nargs="+", type=Path)
    parser.add_argument("--crop", action="append", type=parse_crop, default=[])
    args = parser.parse_args(argv)
    crops = dict(args.crop)
    if len(crops) != len(args.crop):
        parser.error("provide at most one crop per slot")
    try:
        print(create_pack(args.name, args.images, args.output, crops))
        return 0
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
