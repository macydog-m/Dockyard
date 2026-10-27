# Dockyard application icon

The application uses the approved A1 “Quiet harbor” design: an ivory D and a
mint resource module on a graphite tile. The source was generated with the
built-in OpenAI image generation tool and selected for Dockyard on 2026-10-18.
The artwork is distributed with this project's MIT license.

- `icon-source.png`: unmodified 1254 × 1254 RGBA source.
- `icon.png`: 1024 × 1024 RGBA export for the toolbar and window icon.
- `icon.ico`: 32-bit PNG frames at 16, 20, 24, 32, 40, 48, 64, 128 and 256 pixels
  for Windows executables, shortcuts and installers.

Regenerate exports with PowerShell 7 on Windows without changing the selected artwork:

```powershell
pwsh -NoProfile -File scripts/export-app-icon.ps1
```

The desktop build ships only `icon.png` and `icon.ico` in `dist/assets/`.
