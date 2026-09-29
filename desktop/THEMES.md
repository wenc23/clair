# Desktop image themes

The native app accepts either **1–3 local images** or a prepared `manifest.json` theme pack. The AI theme button first opens a copyable prompt and explains the package structure; its dialog then offers the manifest import action. Its three fixed slots are `background` (1920×1080), `cover` (600×600), and `sidebar` (480×1080). For image-group import, selected-file order maps to these slots; a missing slot reuses the last image. The editor automatically center-crops first, then lets the user drag an aspect-locked selection and change its size. Every output is a PNG of the exact slot dimensions.

The portable Windows build accepts PNG, JPEG/JPG and BMP originals. These are input formats; cropped theme assets are saved as PNG without changing originals. WebP/HEIC are not advertised because the bundled Qt runtime does not include the required image plugins.

Original images are copied byte-for-byte into the app-data theme directory and never modified. A manual crop only regenerates its slot output. The active theme ID is stored in `themes/current.txt`; activating the empty ID restores the default appearance. Removing a theme deletes only that theme's private copy, not the user's source images.

## v1 portable pack

An AI crop skill can generate a directory containing `manifest.json` plus the referenced `original-*` images. Example:

```json
{
  "version": 1,
  "id": "00000000-0000-0000-0000-000000000001",
  "name": "My theme",
  "slots": {
    "background": {"original": "original-0.png", "output": "background.png", "crop": [0, 0, 1, 1], "width": 1920, "height": 1080},
    "cover": {"original": "original-1.png", "output": "cover.png", "crop": [0, 0, 1, 1], "width": 600, "height": 600},
    "sidebar": {"original": "original-2.png", "output": "sidebar.png", "crop": [0, 0, 1, 1], "width": 480, "height": 1080}
  }
}
```

`crop` is `[x, y, width, height]` in 0–1 coordinates of the orientation-corrected original. The app assigns a **new UUID** on import, validates slot dimensions and safe basename-only original paths, copies the originals, and regenerates the output PNGs itself; supplied output images are not trusted. An incorrectly shaped crop is center-trimmed to the slot ratio rather than distorted. The importer accepts image files up to 100 MiB and 50 megapixels each; the manifest limit is 1 MiB.

The asset directory is normally `QStandardPaths::AppDataLocation/themes/<UUID>`; when that location cannot create a new theme, the native app tries `QStandardPaths::AppLocalDataLocation/themes/<UUID>` and keeps using an active theme there after restart. Each theme contains `manifest.json`, `original-*` files, and the three output PNGs. Current code supports manifest version 1 only; a newer incompatible manifest will be rejected rather than silently interpreted.

## Integration

Create a `ThemeManager` in `main.cpp`, expose it as the `themeManager` QML context property, instantiate `ThemeEditor` in `Main.qml`, and open it from the main toolbar. Bind `themeManager.backgroundUrl`, `coverUrl`, and `sidebarUrl` to the intended native QML layers. Use `Image.cache: false` for generated output files because re-cropping rewrites the same path. The app remains usable with no active theme (all URLs empty).
