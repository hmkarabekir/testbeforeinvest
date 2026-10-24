import { randomUUID } from 'node:crypto';
import type {
  AudienceDatasetV1,
  CreativeVariantV1,
  SimulationPersonaV1,
  AgentIdentityV1,
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
  validateSingleEvaluation,
  validatePairEvaluation,
  type SingleEvaluation,
  type PairEvaluation,
} from './core/evaluation-contract.js';
import { aggregateEvaluations } from './core/evaluation-aggregate.js';
import { AudienceLabEngine } from './inference/index.js';

export type ExperimentResult = {
  experimentId: string;
  datasetHash: string;
  panelSize: number;
  provider: string;
  model: string;
  variantA: CreativeVariantV1;
  variantB: CreativeVariantV1;
  summary: {
    winner: 'a' | 'b' | 'tie' | 'neither' | 'insufficient_context';
    votes: {
      a: number;
      b: number;
      tie: number;
      neither: number;
    };
    averageScores: {
      a: number;
      b: number;
    };
  };
  criterionComparison: Record<string, { a: number; b: number }>;
  segmentBreakdown: Array<{
    personaTitle: string;
    personaNeed: string;
    winner: 'a' | 'b' | 'tie' | 'neither';
    reasonA: string;
    reasonB: string;
    pairExplanation: string;
  }>;
};

export class AudienceLabOrchestrator {
  constructor(private readonly engine = new AudienceLabEngine()) {}

  /**
   * Compiles an audience panel (personas + 18 agent identities) from a dataset.
   */
  compilePanel(datasetInput: AudienceDatasetV1) {
    const normalized = normalizeAudienceDataset(datasetInput);
    const panel = compilePersonaPanel(datasetInput, { seed: 'audience-lab-seed' });
    return { dataset: normalized.dataset, personas: panel.personas, identities: panel.agents, datasetHash: normalized.datasetHash };
  }

  /**
   * Automatically generates Variant B from Variant A using selected narrative angle.
   */
  async deriveVariantB(params: {
    dataset: AudienceDatasetV1;
    sourceVariantA: CreativeVariantV1;
    angle?: string;
    testedVariable?: string;
  }): Promise<{ variantB: CreativeVariantV1; changedElement: string }> {
    const { dataset, sourceVariantA, angle = 'contrarian', testedVariable = 'hook' } = params;
    const product = dataset.products.find((p) => p.id === sourceVariantA.productId) || dataset.products[0];
    const productFacts = product?.facts || [];

    const promptObj = variantGenerationPrompt({
      product,
      productFacts,
      brief: dataset.brand.description,
      objective: 'consideration',
      platform: sourceVariantA.platform || 'instagram',
      language: dataset.brand.language || 'tr',
      testedVariable,
      sourceVariantA: sourceVariantA as any,
      angle: angle as any,
    });

    const result = await this.engine.infer({
      task: 'variant-generation',
      system: promptObj.system,
      prompt: promptObj.prompt,
      maxOutputTokens: 2500,
      requestId: randomUUID(),
    });

    const val = result.value as { variants: any[]; changedElement: string };
    const rawB = val.variants?.[1] || val.variants?.[0] || {};

    const variantB: CreativeVariantV1 = {
      id: `variant-b-${randomUUID().slice(0, 8)}`,
      version: 1,
      productId: sourceVariantA.productId,
      platform: sourceVariantA.platform,
      format: sourceVariantA.format,
      headline: rawB.headline || sourceVariantA.headline,
      body: rawB.body || sourceVariantA.body,
      callToAction: rawB.callToAction || sourceVariantA.callToAction,
      testedVariable,
      productFactRefs: sourceVariantA.productFactRefs,
      assumptions: [],
      generation: 'model',
      productClaims: rawB.productClaims || [],
      claimValidation: 'supported',
      contentHash: '',
      visualDescription: rawB.visualDescription || sourceVariantA.visualDescription,
      mediaUrl: sourceVariantA.mediaUrl,
    };

    return { variantB, changedElement: val.changedElement || 'Narrative Angle' };
  }

