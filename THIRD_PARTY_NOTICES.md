# Third-party notices

## H3 starter workflow and schema metadata

`public/examples/h3-starter.api.json` adapts the maintained **T2V Normal - MiniMax H3.json** graph from:

- Project: [ComfyUI MiniMax H3 Context Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop)
- Revision inspected: `0d58a64445a81605f9243f9522809ca1ca6b68e8`
- License: GPL-3.0; upstream attribution and origins are documented in its [third-party notices](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/main/THIRD_PARTY_NOTICES.md).
- Changes: converted to API format, resolved reroutes, excluded disabled branches and notes, filled installed-schema defaults, used original SceneWeaver scene directions, and changed project name and dimensions. No model weights or reference media are included.

`public/examples/h3-schemas.json` contains the relevant ComfyUI/H3 node schema metadata, with machine-specific model choices reduced to the starter's selections. Connected operation always uses the live server's schemas. The offline snapshot was inspected against ComfyUI 0.34.0 on 2026-09-05.

Runtime and development dependencies retain their individual package licenses; the exact dependency versions are recorded in `package-lock.json`. The UI uses Lucide icons (ISC). DM Sans and IBM Plex Mono are optional Google Fonts requested by the stylesheet, with local system-font fallbacks; no font files are redistributed.
