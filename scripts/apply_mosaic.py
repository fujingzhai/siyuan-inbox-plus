from PIL import Image
import os

img_path = "/Users/wyg/Desktop/截屏2026-06-17 17.06.51.png"
out_path = "/Users/wyg/Desktop/截屏2026-06-17 17.06.51_mosaiced.png"

img = Image.open(img_path)
pixel_size = 8

def apply_mosaic_to_rect(image, rect):
    x1, y1, x2, y2 = rect
    w = x2 - x1
    h = y2 - y1
    
    # Crop the box
    box = image.crop((x1, y1, x2, y2))
    
    # Resize down and then back up to create pixelated mosaic effect
    small = box.resize((max(1, w // pixel_size), max(1, h // pixel_size)), Image.Resampling.NEAREST)
    mosaiced = small.resize((w, h), Image.Resampling.NEAREST)
    
    # Paste back into image
    image.paste(mosaiced, (x1, y1, x2, y2))

# Bot Token box inside the input borders
apply_mosaic_to_rect(img, (925, 815, 1270, 855))

# Authorized Username box inside the input borders
apply_mosaic_to_rect(img, (925, 895, 1270, 935))

img.save(out_path)
print("Saved mosaiced image to", out_path)
