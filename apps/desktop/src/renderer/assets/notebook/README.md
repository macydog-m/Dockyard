# Notebook SVG sources

The current files replace earlier design exports with traceable official icons
and independently generated UI geometry. See `sources.json` for every file's
source URL, fixed revision, upstream SHA-256, output SHA-256 and adaptations.

- **20 Lucide variants**: 14 official icon designs, ISC. Feather-derived icons
  also retain the upstream MIT notice. The full combined upstream text is
  preserved byte-for-byte in `LICENSES/lucide.txt`.
- **4 Phosphor variants**: `dots-three-bold` and regular `x`, MIT; full upstream
  notice in `LICENSES/phosphor.txt`.
- **3 local geometry files**: two connection dots and an evenly spaced point
  grid, independently constructed for Dockyard, MIT; `LICENSES/dockyard.txt`.
- The unused static curve export `canvasimg2.svg` was removed. Actual notebook
  connections are drawn from their live endpoints by the application.

Official path data is retained. Root SVG attributes adapt dimensions, color and
Lucide stroke width to the existing interface. Each official SVG includes its
source URL and a pointer to the full notices. Keep this directory's notices and
manifest together when copying or distributing these assets.

This source baseline contains only these reviewed replacement assets. Full
source and license evidence is recorded in the repository notebook SVG audit.
