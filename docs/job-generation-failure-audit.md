# Reliability Audit: `generate_pack` failures after artifact/grounding additions

## 1. Executive summary

Plain-English summary:
- The current `generate_pack` path is a long multi-call OpenAI workflow: initial generation, deterministic validation, grounding checks, critic review, optional repair generation, re-validation, re-grounding, and final critic.
- In live job history, the strongest failure correlation is with **both valid OpenAPI and valid Prisma artifacts present on the target snapshot**. In the last 40 `generate_pack` jobs, that effective artifact state produced **12 runs / 12 failures**.
- Those failures split almost evenly between **provider timeout** and **critic coverage rejection after repair**. I did **not** observe live failures whose persisted job error was an OpenAPI grounding mismatch or a Prisma grounding mismatch.
- The evidence does **not** support “artifact size got too big” as the main cause. Artifact summaries are compact in practice: the problem snapshots use 3 OpenAPI operations and 2-4 Prisma models, and successful historical runs with and without grounding have similar token usage.
- Historical failures were amplified by earlier reliability bugs: retries/replays, stale-job fallback, and runtime metadata collapsing back to `load_context`. Those older bugs explain many 20-110 minute runs, but they do **not** explain the current short-form failures that now end in about 5 minutes with a real `repair_critic` stage.

Most likely root causes:
- `1.` Multi-stage AI workflow fragility under full grounding + critic + one-repair cap, especially on dense auth requirements. Confidence: **high**.
- `2.` Provider latency/timeout in the long structured-output chain, especially before the latest retry/timeout hardening. Confidence: **medium-high**.
- `3.` Historical operational bugs (retries/replays, stale-job timeout fallback, runtime-stage preservation gaps) made failures look worse and harder to diagnose, but are not the only cause. Confidence: **high**.

What I do **not** think is the primary root cause:
- “Artifacts are too large.” Confidence against: **medium-high**.
- “The selector is accidentally using stale artifacts from older snapshots.” Confidence against: **high**.

## 2. Audit method

What I inspected:
- Generation/job path:
  - [src/inngest/functions/generatePack.ts](/Users/anweshsingh/Downloads/TraceCase/src/inngest/functions/generatePack.ts)
  - [server/pack-actions.ts](/Users/anweshsingh/Downloads/TraceCase/server/pack-actions.ts)
- AI generation/repair/critic path:
  - [server/packs/generateAiPack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generateAiPack.ts)
  - [server/packs/critiquePack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/critiquePack.ts)
  - [server/ai/openaiClient.ts](/Users/anweshsingh/Downloads/TraceCase/server/ai/openaiClient.ts)
  - [server/ai/openaiClientCore.ts](/Users/anweshsingh/Downloads/TraceCase/server/ai/openaiClientCore.ts)
  - [server/packs/generationRunContext.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generationRunContext.ts)
  - [server/packs/generatePackFailure.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generatePackFailure.ts)
- Grounding/artifact path:
  - [server/openapiGrounding.ts](/Users/anweshsingh/Downloads/TraceCase/server/openapiGrounding.ts)
  - [server/prismaGrounding.ts](/Users/anweshsingh/Downloads/TraceCase/server/prismaGrounding.ts)
  - [server/packs/validateOpenApiGrounding.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/validateOpenApiGrounding.ts)
  - [server/packs/validatePrismaGrounding.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/validatePrismaGrounding.ts)
  - [server/artifactParsers.ts](/Users/anweshsingh/Downloads/TraceCase/server/artifactParsers.ts)
  - [server/requirementArtifacts.ts](/Users/anweshsingh/Downloads/TraceCase/server/requirementArtifacts.ts)
  - [lib/requirementArtifacts.ts](/Users/anweshsingh/Downloads/TraceCase/lib/requirementArtifacts.ts)
- UI classification path:
  - [lib/packUx.ts](/Users/anweshsingh/Downloads/TraceCase/lib/packUx.ts)
