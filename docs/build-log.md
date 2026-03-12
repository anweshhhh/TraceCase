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
