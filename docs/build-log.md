# Build Log

## 2026-03-12 - UX Hardening Pass - Chunk 1

- Scope:
  - Added shared UX presentation helpers for generation jobs, artifact grounding readiness, and pack summaries.
  - Added reusable `CopyTextButton`.
  - Upgraded `ExpandablePreview` to support persisted expand/collapse state via `localStorage`.
- Commands:
  - `npm test`
- Result:
  - Passed: `64`
  - Failed: `0`

## 2026-03-12 - UX Hardening Pass - Chunk 2

- Scope:
  - Requirement detail page now has:
    - sticky actions and status header
    - artifact grounding readiness chips and notes
    - active-generation progress banner
    - richer job cards with copy actions, retry affordance, failure classification, and inline AI/grounding details
- Commands:
  - `npm test`
- Result:
  - Passed: `64`
  - Failed: `0`

## 2026-03-12 - UX Hardening Pass - Chunk 3

- Scope:
  - Added persisted expansion state for requirement source and pack JSON editors.
  - Added copy affordances for pack ids, snapshot ids, source hashes, and artifact hashes.
  - Pack viewer now shows compact pack-summary cards and generation metadata in the header.
  - Pack review now shows a review overview with clarifying questions, assumptions, critic risks, and quality notes before the raw JSON editor.
- Commands:
  - `npm test`
- Result:
  - Passed: `64`
  - Failed: `0`

## 2026-03-12 - UX Hardening Pass - Final Validation

- Scope:
  - Fixed production-build type mismatches in:
    - `server/ai/openaiClient.ts`
    - `server/artifactParsers.ts`
  - Re-ran the full automated suite and production build.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `64 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - UX Hardening Pass - Sticky Header Refinement

- Scope:
  - Shrunk the requirement sticky header so it only carries decision-critical state:
    - title
    - status
    - API grounding readiness
    - latest snapshot badge
    - primary generation action
  - Moved OpenAPI and Prisma readiness details into a non-sticky `Generation readiness` panel.
  - Removed sticky chrome from the pack viewer header to give the JSON/content area more room.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `64 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - UX Hardening Pass - Job Hierarchy Refinement

- Scope:
  - Requirement detail generation jobs now separate into:
    - one emphasized `Latest run` card
    - lighter `Recent history` rows for older runs
  - Added a pure helper for stable latest-job summary copy so the UI stays testable.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `65 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - UX Hardening Pass - Generation Evidence Block

- Scope:
  - Added a dedicated `Generation evidence` block to the latest requirement-job card.
  - Surfaced compact proof metrics for critic coverage and OpenAPI grounding without requiring DB inspection.
  - Added a pure helper and unit coverage so evidence copy stays deterministic.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `66 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - UX Hardening Pass - Evidence Collapse Refinement

- Scope:
  - Changed `Generation evidence` from an always-open block to a collapsible bar matching `Job details`.
  - Added a compact summary string so critic/grounding proof is still visible when collapsed.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `66 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - UX Hardening Pass - Evidence Summary Cleanup

- Scope:
  - Removed the redundant collapsed summary text from `Generation evidence`.
  - Evidence metrics now appear only inside the expanded panel.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `66 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - UX Hardening Pass - Latest Run Simplification

- Scope:
  - Simplified the in-progress banner so it no longer repeats critic/grounding/debug state.
  - Merged `Generation evidence` and `Job details` into one `Details` disclosure on the latest-run card.
  - Moved copy/debug metadata out of the collapsed latest-run summary.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `66 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - Phase 1 - Workstream 2C.2 - Prisma Grounding Gate

- Scope:
  - Added Prisma grounding lookup for latest valid `PRISMA_SCHEMA` artifacts.
  - Added deterministic Prisma grounding validation for SQL checks.
  - Wired Prisma grounding into the OpenAI generation repair loop.
  - Added semantic fallback for unsupported concrete SQL checks after repair.
  - Extended generation metadata and tests for Prisma grounding.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `75 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - Phase 1 - Workstream 2C.2 - Prisma Prompt Alignment

- Scope:
  - Switched semantic SQL fallback to explicit `NEEDS_MAPPING:` query hints.
  - Updated the Prisma validator to count `NEEDS_MAPPING:` checks as semantic.
  - Added the explicit failure-path orchestration test by making Prisma fallback overridable in tests.
  - Expanded Prisma validator coverage to match the full workstream contract.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `79 passed`, `0 failed`
  - Build: `passed`

## 2026-03-12 - Reliability Hardening - OpenAI Timeout Guard