- Env/config:
  - [server/env.ts](/Users/anweshsingh/Downloads/TraceCase/server/env.ts)
- Repo history context:
  - [docs/build-log.md](/Users/anweshsingh/Downloads/TraceCase/docs/build-log.md)
  - [context.md](/Users/anweshsingh/Downloads/TraceCase/context.md)

What live evidence I inspected:
- Recent `Job` rows from the app database, including status, timing, `metadata_json`, `output_pack_id`, and effective artifact state at job creation time.
- Recent `RequirementArtifact` rows and parse summaries for the problem snapshots.
- Current local env model configuration.
- A deterministic selector reproduction showing that older valid artifacts are **not** selected for a newer snapshot with invalid/missing artifacts.

What I attempted but could not fully verify:
- A full live multi-run OpenAI reproduction matrix across five scenarios. I attempted this with temporary external audit scripts, but the live-provider runs did not finish in a reasonable audit window and were aborted after prolonged execution.
- A live job row showing a current **workflow deadline exceeded** error. I found the code path and tests, but no live DB row with that error.
- A live successful job row containing persisted **Prisma grounding** metadata. Current code supports it, but I did not find a successful production-like row with `metadata_json.ai.grounding.prisma` present.

Code changes for diagnostics:
- **None in the repo.**
- I used temporary scripts outside the repo under `/tmp` for DB aggregation and live-provider experiments.

## 3. Current generation pipeline

| Stage | Function / file | Can fail hard? | Metadata written |
| --- | --- | --- | --- |
| Enqueue | `generateDraftPackAction()` in [server/pack-actions.ts](/Users/anweshsingh/Downloads/TraceCase/server/pack-actions.ts) | Yes: rate limit, missing snapshot, Inngest dispatch failure | Creates `Job` with `QUEUED`; on dispatch failure writes `FAILED` + `job.dispatch_failed` |
| Worker bootstrap | `generatePackFunction` in [src/inngest/functions/generatePack.ts](/Users/anweshsingh/Downloads/TraceCase/src/inngest/functions/generatePack.ts) | Yes: missing job, missing snapshot, missing requirement | Marks job `RUNNING`; writes `metadata_json.runtime = load_context` for OpenAI mode |
| Artifact lookup | `getLatestValidOpenApiArtifactForSnapshot()` and `getLatestValidPrismaArtifactForSnapshot()` | No hard failure unless DB read fails | No separate write; selected summaries are passed into generation |
| Initial generation | `generateAiPackWithCritic()` -> `requestPackCandidate()` in [server/packs/generateAiPack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generateAiPack.ts) | Yes: OpenAI/provider timeout, schema-locked output failure | `onProgress` writes `initial_generation` |
| Deterministic validation | `validatePackContent()` in [server/packs/validatePack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/validatePack.ts) via [server/packs/generateAiPack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generateAiPack.ts) | Yes: validation error; may trigger repair instead of hard fail on first attempt | `onProgress` writes `initial_validation` / `repair_validation` |
| Grounding checks | `validateOpenApiGrounding()` and `validatePrismaGrounding()` | Yes: after second attempt, can hard-fail on OpenAPI mismatch or unsafe Prisma grounding | `onProgress` writes `initial_grounding` / `repair_grounding` |
| Critic | `critiquePack()` in [server/packs/critiquePack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/critiquePack.ts) | Yes: provider timeout; can trigger repair or hard-fail after second attempt | `onProgress` writes `initial_critic` / `repair_critic` |
| Repair generation | `requestPackCandidate()` with repair context | Yes: same as initial generation | `onProgress` writes `repair_generation` |
| Persist | `persist-pack-and-job` step in [src/inngest/functions/generatePack.ts](/Users/anweshsingh/Downloads/TraceCase/src/inngest/functions/generatePack.ts) | Yes: DB failure | `onProgress` writes `persisting_pack`, then final `metadata_json.ai` + `SUCCEEDED` |
| Failure finalization | `finalizeGeneratePackFailureMetadata()` in [server/packs/generatePackFailure.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generatePackFailure.ts) | N/A | Writes final `FAILED` job metadata, attempting to preserve last real runtime stage |

