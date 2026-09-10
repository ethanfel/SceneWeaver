# Workflow parity implementation status

Active goal: implement [the complete roadmap](../WORKFLOW_PARITY_PLAN.md), preserving native H3 execution and a Resolve-inspired presentation.

Release convention requested by the user: continue the current work as **0.5.1, 0.5.2, ...**. Do not increment the minor version for each implementation batch.

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
- Extend the typed role bindings and task capability report added in 0.5.1 to processing, independent saved manifests and graph-driven authoring. Establish installed-version reporting and a supported native integration matrix; helper discovery alone does not establish a release compatibility guarantee.
- Complete the stable/nightly compatibility matrix and graph-driven input handling beyond the literal Plan text sources added in 0.5.2. Arbitrary bypass routing, shared subgraph instances, and unknown third-party routing remain explicitly unsupported.
- Extract additional domain state from the app and extend the command lifecycle to later branch, processing, and delivery actions.
- Validate these operations on an isolated representative native project. Synthetic browser/backend tests do not establish production parity.

## Save and receipt boundaries

The first native save interface targets existing persisted workflow files. Temporary workflows must be named/saved in ComfyUI once; a companion Save As flow remains future work. Applying a draft and saving a workflow do not save H3 branch authoring. A save that overlaps another graph edit or a tab change reports a review warning.

Receipts belong to the parent browser session, not durable server job storage. They survive SceneWeaver reloads while that ComfyUI tab remains open. An uncertain receipt cannot by itself prove a job did or did not run; the app queries the existing receipt and native state instead of retrying the action. Durable reconciliation across parent-tab restarts remains part of the later execution interfaces.

## 0.5.1: production control binding and capability evidence

- Added typed provenance for native Plan, flow, state, segment and manifest routes. Prompt editors, connected Studios and Preflight preserve the upstream authoring identity. Policies, loop starts, live/deferred review configuration, loop ends, checkpoint managers, assembly/chapter delivery and manifest PNG/WAV export controls are identified for the selected Plan.
- Crossed Plan or loop identities, wrong output slots, unknown producers, broken links, cycles, inactive paths and externally supplied initial states remain unresolved. Multiple active targets are listed without selecting one. Shared policy nodes identify every associated active authoring Plan.
- Checkpoint Manager's Plan input is an authoring restoration association. Its output can be independently pinned and never acquires the selected Plan's identity merely through that input. Chapter loads and unsupported processing outputs likewise need exact-source adapters.
- Added an inspectable task report separating whole-workflow queueing, draft apply, workflow file save, basic assets, grouped audio, existing final-cut picture choices and checkpoint restoration from pending branch/range/finishing/delivery commands. A connected node is not proof of task parity.
- H3 helper loading now checks export contracts independently and keeps successful integrations when another optional helper fails. Duplicate pack entrypoints cannot be combined into one adapter. Named-branch support checks the actual native identity/path exports. Final-cut source markers remain explicitly labeled as inference.
- Reports the ComfyUI version when the server publishes it. H3 pack and installed frontend versions remain unknown where no authoritative interface exposes them; frontend minimum requirements and module cache keys are not reported as installed versions.
- The report opens above the workspace, with scrolling and direct inspector links, rather than shrinking the sequence viewer and timeline.

Source evidence: H3 main `336ee236de09a92dd25b006bbd97b57f82e3639a` and nightly `cdbd44d195bad589ee2fbfb7657bb99261962a94`. The sanitized [topology fixtures](../../server/fixtures/h3-production-topology.json) retain links/types/modes from T2V Studio, Ref2V Studio Source Audio and deferred SeedVR2 recipes in both revisions. They include the inactive saved-manifest assembly path shipped upstream. Main is not claimed to be a released stable-version validation. Tests also exercise conflicting branches of synthetic graphs, shared policies, unknown producers, helper failures and capability scope.

Native production validation remains pending. No production project was modified and no GPU job was queued for this batch.

Validation: production build passed; 30 frontend unit tests and 63 adapter/proxy tests passed. The final browser run passed all 26 affected live/branch/take cases, and the grouped-audio asset case passed separately (27 cases total). The new cases exercise inspector navigation without mutation, independently pinned delivery sources, and an optional helper failure that leaves other integrations usable. A manual 1280×720 screenshot confirmed the open report leaves the timeline and footer in place with no horizontal overflow. The remaining browser suites were not rerun for this batch.

## 0.5.2: effective Plan text sources

