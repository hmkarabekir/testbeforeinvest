import { aggregateEvaluations, type AggregateInput } from './evaluation-aggregate.js';
import { CRITERIA, CRITERION_WEIGHTS, type Criterion, type SingleEvaluation } from './evaluation-contract.js';
import { hashCanonical } from './dataset-normalizer.js';
import type { CreativeVariantV1, ExperimentContext, SimulationPersonaV1 } from './types.js';

export const CRITERION_LABELS: Record<Criterion, string> = {
  relevance: 'İhtiyaca uygunluk', credibility: 'Güven ve kanıt', clarity: 'Anlaşılabilirlik',
  objectionResolution: 'Tereddütleri giderme', attention: 'Dikkat ve hiyerarşi', ctaFit: 'Sonraki adım',
};
type Row = AggregateInput['results'][number];
type Aggregate = ReturnType<typeof aggregateEvaluations>;
const round = (n: number) => Math.round(n * 100) / 100;
const usable = (v?: SingleEvaluation): v is SingleEvaluation => Boolean(v
  && v.creativeStatus === 'supported' && !v.unsupportedClaims.length && v.intendedAction !== 'insufficient_context');
const sideOf = (row: Row, aId: string) => !row.pair ? 'missing' : row.pair.preferredVariantId
  ? row.pair.preferredVariantId === aId ? 'a' : 'b' : row.pair.preference;