Observed metadata behavior:
- Running-stage writes happen only through `onProgress`, and they write **runtime-only** metadata.
- Final success writes replace that with `metadata_json.ai` payload.
- Final failure writes either runtime-only metadata or richer AI metadata if the thrown `AiPackGenerationError` survives the step boundary.
- Historical rows show that runtime-stage preservation was incomplete before the most recent hardening; some recent rows still show `load_context`, while newer failures can preserve a real stage like `repair_critic`.

## 4. Reproduction matrix

The matrix below combines:
- observed historical `Job` rows from the app DB, with artifact state aligned to each job’s `created_at`
- deterministic selector experiments for latest-invalid/latest-missing behavior
- attempted live-provider reproductions where they did not finish inside the audit window

| Scenario | Artifacts present at run time | Evidence source | Run count | Successes | Failures | Failure type(s) | Dominant failing stage | Notes |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Baseline / no artifacts | none | historical jobs | 12 | 6 | 5 | `schema_contract` (1), `dispatch` (1), `other` (3), plus 1 `QUEUED` row | not observable | This bucket includes older pre-grounding history. It shows generation can succeed without artifacts, but it is not a clean current-code comparison. |
| OpenAPI only | valid OpenAPI, no valid Prisma | historical jobs | 1 | 1 | 0 | none observed | n/a | Single observed success: [cmmo38r6g001lupkw8llkwwz4](/Users/anweshsingh/Downloads/TraceCase) on snapshot `cmmd2puml009bupjt9ppbpx43`, with OpenAPI grounding persisted and no Prisma artifact present at that job’s `created_at`. |
| Prisma only | valid Prisma, no valid OpenAPI | historical jobs | 7 | 3 | 4 | `critic_coverage` (1), `dispatch` (2), `worker_interrupted` (1) | not observable | Mixed reliability. Important counterexample: artifacts are not inherently fatal, because Prisma-only runs did succeed. |
| OpenAPI + Prisma | both valid on same snapshot at job time | historical jobs | 12 | 0 | 12 | `critic_coverage` (5), `provider_timeout` (5), `worker_interrupted` (2) | only one confirmed `repair_critic`; others unknown due metadata gaps | Strongest observed correlation. All 12 recent both-artifact runs failed. This is the clearest reliability regression signal. |
| Invalid/missing latest artifact state | older snapshot valid, latest snapshot invalid/missing | deterministic selector repro + attempted live-provider repro | selector verified; live repro attempted twice and aborted | n/a | n/a | n/a | n/a | Verified by code and temp DB repro: selectors are snapshot-scoped; older valid artifacts are **not** used for newer invalid/missing snapshots. Live generation repro did not finish inside the audit window. |
| Grounding mismatch scenario | partial/underspecified grounding intended to force repair/fallback | attempted live-provider repro + deterministic validator/tests | live repro attempted and aborted; validator/test coverage exists | n/a | n/a | not observed in live DB | not observed in live DB | I did **not** observe a live job row with OpenAPI or Prisma grounding mismatch error. Deterministic validators and unit tests cover the path, but live reproduction did not complete in time. |

## 5. Observed failure taxonomy

### 5.1 Dispatch failure
- How it appears:
  - UI label: `Dispatch issue`
  - Job error: `fetch failed | connect ECONNREFUSED 127.0.0.1:8288`
- Backend source:
  - [server/pack-actions.ts](/Users/anweshsingh/Downloads/TraceCase/server/pack-actions.ts) around `inngest.send(...)`
- Evidence:
  - Job ids `cmmmso32b000fupgyi6m2afrn`, `cmmmsi1fh03qvupu6ga814hdg`
- Interpretation:
  - Not related to artifacts or grounding. This is a local worker availability problem.

