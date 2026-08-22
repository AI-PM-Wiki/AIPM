#!/usr/bin/env python3
"""Generate favicon bitmap assets from the brand SVG icon.

Usage:
    uv run --with resvg-py --with pillow python3 scripts/gen-favicon.py

Input:
    docs/favicon.svg  -- 64x64 brand SVG icon (favicon + header logo)

Outputs (written to docs/):
    favicon_512x512.png  -- 512x512 RGBA render
    favicon_192x192.png  -- 192x192 RGBA render
    favicon.ico          -- multi-resolution ICO (16, 32, 48, 64, 128, 256)

Re-run this script after editing the SVG to refresh all bitmap assets.
Dependencies are provided on the fly via `uv run --with`, so neither
pyproject.toml nor the project .venv is touched.

Renderer note: resvg-py is used instead of cairosvg because cairosvg
requires the native cairo library, which is not installed on this
machine; resvg-py ships a bundled, spec-compliant SVG renderer.
"""

import io

import resvg_py
from PIL import Image

SVG_PATH = "docs/favicon.svg"
OUT_512 = "docs/favicon_512x512.png"
OUT_192 = "docs/favicon_192x192.png"
OUT_ICO = "docs/favicon.ico"
ICO_SIZES = (16, 32, 48, 64, 128, 256)


def render_svg(width: int, height: int) -> Image.Image:
    """Render the SVG to a PIL image at the given size (RGBA)."""
    png = resvg_py.svg_to_bytes(svg_path=SVG_PATH, width=width, height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main() -> None:
    img_512 = render_svg(512, 512)
    img_512.save(OUT_512)
    print(f"wrote {OUT_512}")

    img_192 = render_svg(192, 192)
    img_192.save(OUT_192)
    print(f"wrote {OUT_192}")

    # Render once at the largest ICO size and let Pillow downscale the rest.
    base = render_svg(256, 256)
    base.save(OUT_ICO, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote {OUT_ICO}")


if __name__ == "__main__":
    main()
