# SceneWeaver

A companion workspace for [MiniMax H3 Context Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop), inspired by DaVinci Resolve. Version **0.2.2** focuses on assisting the workflow open in ComfyUI: sequence inspection, prompt drafts, native execution, project assets, takes, and exports.

This repository contains the web app, local proxy, and live workflow bridge. The installable ComfyUI launch button lives in [ComfyUI-SceneWeaver-Companion](https://github.com/ethanfel/ComfyUI-SceneWeaver-Companion).

ComfyUI remains the source of truth for the live workflow. H3 owns generation, continuity, project ownership, checkpoints, and assembly. Standalone editing is a later milestone.

## Run

Requires Node.js **24+**, a current browser, and ComfyUI with H3 Context Loop.

```bash
git clone https://github.com/ethanfel/SceneWeaver.git
cd SceneWeaver
npm install
cp .env.example .env
# Set COMFYUI_URL to the local or remote ComfyUI address.
npm run build
npm start
```

Open **http://127.0.0.1:4310**. The connection dialog can change the remote address until restart. `.env.local` can hold machine-specific settings and is ignored by Git.

For development, use `npm run dev` and **http://127.0.0.1:5173**. The Vite proxy expects the Node backend on port 4310.

## Attach the actual open workflow

1. Start SceneWeaver and connect it to the same ComfyUI address used in your browser.
2. Click **Attach live workflow**. Drag **Open SceneWeaver companion** to your bookmarks bar.
3. Open the intended workflow tab in ComfyUI and click that bookmark. SceneWeaver opens in a paired window and reads the live graph, including unsaved widget changes.
4. Keep that ComfyUI browser tab open. Check the green **Attached to live workflow** bar and workflow name before editing.

This launcher needs no ComfyUI restart. The attachment dialog also provides a console launcher. Your browser may require popup or local-network permission. A browser or reverse proxy that blocks cross-origin scripts or removes window opener relationships can prevent attachment; the UI then remains disconnected.

For a persistent button, install [ComfyUI-SceneWeaver-Companion](https://github.com/ethanfel/ComfyUI-SceneWeaver-Companion) into ComfyUI's `custom_nodes` directory and restart ComfyUI:

```bash
cd /path/to/ComfyUI/custom_nodes
git clone https://github.com/ethanfel/ComfyUI-SceneWeaver-Companion.git
```

Its **Open SceneWeaver** button uses `http://127.0.0.1:4310` by default; change **SceneWeaver companion URL** in ComfyUI settings if needed. The extension has no Python package dependencies. SceneWeaver's attachment dialog links to its repository and installation instructions.

### Docker and remote ComfyUI

SceneWeaver runs on the computer where you use the browser. The Node bridge connects to the Docker host's published ComfyUI port, for example `http://YOUR_SERVER:8188`. Existing Docker port publishing and `--listen 0.0.0.0` are sufficient when that address is already reachable. GPU processing and project files stay on the ComfyUI server; shared filesystem mounts are unnecessary for browser previews, uploads, and downloads.

The optional extension goes into the custom-node directory visible **inside the ComfyUI container**, preferably through its existing persistent volume. `127.0.0.1:4310` in the browser launcher refers to your browser's computer, not the Docker container.

The Node service listens on loopback. It proxies HTTP, WebSocket events, uploads, and media Range requests. ComfyUI does not need a permissive CORS flag: native writes happen in its own browser tab, while reads use the local proxy. Only the public launcher modules have CORS enabled for the configured ComfyUI origin.

## Use the companion

| Task | How it works |
| --- | --- |
| See the sequence | Select scenes in the bin or timeline. Saved H3 trims, placements, gaps, and chosen alternate pictures are reflected. Unfinished scenes use labeled raw estimates. |
| Play the whole cut | **Sequence** is the default: Play or Space advances through saved clips and timeline gaps. Scrub the full cut or jump between scenes. Unrendered scenes show a timed placeholder; playback stops at the sequence end. |
| Hear audio and see captions | The viewer pairs raw/alternate pictures with generated WAV sidecars, synchronizes the saved Plan Studio soundtrack, and overlays its selected SRT/LRC lyrics. Use the generated-audio/source-soundtrack switches, volume, and CC controls. |
| Compare scene takes | The **Scene take** selector previews the final cut, its generated base, or compatible picture alternates. **All takes** opens the revision list for that scene. **Clip** mode stops at the selected scene’s end; selecting a base or alternate take enters this mode. Return to **Sequence** to watch the saved final-cut choices. These preview choices do not activate a different H3 checkpoint. |
| Edit prompts | Change the scene direction, shared direction, seeds, frame counts, or scalar node settings. **Apply to ComfyUI** writes the draft into the attached graph through native widget callbacks. |
| Handle simultaneous edits | Disjoint widget edits merge. Changes to the same widget raise a conflict and preserve the local draft. Export the draft before **Reload from ComfyUI** to keep both versions. A plan JSON widget is one conflict unit. |
| Run the workflow | **Queue in ComfyUI** uses the original frontend queue path, retaining custom serialization, subgraphs, ownership proofs, and queue hooks. Apply the draft first. |
| Follow a running project | Existing queued/running jobs with the selected H3 run name are discovered. The parent tab forwards execution events, and the companion reconciles queue, review, and checkpoint state through HTTP. |
| Review generations | Approve, retry, reroll, approve-and-stop, or select saved candidate takes at H3's review boundary. Native H3 review behavior remains authoritative. |
| Manage assets | **Assets** previews the project catalog, uploads one file at a time, imports relative ComfyUI input paths, and edits tags, roles, and enabled state. Writes use the carousel's native ownership helper and update its catalog. Apply prompt drafts before asset writes. |
| Inspect checkpoints | **Takes** lists revisions, active status, delivered duration, seed, prompt, and dependencies. Preview/download footage or export checkpoint metadata. **Manage branches in ComfyUI** focuses the native checkpoint manager. |
| Export | **Export workflow** downloads the native canvas document. **Export draft** downloads unapplied widget edits. Download media in Assets, Takes, or Renders. Final assembly follows the workflow's H3 assembly nodes. |

Changing the active ComfyUI workflow pauses writes. Return to the attached tab or explicitly choose **Attach current tab**. Attachment never takes ownership away from another workflow. The native H3 ownership error is shown if the current workflow cannot write the project.

Applied changes live in the ComfyUI graph; save that workflow through ComfyUI as usual. Unapplied companion drafts stay in memory and trigger a browser leave warning. Export important drafts before closing or reloading. Credentials and ownership widgets are excluded from live inspection, and live graphs are not copied into localStorage. A native workflow export has the same contents as ComfyUI's own serialization, so review it before sharing.

## Current boundaries

- The timeline edits the generation sequence. Trimming rendered media, transitions, audio mixing, arbitrary track placement, and independent movie export are future work. Sequence timing applies saved H3 trims and placements, combines delivered clips with raw estimates, and does not resolve every H3 continuity policy for unfinished scenes in advance. Sequence playback preserves gaps and unfinished scenes. It ends at the last planned scene, even if the source soundtrack is longer. Remote clip loading can briefly buffer at cuts; this is a browser preview, not a frame-exact assembled export.
- Subtitle text, offset, and soundtrack selection come from the saved H3 project. Change those settings in Plan Studio; companion volume and CC switches affect preview only. Subtitle overlays are not burned into downloaded videos. Plan Studio must have a saved source presentation for its soundtrack to be available.
- Native reference-slot binding, folder organization, asset deletion, checkpoint activation/deletion, and branch recovery remain in ComfyUI. The companion provides navigation to the relevant native nodes.
- A live snapshot exposes named scalar widgets and links for inspection, including nested graph nodes. It is not an API execution graph. Connected inputs and native catalog/proof fields cannot be overwritten through generic input editing. Custom node controls with no scalar widget remain native.
- Asset edits compare the displayed fields with the server before writing. H3's ownership guard remains the server authority; its current update API does not offer an atomic revision precondition for two simultaneous edits from the same owner.
- Snapshot polling runs every two seconds while the parent is available. Browser background throttling can mark the link disconnected; focusing either window resumes the handshake. Reconnect does not automatically retry writes whose outcome is unknown.
- Review retries can change the native plan while a companion draft exists. Resolve the resulting widget conflict before applying the draft. Candidate batch acceptance uses the upstream server's safe-boundary request.
- This is a personal workstation companion. Multiuser hosting and a durable standalone project service are deferred.

## Imported workflow mode

**Import workflow**, **Server library**, and the explicit **Open offline starter** remain available for detached experiments. A saved file does not contain unsaved changes from ComfyUI's open tab.

API imports and supported canvas imports retain the original 0.1 editor. Canvas conversion supports ordinary nodes, reroutes, primitives, simple Get/Set buses, and unambiguous bypasses. Unknown frontend widget formats and subgraphs require native API export for detached mode. The app reports unsupported conversions. Live mode queues through ComfyUI and therefore does not need this conversion.

Detached documents autosave in localStorage and export as SceneWeaver project JSON. Supported canvas imports preserve layout and metadata on scalar edits. Editing the raw API graph drops its canvas association. Imported seed randomization controls are held fixed; use explicit seeds or H3 reroll. Large JSON integer seeds are preserved as strings in browsers supporting JSON reviver source context.

## Verification

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

To use an installed browser:

```bash
SCENEWEAVER_CHROMIUM=/path/to/chrome npm run test:e2e
```

Tests cover workflow conversion, exact seeds, HTTP/WebSocket proxying, origin restrictions, live revision checks, native ownership delegation, concurrent drafts, tab/project switching, and two-window browser attachment. Browser tests use a **mock ComfyUI server**, synthetic media fixtures, and never start GPU generation. Playback checks cover separate WAV audio, source-track seeks, timed captions, selected alternate pictures, continuous cuts and gaps, unrendered scenes, pause/seek/restart, and clip isolation. Compatibility with a particular live workflow still needs an attachment and a controlled production trial.

## Sources

- [Architecture and companion-first roadmap](docs/ARCHITECTURE.md)
- [ComfyUI browser extensions](https://docs.comfy.org/custom-nodes/js/javascript_overview)
- [ComfyUI HTTP routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [H3 Plan format](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/main/H3_CHAIN_FORMAT_GUIDE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

GPL-3.0-only; see [LICENSE](LICENSE). This independent companion is not affiliated with Blackmagic Design.