### 5.2 Provider timeout
- How it appears:
  - UI label: `AI provider timeout`
  - Job error: `OpenAI request timed out while generating the pack. Please retry.`
- Backend source:
  - [server/ai/openaiClientCore.ts](/Users/anweshsingh/Downloads/TraceCase/server/ai/openaiClientCore.ts)
  - [server/ai/openaiClient.ts](/Users/anweshsingh/Downloads/TraceCase/server/ai/openaiClient.ts)
- Evidence:
  - Job ids `cmmrzow61002pupmije3r5atn`, `cmmql0yog006xuptg11s8td2a`, `cmmp93cjn000jupdg7priovru`, `cmmobflc105bnupkwt7kgl1w5`, `cmmo9lliu00xnupkwe63o8kde`
- Notes:
  - All observed provider-timeout rows in the recent both-artifact period are failures on fully grounded snapshots.
  - Most of these rows predate the newest runtime-preservation hardening and often show `runtime.stage = load_context`, so the exact stage of timeout is not recoverable from the DB.

### 5.3 Worker interrupted / stale-job fallback
- How it appears:
  - UI label: `Worker interrupted`
  - Job error: `Generation job timed out or the worker stopped before completion. Please retry.`
- Backend source:
  - [server/pack-actions.ts](/Users/anweshsingh/Downloads/TraceCase/server/pack-actions.ts) stale-job cleanup
- Evidence:
  - Job ids `cmmq1ope6001fup4l3xodxwm6`, `cmmq14mk8000jupv2ztd2t7nu`, `cmmmaeomp000jupu6wk4xpow7`
- Interpretation:
  - These rows are not direct proof of current OpenAI failure stage. They are backup cleanup for jobs that never completed cleanly.

### 5.4 Critic coverage failure
- How it appears:
  - UI label: `Coverage issue`
  - Job error: `AI-generated pack still has uncovered acceptance criteria after one repair attempt.`
- Backend source:
  - [server/packs/generateAiPack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generateAiPack.ts), `throwKnownFailure(...)` from `repair_critic`
- Evidence:
  - Job ids `cmms7jih00009up9cfla9yk5b`, `cmms5r2600009upqsg7121a5u`, `cmms1npd90009upbbxwgpvk6y`, `cmmquicsi0019upp0ybjfd796`, `cmmpdkaan0009up4sz66f6pbe`, `cmmmss5dt0009upv413gqfxue`
- Strongest single-stage evidence:
  - `cmms7jih00009up9cfla9yk5b` preserved `runtime.stage = repair_critic`, `attempt = 2`, and failed in about 5m 13s. This is the clearest current-code signal.

### 5.5 Metadata/runtime preservation gap
- How it appears:
  - Failed rows with `metadata_json.runtime.stage = load_context` even though the job clearly ran for many minutes and failed later.
- Backend source:
  - [src/inngest/functions/generatePack.ts](/Users/anweshsingh/Downloads/TraceCase/src/inngest/functions/generatePack.ts)
  - [server/packs/generatePackFailure.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generatePackFailure.ts)
- Evidence:
  - `cmms5r2600009upqsg7121a5u`, `cmms1npd90009upbbxwgpvk6y`, `cmmrzow61002pupmije3r5atn`, `cmmquicsi0019upp0ybjfd796`, `cmmql0yog006xuptg11s8td2a`
- Interpretation:
  - This is not the root cause of job failure, but it materially reduces observability and can mislead diagnosis.

### 5.6 Schema contract failure (historical, pre-grounding)
- How it appears:
  - Job error: `400 Invalid schema for response_format ... Missing 'reason'.`
- Backend source:
  - Structured output JSON Schema strictness
- Evidence:
  - `cmmfc4li5000tupebjt6g64f1`
- Interpretation:
  - Historical, unrelated to current artifact-grounding reliability issues.

Failure modes **not observed in live DB rows** during this audit:
- `Workflow deadline exceeded`
- `OpenAPI grounding mismatch after repair`
- `Prisma grounding mismatch after repair/fallback`