- Scope:
  - Added a bounded timeout to shared OpenAI structured-output requests.
  - Disabled hidden SDK retries for those requests to avoid multi-minute hangs.
  - Normalized provider timeout errors to a safe retry message.
  - Classified provider timeout failures separately in latest-run UX.
  - Reduced critic and repair prompt size by replacing full pack JSON with compact pack summaries.
  - Split timeout budgets by stage so generation gets a larger budget than the critic path.
  - Added an explicit abort-backed timeout wrapper because the SDK timeout alone did not reliably terminate hung provider calls in live runs.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `88 passed`, `0 failed`
  - Build: `passed`

## Reliability Stabilization: workflow deadline + stage progress
- Scope:
  - Added workflow runtime metadata for `generate_pack` jobs (`metadata_json.runtime`) with stage, attempt, deadline, and model names.
  - Added a hard 12-minute end-to-end AI generation deadline and stage-aware timeout budgeting for generation vs critic calls.
  - Added `OPENAI_GENERATION_MODEL` so generation can use a stronger model than the critic path.
  - Updated latest-run metadata parsing so running jobs show meaningful stage progress and workflow-deadline failures are classified separately from provider timeouts.
- Validation:
  - `npm test`
  - `npm run build`
- Result:
  - `npm test`: 100 passed, 0 failed.
  - `npm run build`: passed.

## Reliability Stabilization: generate_pack retry + failure metadata preservation
- Scope:
  - Disabled automatic retries for `generate_pack` so one deterministic AI failure cannot fan out into long-running repeated attempts on the same job row.
  - Preserved the last real runtime stage on failure instead of overwriting job metadata with a fresh fallback `load_context` runtime block.
  - Added targeted tests for failure-metadata finalization and non-retryable failure classification.
- Commands:
  - `npm test`
  - `npm run build`
- Result:
  - Tests: `103 passed`, `0 failed`
  - Build: `passed`

## 2026-03-15 — generate_pack failure runtime preservation
- Fixed failure finalization to recover the last persisted OpenAI runtime metadata from the `Job` row before writing final FAILED state.
- Added regression coverage for Inngest replay/reset scenarios where local runtime state falls back to `load_context`.
- Validation: `npm test` (`104 passed`, `0 failed`), `npm run build` (passed).

## 2026-03-25 - Reliability Instrumentation Pass - generate_pack stage evidence

- Scope:
  - Added compact `metadata_json.runtime` stage evidence for `generate_pack` without changing acceptance, grounding, or UI flow.
  - Instrumented worker `load_context` and `finalize` stages with requirement/artifact sizing and pack check counts.
  - Instrumented AI generation, validation, OpenAPI grounding, Prisma grounding, critic, and repair stages with enter/exit status, provider-call markers, timeout budgets, mismatch counts, and semantic SQL counts.
  - Preserved final-outcome evidence (`provider_timeout`, `workflow_deadline`, `critic_coverage`, `openapi_grounding`, `prisma_grounding`, `validation`, `dispatch`, `unknown`) in runtime metadata and taught latest-run metadata parsing to read it.
- Commands:
  - `npx tsx --test server/packs/generationRunContext.test.ts server/packs/generateAiPack.test.ts lib/packUx.test.ts server/packs/generatePackFailure.test.ts`
  - `npm test`
  - `npm run build`
- Result:
  - Focused tests: `33 passed`, `0 failed`
  - `npm test`: `105 passed`, `0 failed`
  - `npm run build`: `passed`

## 2026-03-25 - Phase 1 - Workstream 3A - Acceptance Criteria Coverage Planner

- Scope:
  - Added deterministic extraction of the `Acceptance Criteria:` section into stable `AC-xx` items with heuristic expected-layer tags.
  - Threaded the compact acceptance-criteria plan into AI generation/repair prompts and stored it in final OpenAI job metadata.
  - Added planner unit tests and generation integration coverage to ensure the plan reaches the model input and metadata.
- Commands:
  - `npx tsx --test server/packs/acceptanceCriteriaPlanner.test.ts server/packs/generateAiPack.test.ts lib/packUx.test.ts`
  - `npm test`
  - `npm run build`
- Result:
  - Focused tests: `30 passed`, `0 failed`
  - `npm test`: `110 passed`, `0 failed`
  - `npm run build`: `passed`

## 2026-03-26 - Phase 1 - Workstream 3A - AC coverage gate + critic alignment

- Scope:
  - Added a deterministic acceptance-coverage map that reads `AC-xx` references from existing pack fields such as scenario/test-case tags and check text.
  - Added a pre-critic AC coverage gate so obviously uncovered acceptance criteria trigger one targeted repair attempt before the final critic decision.
  - Updated the critic contract to consume the AC plan plus deterministic coverage summary and report explicit uncovered `AC-xx` ids.
  - Extended final OpenAI job metadata with compact `coverage_plan`, `coverage_map`, and critic uncovered-id evidence.
  - Updated planner, coverage-map, prompt-summary, metadata, and orchestration tests to keep Workstream 3A deterministic and green.
