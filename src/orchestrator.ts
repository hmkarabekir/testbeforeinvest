import { randomUUID } from 'node:crypto';
import type {
  AudienceDatasetV1,
  CreativeVariantV1,
  SimulationPersonaV1,
  InferencePort,
  InferenceReceipt,
  ExperimentContext,
} from './core/types.js';
import { normalizeAudienceDataset } from './core/dataset-normalizer.js';
import { compilePersonaPanel } from './core/persona-compiler.js';
import {
  singleEvaluationPrompt,
  pairEvaluationPrompt,
  variantGenerationPrompt,
  creativeText,
} from './core/prompts.js';
import {
  LabEvaluationValidationError,
  validateSingleEvaluation,
  validatePairEvaluation,
  type SingleEvaluation,
  type PairEvaluation,
} from './core/evaluation-contract.js';
import { aggregateEvaluations } from './core/evaluation-aggregate.js';
import { AudienceLabEngine } from './inference/index.js';
import { LabInferenceError } from './inference/codex-cli.js';
import { experimentContext, normalizeExperimentVariant } from './core/experiment-input.js';
import { parseCreativeVariant } from './core/creative-variant.js';
import { analyzeExperiment } from './core/experiment-analysis.js';
import { analyzeAudience } from './core/audience-analysis.js';

type AggregateResult = ReturnType<typeof aggregateEvaluations>;
type PanelDecision = 'a' | 'b' | Exclude<AggregateResult['decision'], 'A' | 'B'>;
export type PanelMode = 'demo' | 'full';
export type AssessmentCall = {
  agentId: string;
  repeatIndex: number;
  assessment: 'a' | 'b' | 'pair';
  attempt: number;
  latencyMs: number;
  status: 'completed' | 'failed';
  errorCode?: string;
  validationIssue?: string;
  receipt: InferenceReceipt | null;
};
export type ExperimentResult = {
  experimentId: string;
  datasetHash: string;
  panelSize: number;
  panelMode: PanelMode;
  context: ExperimentContext;
  repeats: number;
  provider: string;
  model: string;
  evaluationMode: 'model-inference' | 'local-rules';
  provenance: {
    datasetSynthetic: boolean;
    panelSynthetic: true;
    weightBasis: AggregateResult['weightBasis'];
    sources: Array<{ id: string; platform: string; population: string; sampled: boolean; complete: boolean }>;
  };
  timing: { totalMs: number; concurrency: number; calls: AssessmentCall[] };
  aggregate: AggregateResult;
  analysis: ReturnType<typeof analyzeExperiment>;
  evaluations: Array<{ agentId: string; personaId: string; repeatIndex: number; singleA?: SingleEvaluation; singleB?: SingleEvaluation; pair?: PairEvaluation }>;
  creativeIssues: Array<{ agentId: string; repeatIndex: number; variantId: string; unsupportedClaims: string[] }>;
  variantA: CreativeVariantV1;
  variantB: CreativeVariantV1;
  summary: {
    decision: AggregateResult['decision'];
    winner: PanelDecision;
    votes: AggregateResult['preferencePercent'];
    averageScores: { a: number | null; b: number | null };
  };
  criterionComparison: Record<string, { a: number | null; b: number | null }>;
  segmentBreakdown: Array<{
    personaTitle: string;
    personaNeed: string;
    winner: PanelDecision;
    reasonA: string;
    reasonB: string;
    pairExplanation: string;
  }>;
};

export class AudienceLabOrchestrator {
  constructor(private readonly engine: InferencePort = new AudienceLabEngine()) {}

  /**
   * Compiles an audience panel (personas + 18 agent identities) from a dataset.
   */
  compilePanel(datasetInput: AudienceDatasetV1) {
    const normalized = normalizeAudienceDataset(datasetInput);
    const panel = compilePersonaPanel(datasetInput, { seed: 'audience-lab-seed' });
    return { dataset: normalized.dataset, personas: panel.personas, identities: panel.agents, datasetHash: normalized.datasetHash,
      analysis: analyzeAudience(normalized.dataset, panel.personas) };
  }

