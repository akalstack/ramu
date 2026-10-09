# Generates the Ramu icon, wordmark and README lockups. Usage: python3 scripts/make-logo.py assets && pnpm icons
import math, sys
from pathlib import Path
import xml.etree.ElementTree as ET
out = sys.argv[1]
ACCENT = "#7d6cff"
BRANDING = Path(__file__).resolve().parent.parent / "assets/branding"
shared_r = ET.parse(BRANDING / "r-shape.svg").getroot()[0]
r_path = shared_r.attrib["d"]

def squircle(cx, cy, r, n=4.0, N=192):
    pts = []
    for i in range(N):
        t = 2 * math.pi * i / N
        c, s = math.cos(t), math.sin(t)
        pts.append(f"{cx + r * math.copysign(abs(c) ** (2 / n), c):.1f} {cy + r * math.copysign(abs(s) ** (2 / n), s):.1f}")
    return "M" + "L".join(pts) + "Z"

# --- Keep the approved flat app icon; startup uses its bare r + dot.
tile = squircle(512, 512, 412)
# Group is optically centred: stem + dot span ~ x 300..722, y 300..752
dx, dy = -36, -18
dot = (700 + dx, 640 + dy, 72)
icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Ramu">
<path d="{tile}" fill="#232327"/>
<path transform="translate(296 274)" d="{r_path}" fill="none" stroke="#f5f5f7" stroke-width="120" stroke-linecap="round"/>
<circle cx="{dot[0]}" cy="{dot[1]}" r="{dot[2]}" fill="{ACCENT}"/>
</svg>
'''
open(f"{out}/icon.svg", "w").write(icon)

# --- Wordmark: custom rounded r + outlined Manrope amu.
# Read the canonical outlines so regeneration needs no font tooling.
ET.register_namespace('', 'http://www.w3.org/2000/svg')
word_root = ET.parse(BRANDING / "wordmark-shapes.svg").getroot()
_, _, word_w, word_h = map(float, word_root.attrib["viewBox"].split())
word_r = next(e for e in word_root.iter() if e.attrib.get("id") == "ramu-r")
word_r.attrib.update(shared_r.attrib)
word_inner = ''.join(ET.tostring(e, encoding="unicode") for e in word_root)
def wordmark(ink, ox=0, oy=0, scale=1):
    return f'<g color="{ink}" transform="translate({ox} {oy}) scale({scale})">{word_inner}</g>'

for name, ink in (("wordmark", "#f5f5f7"), ("wordmark-light", "#1d1d1f")):
    open(f"{out}/{name}.svg", "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {word_w:.3f} {word_h:.3f}" role="img" aria-label="Ramu">{wordmark(ink)}</svg>\n')

# --- Lockup: icon + wordmark, for the README (dark and light).
icon_inner = icon.split("\n", 1)[1].rsplit("</svg>", 1)[0]
k = 136 / 824
scale = 0.92
ox, oy = 170, (136 - word_h * scale) / 2
for name, ink in (("logo", "#f5f5f7"), ("logo-light", "#1d1d1f")):
    W = ox + word_w * scale + 2
    open(f"{out}/{name}.svg", "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.3f} 136" width="{W:.0f}" height="136" role="img" aria-label="Ramu">\n'
        f'<g transform="translate({-100*k:.3f} {-100*k:.3f}) scale({k:.6f})">{icon_inner}</g>\n'
        f'{wordmark(ink, ox, oy, scale)}\n</svg>\n')
print("Generated flat icon and custom rounded wordmark", word_w)

# Startup animation: one r moves out of the icon; its dot becomes the punctuation.
stage_w = word_w + 64
tile_x = (stage_w - 136) / 2
word_x = (stage_w - word_w) / 2
start_r_x, start_r_y = tile_x + 196*k, 174*k
end_r_x, end_r_y = word_x, 28
letters = next(e for e in word_root[0] if e.attrib.get("fill") == "inherit")
punctuation = next(e for e in word_root.iter() if e.tag.endswith("circle"))
end_dot_x = word_x + float(punctuation.attrib["cx"])
start_dot_x, start_dot_y = tile_x + (dot[0]-100)*k, (dot[1]-100)*k
startup = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {stage_w:.3f} 136" aria-hidden="true">
<g class="startup-r" style="--r-start-x:{start_r_x:.3f}px;--r-start-y:{start_r_y:.3f}px;--r-start-scale:{k*6:.9f};--r-end-x:{end_r_x:.3f}px;--r-end-y:{end_r_y:.3f}px"><g transform="scale(0.166666666667)"><path d="{r_path}" fill="none" stroke="currentColor" stroke-width="120" stroke-linecap="round"/></g></g>
<g class="startup-letters" transform="translate({word_x} 28)" fill="currentColor">{ET.tostring(letters, encoding="unicode")}</g>
<circle class="startup-dot" r="10" fill="{ACCENT}" style="--dot-start-x:{start_dot_x:.3f}px;--dot-start-y:{start_dot_y:.3f}px;--dot-start-scale:{dot[2]*k/10:.9f};--dot-end-x:{end_dot_x:.3f}px;--dot-end-y:98px"/>
</svg>
'''
open(f"{out}/startup-logo.svg", "w").write(startup)
