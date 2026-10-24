# Luna pipeline validation

Date: 2026-10-24. CLI: `codex-cli 0.164.0`. Requested model: `gpt-6-luna`.

## Live demo

Command: `node scripts/smoke-luna.cjs --demo` after `npm run build`.

The fixed synthetic software fixture supplied six normal-attention identities, one per persona. Each identity received separate A and B assessments and a pair assessment, repeated with presentation order reversed. Concurrency was limited to two identities.

| Measurement | Observed |
| --- | --- |
| Planned / valid tasks | 36 / 36 |
| Model calls / retries | 36 / 0 |
| Provider | Codex CLI for all 36 calls; no local evaluator calls |
| Total wall time | 174.224 seconds |
| Per-call latency, minimum / mean / maximum | 6.452 / 9.460 / 12.141 seconds |
| CLI usage reports | Present for all 36 calls |
| Aggregate decision | `mixed` |
| Consistency across reversed pair orders | 4 / 6 identities |
| Diagnostic | `ORDER_STABILITY_UNPROVEN` |

All responses passed the existing evaluation contract, and no unsupported creative claims were flagged in this run. The panel did not produce a stable recommendation. That outcome is preserved rather than changed to a tie or forced winner.

The CLI accepted the requested model and completed real inference. It did not report a separate returned-model identity; receipts therefore leave `returnedModel` null. Billing remains unknown. Token usage comes from CLI events, with unreported reasoning-token counts left null.

The [machine-readable record](validation/luna-demo-2026-10-24.json) includes the fixture hash, exact variants, per-call timings, provider usage, and aggregate diagnostics. The final three-assessment check also passed all contracts on its first attempts in 26.740 seconds. Initial exploratory runs exposed empty persona references and invalid excerpts; the final transport schema restricts references and literal excerpts without weakening the semantic validator.

## Software checks

- `npm run build`: passed.
- `npm test -- --runInBand`: two suites, 23 tests passed; zero failed.
- Coverage includes explicit engine selection, demo/full panels, bounded concurrency, reversed order, null scores, missing vote weight, original decisions, invalid JSON, provider rejection, rate limits, process failures, timeout termination, and temporary-file cleanup.
- Local HTTP demo: six identities, 36 calls, correct local-mode labeling; invalid repeat settings returned HTTP 400.
- Result-rendering checks: all seven decisions, mode labels, timing, and preservation of the missing-vote denominator passed. Inline browser scripts passed syntax checks.
- Visual browser inspection was unavailable because computer-use access to the browser was not approved. The rendering checks above execute the result renderer with a minimal DOM stand-in; they do not verify visual layout.
- Jest emits its existing NodeNext / isolatedModules configuration warning. It does not fail the test suite.

## Interpretation and reproduction

These checks establish real transport, contract compatibility, failure handling, and one measured runtime. They do not establish prediction accuracy against human behavior or implement historical calibration. Inference latency and panel preferences can vary between runs.

Run `npm run smoke:luna` for the smaller three-assessment check, or `npm run smoke:luna -- --demo` for the full demo. Live checks use the existing CLI authentication and are separate from deterministic automated tests. Selecting local rules in the UI runs the same panel flow without live model calls and labels the result accordingly.