  /**
   * Automatically generates Variant B from Variant A using selected narrative angle.
   */
  async deriveVariantB(params: {
    dataset: AudienceDatasetV1;
    sourceVariantA: unknown;
    angle?: string;
    testedVariable?: string;
    context?: Partial<ExperimentContext>;
  }): Promise<{ variantB: CreativeVariantV1; changedElement: string; evaluationMode: string; model: string; latencyMs: number }> {
    const started = performance.now();
    const { dataset, angle = 'concise', testedVariable = 'hook' } = params;
    if (!['contrarian','story','concise','problem','actionable'].includes(angle)
      || !['hook','need-frame','proof','cta','length','bundle'].includes(testedVariable)) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    const normalizedInput = normalizeAudienceDataset(dataset).dataset;
    const source = normalizeExperimentVariant(params.sourceVariantA, normalizedInput, 'a');
    if (['screen','flow'].includes(source.format)) throw new Error('AUDIENCE_LAB_IMAGE_GENERATION_UNSUPPORTED');
    const product = dataset.products.find((p) => p.id === source.productId)!;
    const context = experimentContext(params.context);
    const prompt = variantGenerationPrompt({
      product, productFacts: product.facts, brief: dataset.brand.description,
      objective: context.objective, platform: source.platform, language: dataset.brand.language || 'tr',
      testedVariable, sourceVariantA: source, angle: angle as any,
    });
    const response = await this.engine.infer({ task: 'variant-generation', ...prompt, maxOutputTokens: 3500, requestId: randomUUID() });
    const value = response.value as any;
    if (!value || !Array.isArray(value.variants) || value.variants.length !== 2) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    const raw = value.variants[1];
    if (!raw || ['headline','body','callToAction'].some((field) => typeof raw[field] !== 'string'
      || value.variants[0]?.[field] !== source[field as 'headline' | 'body' | 'callToAction'])) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    const allowed: Record<string, string[]> = { hook:['headline'], 'need-frame':['headline','body'], proof:['body'], cta:['callToAction'], length:['body'], bundle:['headline','body','callToAction'] };
    const changed = ['headline','body','callToAction'].filter((field) => raw[field] !== source[field as 'headline' | 'body' | 'callToAction']);
    if (changed.some((field) => !allowed[testedVariable].includes(field))) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    let html = source.html;
    if (source.format === 'html') {
      if (response.receipt.provider === 'local-rules') {
        html = source.html;
        for (const field of changed) if (source[field as 'headline' | 'body' | 'callToAction']) html = html?.split(source[field as 'headline' | 'body' | 'callToAction']).join(raw[field]);
        if (html === source.html && testedVariable === 'bundle') html = `<div style="max-width:42rem;margin:0 auto;padding:24px;line-height:1.6">${html}</div>`;
      } else html = raw.html;
      if (typeof html !== 'string' || !html.trim() || html === source.html) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    } else if (!changed.length) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    const text = `${raw.headline}\n${raw.body}\n${raw.callToAction}`;
    const claims = Array.isArray(raw.productClaims) ? raw.productClaims : [];
    if (claims.some((claim: any) => typeof claim?.quote !== 'string' || !text.includes(claim.quote)
      || !product.facts.some((f) => f.id === claim.factRef && f.text.includes(claim.quote)))) throw new Error('AUDIENCE_LAB_DERIVATION_INVALID');
    const variantB = normalizeExperimentVariant({ ...source, ...raw, html, id: `variant-b-${randomUUID().slice(0,8)}`,
      productId: source.productId, platform: source.platform, format: source.format,
      images: source.images, visualDescription: source.visualDescription, testedVariable, generation: 'model',
    }, dataset, 'b');
    variantB.productClaims = claims;
    try {
      const { images: _images, referenceUrl: _referenceUrl, contentHash: _contentHash, claimValidation: _claimValidation, ...claimInput } = variantB;
      const checked = parseCreativeVariant({ ...claimInput, body: claimInput.body || 'HTML materyali', callToAction: claimInput.callToAction || 'Belirtilmedi' }, dataset);
      const unsupportedNewText = [source.headline, source.body, source.callToAction, ...product.facts.map((f) => f.text)]
        .filter(Boolean).sort((a,b) => b.length-a.length).reduce((value, passage) => value.split(passage).join(' '), text);
      if (/\d|%|₺|\$|€|ücretsiz|garantili|kesin sonuç|en ucuz|en iyi/iu.test(unsupportedNewText)) throw new Error('new-unsupported-claim');
      variantB.claimValidation = checked.claimValidation;
    } catch { throw new Error('AUDIENCE_LAB_DERIVATION_INVALID'); }
    return { variantB, changedElement: source.format === 'html' ? 'HTML ve seçilen içerik öğeleri' : changed.join(', '),
      evaluationMode: response.receipt.provider === 'local-rules' ? 'local-rules' : 'model-inference',
      model: response.receipt.requestedModel, latencyMs: Math.round(performance.now() - started) };
  }

