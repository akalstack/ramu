# Branding assets

The wordmark uses the icon's shared `r` path and outlined Manrope Semibold letters. See the included [SIL Open Font License](Manrope-OFL.txt).

`r-shape.svg` supplies the icon and wordmark's `r`. `wordmark-shapes.svg` supplies the other letter outlines. The generated SVG, PNG, and ICNS assets are checked in; builds do not require a logo generator or installed font.

Startup animation lives in `Brand.tsx`, `main.tsx`, and `styles.css`.

macOS 26+ Liquid Glass icon: `Ramu.icon` is the Icon Composer source (flat background plus separate `r` and dot layers; the system adds the glass edge). `Assets.car` is its checked-in compile, rebuilt with `xcrun actool Ramu.icon --compile <dir> --platform macosx --minimum-deployment-target 26.0 --app-icon Ramu --output-partial-info-plist <dir>/p.plist`. `icon.icns` and `icon.png` remain the pre-26 and Linux fallback.
