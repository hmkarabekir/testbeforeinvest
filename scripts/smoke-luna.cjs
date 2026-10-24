// Explicit, opt-in live check; never included in the deterministic test suite.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { AudienceLabEngine } = require('../dist/inference/index.js');
const { AudienceLabOrchestrator } = require('../dist/orchestrator.js');
const { singleEvaluationPrompt, pairEvaluationPrompt, creativeText } = require('../dist/core/prompts.js');
const { validateSingleEvaluation, validatePairEvaluation } = require('../dist/core/evaluation-contract.js');

async function main() {
  const dataset = JSON.parse(readFileSync(join(__dirname, '../src/fixtures/b2b-software.v1.json'), 'utf8'));
  const product = dataset.products[0];
  const common = {
    version: 1, productId: product.id, platform: 'instagram', format: 'text-ad',
    body: 'CSV ile veri içe aktarma. Kurulum kontrol listesi bulunur.', callToAction: 'Planı incele',
    testedVariable: 'hook', productFactRefs: product.facts.map((f) => f.id), assumptions: [],
    generation: 'manual', productClaims: [], claimValidation: 'supported', contentHash: '',
  };
  const variantA = { ...common, id: 'smoke-a', headline: 'CSV ile veri içe aktarma.' };
  const variantB = { ...common, id: 'smoke-b', headline: 'Kuruluma nereden başlarsınız?' };
  const engine = new AudienceLabEngine('codex');
  const config = engine.configuration();
  if (config.model !== 'gpt-6-luna') throw new Error('Smoke check requires AUDIENCE_LAB_MODEL=gpt-6-luna (or unset).');
  const orchestrator = new AudienceLabOrchestrator(engine);
  if (process.argv.includes('--demo')) {
    const result = await orchestrator.runExperiment({ dataset, variantA, variantB, panelMode: 'demo', repeats: 2, concurrency: 2 });
    console.log(JSON.stringify(result, null, 2));
    if (result.aggregate.completion.ratio !== 1) process.exitCode = 1;
    return;
  }
  const panel = orchestrator.compilePanel(dataset);
  const persona = panel.personas[0];
  const identity = panel.identities.find((i) => i.personaId === persona.id && i.scenario.attention === 'normal');
  const context = { persona, identity, productFacts: product.facts, exposure: { objective: 'consideration', platform: 'instagram', language: 'tr' } };
  const started = performance.now();
  const results = [];
  const attempts = [];
  const checkedInfer = async (task, prompt, validate) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await engine.infer({ task, ...prompt });
      try {
        const value = validate(result.value);
        attempts.push({ task, attempt, latencyMs: result.receipt.latencyMs, status: 'completed' });
        return { value, receipt: result.receipt };
      } catch (error) {
        if (process.env.AUDIENCE_LAB_SMOKE_DEBUG) writeFileSync(process.env.AUDIENCE_LAB_SMOKE_DEBUG, JSON.stringify({ task, value: result.value, input: JSON.parse(prompt.prompt) }, null, 2));
        attempts.push({ task, attempt, latencyMs: result.receipt.latencyMs, status: 'failed', code: error.message });
        if (attempt === 2) {
          error.receipt = result.receipt;
          error.attempts = attempts;
          throw error;
        }
      }
    }
  };
  for (const creative of [variantA, variantB]) {
    const prompt = singleEvaluationPrompt({ ...context, creative });
    const result = await checkedInfer('single-evaluation', prompt, (raw) => validateSingleEvaluation(raw, {
      agentId: identity.id, exposureId: creative.id, personaClaimIds: identity.knowledgeClaimIds, creativeText: creativeText(creative),
    }));
    results.push({ assessment: creative.id, value: result.value, receipt: result.receipt });
  }
  const prompt = pairEvaluationPrompt({ ...context, left: variantA, right: variantB });
  const result = await checkedInfer('pair-evaluation', prompt, (raw) => validatePairEvaluation(raw, {
    agentId: identity.id, exposureId: 'smoke-pair', leftVariantId: variantA.id, rightVariantId: variantB.id,
    personaClaimIds: identity.knowledgeClaimIds, leftText: creativeText(variantA), rightText: creativeText(variantB),
  }));
  results.push({ assessment: 'pair', value: result.value, receipt: result.receipt });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), evaluationMode: 'model-inference',
    requestedModel: config.model, datasetSynthetic: true, panelSynthetic: true, personaId: persona.id,
    totalMs: Math.round(performance.now() - started), attempts, results }, null, 2));
}
main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, receipt: error.receipt || null, attempts: error.attempts || [] }));
  process.exitCode = 1;
});
