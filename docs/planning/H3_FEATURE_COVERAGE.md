# H3 coverage register

Planning baseline: 2026-09-10. Companion implementation target; this file does not claim feature completion. See [the implementation plan](../WORKFLOW_PARITY_PLAN.md).

Static census of nightly `cdbd44d`: **89 registered node types**, **50 HTTP method/path pairs**, **23 top-level example workflows**. Counts exclude archived recipes. UI-only branch/prompt/editorial controls are covered in the plan, not captured by counting nodes.

Every row remains subject to the M0 input/action audit. A generic widget inspector or an Open in ComfyUI shortcut is not proof of dedicated task parity. Milestones indicate completion targets; basic controls may land earlier. Legacy and experimental behavior keeps its upstream classification.

The [implementation status](IMPLEMENTATION_STATUS.md) tracks shipped progress separately. Version 0.5.1 adds typed production-node associations and task capability evidence; 0.5.2 adds effective Plan text source inspection and editing for supported literal producers; 0.5.3 adds a native branch command menu dependent on H3 PR #57. These do not mark the associated authoring, generation, checkpoint or delivery features complete.

## Registered nodes

### Advanced Continuity

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3AdvancedPolicy` | Generate / Finish | M8 |
| `MiniMaxH3BoundaryAnchorPrepass` | Generate / Finish | M8 |
| `MiniMaxH3ExtractBoundaryAnchors` | Generate / Finish | M8 |
| `MiniMaxH3PatchPriority` | Generate / Finish | M8 |
| `MiniMaxH3DriftControlModelPatch` | Generate / Finish | M8 |
| `MiniMaxH3ContexLoopSeamProbe` | Generate / Finish | M8 |
| `MiniMaxH3ReferenceVideoFadeModelPatch` | Generate / Finish | M8 |
| `MiniMaxH3VisualContextLateRevealModelPatch` | Generate / Finish | M8 |

### Assets

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ProjectAssetManager` | Media | M2 |

### Audio

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3LipSyncOptions` | Audio / Generate | M5 |
| `MiniMaxH3AudioTracks` | Audio / Generate | M5 |
| `MiniMaxH3SourceTimeline` | Audio / Generate | M5 |

### Authoring

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ChainPlan` | Edit | M2 |
| `MiniMaxH3ChainPlanModern` | Edit | M2 |
| `MiniMaxH3ChainScenePromptEditor` | Edit | M2 |
| `MiniMaxH3ChainRichScenePromptEditor` | Edit | M2 |
| `MiniMaxH3ChainPlanStudio` | Edit | M2 |

### Checkpoints

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ChainCheckpointManager` | Edit / Takes | M4 |

### Delivery

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ChainRunManager` | Deliver / Project | M7 |
| `MiniMaxH3ChainManifestLoad` | Deliver / Project | M7 |
| `MiniMaxH3ChainChapterDelivery` | Deliver / Project | M7 |
| `MiniMaxH3ChainChapterLoad` | Deliver / Project | M7 |
| `MiniMaxH3ChainExportPNG` | Deliver / Project | M7 |
| `MiniMaxH3ChainAssemble` | Deliver / Project | M7 |

### Finishing

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ChainLatentVideoAdapter` | Finish | M6 |
| `MiniMaxH3ChainLMSGuide` | Finish | M6 |
| `MiniMaxH3ChainUpscalePixelCurrent` | Finish | M6 |
| `MiniMaxH3ChainUpscalePixelConditioning` | Finish | M6 |
| `MiniMaxH3ChainUpscaleAdapter` | Finish | M6 |
| `MiniMaxH3ChainUpscaleCurrent` | Finish | M6 |
| `MiniMaxH3ChainDeropeGuard` | Finish | M6 |
| `MiniMaxH3ChainDeropeBudget` | Finish | M6 |
| `MiniMaxH3ChainDeropeFreezeMask` | Finish | M6 |
| `MiniMaxH3ChainDeropeContinuity` | Finish | M6 |
| `MiniMaxH3ChainRecoveredAV` | Finish | M6 |
| `MiniMaxH3UpscaleReferencePromptOverride` | Finish | M6 |
| `MiniMaxH3ChainUpscaleReferenceConditioning` | Finish | M6 |
| `H3ConditioningSyncFromLatents` | Finish | M6 |
| `MiniMaxH3ChainPass2Prepare` | Finish | M6 |
| `MiniMaxH3ChainUpscaleSegmentSave` | Finish | M6 |
| `MiniMaxH3ChainUpscaleLoopEnd` | Finish | M6 |
| `MiniMaxH3ChainUpscaleHandoff` | Finish | M6 |
| `MiniMaxH3ChainUpscaleAdvance` | Finish | M6 |
| `MiniMaxH3ChainUpscaleMerge` | Finish | M6 |

### Generation

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3LoopTrim` | Generate | M3 |
| `MiniMaxH3GenerationProfile` | Generate | M3 |
| `MiniMaxH3ChainPolicy` | Generate | M3 |
| `MiniMaxH3Legacy04PolicyAdapter` | Generate | M3 |
| `MiniMaxH3ChainPreflight` | Generate | M3 |
| `MiniMaxH3ChainExternalVideo` | Generate | M3 |
| `MiniMaxH3ChainLoopStart` | Generate | M3 |
| `MiniMaxH3ChainCurrent` | Generate | M3 |
| `MiniMaxH3ChainLoRAScheduler` | Generate | M3 |
| `MiniMaxH3ChainContext` | Generate | M3 |
| `MiniMaxH3ChainSegmentSave` | Generate | M3 |
| `MiniMaxH3ChainLoopEnd` | Generate | M3 |