Those code paths exist and have test coverage, but I did not find live job rows exercising them.

## 6. Artifact correlation findings

### 6.1 Failures do correlate with the presence of both valid artifacts
Observed in live job history:
- Effective artifact state `openapi+prisma`: **12 runs / 12 failures** in the last 40 jobs.
- Effective artifact state `prisma-only`: **7 runs / 3 successes / 4 failures**.
- Effective artifact state `openapi-only`: **1 run / 1 success**.
- Effective artifact state `no-artifacts`: **12 runs / 6 successes / 5 failures / 1 queued**.

Interpretation:
- The strongest observed regression is not “artifacts exist” but “**both grounding gates are active at the same time**.”
- That is a correlation, not a proven single-cause explanation. The both-artifact runs also cluster on dense auth requirements/snapshots.

### 6.2 Artifact selection is snapshot-scoped and deterministic
Observed in code:
- [server/openapiGrounding.ts](/Users/anweshsingh/Downloads/TraceCase/server/openapiGrounding.ts) and [server/prismaGrounding.ts](/Users/anweshsingh/Downloads/TraceCase/server/prismaGrounding.ts) query **only the target snapshot id**, order by `updated_at`, `created_at`, `id`, then pick the first valid parse summary.

Observed in deterministic repro:
- Temporary selector repro returned:
  - `snapshot1`: valid OpenAPI + valid Prisma selected
  - `snapshot2` (newer snapshot with invalid/missing artifacts): both selectors returned `null`
- That confirms older valid artifacts are **not** reused for a newer invalid/missing snapshot.

Conclusion:
- I found **no evidence** of stale cross-snapshot artifact selection.

### 6.3 Invalid latest artifacts cause grounding to skip, not fallback to older snapshots
Observed in code + selector repro:
- Latest invalid/missing artifact state leads to `getLatestValid*ForSnapshot(...) => null`.
- The generator will then pass `null` grounding and the validators will report `status = skipped`.

What I could not verify live:
- I attempted live-provider reproductions of this exact scenario, but those runs did not finish inside the audit window. So the generation outcome for this scenario is **inferred from code**, not directly observed in a completed live run during this audit.

### 6.4 Grounding summaries are compact in practice
Observed in DB:
- Snapshot `cmmd2puml009bupjt9ppbpx43`:
  - requirement source length: `2518`
  - OpenAPI artifact content length: `331`
  - OpenAPI operations count: `3`
  - Prisma artifact content length: `219`
  - Prisma model count: `2`
- Snapshot `cmmi7ixho001vup0je4sag88y`:
  - requirement source length: `2448`
  - Prisma artifact content length: `260`
  - Prisma model count: `2`
  - OpenAPI artifact content length: `331`
  - OpenAPI operations count: `3`
- Snapshot `cmmrzltiu000hupmi90kt7yos`:
  - requirement source length: `2518`
  - OpenAPI artifact content length: `2139`
  - OpenAPI operations count: `3`
  - Prisma artifact content length: `860`
  - Prisma model count: `4`

Interpretation:
- The compact summaries are small enough that they do **not** explain multi-minute failures by size alone.
- The **repair context + critic loop** is more likely to be the meaningful prompt-cost multiplier than the grounding summary itself.

### 6.5 Live successful Prisma-grounded jobs are missing from the DB evidence
Observed in the last 10 successful jobs:
- I found `has_openapi_grounding = true` on several successful jobs.
- I found **no successful job row** with `metadata_json.ai.grounding.prisma` present.

Interpretation:
- Current code supports Prisma grounding metadata on success, but that success path is not yet evidenced in the live DB rows I inspected.
- This weakens confidence that the Prisma-grounded success path is healthy in real usage, even though tests cover it.

## 7. Timeout/reliability findings

### 7.1 Current timeout and model configuration
Observed in code + env:
- Current local env:
  - `AI_PROVIDER = openai`
  - `OPENAI_MODEL = gpt-5-mini`
  - `OPENAI_GENERATION_MODEL = gpt-5-mini`
  - `OPENAI_STORE = false`
