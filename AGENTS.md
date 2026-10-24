# Project context

OctopIQ Audience Lab is grounded in Hut and Masoero's 2026 research,
**Can AI Agents Simulate A/B Test Outcomes? A Validation Framework for Agentic Experimentation**.
This is an explicit product direction from the user, recorded on 2026-10-24.

Read [the research foundation](docs/RESEARCH_FOUNDATION.md) before changing
simulation methodology, audience ingestion, result interpretation, or product claims.

## Hackathon scope

- Read [the product scope](docs/PRODUCT_SCOPE.md). The product evaluates general A/B candidates: websites, mobile screens, flows, HTML, visuals, offers, and content. Story advertisements and headline rewriting are examples, not the product boundary.
- Comparison and generation are separate capabilities. The existing headline generator must not be described as editing images, applications, or full websites.
- Direct X integration was removed by user direction. Prefer a user-mediated Grok research report; keep cited public observations separate from model-generated audience hypotheses.
- The pixel may remain as a demo input populated with explicitly synthetic events. Do not present those events as measured user behavior or validation evidence.
- The immediate deliverable is a working hackathon MVP. Favor a complete, demonstrable flow and small reversible changes.
- The paper guides the design; full historical validation and calibration are later research work, not MVP completion gates.
- The selected evaluation model is `gpt-6-luna` through the existing Codex CLI adapter. Do not change it without a task-specific reason or user direction.
- Live Luna CLI inference was exercised on 2026-10-24; see [the validation record](docs/LUNA_VALIDATION.md) for outcomes and limits. Automated tests remain local or use mocked processes; live checks are opt-in.
- The user plans model training for analysis and persona card generation. Keep that upstream task separate from the Luna audience evaluation role; the training approach is not yet chosen.
- Proposals in the research note are recommendations, not authorization to expand the MVP or launch training jobs.

## Engineering decisions for this project

- Current output is an uncalibrated synthetic panel assessment. Preserve that distinction in API and UI work.
- Keep observed evidence, inferred signals, and assumed scenarios traceable and distinct.
- Repeated responses and fictional cognitive scenarios do not increase the number of real participants.
- Preserve fixed identities, isolated evaluations, order checks, and inconclusive outcomes.
- Require our own historical validation before claiming predictive accuracy or interpreting scores as CTR, conversion, or causal uplift.
- Treat the research roadmap as planned work; check the implementation before describing a capability as complete.

## Local verification

- Do not run real Luna inference or live demos unless the user explicitly asks again. The user requested token-free verification; use local rules and mocked providers.
- Latest ownership: the external agent handles UI; this agent handles backend, analysis, and ML. Preserve the existing XGBoost model, scores, defaults, and card capabilities. The user explicitly asked not to remove them. Prioritize a polished hackathon demo; do not expand this into a research/calibration project.
- The additive backend handoff is [UI API contract](docs/UI_API_CONTRACT.md). No extra model calls are required for the new analysis summaries.
- Persona card design should follow the Merts customer group/catalog cards and fictional avatar artwork under `merts/nextjs/src/components/customers`.
- Build: `npm run build`
- Tests: `npm test -- --runInBand`
- Live check (three assessments): `npm run smoke:luna`
- Live demo (up to six identities, two repeats): `npm run smoke:luna -- --demo`
