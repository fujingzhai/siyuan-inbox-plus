from PIL import Image, ImageDraw, ImageFont
import os

img_path = "/Users/wyg/Desktop/截屏2026-06-17 17.06.51.png"
out_path = "/Users/wyg/AI-Space/code/思源笔记/siyuan-inbox-plus/grid.png"

img = Image.open(img_path)
draw = ImageDraw.Draw(img)
w, h = img.size

# Draw vertical lines every 50 pixels
for x in range(0, w, 50):
    draw.line([(x, 0), (x, h)], fill="red", width=1)
    if x % 100 == 0:
        draw.text((x, 10), str(x), fill="blue")

# Draw horizontal lines every 50 pixels
for y in range(0, h, 50):
    draw.line([(0, y), (w, y)], fill="red", width=1)
    if y % 100 == 0:
        draw.text((10, y), str(y), fill="blue")

img.save(out_path)
print("Saved grid image to", out_path)