- Timeouts from [server/packs/generationRunContext.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generationRunContext.ts):
  - generation / repair generation stage budget: `240s`
  - critic / repair critic stage budget: `90s`
  - workflow deadline: `12 minutes`
- Hidden retries from [server/ai/openaiClientCore.ts](/Users/anweshsingh/Downloads/TraceCase/server/ai/openaiClientCore.ts):
  - `maxRetries: 0`
- Inngest retries from [src/inngest/functions/generatePack.ts](/Users/anweshsingh/Downloads/TraceCase/src/inngest/functions/generatePack.ts):
  - `retries: 0`

### 7.2 Provider timeout guard is real, but live evidence is mostly from older runs
Observed:
- Many long timeout rows exist: `cmmrzow...`, `cmmql0...`, `cmmp93...`, `cmmobf...`, `cmmo9l...`
- Those rows typically show either `metadata_json = null` or `runtime.stage = load_context`, and several ran far longer than the current 12-minute workflow deadline.

Interpretation:
- These timeout rows are strong evidence of historical provider/workflow instability.
- They are **not** good evidence that the current workflow deadline is firing correctly, because most predate or straddle the reliability hardening sequence.

### 7.3 I found no live `workflow deadline` error rows
Observed:
- Query for `error contains "workflow deadline"` returned `[]`.

Interpretation:
- The workflow deadline exists in code/tests.
- I could not verify it firing in live job rows.

### 7.4 Failures cluster around provider timeout and critic rejection, not grounding mismatch
Observed in both-artifact historical bucket:
- `provider_timeout`: `5`
- `critic_coverage`: `5`
- `worker_interrupted`: `2`
- `openapi_grounding`: `0` observed
- `prisma_grounding`: `0` observed

Interpretation:
- Full grounding appears to make the overall workflow less reliable, but the observed terminal failure is usually **timeout** or **critic rejection**, not a deterministic grounding-mismatch error.
- That suggests grounding is increasing constraint/repair complexity more than it is directly tripping the grounding validators in saved job errors.

### 7.5 Stage clustering is only partially observable
Observed:
- `cmms7jih00009up9cfla9yk5b` failed with `runtime.stage = repair_critic`.
- Many older failed rows still collapsed to `load_context`.

Interpretation:
- The best confirmed current failing stage is **repair critic**.
- For provider-timeout rows, the dominant failing stage is still **not recoverable** from the persisted metadata I inspected.

## 8. Coverage-classification findings

What “coverage issue” means in code:
- In [lib/packUx.ts](/Users/anweshsingh/Downloads/TraceCase/lib/packUx.ts), any error text containing `acceptance criteria` is labeled:
  - `Coverage issue`
  - `The repaired pack still missed requirement coverage and was rejected before save.`
- In [server/packs/generateAiPack.ts](/Users/anweshsingh/Downloads/TraceCase/server/packs/generateAiPack.ts), that error is thrown only when:
  - the critic still says `needs_work`, or coverage is incomplete,
  - after the single allowed repair attempt,
  - in `initial_critic` or `repair_critic` logic.

So the label is:
- **Accurate** as a description of the terminal condition.
- **Not the root cause** by itself.

What it is **not**:
- not deterministic pack schema validation failure
- not an OpenAPI grounding mismatch
- not a Prisma grounding mismatch
- not a dispatch/worker failure

Why it can still feel misleading:
- “Coverage issue” is the critic’s terminal judgment, but the deeper cause may be one of:
  - the model could not satisfy all criteria under the full grounding constraints,
  - the requirement is dense/ambiguous enough that one repair pass is insufficient,
  - the critic prompt is stricter than the generator can recover from within the one-repair cap.

## 9. Most likely root cause(s)

### Root cause 1: Full grounded generation + critic + one-repair cap is too fragile for dense auth requirements
Confidence: **high**