### Masked Editing

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ContexTrimSourceAV` | Edit / Generate | M8 |
| `MiniMaxH3ContexMaskedTarget` | Edit / Generate | M8 |
| `MiniMaxH3ContexMaskGridPreview` | Edit / Generate | M8 |
| `MiniMaxH3ContexMasterAudioMaskedAV` | Edit / Generate | M8 |
| `MiniMaxH3ContexMaskedAVBridge` | Edit / Generate | M8 |
| `MiniMaxH3ContexLoopSourceAVTarget` | Edit / Generate | M8 |
| `MiniMaxH3ContexLoopMaskSlice` | Edit / Generate | M8 |

### References

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3ChainFirstSceneImage` | Media / Edit | M2 |
| `MiniMaxH3ChainFrameIndexSwitch` | Media / Edit | M2 |
| `MiniMaxH3ReferenceVideoPrepare` | Media / Edit | M2 |
| `MiniMaxH3ScheduledPictureReference` | Media / Edit | M2 |
| `MiniMaxH3ScheduledVideoReference` | Media / Edit | M2 |
| `MiniMaxH3ScheduledAudioReference` | Media / Edit | M2 |
| `MiniMaxH3ScheduledReferenceToVideo` | Media / Edit | M2 |
| `MiniMaxH3SemanticPictureAnchor` | Media / Edit | M2 |
| `MiniMaxH3SemanticAnchorBundle` | Media / Edit | M2 |
| `MiniMaxH3TaggedPictureReference` | Media / Edit | M2 |
| `MiniMaxH3TaggedVideoReference` | Media / Edit | M2 |
| `MiniMaxH3TaggedMotionReference` | Media / Edit | M2 |
| `MiniMaxH3TaggedMotionReferenceTimeline` | Media / Edit | M2 |
| `MiniMaxH3LazyMotionAVLoader` | Media / Edit | M2 |
| `MiniMaxH3TaggedMotionReferencePath` | Media / Edit | M2 |
| `MiniMaxH3LazyMotionScenePreview` | Media / Edit | M2 |
| `MiniMaxH3SourceTimelineScenePreview` | Media / Edit | M2 |
| `MiniMaxH3TaggedAudioReference` | Media / Edit | M2 |
| `MiniMaxH3SemanticAnchorConditioning` | Media / Edit | M2 |
| `MiniMaxH3TaggedReferenceToVideo` | Media / Edit | M2 |
| `MiniMaxH3TaggedSceneOptions` | Media / Edit | M2 |
| `MiniMaxH3CurrentTaggedScenePack` | Media / Edit | M2 |
| `MiniMaxH3CurrentTaggedReferenceScene` | Media / Edit | M2 |
| `MiniMaxH3SceneDataExtract` | Media / Edit | M2 |

### Reviews

| Registered ID | Interface | Milestone |
|---|---|---|
| `MiniMaxH3PendingReview` | Generate | M3 |
| `MiniMaxH3ChainReview` | Generate | M3 |

## Existing HTTP routes

These routes exist in the inspected H3 source. They are building blocks, not a promise that every frontend action has a transactional API. Native node execution and widget synchronization are still required for many operations.