- Scene inspection and editing use the effective native Plan document: a nonblank `plan_json_input` wins over `plan_json`; a known blank override uses the fallback. Converted required `plan_json` inputs remain selectable. Connected Studios still defer to the upstream authoring Plan.
- Supported sources are literal `PrimitiveString`, `PrimitiveStringMultiline`, and frontend `PrimitiveNode` widgets, through the existing supported routing adapters. The inspector names the source and can open its node settings. Runtime generators, broken or inactive routes, cycles, dynamic prompts and custom Primitive serializers remain unresolved; inspection does not execute them or present the inactive fallback as their output.
- Shared-source edits list all active input consumers, including consumers outside H3 Plans. Confirmation is tied to the current draft and graph revision, and the parent validates the consumer list again before writing. Native branch identity cannot be changed through a generic source edit.
- Draft backups include connected source identity and effective branch. A remote source rewire or branch change preserves the pending draft and reports a conflict. An unresolved branch does not read Original's checkpoint or playback inventory; project-shared asset editing remains available.
- An explicit adapter capability prevents an older cached parent bridge from editing a connected Plan. Refresh the ComfyUI tab and reopen SceneWeaver after updating. The node inspector also respects the native editable-widget list.
- Saved-picture choices use the effective branch. Checkpoint restoration remains disabled for connected or read-only Plan text because the current native helper restores the backing `plan_json` widget. Its dedicated source adapter is still required. The native checkpoint shortcut now requires one unambiguous manager associated with the selected Plan.

Known source limits: native top-level array and string-shot shorthand still needs an authoring adapter. Custom text generators and Node 2 widget serializers need additional verified contracts. A whitespace-only nonempty override combined with a named-branch fallback is reported as unresolved: the inspected native Plan parser strips whitespace, while branch scoping uses truthiness. Clear that override to an empty string in ComfyUI to remove the disagreement.

Upstream recheck on 10 September 2026: main remains `336ee236de09a92dd25b006bbd97b57f82e3639a`; nightly advanced to `62948e3ec8602cbd5f34ad6ef7b961117f5746b4`. Its new checkpoint zoom and final-cut source changes do not alter the Plan input or branch scoping contracts used here. The coverage census remains pinned to `cdbd44d`; the newer `final_cut_source` / `final_cut_contexts` behavior needs the later exact-source processing and checkpoint adapters.

Validation: the final 0.5.2 production build passed, with 31 frontend unit tests and 73 adapter/proxy tests passing. The affected live, draft, branch, take, asset and Plan-source browser suites passed 35 cases before the final bridge-version guard; a final targeted run passed all nine cases covering the seven Plan-source cases, production inspector navigation, and ordinary live draft application/queue/export (36 distinct affected cases across the runs). These include stale shared-consumer confirmation, source rewiring, uint64 seeds, draft recovery, unresolved branch isolation and old-bridge rejection. A manual 1280×720 check confirmed both the source card and shared-source dialog fit, with the timeline/footer and playback controls reachable and no horizontal page overflow. The remaining browser suites were not rerun for this batch.

The live Agent panel was still disconnected when rechecked. No production project was modified and no GPU job was queued. M0 remains in progress; these tests do not establish native production parity.

## Source contracts inspected

- ComfyUI frontend `v1.51.9`, commit `71d2f2f2b5c6da9dee281836b5b72f3af368966f`: [workflow service](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/platform/workflow/core/services/workflowService.ts), [workflow store](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/platform/workflow/management/stores/workflowStore.ts), and [subgraph node](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/lib/litegraph/src/subgraph/SubgraphNode.ts).
- KJNodes [Set/Get implementation](https://github.com/kijai/ComfyUI-KJNodes/blob/main/web/js/setgetnodes.js), inspected 10 September 2026. Native ancestor support is detected per live Get node; it is not assumed for older installations.
- H3 nightly `62948e3`: [Plan build and Studio](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/62948e3ec8602cbd5f34ad6ef7b961117f5746b4/chain_nodes.py), [branch scoping](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop/blob/62948e3ec8602cbd5f34ad6ef7b961117f5746b4/branch_scope.py), and the native checkpoint restoration helpers. Plan-source contracts match the prior `cdbd44d` inspection.
- ComfyUI frontend `v1.51.9`: [Primitive/widget input handling](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/extensions/core/widgetInputs.ts) and [dynamic prompt serialization](https://github.com/Comfy-Org/ComfyUI_frontend/blob/71d2f2f2b5c6da9dee281836b5b72f3af368966f/src/extensions/core/dynamicPrompts.ts). Core [STRING Primitive nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_primitive.py), inspected 10 September 2026.

## Validation of the first batch

- Production build passed.
- 30 frontend unit tests and 43 adapter/proxy tests passed.
- All 44 browser cases passed across the full run and the corrected targeted rerun. The full run exposed one ambiguous text selector because an error appeared in both the banner and receipt history; the assertion now targets the alert. The corrected case and three attachment/recovery checks passed afterward.
- Browser fixtures are synthetic. No GPU generation or writes to a production H3 project were performed during this batch.
- A manual 1280×720 check found an existing transport overlap made worse by the extra status row. The compact desktop layout now keeps playback/audio controls and the timeline reachable, with no horizontal page overflow; full panel resizing remains M1 work.

The browser suite was run with `PLAYWRIGHT_BROWSERS_PATH=/tmp/sceneweaver-playwright` after installing its matching Chromium there. This does not alter the user's system browser.

## Later milestones

M1–M8 remain open. M1 will bring the workspace shell, core branch controls and first one-scene generation/review/delivery cycle. No milestone is complete merely because its controls can be represented in the generic inspector.