  /**
   * Executes a full, counterbalanced A/B experiment across all agents in the panel.
   */
  async runExperiment(params: {
    dataset: AudienceDatasetV1;
    variantA: CreativeVariantV1;
    variantB: CreativeVariantV1;
    repeats?: number;
  }): Promise<ExperimentResult> {
    const { dataset, variantA, variantB, repeats = 2 } = params;
    const { dataset: normalizedDataset, personas, identities, datasetHash } = this.compilePanel(dataset);
    const product = dataset.products.find((p) => p.id === variantA.productId) || dataset.products[0];
    const productFacts = product?.facts || [];
    const config = this.engine.configuration();

    const evaluationResults: Array<{
      agentId: string;
      personaId: string;
      repeatIndex: number;
      singleA?: SingleEvaluation;
      singleB?: SingleEvaluation;
      pair?: PairEvaluation;
    }> = [];

    const segmentSummaries: Map<string, { persona: SimulationPersonaV1; singleA?: SingleEvaluation; singleB?: SingleEvaluation; pair?: PairEvaluation }> = new Map();

    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const identity of identities) {
        const persona = personas.find((p: any) => p.id === identity.personaId)!;
        const exposure = {
          objective: 'consideration' as const,
          platform: variantA.platform,
          language: identity.language,
        };
        const commonContext = {
          persona: persona as any,
          identity: identity as any,
          productFacts,
          exposure,
        };

        // 1. Single evaluation A
        const promptA = singleEvaluationPrompt({ ...commonContext, creative: variantA });
        const resA = await this.engine.infer({
          task: 'single-evaluation',
          system: promptA.system,
          prompt: promptA.prompt,
          maxOutputTokens: 1800,
          requestId: randomUUID(),
        });
        const stampedSingleA = validateSingleEvaluation(resA.value, {
          agentId: identity.id,
          exposureId: `exp-a-${identity.id}-${repeat}`,
          personaClaimIds: identity.knowledgeClaimIds,
          creativeText: creativeText(variantA),
        });

        // 2. Single evaluation B
        const promptB = singleEvaluationPrompt({ ...commonContext, creative: variantB });
        const resB = await this.engine.infer({
          task: 'single-evaluation',
          system: promptB.system,
          prompt: promptB.prompt,
          maxOutputTokens: 1800,
          requestId: randomUUID(),
        });
        const stampedSingleB = validateSingleEvaluation(resB.value, {
          agentId: identity.id,
          exposureId: `exp-b-${identity.id}-${repeat}`,
          personaClaimIds: identity.knowledgeClaimIds,
          creativeText: creativeText(variantB),
        });

        // 3. Counterbalanced pair evaluation (order flip)
        const flipped = repeat % 2 === 1;
        const left = flipped ? variantB : variantA;
        const right = flipped ? variantA : variantB;
        const promptPair = pairEvaluationPrompt({ ...commonContext, left, right });
        const resPair = await this.engine.infer({
          task: 'pair-evaluation',
          system: promptPair.system,
          prompt: promptPair.prompt,
          maxOutputTokens: 1200,
          requestId: randomUUID(),
        });
        const stampedPair = validatePairEvaluation(resPair.value, {
          agentId: identity.id,
          exposureId: `exp-pair-${identity.id}-${repeat}`,
          leftVariantId: left.id,
          rightVariantId: right.id,
          personaClaimIds: identity.knowledgeClaimIds,
          leftText: creativeText(left),
          rightText: creativeText(right),
        });

        evaluationResults.push({
          agentId: identity.id,
          personaId: persona.id,
          repeatIndex: repeat,
          singleA: stampedSingleA as any,
          singleB: stampedSingleB as any,
          pair: stampedPair as any,
        });

        if (!segmentSummaries.has(persona.id)) {
          segmentSummaries.set(persona.id, {
            persona,
            singleA: stampedSingleA as any,
            singleB: stampedSingleB as any,
            pair: stampedPair as any,
          });
        }
      }
    }

    // Aggregate statistics
    const agg = aggregateEvaluations({
      expectedAgents: identities.map((i) => ({ id: i.id, personaId: i.personaId })),
      expectedRepeats: repeats,
      personas: personas.map((p: any) => ({
        id: p.id,
        weight: { value: 1 / personas.length, basis: 'equal-scenario' },
      })),
      results: evaluationResults,
      variantAId: variantA.id,
      variantBId: variantB.id,
    });

    const count = evaluationResults.length || 1;
    const avgScoreA = Math.round(evaluationResults.reduce((sum, r) => sum + (r.singleA?.score || 0), 0) / count);
    const avgScoreB = Math.round(evaluationResults.reduce((sum, r) => sum + (r.singleB?.score || 0), 0) / count);

    const calcCriterion = (key: keyof SingleEvaluation['criterionScores']) => {
      const a = Math.round((evaluationResults.reduce((sum, r) => sum + (r.singleA?.criterionScores?.[key] || 0), 0) / count) * 10) / 10;
      const b = Math.round((evaluationResults.reduce((sum, r) => sum + (r.singleB?.criterionScores?.[key] || 0), 0) / count) * 10) / 10;
      return { a, b };
    };

    const votes = {
      a: Math.round(agg.preferencePercent.a || 0),
      b: Math.round(agg.preferencePercent.b || 0),
      tie: Math.round(agg.preferencePercent.tie || 0),
      neither: Math.round(agg.preferencePercent.neither || 0),
    };

    let winner: ExperimentResult['summary']['winner'] = 'tie';
    if (agg.decision === 'A') winner = 'a';
    else if (agg.decision === 'B') winner = 'b';
    else if (agg.decision === 'neither') winner = 'neither';
    else winner = 'tie';

    const segmentBreakdown = Array.from(segmentSummaries.values()).map(({ persona, singleA, singleB, pair }) => {
      let segWinner: 'a' | 'b' | 'tie' | 'neither' = 'tie';
      if (pair?.preferredVariantId === variantA.id) segWinner = 'a';
      else if (pair?.preferredVariantId === variantB.id) segWinner = 'b';
      else if (pair?.preference === 'neither') segWinner = 'neither';

      return {
        personaTitle: persona.title,
        personaNeed: persona.needs[0] || 'Genel fayda',
        winner: segWinner,
        reasonA: singleA?.reasons?.[0]?.explanation || 'Değerlendirildi',
        reasonB: singleB?.reasons?.[0]?.explanation || 'Değerlendirildi',
        pairExplanation: pair?.explanation || 'Karşılaştırıldı',
      };
    });

    return {
      experimentId: `exp-${randomUUID()}`,
      datasetHash,
      panelSize: identities.length,
      provider: config.provider,
      model: config.model,
      variantA,
      variantB,
      summary: {
        winner,
        votes,
        averageScores: {
          a: agg.scores.a ?? avgScoreA,
          b: agg.scores.b ?? avgScoreB,
        },
      },
      criterionComparison: {
        relevance: calcCriterion('relevance'),
        credibility: calcCriterion('credibility'),
        clarity: calcCriterion('clarity'),
        objectionResolution: calcCriterion('objectionResolution'),
        attention: calcCriterion('attention'),
        ctaFit: calcCriterion('ctaFit'),
      },
      segmentBreakdown,
    };
  }
}