Evidence for:
- Effective artifact state `openapi+prisma` had **12/12 failures** in the last 40 jobs.
- Those failures split between timeout and critic rejection, which is what you expect from a brittle multi-call constrained workflow.
- The clearest current-code failure, `cmms7jih00009up9cfla9yk5b`, reached `repair_critic` and still failed coverage after repair.
- Grounding summaries are compact, so the more likely stressor is the combined constraint stack plus repair loop, not raw artifact size.

Evidence against:
- I did not complete a clean live-provider matrix across all five scenarios during this audit.
- I observed at least one historical successful openapi-only run and several prisma-only/no-artifact successes, so full failure is not universal across all grounded states.

### Root cause 2: Provider latency/timeouts still matter materially in the generation/critic chain
Confidence: **medium-high**

Evidence for:
- Five recent both-artifact failures are explicit provider timeouts.
- Historical timeout durations were often extremely long, indicating unstable upstream latency before the latest hardening.
- My attempted live-provider repro scripts also failed to complete in a practical audit window, even on compact temporary requirements.

Evidence against:
- Current local env is already using `gpt-5-mini` for both generation and critic.
- I did not observe a fresh post-hardening live job row with a cleanly preserved stage-specific provider timeout.

### Root cause 3: Historical retry/replay/metadata bugs amplified the problem and masked the real stage
Confidence: **high**

Evidence for:
- Multiple historical rows ran 20-110 minutes and either had `metadata_json = null` or `runtime.stage = load_context`.
- Current code now disables Inngest retries and tries to preserve persisted runtime, and newer failures are shorter.
- `cmms7jih...` preserving `repair_critic` after ~5 minutes is a strong signal that earlier observability failures were at least partly instrumentation/worker-history issues.

Evidence against:
- Even after the reliability hardening, the underlying critic-coverage failure remains.
- Therefore these bugs explain the *shape* and *duration* of older failures, but not the whole product problem.

## 10. Recommended next fixes (do not implement yet)

`1.` Add explicit stage enter/exit timestamps and compact input-size counters to `metadata_json.runtime`.
- Why it helps: it will separate generation-stage timeouts from critic-stage timeouts and show whether artifact counts or repair entry correlate with slow runs.
- Expected impact: high diagnostic value with minimal product risk.
- Risk: low.

`2.` Persist a compact failure-evidence block on failed OpenAI jobs, not only runtime.
- Why it helps: right now most failed rows lose critic details and grounding details, leaving only the terminal error string. Persisting safe summaries would make postmortems much easier.
- Expected impact: high diagnostic value; clarifies whether failures are timeout vs critic vs grounding.
- Risk: low-medium because metadata shape becomes richer, though DB schema does not change.

`3.` Run a controlled live experiment with the same dense requirement under four configurations: no artifacts, OpenAPI only, Prisma only, both.
- Why it helps: this is the cleanest way to separate “artifacts increase complexity” from “that specific requirement snapshot is just hard.”
- Expected impact: high; it would convert the strongest current correlation into a cleaner causal test.
- Risk: medium because it consumes provider time/cost.

`4.` Instrument repair-loop entry and exit explicitly.
- Why it helps: successful historical runs often show `attempts = 2`, and current failures also reach repair. Knowing how often jobs enter repair before timing out or failing coverage would sharpen the root-cause picture.
- Expected impact: medium-high.
- Risk: low.

`5.` Consider decomposing the monolithic generation into smaller subcalls only after the above instrumentation is in place.
- Why it helps: if the evidence continues to show fragility under full grounding + critic + repair, decomposition is the structural fix.
- Expected impact: potentially high.
- Risk: medium-high because it changes workflow design and may create new consistency issues.

## 11. Appendix

### Exact commands run

