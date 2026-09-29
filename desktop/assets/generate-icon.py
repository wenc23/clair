"""Regenerate Clair's original disc icon with Pillow (no external artwork)."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


SIZE = 1024
HERE = Path(__file__).resolve().parent
image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
pixels = image.load()
for y in range(SIZE):
    for x in range(SIZE):
        dx = (x - SIZE / 2) / (SIZE / 2)
        dy = (y - SIZE / 2) / (SIZE / 2)
        distance = (dx * dx + dy * dy) ** 0.5
        if distance < 0.96:
            t = min(1, max(0, (dx + dy + 1.8) / 3.6))
            pixels[x, y] = (int(240 - 90 * t), int(166 - 53 * t), int(189 + 22 * t), 255)

draw = ImageDraw.Draw(image, "RGBA")
draw.ellipse((65, 65, 959, 959), outline=(255, 223, 235, 190), width=13)
draw.ellipse((177, 177, 847, 847), fill=(29, 18, 38, 255))
for radius in range(208, 329, 15):
    draw.ellipse((512 - radius, 512 - radius, 512 + radius, 512 + radius),
                 outline=(189, 132, 163, 95), width=3)
draw.ellipse((359, 359, 665, 665), fill=(102, 62, 91, 255),
             outline=(255, 210, 226, 205), width=8)
font_path = Path(r"C:\Windows\Fonts\georgia.ttf")
font = ImageFont.truetype(str(font_path), 235) if font_path.exists() else ImageFont.load_default(235)
box = draw.textbbox((0, 0), "C", font=font)
draw.text(((SIZE - (box[2] - box[0])) / 2 - box[0],
           (SIZE - (box[3] - box[1])) / 2 - box[1] - 13),
          "C", font=font, fill=(255, 231, 241, 255))
draw.ellipse((501, 501, 523, 523), fill=(32, 19, 38, 255))

image.save(HERE / "clair-icon.png")
image.save(HERE / "clair-icon.ico", sizes=[(16, 16), (24, 24), (32, 32),
                                           (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(HERE / "clair-icon.icns")