- Commands:
  - `npx tsx --test server/packs/acceptanceCriteriaPlanner.test.ts server/packs/coverageMap.test.ts server/packs/generateAiPack.test.ts server/packs/packPromptContext.test.ts lib/packUx.test.ts`
  - `npm test`
  - `npm run build`
- Result:
  - Focused tests: `39 passed`, `0 failed`
  - `npm test`: `116 passed`, `0 failed`
  - `npm run build`: `passed`

## 2026-03-27 - Phase 1 - Workstream 3B - Deterministic coverage closure

- Scope:
  - Preserved the latest critic phase and explicit uncovered `AC-xx` ids in final OpenAI job metadata so failed `repair_critic` runs keep actionable evidence.
  - Added deterministic coverage-closure planning that maps uncovered `AC-xx` items into layer-aware repair obligations such as `add_ui_case`, `add_api_case_or_check`, `add_audit_or_logging_check`, and `add_session_case_or_check`.
  - Added deterministic closure validation before the final critic so repaired packs record whether the previously uncovered AC ids were actually closed in a layer-appropriate way.
  - Tightened pack validation so API checks missing an HTTP method fail during validation before OpenAPI grounding.
  - Added unit and orchestration coverage for closure-plan mapping, closure validation, final critic evidence preservation, repair-obligation prompting, and malformed API-check rejection.
- Commands:
  - `npx tsx --test server/packs/coverageClosurePlan.test.ts server/packs/validateCoverageClosure.test.ts server/packs/validatePack.test.ts server/packs/generateAiPack.test.ts lib/packUx.test.ts`
  - `npm test`
  - `npm run build`
- Result:
  - Focused tests: `40 passed`, `0 failed`
  - `npm test`: `125 passed`, `0 failed`
  - `npm run build`: `passed`

## 2026-03-27 - Phase 1 - Workstream 3C - Deterministic repair hardening + final critic evidence preservation

- Scope:
  - Added deterministic sanitization before validation for both initial and repaired AI candidates, including safe `source_refs` line-range swaps, API method casing normalization, and safe text trimming.
  - Recorded compact sanitization summaries in final OpenAI job metadata under `metadata_json.ai.sanitization`.
  - Hardened final critic evidence preservation so the canonical stored critic result keeps the latest phase plus explicit uncovered `AC-xx` ids and reasons.
  - Added compensating-coverage validation for cases where Prisma grounding downgrades concrete SQL to semantic `NEEDS_MAPPING:` checks, requiring stronger concrete UI/API/session/audit coverage where appropriate.
  - Tightened deterministic API validation so missing `method` or `endpoint` fail before grounding.
  - Extended prompt/repair orchestration so compensating-coverage obligations are fed back into repair when semantic fallback weakens specificity.
- Commands:
  - `npx tsx --test server/packs/sanitizeGeneratedPack.test.ts server/packs/validateCompensatingCoverage.test.ts server/packs/validatePack.test.ts server/packs/generateAiPack.test.ts lib/packUx.test.ts server/packs/generatePackFailure.test.ts`
  - `npm test`
  - `npm run build`
- Result:
  - Focused tests: `51 passed`, `0 failed`
  - `npm test`: `137 passed`, `0 failed`
  - `npm run build`: `passed`

## 2026-03-29 - Live reliability follow-up: metadata transport, method recovery, and structural repair hardening

- Scope:
  - Preserved `AiPackGenerationError` metadata across the Inngest `generate-pack-content` step so failed rows keep final `metadata_json.ai` evidence instead of dropping to runtime-only metadata.
  - Added deterministic OpenAPI-based API method recovery before validation when a missing `method` can be safely inferred from a uniquely grounded `endpoint`.
  - Expanded deterministic sanitization to normalize drifting `source_ref.snapshot_id` values to the current requirement snapshot and to reassign duplicate or invalid ids across clarifying questions, test cases, and check collections.
  - Hardened the repair prompt so every repair pass explicitly requires unique ids, current-snapshot source refs, and complete API checks with both `method` and `endpoint`.
  - Added focused orchestration and sanitization tests that mirror the live repaired-pack failure shape.
  - Verified the full end-to-end path with a real live job after restarting the app and Inngest worker.
- Commands:
  - `npx tsx --test server/packs/sanitizeGeneratedPack.test.ts server/packs/generateAiPack.test.ts server/packs/validatePack.test.ts`
  - `npm test`
  - `npm run build`
  - live job trigger via `npx dotenv-cli -e .env.local -- npx tsx <<'TS' ... TS`
- Result:
  - Focused tests: `40 passed`, `0 failed`
  - `npm test`: `147 passed`, `0 failed`
  - `npm run build`: `passed`
  - Live job: `cmnc5awro0001upha7bu2ykkt` -> `SUCCEEDED`
  - Output pack: `cmnc5i0j80001upicx2s99pxb`
