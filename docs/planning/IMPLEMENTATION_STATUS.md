# Workflow parity implementation status

Active goal: implement [the complete roadmap](../WORKFLOW_PARITY_PLAN.md), preserving native H3 execution and a Resolve-inspired presentation.

## M0: in progress

Implemented in the first integration batch, SceneWeaver 0.5.0:

- One shared Plan/Carousel resolver for project identification, asset editing, take management, and parent-tab validation.
- Exact wired Carousel selection when multiple Carousels use the same project name; explicit Plan selection when several authoring Plans exist.
- Reroute and KJ Get/Set inspection, including ancestor lookup only when the installed Get node exposes the corresponding native support.
- ComfyUI subgraph input/output boundary inspection. Raw links remain intact; resolved inspection metadata never becomes a reconstructed execution graph.
- Explicit failures for ambiguous, broken, unknown, inactive, or shared-instance routing. Connected Studios remain presentation nodes; their upstream Plan owns authoring.
- Native saving of an already persisted workflow through its change tracker and exposed workflow store, with separate draft and workflow-file status.
- Parent-tab command receipts with running/completed/rejected/partial/uncertain outcomes. Duplicate accepted action IDs never rerun, including after their detailed receipts expire.
- Receipt recovery after a companion refresh, read-only result checking during execution, and heartbeats while a long command runs.

Still required before M0 is complete:

- Audit the exact production workflow and all frontend-only actions against the feature inventory. The ComfyUI Agent panel was disconnected during this batch; an optional request for the intended workflow/project is pending.
- Expand binding to policy, review, loop, checkpoint, and delivery roles; publish task-level capabilities and supported native integration versions.
- Complete the stable/nightly compatibility matrix and graph-driven input handling. Arbitrary bypass routing, shared subgraph instances, and unknown third-party routing remain explicitly unsupported.
- Extract additional domain state from the app and extend the command lifecycle to later branch, processing, and delivery actions.
- Validate these operations on an isolated representative native project. Synthetic browser/backend tests do not establish production parity.

## Save and receipt boundaries

The first native save interface targets existing persisted workflow files. Temporary workflows must be named/saved in ComfyUI once; a companion Save As flow remains future work. Applying a draft and saving a workflow do not save H3 branch authoring. A save that overlaps another graph edit or a tab change reports a review warning.

Receipts belong to the parent browser session, not durable server job storage. They survive SceneWeaver reloads while that ComfyUI tab remains open. An uncertain receipt cannot by itself prove a job did or did not run; the app queries the existing receipt and native state instead of retrying the action. Durable reconciliation across parent-tab restarts remains part of the later execution interfaces.

## Source contracts inspected

- ComfyUI frontend `v1.51.9`, commit `71d2f2f2b5c6da9dee281836b5b72f3af368966f`: [workflow service](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/platform/workflow/core/services/workflowService.ts), [workflow store](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/platform/workflow/management/stores/workflowStore.ts), and [subgraph node](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/lib/litegraph/src/subgraph/SubgraphNode.ts).
- KJNodes [Set/Get implementation](https://github.com/kijai/ComfyUI-KJNodes/blob/main/web/js/setgetnodes.js), inspected 10 September 2026. Native ancestor support is detected per live Get node; it is not assumed for older installations.

## Validation of the first batch

- Production build passed.
- 30 frontend unit tests and 43 adapter/proxy tests passed.
- All 44 browser cases passed across the full run and the corrected targeted rerun. The full run exposed one ambiguous text selector because an error appeared in both the banner and receipt history; the assertion now targets the alert. The corrected case and three attachment/recovery checks passed afterward.
- Browser fixtures are synthetic. No GPU generation or writes to a production H3 project were performed during this batch.
- A manual 1280×720 check found an existing transport overlap made worse by the extra status row. The compact desktop layout now keeps playback/audio controls and the timeline reachable, with no horizontal page overflow; full panel resizing remains M1 work.

The browser suite was run with `PLAYWRIGHT_BROWSERS_PATH=/tmp/sceneweaver-playwright` after installing its matching Chromium there. This does not alter the user's system browser.

## Later milestones

M1–M8 remain open. M1 will bring the workspace shell, core branch controls and first one-scene generation/review/delivery cycle. No milestone is complete merely because its controls can be represented in the generic inspector.
