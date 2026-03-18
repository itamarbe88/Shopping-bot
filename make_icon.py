"""
Generates android-icon-foreground.png (1024x1024, transparent background)
from the SVG using cairosvg.
Run: pip install cairosvg && python make_icon.py
"""
import cairosvg, pathlib, sys

src = pathlib.Path(__file__).parent / "mobile/assets/adaptive_icon.svg"
dst = pathlib.Path(__file__).parent / "mobile/assets/android-icon-foreground.png"

cairosvg.svg2png(url=str(src), write_to=str(dst), output_width=1024, output_height=1024)
print(f"Saved {dst}")
