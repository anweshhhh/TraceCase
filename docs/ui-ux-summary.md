# UI / UX Summary

## UX Hardening Pass

### Shared interaction patterns

- Long read-only content uses `ExpandablePreview` so pages stay shorter by default.
- Expand/collapse preferences can now be persisted with a per-surface `localStorage` key.
- Copy actions use a consistent small button with explicit `Copy` / `Copied` feedback.

### Presentation helpers now available

- Generation jobs:
  - metadata parsing for `placeholder` and `openai`
  - failure classification for dispatch, timeout, grounding mismatch, and coverage/validation failures
- Artifact readiness:
  - latest-snapshot readiness summaries for `OPENAPI` and `PRISMA_SCHEMA`
- Pack summaries:
  - compact counts for scenarios, cases, checks, and clarifying questions
  - review highlights for clarifying questions, assumptions, major risks, and quality notes

### Next UI chunks

- Requirement detail:
  - sticky actions
  - grounding readiness chips
  - active-generation banner
  - richer job cards with retry/details/copy
  - now implemented
- Pack viewer and review:
  - summary strip
  - readable review overview
  - copy affordances
  - sticky review actions

### Requirement detail page

- The top action area is sticky, but now stays compact and decision-focused:
  - requirement title
  - status
  - one `API grounding` readiness signal
  - latest snapshot badge
  - primary `Generate Draft Pack` action
- Detailed readiness moved out of the sticky area into a separate `Generation readiness` panel:
  - `OpenAPI: valid/invalid/missing`
  - `Prisma: valid/invalid/missing`
  - non-blocking notes explaining what actually gates generation today
- When a generation job is active, a progress banner appears near the top with:
  - current job status
  - auto-refresh note
  - grounding context note
  - copyable job id
- Generation jobs now explain themselves without leaving the page:
  - latest run gets a dedicated primary card with the actionable summary
  - older runs are compressed into lighter history rows
  - failure classification
  - retry button on failed jobs
  - AI/grounding details when metadata is available
  - copy buttons for job id and output pack id

### Pack viewer

- Header is no longer sticky. This page is read-heavy, so the summary stays visible without reducing the JSON viewport.
- Pack id, snapshot id, and source hash can be copied directly.
- Generation metadata is summarized inline:
  - mode
  - model / attempts
  - critic verdict
  - grounding status
- A compact summary strip shows scenario, case, and check counts before the raw JSON block.

### Pack review

- Header is sticky so review actions stay reachable.
- Snapshot id and hash are directly copyable.
- Reviewers now get a readable overview before raw JSON:
  - clarifying questions
  - assumptions
  - critic risks
  - quality notes
- JSON and snapshot expansion preferences can be remembered per pack.

### Validation status

- `npm test`: green
- `npm run build`: green
