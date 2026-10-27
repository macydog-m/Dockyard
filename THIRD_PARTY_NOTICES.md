# Third-party notices

Dockyard's original code is licensed under MIT; see [LICENSE](LICENSE).
Third-party code and assets retain their own licenses and copyright notices.

## Included software

The desktop build generates `THIRD_PARTY_LICENSES.txt` from the packages actually
included by esbuild and the external Koffi runtime. It contains package names,
versions, and full license/notice text. Both package formats include that file,
this document, and the project license. Electron also supplies its own license
and Chromium notices with the runtime; those files must remain in the package.
Koffi's vendored Node API license files are retained in its copied package.

Major components include Electron, React, Phosphor Icons, the MCP TypeScript SDK,
Zod, smol-toml, and Koffi. `package-lock.json` records resolved dependency versions.

## Repository resources

- System font presets refer to installed fonts by family name. Dockyard does
  not distribute those font files. A font selected by a user retains its own
  licensing requirements.
- Notebook SVG icons now come from fixed official Lucide and Phosphor commits.
  The Lucide copyright belongs to Lucide Icons and Contributors (ISC); its
  Feather-derived portions retain Cole Bemis's MIT notice. Phosphor's icons
  retain Phosphor Icons' MIT notice. Dockyard only adapts size, color and stroke
  width. Simple connection dots and the point grid are independently generated
  Dockyard UI geometry, licensed under the project MIT license.
- Per-file sources, upstream revisions, transformations and SHA-256 hashes are
  recorded in `apps/desktop/src/renderer/assets/notebook/sources.json`.
  Complete notices are in the adjacent `LICENSES/` directory. Desktop builds
  copy both the manifest and license files to `ui/assets/notebook/` in the app.
- This source baseline includes only the reviewed replacement notebook assets.
  See `docs/notebook-svg-license-audit.md` for source and license evidence.

This notice describes the current source assets. Keep the notices and manifest
together with the assets in source distributions and desktop packages.
