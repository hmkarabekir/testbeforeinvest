import { normalizeAudienceDataset } from './dataset-normalizer.js';
import type { AudienceDatasetV1, SimulationPersonaV1 } from './types.js';

/** Card/chart data from the same records that feed the evaluator; no extra inference. */
export function analyzeAudience(dataset: AudienceDatasetV1, personas: SimulationPersonaV1[]) {
  const normalized = normalizeAudienceDataset(dataset);
  return {
    schemaVersion: 1 as const,
    headline: `${dataset.brand.name} için ${personas.length} farklı karar senaryosu`,
    datasetHash: normalized.datasetHash,
    sources: normalized.populations.map(p => ({ sourceId: p.sourceRef, platform: p.platform, population: p.population,
      contentCount: p.contentCount, eventCounts: p.eventCounts, sourceLocalProfiles: p.profileCount,
      observationCount: p.observations.filter(o => o.status === 'observed' && o.value !== null).length,
      sampled: p.sampled, complete: p.complete })),
    cards: personas.map(persona => {
      const claims = [...persona.observedFacts, ...persona.derivedSignals, ...persona.assumptions];
      const counts = Object.fromEntries(['observed','declared','computed','inferred','assumed'].map(kind => [kind, claims.filter(c => c.kind === kind).length]));
      const audienceRefs = persona.evidenceRefs.filter(ref => /^(content|event|observation):/.test(ref));
      return { personaId: persona.id, title: persona.title, need: persona.needs[0], objections: persona.objections,
        scenarioWeightPercent: Math.round(persona.weight.value * 10_000) / 100,
        evidenceProfile: counts, audienceRecordCount: new Set(audienceRefs).size,
        support: audienceRefs.length ? 'source-context' : 'brief-scenario',
        evidence: persona.evidenceRefs.flatMap(ref => normalized.evidence[ref] ? [normalized.evidence[ref]] : []),
        testQuestion: `${persona.needs[0]} için hangi versiyon daha açık ve ikna edici?` };
    }),
    coverage: { ...normalized.summary, scenarioCount: personas.length },
    provenance: { datasetSynthetic: dataset.synthetic, cardGenerator: 'evidence-linked-rules', panelSynthetic: true,
      weightBasis: 'equal-scenario', populationSharesEstimated: false, modelCalls: 0 },
  };
}
