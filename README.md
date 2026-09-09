# SceneWeaver

A companion workspace for [MiniMax H3 Context Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop), inspired by DaVinci Resolve. Version **0.4.0** focuses on assisting the workflow open in ComfyUI: sequence inspection, prompt drafts, native execution, project assets, takes, and exports.

This repository contains the web app, local proxy, and live workflow bridge. The installable ComfyUI launch button lives in [ComfyUI-SceneWeaver-Companion](https://github.com/ethanfel/ComfyUI-SceneWeaver-Companion).

ComfyUI remains the source of truth for the live workflow. H3 owns generation, continuity, project ownership, checkpoints, and assembly. Standalone editing is a later milestone.

## September 2026 H3 compatibility update

SceneWeaver 0.4 follows the working branch of the selected Plan. Checkpoint reads, saved-cut writes, restoration, soundtrack presentation, thumbnails, reviews, and browser draft backups retain that branch identity. The branch bar shows its name. Switching branches in Plan Studio updates the companion; unapplied drafts stay with their previous branch and require conflict resolution. An empty branch never displays Original’s clips. Branch creation, switching, authoring saves, and the project-default selection remain native Plan Studio actions.

**Takes** now separates Original, DeRoPE, latent upscale, and pixel upscale inventories. Processed takes show their saved profile, dimensions, date, source identity, and missing files, with video/audio preview and download. They do not become generation checkpoints or replace the final cut automatically. Select their output path in ComfyUI’s Checkpoint Manager.

**Assets** adds search, type filters, lyrics/SRT editing, and synchronized soundtrack bindings. For a source-track asset, assign enabled audio/video assets to Full mix, Vocals, and Instrumental, then apply. Keep stems at the full song length, including silence. H3 uses a full mix unchanged; without one it mixes vocals and instrumental. Scene Lip-sync and subtitle mode/offset stay in Plan Studio. Refresh its saved presentation there when changing soundtrack configuration. Assets and their metadata remain shared across branches.

Recovered review gates marked non-actionable by H3 show recovery instructions with generation decisions disabled.

Verified against upstream nightly [`89e238c`](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/commit/89e238c) and the running server’s branch/checkpoint inventories. Existing stable H3 projects continue to use Original; new mutations require the corresponding installed native helpers. A server that ignores a named branch is rejected for checkpoint reads and writes. This is an integration update, not a replacement for every native H3 control.

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

After updating SceneWeaver, rebuild and restart its service. Refresh the **ComfyUI browser tab**, then reopen SceneWeaver to load new native adapters. A ComfyUI server restart is unnecessary for a SceneWeaver update. Export any unapplied drafts from older versions before refreshing.

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
| See the sequence | Select scenes in the bin or timeline. Saved H3 trims, placements, gaps, and chosen alternate pictures are reflected. Timeline clips and scene cards display cached thumbnails of the saved final-cut revision. Unfinished scenes use labeled raw estimates. |
| Play the whole cut | **Sequence** is the default: Play or Space advances through saved clips and timeline gaps. Click or drag the timeline ruler to pause and seek the saved cut, including from other viewer tabs or isolated takes. With the ruler focused, Left/Right steps one frame, Shift+Left/Right steps one second, and Home/End jumps to the sequence boundaries. Unrendered scenes show a timed placeholder; playback stops at the sequence end. |
| Hear audio and see captions | The viewer pairs raw/alternate pictures with generated WAV sidecars, synchronizes the saved Plan Studio soundtrack, and overlays its selected SRT/LRC lyrics. Use the generated-audio/source-soundtrack switches, volume, and CC controls. |
| Watch sampling | **Generation** connects to an optional PreviewRelay channel, displays still/animated samples or MP4 previews, and plays decoded audio on request. Step counts, average sampling time, and preview decoding cost are shown. |
| Compare scene takes | The **Scene take** selector previews the final cut, its generated base, or compatible picture alternates. **All takes** opens the revision list for that scene. **Clip** mode stops at the selected scene’s end; selecting a base or alternate take enters this mode. Return to **Sequence** to watch the saved final-cut choices. These preview choices do not activate a different H3 checkpoint. |
| Edit prompts | Change the scene direction, shared direction, seeds, frame counts, or scalar node settings. **Apply to ComfyUI** writes the draft into the attached graph through native widget callbacks. |
| Handle simultaneous edits | Disjoint widget edits merge. Changes to the same widget raise a conflict and preserve the local draft. Export the draft before **Reload from ComfyUI** to keep both versions. A plan JSON widget is one conflict unit. |
| Run the workflow | **Queue in ComfyUI** uses the original frontend queue path, retaining custom serialization, subgraphs, ownership proofs, and queue hooks. Apply the draft first. |
| Follow a running project | Existing queued/running jobs with the selected H3 run name are discovered. The parent tab forwards execution events, and the companion reconciles queue, review, and checkpoint state through HTTP. |
| Review generations | Approve, retry, reroll, approve-and-stop, or select saved candidate takes at H3's review boundary. Native H3 review behavior remains authoritative. |
| Manage assets | **Assets** previews the project catalog, uploads one file at a time, imports relative ComfyUI input paths, and edits tags, roles, and enabled state. Writes use the carousel's native ownership helper and update its catalog. Apply prompt drafts before asset writes. |
| Compare saved takes | **Takes → Compare takes** shows two pictures with their prompts, seeds, and durations. Playing either side pauses the other. Alternates use their base checkpoint’s generated audio. |
| Choose the final-cut picture | **Use in final cut** selects the active base picture or a compatible alternate. H3 saves the choice with an editorial revision check; the timeline and native Plan Studio refresh. Other trims, placements, soundtrack and subtitle settings are preserved. |
| Restore checkpoints | **Restore checkpoint…** previews the chapter, checkpoints to activate, later active pointers to clear, and dependencies outside that chapter. **Restore this branch** uses H3’s native activation and Plan restoration helpers. The ComfyUI queue must be empty. Immutable takes remain available; the operation does not queue generation. |
| Recover prompt drafts | Editable widget changes are backed up in this browser, scoped to the server, workflow identity, Plan and original project. Refresh or reopen the matching workflow to review, restore, export or discard its saved draft. Restoring stages edits; **Apply to ComfyUI** remains explicit. |
| Export | **Export workflow** downloads the native canvas document. **Export draft** downloads unapplied widget edits. Download media in Assets, Takes, or Renders. Final assembly follows the workflow's H3 assembly nodes. |

Changing the active ComfyUI workflow pauses writes. Return to the attached tab or explicitly choose **Attach current tab**. Attachment never takes ownership away from another workflow. The native H3 ownership error is shown if the current workflow cannot write the project.

Applied changes live in the ComfyUI graph; save that workflow through ComfyUI as usual. Unapplied companion drafts are backed up in localStorage as widget changes only; full live graphs and attachment tokens are not stored. Recovery checks widget types/editability and shows newer ComfyUI values before staging a saved draft. Backups are removed after apply or discard. If storage fails or another companion window changes the same backup, export the draft before closing. Credentials and ownership widgets are excluded from live inspection and draft backups. A native workflow export has the same contents as ComfyUI's own serialization, so review it before sharing.

## Live generation previews with PreviewRelay

Install [ComfyUI-PreviewRelay](https://github.com/drozbay/ComfyUI-PreviewRelay) in ComfyUI's persistent `custom_nodes` directory inside Docker. Restart ComfyUI after any running render finishes. Then:

1. Insert **Preview Relay** on the MODEL connection that reaches your sampler. Give it a channel unique to your workflow, for example `sceneweaver_my_film`.
2. Configure preview resolution, frame count, and VAE decoding steps in ComfyUI. A compatible optional **audio_vae** supplies sample audio. Decoding previews adds work to sampling; the relay can use fast previews or selected VAE steps.
3. Refresh SceneWeaver, open **Generation**, and choose the channel. Literal channel names from the attached workflow are suggested automatically. Use **Check installation** if SceneWeaver was connected before the node was installed.
4. Start generation normally. **Sample audio** enables monitoring; **Open PreviewRelay** opens its native viewer and decoding controls.

The current sample is restored when attaching mid-render or reconnecting. Only the latest sample is retained locally. A new run clears the previous picture, and changing channels, servers, or the attached workflow cancels pending preview reads. Leaving the Generation tab stops its media playback. Animated images and audio loop independently; MP4 samples provide a clock for audio alignment.

PreviewRelay events are shared by channel across the ComfyUI server and do not identify a prompt, workflow, or scene. SceneWeaver displays the channel name and never attaches sampling images to a scene or marks them as saved takes. The integration reads PreviewRelay's existing HTTP endpoints and WebSocket notifications through the local proxy. It does not install nodes, rewire the graph, change decoding settings, or start a render automatically. PreviewRelay remains an experimental, optional dependency; no additional ports or Docker mounts are needed.

## Current boundaries

- The timeline edits the generation sequence. Trimming rendered media, transitions, audio mixing, arbitrary track placement, and independent movie export are future work. Sequence timing applies saved H3 trims and placements, combines delivered clips with raw estimates, and does not resolve every H3 continuity policy for unfinished scenes in advance. Sequence playback preserves gaps and unfinished scenes. It ends at the last planned scene, even if the source soundtrack is longer. Remote clip loading can briefly buffer at cuts; this is a browser preview, not a frame-exact assembled export.
- Subtitle text and soundtrack bindings can be edited in Assets; subtitle mode/offset and the saved soundtrack presentation remain controlled by Plan Studio; companion volume and CC switches affect preview only. Subtitle overlays are not burned into downloaded videos. Plan Studio must have a saved source presentation for its soundtrack to be available.
- Native reference-slot binding, folder organization, asset deletion, checkpoint deletion, lineage attribution, and workflow-local branch pinning remain in ComfyUI. The companion provides navigation to the relevant native nodes.
- Take writes require the selected Plan and its matching Asset Carousel. Unsupported native adapters leave their actions disabled. Checkpoint activation changes only the selected working branch within its chapter (other workflows selecting that same branch share those changes) and restores scene settings into the attached Plan; it does not configure Loop Start resume settings or restore model/policy wiring. Save the restored workflow in ComfyUI and inspect its generation controls before queuing.
- Draft backups are browser-local, not server backups. Clearing browser data removes them. A renamed workflow, changed graph identity, or different SceneWeaver browser origin can require returning to the original attachment to export the old draft.
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

Tests cover branch-scoped reads and mutations, delayed responses after a branch switch, draft isolation, processed media, soundtrack bindings, non-actionable recovered reviews, workflow conversion, exact seeds, HTTP/WebSocket proxying, origin restrictions, live revision checks, native ownership delegation, concurrent drafts, tab/project switching, and two-window browser attachment. Browser tests use a **mock ComfyUI server**, synthetic media fixtures, and never start GPU generation. Playback checks cover separate WAV audio, source-track seeks, timed captions, selected alternate pictures and their thumbnails, A/B take audio, revision-checked final-cut writes, checkpoint impact/activation and delayed-response guards, draft recovery and workflow isolation, missing-thumbnail recovery, continuous cuts and gaps, unrendered scenes, pause/seek/restart, ruler scrubbing across zoom and scroll offsets, frame keys, clip isolation, PreviewRelay media/audio, channel isolation, delayed responses, fresh-run resets, and preview reconnects. Compatibility with a particular live workflow still needs an attachment and a controlled production trial.

## Sources

- [Architecture and companion-first roadmap](docs/ARCHITECTURE.md)
- [ComfyUI browser extensions](https://docs.comfy.org/custom-nodes/js/javascript_overview)
- [ComfyUI HTTP routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [H3 Plan format](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/main/H3_CHAIN_FORMAT_GUIDE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

GPL-3.0-only; see [LICENSE](LICENSE). This independent companion is not affiliated with Blackmagic Design.