  /** Evaluate independent identities with at most two concurrent CLI processes. */
  async runExperiment(params: {
    dataset: AudienceDatasetV1;
    variantA: unknown;
    variantB: unknown;
    context?: Partial<ExperimentContext>;
    repeats?: number;
    panelMode?: PanelMode;
    concurrency?: number;
    selectedPersonaIds?: string[];
  }): Promise<ExperimentResult> {
    const started = performance.now();
    const { dataset, repeats = 2, panelMode = 'full', concurrency = 2 } = params;
    const panel = this.compilePanel(dataset);
    const context = experimentContext(params.context);
    const variantA = normalizeExperimentVariant(params.variantA, dataset, 'a');
    const variantB = normalizeExperimentVariant(params.variantB, dataset, 'b');
    const selectedPersonaIds = params.selectedPersonaIds;
    if (selectedPersonaIds !== undefined && (!Array.isArray(selectedPersonaIds) || !selectedPersonaIds.length
      || new Set(selectedPersonaIds).size !== selectedPersonaIds.length
      || selectedPersonaIds.some(id => !panel.personas.some(persona => persona.id === id)))) {
      throw new Error('AUDIENCE_LAB_EXPERIMENT_INVALID');
    }
    if (!['demo', 'full'].includes(panelMode) || !Number.isInteger(repeats) || repeats < 1 || repeats > 6
      || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2
      || !variantA.id || !variantB.id || variantA.id === variantB.id || variantA.productId !== variantB.productId) {
      throw new Error('AUDIENCE_LAB_EXPERIMENT_INVALID');
    }
    if (variantA.contentHash === variantB.contentHash) throw new Error('AUDIENCE_LAB_IDENTICAL_VARIANTS');
    const normalizedDataset = panel.dataset;
    // One normal-attention identity per persona; never take the first six identities of the full panel.
    const selectedPersonas = selectedPersonaIds
      ? panel.personas.filter(persona => selectedPersonaIds.includes(persona.id))
      : panel.personas;
    const personas = panelMode === 'demo' ? selectedPersonas.slice(0, 6) : selectedPersonas;
    const identities = panelMode === 'demo'
      ? personas.map((p) => panel.identities.find((i) => i.personaId === p.id && i.scenario.attention === 'normal')!)
      : panel.identities.filter(identity => personas.some(persona => persona.id === identity.personaId));
    const product = normalizedDataset.products.find((p) => p.id === variantA.productId);
    if (!product) throw new Error('AUDIENCE_LAB_EXPERIMENT_INVALID');
    const config = this.engine.configuration();
    if (config.provider === 'local-rules' && (variantA.images?.length || variantB.images?.length)) {
      throw new Error('AUDIENCE_LAB_VISION_REQUIRES_MODEL');
    }
    const calls: AssessmentCall[] = [];
    type EvaluationRow = {
      agentId: string; personaId: string; repeatIndex: number;
      singleA?: SingleEvaluation; singleB?: SingleEvaluation; pair?: PairEvaluation;
    };
    const rows: EvaluationRow[][] = identities.map(() => []);

    const assess = async <T>(
      identityId: string, repeatIndex: number, assessment: AssessmentCall['assessment'],
      prompt: ReturnType<typeof singleEvaluationPrompt>, validate: (value: unknown) => T,
    ): Promise<T | undefined> => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const callStarted = performance.now();
        let receipt: InferenceReceipt | null = null;
        try {
          const result = await this.engine.infer({
            task: assessment === 'pair' ? 'pair-evaluation' : 'single-evaluation',
            ...prompt,
            system: prompt.system + (attempt > 1 ? '\nÖnceki yanıt sözleşmeyi geçmedi. Altı kriterin her birini tam bir kez kullan; alıntılar kesintisiz ve birebir reklamdan, claim id alanları yalnız karttan olmalıdır.' : ''),
            maxOutputTokens: assessment === 'pair' ? 1200 : 1800, requestId: randomUUID(),
          });
          receipt = result.receipt;
          if (receipt.provider !== config.provider || receipt.requestedModel !== config.model) {
            throw new Error('AUDIENCE_LAB_PROVIDER_MISMATCH');
          }
          const value = validate(result.value);
          calls.push({ agentId: identityId, repeatIndex, assessment, attempt,
            latencyMs: Math.max(1, Math.round(performance.now() - callStarted)), status: 'completed', receipt });
          return value;
        } catch (error) {
          const providerError = error instanceof LabInferenceError;
          const contractError = error instanceof LabEvaluationValidationError;
          if (providerError) receipt = error.receipt;
          const errorCode = error instanceof Error ? error.message : 'AUDIENCE_LAB_ASSESSMENT_FAILED';
          calls.push({ agentId: identityId, repeatIndex, assessment, attempt,
            latencyMs: Math.max(1, Math.round(performance.now() - callStarted)), status: 'failed', errorCode,
            ...(contractError ? { validationIssue: error.issue } : {}), receipt });
          // Authentication, unavailable models, configuration errors and programming errors fail visibly.
          if (!contractError && !(providerError && error.retryable)) throw error;
          // A failed assessment remains missing; never replace it with a local result or a zero score.
          if (attempt === 2) return undefined;
        }
      }
      return undefined;
    };

    const evaluateIdentity = async (index: number) => {
      const identity = identities[index];
      const persona = personas.find((p) => p.id === identity.personaId)!;
      const evaluationContext = {
        persona, identity, productFacts: product.facts,
        exposure: { ...context, platform: variantA.platform, language: identity.language },
      };
      for (let repeat = 0; repeat < repeats; repeat++) {
        const row: EvaluationRow = { agentId: identity.id, personaId: persona.id, repeatIndex: repeat };
        const single = async (creative: CreativeVariantV1, side: 'a' | 'b') => assess(
          identity.id, repeat, side, singleEvaluationPrompt({ ...evaluationContext, creative }),
          (value) => validateSingleEvaluation(value, {
            agentId: identity.id, exposureId: `exp-${side}-${identity.id}-${repeat}`,
            personaClaimIds: identity.knowledgeClaimIds, creativeText: creativeText(creative),
          }),
        );
        // Each call is stateless; alternate scheduling as well as pair presentation.
        if (repeat % 2) { row.singleB = await single(variantB, 'b'); row.singleA = await single(variantA, 'a'); }
        else { row.singleA = await single(variantA, 'a'); row.singleB = await single(variantB, 'b'); }
        const left = repeat % 2 ? variantB : variantA;
        const right = repeat % 2 ? variantA : variantB;
        row.pair = await assess(identity.id, repeat, 'pair', pairEvaluationPrompt({ ...evaluationContext, left, right }),
          (value) => validatePairEvaluation(value, {
            agentId: identity.id, exposureId: `exp-pair-${identity.id}-${repeat}`,
            leftVariantId: left.id, rightVariantId: right.id, personaClaimIds: identity.knowledgeClaimIds,
            leftText: creativeText(left), rightText: creativeText(right),
          }));
        rows[index].push(row);
      }
    };
    let cursor = 0;
    let fatal: unknown;
    let stopped = false;
    const worker = async () => {
      while (!stopped && cursor < identities.length) {
        const index = cursor++;
        try { await evaluateIdentity(index); }
        catch (error) { fatal = error; stopped = true; }
      }
    };
    // Wait for in-flight workers before returning an error; do not leave orphan work behind.
    await Promise.all(Array.from({ length: Math.min(concurrency, identities.length) }, worker));
    if (stopped) throw fatal;
    const evaluationResults = rows.flat();
    const agg = aggregateEvaluations({
      expectedAgents: identities.map((i) => ({ id: i.id, personaId: i.personaId })),
      expectedRepeats: repeats,
      personas: personas.map((p) => ({ id: p.id, weight: { value: 1 / personas.length, basis: 'equal-scenario' } })),
      results: evaluationResults, variantAId: variantA.id, variantBId: variantB.id,
    });
    const analysis = analyzeExperiment({ rows: evaluationResults, personas, aggregate: agg, variantA, variantB, context });
    const segmentBreakdown = personas.map((persona) => {
      const segment = agg.personas.find((p) => p.personaId === persona.id)!;
      const samples = evaluationResults.filter((r) => r.personaId === persona.id);
      const insight = analysis.segments.find(s => s.personaId === persona.id)!;
      let winner: PanelDecision = 'mixed';
      if (segment.completionRatio < 0.8 || segment.votes.insufficientContext >= 0.5) winner = 'insufficient-data';
      else if (samples.some((r) => r.singleA?.creativeStatus === 'invalid-creative' || r.singleB?.creativeStatus === 'invalid-creative')) winner = 'invalid-creative';
      else if (segment.votes.neither >= 0.5) winner = 'neither';
      else if (segment.votes.a > segment.votes.b) winner = 'a';
      else if (segment.votes.b > segment.votes.a) winner = 'b';
      else if (segment.votes.tie >= 0.25) winner = 'tie';
      return {
        personaTitle: persona.title, personaNeed: persona.needs[0] || 'Genel fayda', winner,
        reasonA: samples.find((r) => r.singleA)?.singleA?.reasons[0]?.explanation || 'Geçerli değerlendirme yok',
        reasonB: samples.find((r) => r.singleB)?.singleB?.reasons[0]?.explanation || 'Geçerli değerlendirme yok',
        pairExplanation: insight.representativeReason?.explanation || (insight.consensus === 'divided' ? 'Tekrarlarda farklı tercihler var.' : 'Geçerli karşılaştırma yok'),
      };
    });
    return {
      experimentId: `exp-${randomUUID()}`, datasetHash: panel.datasetHash,
      panelSize: identities.length, panelMode, context, repeats, provider: config.provider, model: config.model,
      evaluationMode: config.provider === 'local-rules' ? 'local-rules' : 'model-inference',
      provenance: {
        datasetSynthetic: normalizedDataset.synthetic, panelSynthetic: true, weightBasis: agg.weightBasis,
        sources: normalizedDataset.sources.map(({ id, platform, population, sampled, complete }) => ({ id, platform, population, sampled, complete })),
      },
      timing: { totalMs: Math.max(1, Math.round(performance.now() - started)), concurrency, calls },
      aggregate: agg,
      analysis,
      evaluations: evaluationResults,
      creativeIssues: evaluationResults.flatMap((r) => [
        ...(r.singleA?.unsupportedClaims.length ? [{ agentId: r.agentId, repeatIndex: r.repeatIndex, variantId: variantA.id, unsupportedClaims: r.singleA.unsupportedClaims }] : []),
        ...(r.singleB?.unsupportedClaims.length ? [{ agentId: r.agentId, repeatIndex: r.repeatIndex, variantId: variantB.id, unsupportedClaims: r.singleB.unsupportedClaims }] : []),
      ]),
      variantA, variantB,
      summary: {
        decision: agg.decision,
        winner: agg.decision === 'A' ? 'a' : agg.decision === 'B' ? 'b' : agg.decision,
        votes: agg.preferencePercent, averageScores: { a: agg.scores.a, b: agg.scores.b },
      },
      criterionComparison: Object.fromEntries(analysis.criteria.map(c => [c.criterion, { a: c.a, b: c.b }])),
      segmentBreakdown,
    };
  }
}