| Method | H3 path | Handler |
|---|---|---|
| GET | `/working-branches` | `_working_branch_command` |
| POST | `/working-branches` | `_working_branch_command` |
| POST | `/project-ownership` | `_project_ownership_command` |
| POST | `/review` | `_submit_review_decision` |
| POST | `/review-candidate-batch` | `_submit_candidate_batch_command` |
| GET | `/reviews` | `_list_pending_reviews` |
| GET | `/deferred-reviews` | `_list_deferred_reviews` |
| POST | `/deferred-review` | `_submit_deferred_review` |
| GET | `/checkpoints` | `_list_saved_checkpoints` |
| GET | `/handoffs` | `_list_handoffs` |
| POST | `/handoffs/claim` | `_claim_handoff` |
| POST | `/handoffs/transition` | `_transition_handoff` |
| POST | `/handoffs/release` | `_release_handoff` |
| POST | `/editorial` | `_update_run_editorial` |
| POST | `/checkpoint-revisions/restore` | `_restore_checkpoint_revisions` |
| POST | `/checkpoint-revisions/attribute` | `_attribute_checkpoint_revision` |
| POST | `/checkpoint-revisions/delete-preview` | `_preview_checkpoint_revision_deletion` |
| POST | `/checkpoint-revisions/delete` | `_delete_checkpoint_revision` |
| POST | `/chapter-snapshots/retire-preview` | `_chapter_snapshot_retirement` |
| POST | `/chapter-snapshots/retire` | `_chapter_snapshot_retirement` |
| POST | `/processing-checkpoints/delete-preview` | `_processing_checkpoint_deletion` |
| POST | `/processing-checkpoints/delete` | `_processing_checkpoint_deletion` |
| POST | `/open-run-folder` | `_open_run_folder` |
| POST | `/run-folder/delete-preview` | `_preview_run_folder_deletion` |
| POST | `/run-folder/delete` | `_delete_complete_run_folder` |
| GET | `/prompt-history` | `_get_prompt_history` |
| POST | `/prompt-history` | `_update_prompt_history` |
| GET | `/runs` | `_list_saved_runs` |
| GET | `/run` | `_load_saved_run` |
| POST | `/run-assets` | `_save_run_assets` |
| GET | `/plan-studio/presentation` | `_plan_studio_presentation` |
| GET | `/plan-studio/checkpoint-thumbnail` | `_plan_studio_checkpoint_thumbnail` |
| GET | `/plan-studio/source-preview` | `_plan_studio_source_preview` |
| GET | `/plan-studio/source-audio` | `_plan_studio_source_audio` |
| GET | `/plan-studio/source-waveform` | `_plan_studio_source_waveform` |
| POST | `/prompt-optimize` | `_optimize_scene_prompt` |
| GET | `/project-assets` | `_project_asset_catalog` |
| GET | `/project-assets/projects` | `_project_asset_projects` |
| GET | `/project-assets/sources` | `_project_asset_sources` |
| POST | `/project-assets/upload` | `_project_asset_upload` |
| POST | `/project-assets/import` | `_project_asset_import` |
| POST | `/project-assets/capture-frame` | `_project_asset_capture_frame` |
| POST | `/project-assets/update` | `_project_asset_update` |
| POST | `/project-assets/duplicate` | `_project_asset_duplicate` |
| POST | `/project-assets/duplicate-project` | `_project_asset_duplicate_project` |
| POST | `/project-assets/derive` | `_project_asset_derive` |
| POST | `/project-assets/folder` | `_project_asset_folder` |
| POST | `/project-assets/reorder` | `_project_asset_reorder` |
| POST | `/project-assets/delete` | `_project_asset_delete` |
| GET | `/project-assets/media` | `_project_asset_media` |

All paths in the table are relative to `/minimax_h3_context_loop`. Newly proposed companion capabilities and command APIs are described separately in the plan.

## Current recipe coverage

Validate each recipe through its complete input → render/review → recovery/output path. External node types are recorded in the JSON inventory for adapter discovery. Inspect nested graphs and the actual production workflow during M0; the static recipe list only reads top-level nodes.

- Deferred De-Rope Only - Fast Turbo - MiniMax H3 0.6.json
- Deferred De-Rope Only - MiniMax H3 0.6.json
- Deferred Upscale + De-Rope - H3 LBH 3D - MiniMax H3 0.6.json
- Deferred Upscale - DLSS5 + LMS Guide - EXPERIMENTAL - MiniMax H3 0.6.json
- Deferred Upscale - H3 LBH 3D - MiniMax H3 0.6.json
- Deferred Upscale - H3 LBH 3D Split - EXPERIMENTAL - MiniMax H3 0.6.json
- Deferred Upscale - Pixel DLSS5 + USDU - EXPERIMENTAL - MiniMax H3 0.6.json
- Deferred Upscale - SeedVR2 Full Chain - MiniMax H3 0.6.json
- FL2V Normal - MiniMax H3 0.6.json
- I2V Normal - MiniMax H3 0.6.json
- I2V Studio - MiniMax H3 0.6.json
- Masked AV Bridge - Two Clips - MiniMax H3 0.6.json
- Masked AV Extension - Chain + Reference Image - MiniMax H3 0.6.json
- Masked AV Extension - Single Clip - MiniMax H3 0.6.json
- Masked Video Inpaint - MiniMax H3 0.6.json
- Ref2V Basic - MiniMax H3 0.6.json
- Ref2V Masked Video Inpaint - MiniMax H3 0.6.json
- Ref2V Sequential Motion - EXPERIMENTAL - MiniMax H3 0.6.json
- Ref2V Studio - MiniMax H3 0.6.json
- Ref2V Studio Source Audio - MiniMax H3 0.6.json
- Ref2V Tagged - MiniMax H3 0.6.json
- T2V Normal - MiniMax H3 0.6.json
- T2V Studio - MiniMax H3 0.6.json

## Updating the register

At each H3 integration update, compare registered IDs, input schemas, frontend actions/import contracts, HTTP schemas/events, and maintained recipes against the pinned commit. Add new rows before claiming parity. Removed/renamed controls require a migration or an explicit compatibility exception. Record real workflow tests separately from synthetic fixtures.
