"""Preview custom wider r shapes; requires fonttools and brotli.

Run from the repo root: python3 scripts/preview-custom-r.py
Only writes review artifacts to output/branding.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
import xml.etree.ElementTree as ET

OUT = Path('output/branding')
FONT = instantiateVariableFont(TTFont(OUT / 'fonts/Manrope.ttf'), {'wght': 600})
GLYPHS, CMAP = FONT.getGlyphSet(), FONT.getBestCmap()
ACCENT = '#7d6cff'


def run(text):
    paths, bounds, x = [], [], 0
    for ch in text:
        glyph = GLYPHS[CMAP[ord(ch)]]
        pen = SVGPathPen(GLYPHS)
        glyph.draw(pen)
        bp = BoundsPen(GLYPHS)
        glyph.draw(bp)
        x0, y0, x1, y1 = bp.bounds
        bounds.append((x+x0, y0, x+x1, y1))
        paths.append(f'<path transform="translate({x} 0)" d="{pen.getCommands()}"/>')
        x += glyph.width - FONT['head'].unitsPerEm * .025
    left, right = min(b[0] for b in bounds), max(b[2] for b in bounds)
    bottom, top = min(b[1] for b in bounds), max(b[3] for b in bounds)
    scale = 80 / (top-bottom)
    body = f'<g transform="translate({-left*scale:.4f} {top*scale:.4f}) scale({scale:.6f} {-scale:.6f})">{"".join(paths)}</g>'
    return body, (right-left)*scale


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="Ramu">{body}</svg>\n'


def place(body, x, y, scale=1, ink='#f5f5f7'):
    return f'<g fill="{ink}" transform="translate({x} {y}) scale({scale})">{body}</g>'


amu, amu_width = run('amu')
original, original_width = run('ramu')
# Custom outlines: retain a normal stem weight, extend the shoulder, keep x-height 80.
wide = '<path d="M0 80V1H13V18C22 5 37 0 57 0H68V13H57C29 13 13 27 13 51V80Z"/>'
# Copy the icon's actual path and scale uniformly from its 480-unit ink height.
icon_r = ET.parse('assets/branding/r-shape.svg').getroot()[0]
round_r = f'<g transform="scale(0.166666666667)"><path id="ramu-r" d="{icon_r.attrib["d"]}" fill="none" stroke="currentColor" stroke-width="120" stroke-linecap="round"/></g>'
variants = [('original', 'Original / Manrope', 'Standard narrow shoulder', original, original_width),
            ('wide', 'A / Extended shoulder', 'Custom r · same stem weight', wide + place(amu, 80, 0, ink='inherit'), 80+amu_width),
            ('rounded', 'B / Logo r', 'Exact icon shape · uniformly scaled', round_r + place(amu, 64, 0, ink='inherit'), 64+amu_width)]

sheet = ['<rect width="1200" height="580" fill="#eeece8"/>',
         '<g font-family="Arial, sans-serif" fill="#232327"><text x="40" y="50" font-size="24" font-weight="700">ramu / wider, not taller</text><text x="40" y="80" font-size="14">Custom r shapes. Same 80-unit height, same amu, same baseline. Preview only.</text></g>']
icon = Path('assets/icon.svg').read_text().split('\n', 1)[1].rsplit('</svg>', 1)[0]
for i, (name, label, description, body, width) in enumerate(variants):
    body += f'<circle cx="{width+24:.3f}" cy="70" r="10" fill="{ACCENT}"/>'
    width += 36
    for suffix, ink in [('', '#f5f5f7'), ('-light', '#1d1d1f')]:
        colored = f'<g fill="{ink}" color="{ink}">{body}</g>'
        (OUT / f'custom-r-{name}-wordmark{suffix}.svg').write_text(svg(round(width, 3), 80, colored))
        k = 136/824
        lockup = f'<g transform="translate({-100*k} {-100*k}) scale({k})">{icon}</g><g transform="translate(170 28)">{colored}</g>'
        (OUT / f'custom-r-{name}-logo{suffix}.svg').write_text(svg(round(170+width, 3), 136, lockup))
    x = 40+i*380
    sheet.append(f'<g font-family="Arial, sans-serif" fill="#232327"><text x="{x}" y="125" font-size="18" font-weight="700">{label}</text><text x="{x}" y="150" font-size="13">{description}</text></g>')
    sheet.append(f'<rect x="{x}" y="170" width="360" height="360" rx="12" fill="#18181b"/>')
    sheet.append(f'<g color="#f5f5f7">{place(body, x+24, 230, .86)}{place(body, x+24, 380, .425)}{place(body, x+24, 480, .1875)}</g>')
    sheet.append(f'<g font-family="Arial, sans-serif" font-size="11" fill="#f5f5f7" opacity=".6"><text x="{x+24}" y="362">WELCOME · 34px</text><text x="{x+24}" y="462">SIDEBAR · 15px</text></g>')
(OUT / 'custom-r.svg').write_text(svg(1200, 580, ''.join(sheet)))
(OUT / 'custom-r.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>Custom wider Ramu r</title><style>body{margin:0;background:#eeece8}img{display:block;width:100%;max-width:1200px;margin:auto}</style><img src="custom-r.svg" alt="Original Manrope wordmark beside two custom r shapes with wider shoulders at the same height."></html>')
print('Created custom r alternatives in', OUT)
