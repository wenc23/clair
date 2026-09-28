import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from crop_theme import create_pack, parse_crop


class CropThemeTest(unittest.TestCase):
    def test_pack_dimensions_and_original_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / "source.png"
            Image.new("RGB", (240, 150), (10, 80, 160)).save(original)
            original_bytes = original.read_bytes()
            manifest_path = create_pack("Test", [original], root / "pack", {})
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["version"], 1)
            self.assertEqual((root / "pack" / "original-0.png").read_bytes(), original_bytes)
            for slot, size in {"background": (1920, 1080), "cover": (600, 600), "sidebar": (480, 1080)}.items():
                with Image.open(root / "pack" / f"{slot}.png") as output:
                    self.assertEqual(output.size, size)
                self.assertEqual(len(manifest["slots"][slot]["crop"]), 4)

    def test_reject_existing_destination_and_invalid_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / "source.png"
            Image.new("RGB", (20, 20)).save(original)
            existing = root / "existing"
            existing.mkdir()
            with self.assertRaises(FileExistsError):
                create_pack("Test", [original], existing, {})
            with self.assertRaises(Exception):
                parse_crop("cover:0.9,0,0.2,1")


if __name__ == "__main__":
    unittest.main()
