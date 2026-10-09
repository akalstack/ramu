"""Build outlined font alternatives without replacing the active wordmark.

Requires fonttools and brotli. Run from the repository root:
  python3 scripts/preview-wordmarks.py
Font sources and their licenses live in output/branding/fonts.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

OUT = Path('output/branding')
ACCENT = '#7d6cff'
ICON = Path('assets/icon.svg').read_text().split('\n', 1)[1].rsplit('</svg>', 1)[0]
OPTIONS = [('A', 'Geist', 'Geist.woff2', 'Clean and compact'),
           ('B', 'Manrope', 'Manrope.ttf', 'Soft and rounded'),
           ('C', 'Sora', 'Sora.ttf', 'Wide and geometric')]


def outline(filename, r_scale=1.4):
    font = instantiateVariableFont(TTFont(OUT / 'fonts' / filename), {'wght': 600})
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    paths, x, bounds = [], 0, []
    for ch in 'ramu':
        # Emphasize the initial r, keeping every letter on the baseline.
        glyph_scale = r_scale if ch == 'r' else 1
        glyph = glyphs[cmap[ord(ch)]]
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        bounds_pen = BoundsPen(glyphs)
        glyph.draw(bounds_pen)
        x0, y0, x1, y1 = bounds_pen.bounds
        bounds.append((x + x0 * glyph_scale, y0 * glyph_scale,
                       x + x1 * glyph_scale, y1 * glyph_scale))
        paths.append(f'<path transform="translate({x} 0) scale({glyph_scale})" d="{pen.getCommands()}"/>')
        x += glyph.width * glyph_scale - font['head'].unitsPerEm * .025
    left, bottom = min(b[0] for b in bounds), min(b[1] for b in bounds)
    right, top = max(b[2] for b in bounds), max(b[3] for b in bounds)
    # Preserve the original size of amu; the r can extend just above the x-height.
    scale = 80 / max(b[3] - b[1] for b in bounds[1:])
    width = (right - left) * scale
    body = f'<g transform="translate({-left * scale:.4f} {top * scale:.4f}) scale({scale:.6f} {-scale:.6f})">{"".join(paths)}</g>'
    height = (top - bottom) * scale
    body += f'<circle cx="{width + 24:.3f}" cy="{height - 10:.3f}" r="10" fill="{ACCENT}"/>'
    return body, width + 36, height


def svg(width, height, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Ramu">{body}</svg>\n'


def mark(body, ink, x=0, y=0, scale=1):
    return f'<g fill="{ink}" transform="translate({x} {y}) scale({scale})">{body}</g>'


sheet = ['<rect width="1200" height="980" fill="#eeece8"/>',
         '<g font-family="Arial, sans-serif" fill="#232327"><text x="40" y="50" font-size="24" font-weight="700">ramu / a bigger r</text><text x="40" y="80" font-size="14">First r enlarged 40%. Other letters stay the same size. Preview only.</text></g>']
for i, (letter, name, filename, description) in enumerate(OPTIONS):
    body, width, height = outline(filename)
    for suffix, ink in [('', '#f5f5f7'), ('-light', '#1d1d1f')]:
        (OUT / f'{name.lower()}-wordmark{suffix}.svg').write_text(svg(round(width, 3), round(height, 3), mark(body, ink)))
        k = 136 / 824
        lockup = f'<g transform="translate({-100*k} {-100*k}) scale({k})">{ICON}</g>' + mark(body, ink, 170, 68-height/2)
        (OUT / f'{name.lower()}-logo{suffix}.svg').write_text(svg(round(170 + width, 3), 136, lockup))
    y = 115 + i * 280
    sheet.append(f'<g font-family="Arial, sans-serif" fill="#232327"><text x="40" y="{y+20}" font-size="18" font-weight="700">{letter} / {name} Semibold</text><text x="1160" y="{y+20}" text-anchor="end" font-size="14">{description}</text></g>')
    for x, background, ink in [(40, '#18181b', '#f5f5f7'), (610, '#ffffff', '#1d1d1f')]:
        sheet.append(f'<rect x="{x}" y="{y+40}" width="550" height="210" rx="12" fill="{background}"/>')
        k = 78 / 824
        sheet.append(f'<g transform="translate({x+32-100*k} {y+85-100*k}) scale({k})">{ICON}</g>')
        sheet.append(mark(body, ink, x+133, y+89-(height-80)*.88, .88))
        sheet.append(mark(body, ink, x+32, y+207-(height-80)*15/80, 15/80))
        sheet.append(mark(body, ink, x+150, y+193-(height-80)*34/80, 34/80))
        sheet.append(f'<g font-family="Arial, sans-serif" font-size="11" fill="{ink}" opacity=".6"><text x="{x+32}" y="{y+190}">SIDEBAR · 15px</text><text x="{x+150}" y="{y+180}">WELCOME · 34px</text></g>')
(OUT / 'comparison.svg').write_text(svg(1200, 980, ''.join(sheet)))
(OUT / 'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ramu wordmark alternatives</title><style>body{margin:0;background:#eeece8}img{display:block;width:100%;max-width:1200px;margin:auto}</style><img src="comparison.svg" alt="Three flat Ramu wordmarks: A Geist Semibold, B Manrope Semibold, C Sora Semibold, each shown on dark and light backgrounds at logo, sidebar and welcome sizes."></html>''')

# A direct comparison preserves the amu size and baseline in both panels.
comparison = ['<rect width="1200" height="500" fill="#eeece8"/>',
              '<g font-family="Arial, sans-serif" fill="#232327"><text x="40" y="50" font-size="24" font-weight="700">Manrope / original vs. bigger r</text><text x="40" y="80" font-size="14">Same size for amu. Same baseline. Only the first r changes. Preview only.</text></g>']
for x, r_scale, label in [(40, 1, 'Original proportions'), (610, 1.4, 'First r 40% bigger')]:
    body, width, height = outline('Manrope.ttf', r_scale)
    comparison.append(f'<rect x="{x}" y="110" width="550" height="340" rx="12" fill="#18181b"/>')
    comparison.append(f'<text x="{x+32}" y="150" font-family="Arial, sans-serif" font-size="18" fill="#f5f5f7">{label}</text>')
    comparison.append(mark(body, '#f5f5f7', x+40, 310-height, 1))
    comparison.append(mark(body, '#f5f5f7', x+40, 400-height*.425, .425))
(OUT / 'bigger-r.svg').write_text(svg(1200, 500, ''.join(comparison)))
(OUT / 'bigger-r.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>Ramu bigger r comparison</title><style>body{margin:0;background:#eeece8}img{display:block;width:1200px}</style><img src="bigger-r.svg" alt="Manrope original proportions beside a version with the initial r enlarged 40 percent."></html>')
print('Created three outlined alternatives and comparison.svg in', OUT)