/** Summarizes already validated assessments. This stage makes no extra model calls. */
export function analyzeExperiment(input: {
  rows: Row[]; personas: SimulationPersonaV1[]; aggregate: Aggregate;
  variantA: CreativeVariantV1; variantB: CreativeVariantV1; context: ExperimentContext;
}) {
  const { rows, personas, aggregate: agg, variantA: a, variantB: b, context } = input;
  const claimIndex = new Map(personas.flatMap(p => [...p.observedFacts, ...p.derivedSignals, ...p.assumptions]
    .map(claim => [claim.id, { ...claim, personaId: p.id }] as const)));
  const evidence = (criterion: Criterion, side: 'a' | 'b', subset: Row[] = rows) => {
    const examples = new Map<string, {
      id: string; personaId: string; variantId: string; criterion: Criterion; excerpt: string;
      explanation: string; occurrences: number; exposureIds: string[];
      claims: Array<{ id: string; kind: string; text: string; evidenceRefs: string[] }>;
    }>();
    for (const row of subset) {
      const v = side === 'a' ? row.singleA : row.singleB;
      if (!usable(v)) continue;
      const reason = v.reasons.find(r => r.criterion === criterion);
      if (!reason) continue;
      const key = hashCanonical([row.personaId, reason.creativeExcerpt, reason.explanation, [...reason.personaClaimIds].sort()]);
      const prior = examples.get(key);
      if (prior) { prior.occurrences++; prior.exposureIds.push(v.exposureId); continue; }
      examples.set(key, {
        id: `${v.exposureId}:${criterion}`, personaId: row.personaId, variantId: side === 'a' ? a.id : b.id,
        criterion, excerpt: reason.creativeExcerpt, explanation: reason.explanation, occurrences: 1, exposureIds: [v.exposureId],
        claims: reason.personaClaimIds.flatMap(id => {
          const claim = claimIndex.get(id);
          return claim ? [{ id: claim.id, kind: claim.kind, text: claim.text, evidenceRefs: claim.evidenceRefs }] : [];
        }),
      });
    }
    return [...examples.values()].sort((x, y) => y.occurrences - x.occurrences || x.id.localeCompare(y.id)).slice(0, 4);
  };
  const criteriaFor = (subset: Row[]) => {
    const common = subset.filter(r => usable(r.singleA) && usable(r.singleB));
    const weighted = common.map(row => {
      const p = agg.personas.find(p => p.personaId === row.personaId)!;
      return { row, weight: p.weight / (p.expectedTasks / 3) };
    });
    const coverageWeight = weighted.reduce((sum, r) => sum + r.weight, 0);
    return CRITERIA.map(criterion => {
      const mean = (side: 'singleA' | 'singleB') => coverageWeight ? round(weighted.reduce((sum, r) =>
        sum + r.weight * r.row[side]!.criterionScores[criterion], 0) / coverageWeight) : null;
      const scoreA = mean('singleA'), scoreB = mean('singleB');
      const delta = scoreA === null || scoreB === null ? null : round(scoreB - scoreA);
      return { criterion, label: CRITERION_LABELS[criterion], a: scoreA, b: scoreB, delta,
        advantage: delta === null ? null : delta > 0 ? 'b' as const : delta < 0 ? 'a' as const : 'tie' as const,
        rubricWeight: CRITERION_WEIGHTS[criterion], commonAssessments: common.length,
        commonPanelWeight: round(coverageWeight), evidenceA: evidence(criterion, 'a', common), evidenceB: evidence(criterion, 'b', common) };
    });
  };
  const criteria = criteriaFor(rows);
  const unanswered = new Map<string, { question: string; variants: string[]; personaIds: string[]; exposureIds: string[]; occurrences: number }>();
  for (const row of rows) for (const [side, v] of [['a', row.singleA], ['b', row.singleB]] as const) {
    for (const question of v?.unansweredQuestions || []) {
      const key = question.trim().toLocaleLowerCase('tr');
      const item = unanswered.get(key) || { question, variants: [], personaIds: [], exposureIds: [], occurrences: 0 };
      item.occurrences++; item.variants.push(side === 'a' ? a.id : b.id); item.personaIds.push(row.personaId); item.exposureIds.push(v!.exposureId);
      unanswered.set(key, item);
    }
  }
  const questions = [...unanswered.values()].map(q => ({ ...q, variants: [...new Set(q.variants)], personaIds: [...new Set(q.personaIds)] }))
    .sort((x, y) => y.personaIds.length - x.personaIds.length || y.occurrences - x.occurrences).slice(0, 8);
  const segments = personas.map(persona => {
    const subset = rows.filter(r => r.personaId === persona.id);
    const aggregate = agg.personas.find(p => p.personaId === persona.id)!;
    const pairs = subset.filter(r => r.pair);
    const distribution: Record<string, number> = {};
    for (const row of pairs) { const vote = sideOf(row, a.id); distribution[vote] = (distribution[vote] || 0) + 1; }
    const largest = Math.max(0, ...Object.values(distribution));
    const leaders = Object.keys(distribution).filter(key => distribution[key] === largest);
    const preference = leaders.length === 1 ? leaders[0] : pairs.length ? 'mixed' : 'missing';
    const representative = pairs.find(r => sideOf(r, a.id) === preference)?.pair || null;
    const counterExamples = pairs.filter(r => sideOf(r, a.id) !== preference).map(r => ({
      exposureId: r.pair!.exposureId, preference: sideOf(r, a.id), explanation: r.pair!.explanation,
    })).slice(0, 3);
    const segmentCriteria = criteriaFor(subset);
    return {
      personaId: persona.id, title: persona.title, need: persona.needs[0], objections: persona.objections,
      preference, votes: aggregate.votes, scoreA: aggregate.scoreA, scoreB: aggregate.scoreB,
      assessmentCount: pairs.length, agreementRatio: pairs.length ? round(largest / pairs.length) : null,
      consensus: pairs.length === 0 ? 'missing' : leaders.length > 1 ? 'divided' : largest === pairs.length ? 'unanimous' : 'majority',
      representativeReason: representative ? { exposureId: representative.exposureId, explanation: representative.explanation,
        excerptA: representative.leftVariantId === a.id ? representative.leftExcerpt : representative.rightExcerpt,
        excerptB: representative.leftVariantId === b.id ? representative.leftExcerpt : representative.rightExcerpt,
        claimIds: representative.personaClaimIds } : null,
      counterExamples, criteria: segmentCriteria,
      drivers: [...segmentCriteria].filter(c => c.delta !== null && c.delta !== 0)
        .sort((x, y) => Math.abs(y.delta!) * y.rubricWeight - Math.abs(x.delta!) * x.rubricWeight).slice(0, 2),
    };
  });
  const changedFields = (['headline', 'body', 'callToAction', 'format', 'platform', 'html', 'visualDescription', 'referenceUrl'] as const)
    .filter(key => (a[key] || '') !== (b[key] || '')) as string[];
  // Attachment names are labels, not image content.
  if (hashCanonical((a.images || []).map(i => [i.mimeType, i.data])) !== hashCanonical((b.images || []).map(i => [i.mimeType, i.data]))) changedFields.push('images');
  const drivers = [...criteria].filter(c => c.delta !== null && c.delta !== 0)
    .sort((x, y) => Math.abs(y.delta!) * y.rubricWeight - Math.abs(x.delta!) * x.rubricWeight).slice(0, 3);
  const headlines: Record<Aggregate['decision'], string> = {
    A: 'A bu panelde öne çıkıyor.', B: 'B bu panelde öne çıkıyor.', mixed: 'Tercih, müşteri ihtiyacına göre değişiyor.',
    tie: 'İki versiyon birbirine yakın.', neither: 'İki versiyon da temel beklentileri karşılamıyor.',
    'insufficient-data': 'Kararı tamamlamak için daha fazla bağlam gerekiyor.', 'invalid-creative': 'Kararı etkileyen ürün vaatleri kontrol edilmeli.',
  };
  const edits: Array<{ id: string; priority: number; variantId: string | null; criterion: Criterion | null; title: string; instruction: string; reason: string; evidenceIds: string[] }> = [];
  const invalid = rows.flatMap(r => [r.singleA, r.singleB].filter((v): v is SingleEvaluation => Boolean(v?.unsupportedClaims.length)));
  if (invalid.length) edits.push({ id: 'verify-claims', priority: 1, variantId: null, criterion: null,
    title: 'Ürün vaadini somutlaştır', instruction: 'Kaynağı bulunmayan vaatleri ürün bilgisiyle eşleştir veya metni düzelt.',
    reason: invalid.flatMap(v => v.unsupportedClaims).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 3).join(' '),
    evidenceIds: invalid.map(v => v.exposureId) });
  const editCopy: Record<Criterion, [string, string]> = {
    relevance: ['İlk mesajı ihtiyaca bağla', `İlk görülen öğede “${context.task}” görevini ve ilgili ihtiyacı açıklaştır.`],
    credibility: ['İddiayı kanıtla eşleştir', 'Belirsiz vaat yerine mevcut ürün bilgisinden somut bir özellik veya koşul göster.'],
    clarity: ['Ana mesajı sadeleştir', 'Tek ana mesaj kullan; karar için gereken bilgiyi kısa, anlaşılır bir sıraya koy.'],
    objectionResolution: ['Karar öncesi tereddüdü gider', 'Panelin açık bıraktığı soruyu ilgili karar adımının yanında yanıtla.'],
    attention: ['Görsel önceliği belirginleştir', 'Görev için en önemli öğeyi öne çıkar; onunla yarışan ikincil içeriği azalt.'],
    ctaFit: ['Sonraki adımı açıklaştır', 'Eylem metninde kullanıcının sonraki adımda ne göreceğini veya yapacağını belirt.'],
  };
  const target = agg.decision === 'A' ? 'b' : agg.decision === 'B' ? 'a' : null;
  const weaknesses = criteria.filter(c => c.a !== null && c.b !== null).map(c => ({ c, side: target || (c.a! <= c.b! ? 'a' as const : 'b' as const) }))
    .filter(({ c, side }) => c[side]! < 3).sort((x, y) => x.c[x.side]! - y.c[y.side]! || y.c.rubricWeight - x.c.rubricWeight);
  for (const { c, side } of weaknesses.slice(0, 3)) {
    const reasons = side === 'a' ? c.evidenceA : c.evidenceB;
    edits.push({ id: `edit-${side}-${c.criterion}`, priority: edits.length + 1, variantId: side === 'a' ? a.id : b.id,
      criterion: c.criterion, title: editCopy[c.criterion][0], instruction: editCopy[c.criterion][1],
      reason: reasons[0]?.explanation || c.label, evidenceIds: reasons.map(r => r.id) });
  }
  return {
    schemaVersion: 1 as const, method: 'validated-assessment-summary-v1' as const, headline: headlines[agg.decision],
    decision: agg.decision, recommendedVariantId: agg.recommendation,
    preferenceGapPoints: round(agg.preferencePercent.b - agg.preferencePercent.a),
    criteria, drivers, segments, unansweredQuestions: questions, nextEdits: edits,
    design: { declaredChange: context.changedElement, changedFields,
      comparisonScope: changedFields.length === 1 && !['html', 'images'].includes(changedFields[0]) ? 'single-field' : 'whole-experience',
      htmlRendered: false, externalUrlsFetched: false, imageInputs: { a: a.images?.length || 0, b: b.images?.length || 0 } },
    diagnostics: { warnings: agg.warnings, coverage: agg.completion.ratio, orderStability: agg.orderStability,
      missingPairWeightPercent: agg.preferencePercent.missing,
      dividedSegments: segments.filter(s => s.consensus === 'divided' || s.consensus === 'majority').map(s => s.personaId) },
    provenance: { syntheticPanel: true, calibrated: false, behavioralPrediction: false,
      additionalModelCalls: 0, repeatedAssessmentsAreIndependentPeople: false },
  };
}
