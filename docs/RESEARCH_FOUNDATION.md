# Research foundation

Recorded: 2026-10-24. This document captures the user's direction for OctopIQ Audience Lab.

## Immediate goal: hackathon MVP

Read [Product scope](PRODUCT_SCOPE.md) for the user's clarified direction: generic A/B candidates across web, mobile, HTML, visuals, offers, and content. Story advertisements are an example. The current code's advertising-focused inputs and rubric are implementation limits to address, not the intended product boundary.

The user clarified that a working hackathon MVP is sufficient. Keep the research foundation while prioritizing a usable demonstration. The extended validation and calibration work below is not a prerequisite for that demonstration.

The intended evaluation model is `gpt-6-luna`, configured in the [Codex CLI adapter](../src/inference/codex-cli.ts). Live calls have now been exercised; see [the validation record](LUNA_VALIDATION.md). Automated tests use the local evaluator or mock CLI processes. Persona compilation remains rule-based; XGBoost components are present as a separate ML service and are outside this inference change.

Recommended MVP flow: product/audience input -> inspectable persona cards -> two creative variants -> Luna assessments -> panel preference with reasons and a suggested next edit.

MVP progress and remaining recommendations:

1. Live inference, output validation, per-call timing, and demo execution are implemented. The full panel retains 18 identities x 2 repeats x 3 assessments (108 tasks); demo mode selects one normal-attention identity per persona, up to six (36 tasks). Execution is bounded to two concurrent identities.
2. Give each comparison one explicit goal and one intended changed element. A hook comparison should keep the offer and CTA fixed; comparing whole concepts is also possible, but does not isolate why the preference changed.
3. Panel preference, diagnostics, and distinct inconclusive decisions are returned and displayed. Concrete creative revision suggestions remain a future enhancement.
4. Start the card-generation training track with a small set of reviewed input/card examples and a separate evaluation set. First measure what prompting with examples achieves. Training remains a planned track; whether it belongs inside the hackathon deadline depends on the event requirements and available data.

The proposed task split is an upstream analysis/card generator feeding the Luna evaluator. Training the card generator would improve a different capability from predicting real creative performance. No training job was run as part of the Luna pipeline work.

## Primary reference

Stefan Hut and Lorenzo Masoero (2026), **Can AI Agents Simulate A/B Test Outcomes? A Validation Framework for Agentic Experimentation**, COLM 2026.

- [Amazon Science publication](https://www.amazon.science/publications/can-ai-agents-simulate-a-b-test-outcomes-a-validation-framework-for-agentic-experimentation)
- [Full paper](https://cdn.amazon.science/d8/f7/0669d70a48ca903756a75cafad92/agentlabcolmdeanonymized-camera-readyv2-camera-ready-1.pdf)

The paper formalizes simulated randomized controlled trials (S-RCTs), separating behavioral approximation error from subsampling error. It studies historical validation, pre-period calibration, and within-subject estimation. Its 67-test marketing CTR benchmark does not establish reliable directional prediction merely from roughly 70% sign agreement. The reported calibration improvement concerns a 16-experiment subset. These are research results, not OctopIQ performance claims. See Sections 2-5 and Appendix A.

## Our product interpretation

We are building a research-informed tool for examining creative hypotheses before live experimentation. Its current evidence supports a description of synthetic panel preferences, rubric scores, and generated explanations. Predictive usefulness for our audience and use case remains to be measured.

Our current implementation is an adaptation under development, not a reproduction of the paper. The following requirements and development priorities are our engineering decisions.

## Implementation snapshot

This snapshot describes the working tree on 2026-10-24; verify it against code as development continues.

| Area | Current implementation | Consequence for our next work |
| --- | --- | --- |
| Audience representation | [Persona compiler](../src/core/persona-compiler.ts) builds thematic cards with equal scenario weights. [Agent identities](../src/core/agent-identity.ts) add three assumed cognitive contexts per card. | These are fictional scenarios, not one-to-one twins of experiment participants or measured population shares. |
| Exposure | [Orchestrator](../src/orchestrator.ts) evaluates A and B separately for each identity, alternating single-call scheduling and pair presentation order across repeats. | Order checks concern synthetic response consistency; they do not establish behavioral accuracy. |
| Outcome | [Evaluation contract](../src/core/evaluation-contract.ts) records criterion scores, intended actions, and pair preferences. | There is no implemented behavioral treatment-effect estimator or measured CTR prediction. An intended click remains model output. |
| Aggregation | [Aggregator](../src/core/evaluation-aggregate.ts) checks coverage, order consistency, and scenario weight sensitivity. Its decisions and diagnostics now pass through the API and UI. | Sensitivity is explicitly not a confidence interval. Missing responses remain missing and unsupported creatives are identified. |
| Data ingestion | [Social ingestion](../src/core/social-ingestion.ts) includes synthetic fallbacks and pixel event mapping. | A handle or source connection alone does not establish observed audience behavior. Preserve provenance through mixed-source imports. |
| Web events | [Pixel](../public/pixel.js) emits visitor events; [server](../src/server.ts) buffers them in memory. | Events lack a dedicated experiment assignment and exposure contract. Event counts alone cannot supply a validation benchmark. |
| Validation | [Standalone tests](../src/tests/standalone.spec.ts), [pipeline tests](../src/tests/luna-pipeline.spec.ts), and opt-in live checks cover software behavior and real transport. | Historical outcome validation and fitted pre-period calibration are not implemented. Passing these checks does not establish behavioral accuracy. |

## Research roadmap after the MVP

1. **Preserve result inspectability.** Keep evaluation mode, scenario weights, completion, order stability, warnings, and the original aggregate decision visible as the research capabilities grow.
2. **Define measurement before collecting benchmark data.** Specify the eligible audience, triggering rule, control/treatment, actual exposure, outcome window, metric denominator, and effect units. Store versioned experiment records and distinguish demo events from observations. Preserve native event meanings instead of reinterpreting every CTA click as a pricing view.
3. **Build an independent evaluation path.** Freeze the simulator configuration before scoring held-out historical experiments. Compare with simple baselines, account for historical uncertainty, and inspect segment coverage. Only report effect-error metrics when simulated and observed outcomes share a scale.
4. **Add calibration when suitable data exists.** Separate calibration inputs and labels from evaluation outcomes, version the fitted artifact, and retain raw and calibrated outputs. Do not relabel rubric scores as calibrated behavioral probabilities.

Until these capabilities are implemented and evaluated, describe a favored variant as the panel's preference. Keep predictive accuracy, causal uplift, and launch recommendations tied to evidence from our own validation.
