#!/usr/bin/env bash
# Installs the built .deb the way a person would, then runs the desktop startup smoke against the installed app
# under a virtual display. Run after `pnpm make` on Linux.
set -euo pipefail
deb=$(ls dist/make/deb/*/*.deb | head -n 1)
sudo apt-get install -y xvfb "./$deb"
executable=$(dpkg -L "$(dpkg-deb -f "$deb" Package)" | grep -E '/Ramu$' | head -n 1)
test -x "$executable"
RAMU_PACKAGED_EXECUTABLE="$executable" xvfb-run -a pnpm test:desktop-smoke