```bash
sed -n '1,360p' src/inngest/functions/generatePack.ts
sed -n '1,760p' server/packs/generateAiPack.ts
sed -n '1,280p' server/packs/critiquePack.ts
sed -n '1,260p' server/ai/openaiClient.ts
sed -n '1,260p' server/ai/openaiClientCore.ts
sed -n '1,220p' server/openapiGrounding.ts
sed -n '1,220p' server/prismaGrounding.ts
sed -n '1,240p' server/packs/validateOpenApiGrounding.ts
sed -n '1,320p' server/packs/validatePrismaGrounding.ts
sed -n '1,260p' server/artifactParsers.ts
sed -n '1,280p' server/pack-actions.ts
sed -n '281,420p' server/pack-actions.ts
sed -n '1,280p' lib/packUx.ts
sed -n '1,260p' lib/requirementArtifacts.ts
sed -n '1,260p' server/requirementArtifacts.ts
sed -n '1,240p' server/env.ts
sed -n '1,220p' server/packs/generationRunContext.ts
sed -n '1,220p' server/packs/generatePackFailure.ts
tail -n 120 docs/build-log.md
tail -n 120 context.md
```

```bash
npx dotenv-cli -e .env.local -- npx tsx -e '...recent job extraction with artifact rows...'
npx dotenv-cli -e .env.local -- npx tsx -e '...effective artifact state per job at job.created_at...'
npx dotenv-cli -e .env.local -- npx tsx -e '...snapshot source lengths + artifact content lengths...'
npx dotenv-cli -e .env.local -- npx tsx -e '...current env model config...'
npx dotenv-cli -e .env.local -- npx tsx -e '...successful jobs with/without prisma grounding metadata...'
npx dotenv-cli -e .env.local -- npx tsx -e '...failed jobs with preserved runtime stage...'
npx dotenv-cli -e .env.local -- npx tsx -e '...query for workflow deadline errors...'
npx dotenv-cli -e .env.local -- npx tsx -e '...query for live grounding-mismatch errors...'
```

```bash
NODE_OPTIONS='--require /tmp/tracecase-server-only-hook.cjs' \
NODE_PATH=/Users/anweshsingh/Downloads/TraceCase/node_modules \
  npx dotenv-cli -e .env.local -- npx tsx -e '...temporary selector repro for older-valid/latest-invalid snapshot chain...'
```

```bash
npm test
```

### Temporary diagnostic files used outside the repo
- `/tmp/tracecase-server-only-hook.cjs`
- `/tmp/tracecase_audit_repro.ts` (attempted full live matrix; aborted)
- `/tmp/tracecase_targeted_repro.ts` (attempted reduced live matrix; aborted)
- `/tmp/tracecase_job_bucket.ts`

No repo files were modified for diagnostics.

### Relevant job ids / snapshot ids

Key job ids inspected:
- `cmms7jih00009up9cfla9yk5b` — failed, `repair_critic`, both artifacts valid
- `cmms5r2600009upqsg7121a5u` — failed, coverage issue, runtime collapsed to `load_context`
- `cmms1npd90009upbbxwgpvk6y` — failed, coverage issue, runtime collapsed to `load_context`
- `cmmrzow61002pupmije3r5atn` — provider timeout, both artifacts valid
- `cmmql0yog006xuptg11s8td2a` — provider timeout, both artifacts valid
- `cmmq1ope6001fup4l3xodxwm6` — worker interrupted fallback
- `cmmo38r6g001lupkw8llkwwz4` — success, effective OpenAPI-only grounding
- `cmmmw65j800rtupcznqveez9j` — success, effective Prisma-only grounding
- `cmmff6ojy000dup3bwtrgqkm1` — success, no artifacts

Key snapshot ids inspected:
- `cmmd2puml009bupjt9ppbpx43` — requirement length `2518`; historical no-artifact, OpenAPI-only, and both-artifact periods
- `cmmi7ixho001vup0je4sag88y` — requirement length `2448`; historical Prisma-only and later both-artifact periods
- `cmmrzltiu000hupmi90kt7yos` — requirement length `2518`; both-artifact recent failures only

### Validation result
- `npm test` passed: `104 passed`, `0 failed`
