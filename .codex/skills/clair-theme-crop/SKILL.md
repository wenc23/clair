---
name: clair-theme-crop
description: Inspect user-supplied reference images, choose subject-aware crops, and export a three-slot Clair Desktop theme pack compatible with its v1 manifest. Use for Clair theme images, not for modifying unrelated pictures.
---

# Clair image-group theme cropping

When the user supplies one to three reference images for Clair Desktop, inspect each image visually before choosing a crop. Do not upload private images or claim automated subject detection when the choice was visual judgment. Use the first image for `background` (1920×1080), second for `cover` (600×600), third for `sidebar` (480×1080); if fewer than three, reuse the last image for the remaining slots.

Choose normalized crop rectangles `[x,y,w,h]` relative to the EXIF-orientation-corrected image. Keep the subject, faces and important text away from edges; preserve useful negative space in the background slot. The rectangle may be larger than the output aspect ratio: the script will trim its center without stretching. Show the user a preview of the generated slots and revise if the composition is poor.

Run `scripts/crop_theme.py` with Python 3 and Pillow (`python -m pip install Pillow` if missing). Example:

```sh
python scripts/crop_theme.py --name "My theme" --output /absolute/new/theme-pack \
  --images /absolute/reference1.jpg /absolute/reference2.png \
  --crop background:0.05,0.08,0.90,0.80 \
  --crop cover:0.20,0.10,0.60,0.70
```

If a slot lacks a crop argument, it uses a centered aspect-fit crop. The script never alters originals and refuses an existing output directory. It writes `manifest.json`, exact-size PNG derivatives, and copied `original-*` files. Import `manifest.json` via Clair Desktop's theme editor; the app validates the manifest and regenerates outputs from the originals. Do not invent image rights or claim AI-selected crop quality without visual review.
