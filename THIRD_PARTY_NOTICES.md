# Third-party notices

## H3 starter workflow and schema metadata

`public/examples/h3-starter.api.json` adapts the maintained **T2V Normal - MiniMax H3.json** graph from:

- Project: [ComfyUI MiniMax H3 Context Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop)
- Revision inspected: `0d58a64445a81605f9243f9522809ca1ca6b68e8`
- License: GPL-3.0; upstream attribution and origins are documented in its [third-party notices](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/main/THIRD_PARTY_NOTICES.md).
- Changes: converted to API format, resolved reroutes, excluded disabled branches and notes, filled installed-schema defaults, used original SceneWeaver scene directions, and changed project name and dimensions. No model weights or reference media are included.

`public/examples/h3-schemas.json` contains the relevant ComfyUI/H3 node schema metadata, with machine-specific model choices reduced to the starter's selections. Connected operation always uses the live server's schemas. The offline snapshot was inspected against ComfyUI 0.34.0 on 2026-09-05.

Runtime and development dependencies retain their individual package licenses; the exact dependency versions are recorded in `package-lock.json`. The UI uses Lucide icons (ISC). DM Sans and IBM Plex Mono are optional Google Fonts requested by the stylesheet, with local system-font fallbacks; no font files are redistributed.

## PreviewRelay interoperability

SceneWeaver includes an independently implemented client for the HTTP and WebSocket protocol exposed by [ComfyUI-PreviewRelay](https://github.com/drozbay/ComfyUI-PreviewRelay), inspected at revision `460878239193fd4dc943d9130db8dc1748228bbb`. PreviewRelay's Python nodes and browser viewer are not bundled or redistributed. Users install that experimental optional node pack separately on their ComfyUI server.

## Native H3 branch test fixtures

`e2e/fixtures/h3-native/h3_working_branches.mjs` and `h3_branch_commands.mjs` are unmodified copies from [ComfyUI MiniMax H3 Context Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop), commit `36362b7cbf14d1e2e01aba5da173a9792b319f43` (GPL-3.0), proposed in H3 PR #57. Tests use the real native controller with synthetic Studio callbacks and storage. These copies are test fixtures; SceneWeaver's production runtime calls the interface on the user's installed H3 Studio. Other files in that fixture directory, except the native copies identified below, are lightweight contract stubs, not copies of the complete native editor.

`e2e/fixtures/h3-native/h3_chain_top_level_requeue_coordinator.mjs` is an unmodified GPL-3.0 test copy from the same H3 repository at nightly commit `326453d`. It validates use of the exported native before-queue traversal. Its entry script, the mock ComfyUI serializer/API, and mock execution responses are synthetic; these tests do not execute a GPU workflow or the full ComfyUI frontend.

`h3_checkpoint_selection_native.mjs` is an unmodified copy of the native `h3_checkpoint_manager_core.mjs` at `326453d71065f8031c160ea4d504678dab3e0cc1`. `h3_delivery_core.mjs` is an unmodified copy at `e108f13d208c0cf21cb129ac1221c4b4170595b4`, proposed in H3 PR #58. Both are GPL-3.0 fixtures from the same repository. They exercise real lineage selection and delivery recipe serialization; the browser preparation endpoint and execution responses remain synthetic. Production SceneWeaver imports the helpers from the installed H3 pack rather than bundling these test copies.

`h3_editorial_commands.mjs` is an unmodified GPL-3.0 test copy from H3 commit `9638949e28debc503d6cf90aa02a216ac8573c10`, proposed in PR #59. The browser fixture uses its real identity/response contract with a synthetic editorial backend; native Python and FFmpeg tests live in the H3 PR. Production imports this optional helper from the installed H3 pack.

`e2e/fixtures/h3-native/h3_chain_plan_core.mjs` is an unmodified GPL-3.0 test copy from H3 nightly `326453d71065f8031c160ea4d504678dab3e0cc1`. It replaces the previous three-function stub so authoring checks exercise native parsing, identity/reference remapping and chapter helpers. The production app discovers and imports the installed H3 copy in the parent ComfyUI tab.
