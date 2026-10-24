import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { AudienceDatasetV1 } from '../core/types.js';
import { parseAudienceDataset } from '../core/dataset-contract.js';

export const ML_FEATURE_NAMES = ['ig_followers_log','ig_engagement_rate','ig_male_ratio','ig_top_age_idx',
  'ig_story_interaction_rate','x_followers_log','x_tech_density','x_retweet_ratio','x_critique_ratio',
  'pixel_events_log','pixel_cta_ratio','pixel_avg_dwell_sec','pixel_scroll_depth','category_idx','has_proof_facts','has_code_snippet'] as const;
export class PersonaModelError extends Error {
  constructor(readonly code: string, readonly status: number = 500) { super(code); }
}
export type FeatureReport = {
  values: Record<string, number>;
  features: Array<{ name: string; value: number; basis: 'computed' | 'observed' | 'assumed'; evidenceRefs: string[] }>;
  measuredOrComputedFeatures: number;
  assumedFeatures: number;
  datasetSynthetic: boolean;
};

export type XgBoostReceipt = {
  contract: string;
  status: 'trained' | 'pending';
  engine: string;
  trainedAt: string;
  trainingDurationSec: number;
  dataset: {
    totalSamples: number;
    trainSamples: number;
    testSamples: number;
    featuresCount: number;
    featureNames: string[];
  };
  metrics: {
    testAccuracy: number;
    testLogLoss: number;
    topFeature: string;
  };
  featureImportances: Array<{ feature: string; importance: number }>;
  personaBreakdown: Array<{ index: number; label: string; support: number; accuracy: number }>;
  artifact: {
    filename: string;
    sha256: string;
    sizeBytes: number;
  };
  provenance?: { trainingData: 'synthetic'; target: 'synthetic-persona-class'; behavioralValidation: false; artifactVerified: boolean };
};

export type PersonaPrediction = {
  dominantPersona: string;
  dominantIndex: number;
  personaScores: Array<{
    index: number;
    label: string;
    probability: number;
    isDominant: boolean;
    recommendedWeight: number;
  }>;
  featuresUsed: Record<string, number>;
  model?: { artifactHash: string; engine: string; latencyMs: number };
  provenance?: { trainingData: 'synthetic'; scoreMeaning: 'model-class-probability'; populationShare: false; calibratedBehavior: false };
  featureReport?: FeatureReport;
  diagnostics?: { entropy: number; topTwoMargin: number; separation: 'close' | 'clear'; inputBasis: 'dataset' | 'supplied-features' };
};

export class XgBoostPersonaService {
  private artifactDir: string;
  private readonly rootDir: string;
  private readonly pythonBin: string;
  private readonly timeoutMs: number;
  private training = false;

  constructor(options: { rootDir?: string; artifactDir?: string; pythonBin?: string; timeoutMs?: number } = {}) {
    this.rootDir = options.rootDir || resolve(__dirname, '../..');
    this.artifactDir = options.artifactDir || join(this.rootDir, 'ml', 'artifacts');
    const localPython = join(this.rootDir, '.venv', 'bin', 'python');
    const existingDemoPython = resolve(this.rootDir, '../merts/.local/venvs/adset-day/bin/python');
    this.pythonBin = options.pythonBin || process.env.AUDIENCE_LAB_PYTHON
      || (existsSync(localPython) ? localPython : existsSync(existingDemoPython) ? existingDemoPython : 'python3');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) throw new PersonaModelError('ML_TIMEOUT_INVALID', 400);
  }

  public getReceipt(): XgBoostReceipt | null {
    const receiptPath = join(this.artifactDir, 'training_receipt.json');
    if (!existsSync(receiptPath)) return null;
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as XgBoostReceipt;
      const modelPath = join(this.artifactDir, 'xgboost_persona_model.json');
      if (receipt.status !== 'trained' || !receipt.artifact?.sha256 || !existsSync(modelPath)
        || receipt.dataset?.featureNames?.join(',') !== ML_FEATURE_NAMES.join(',')) return null;
      const actualHash = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
      if (actualHash !== receipt.artifact.sha256) return null;
      return { ...receipt, provenance: { trainingData: 'synthetic', target: 'synthetic-persona-class', behavioralValidation: false, artifactVerified: true } };
    } catch {
      return null;
    }
  }

  public async train(numSamples: number = 3000): Promise<XgBoostReceipt> {
    if (!Number.isInteger(numSamples) || numSamples < 500 || numSamples > 20_000) throw new PersonaModelError('ML_SAMPLE_COUNT_INVALID', 400);
    if (this.training) throw new PersonaModelError('ML_TRAINING_BUSY', 409);
    this.training = true;
    try {
      await this.runPython('train_xgboost.py', [String(numSamples), this.artifactDir]);
      const receipt = this.getReceipt();
      if (!receipt) throw new PersonaModelError('ML_ARTIFACT_INVALID');
      return receipt;
    } finally { this.training = false; }
  }

  public async predict(features: number[] | Record<string, number>): Promise<PersonaPrediction> {
    const vector = this.validateFeatures(features);
    if (this.training) throw new PersonaModelError('ML_TRAINING_BUSY', 409);
    const receipt = this.getReceipt();
    if (!receipt) throw new PersonaModelError('ML_MODEL_NOT_READY', 503);
    const start = performance.now();
    const result = await this.runPython('predict.py', [JSON.stringify(vector), this.artifactDir]) as PersonaPrediction;
    const scores = result?.personaScores;
    if (!Array.isArray(scores) || scores.length !== 6 || new Set(scores.map(s => s.index)).size !== 6
      || scores.some(s => !Number.isInteger(s.index) || s.index < 0 || s.index > 5 || typeof s.label !== 'string'
        || !Number.isFinite(s.probability) || s.probability < 0 || s.probability > 1)
      || Math.abs(scores.reduce((sum, s) => sum + s.probability, 0) - 1) > 0.002) throw new PersonaModelError('ML_OUTPUT_INVALID', 502);
    const sorted = [...scores].sort((a, b) => b.probability - a.probability);
    if (result.dominantIndex !== sorted[0].index || result.dominantPersona !== sorted[0].label) throw new PersonaModelError('ML_OUTPUT_INVALID', 502);
    const margin = sorted[0].probability - sorted[1].probability;
    return { ...result,
      model: { artifactHash: receipt.artifact.sha256, engine: receipt.engine, latencyMs: Math.max(1, Math.round(performance.now() - start)) },
      provenance: { trainingData: 'synthetic', scoreMeaning: 'model-class-probability', populationShare: false, calibratedBehavior: false },
      diagnostics: { entropy: Math.round(-scores.reduce((sum, s) => sum + (s.probability ? s.probability * Math.log(s.probability) : 0), 0) / Math.log(6) * 1000) / 1000,
        topTwoMargin: Math.round(margin * 10000) / 10000, separation: margin < 0.15 ? 'close' : 'clear', inputBasis: 'supplied-features' },
    };
  }

  public async predictDataset(input: AudienceDatasetV1): Promise<PersonaPrediction> {
    const featureReport = this.extractFeatureReport(input);
    const result = await this.predict(featureReport.values);
    return { ...result, featureReport, diagnostics: { ...result.diagnostics!, inputBasis: 'dataset' } };
  }

  private validateFeatures(features: number[] | Record<string, number>): number[] {
    if (!features || typeof features !== 'object') throw new PersonaModelError('ML_FEATURES_INVALID', 400);
    if (!Array.isArray(features) && (Object.keys(features).length !== ML_FEATURE_NAMES.length
      || Object.keys(features).some(k => !ML_FEATURE_NAMES.includes(k as any)))) throw new PersonaModelError('ML_FEATURES_INVALID', 400);
    const vector = Array.isArray(features) ? features : ML_FEATURE_NAMES.map(name => features[name]);
    const max = [12,1,1,3,1,12,1,1,1,12,1,86400,100,5,1,1];
    if (vector.length !== ML_FEATURE_NAMES.length || vector.some((v, i) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max[i])
      || [3,13,14,15].some(i => !Number.isInteger(vector[i]))) throw new PersonaModelError('ML_FEATURES_INVALID', 400);
    return vector;
  }

  private runPython(script: string, args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonBin, [join(this.rootDir, 'ml', script), ...args], {
        cwd: this.rootDir, env: { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' }, stdio: ['ignore','pipe','pipe'],
      });
      let stdout = '', stderr = '', done = false;
      const finish = (error?: Error, value?: unknown) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => { proc.kill('SIGKILL'); finish(new PersonaModelError('ML_TIMEOUT', 504)); }, this.timeoutMs);
      proc.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.length > 2_000_000) { proc.kill('SIGKILL'); finish(new PersonaModelError('ML_OUTPUT_TOO_LARGE', 502)); }
      });
      proc.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-16_000);
      });
      proc.on('error', () => finish(new PersonaModelError('ML_RUNTIME_UNAVAILABLE', 503)));
      proc.on('close', code => {
        if (done) return;
        if (code !== 0) return finish(new PersonaModelError(/No module named/.test(stderr) ? 'ML_DEPENDENCIES_MISSING' : 'ML_PROCESS_FAILED', 503));
        try { finish(undefined, JSON.parse(stdout)); } catch { finish(new PersonaModelError('ML_OUTPUT_INVALID', 502)); }
      });
    });
  }

  /**
   * Keeps the original 16-feature demo model compatible. Defaults are documented by extractFeatureReport.
   */
  public extractFeaturesFromDataset(dataset: AudienceDatasetV1): Record<string, number> {
    dataset = parseAudienceDataset(dataset);
    const categories = ['software', 'creator', 'coffee', 'furniture', 'personal-brand', 'other'];
    const catIdx = Math.max(0, categories.indexOf(dataset.brand.category || 'other'));

    const igMaleObs = dataset.observations.find((o) => o.dimensions.gender === 'M')?.value ?? 60;
    const igAgeObs = dataset.observations.find((o) => o.dimensions.age === '25-34')?.value ?? 50;

    const allText = [
      dataset.brand.description,
      ...(dataset.products || []).flatMap((p) => p.facts.map((f) => f.text)),
      ...(dataset.content || []).map((c) => c.text),
      ...(dataset.research || []).map((r) => r.statement),
    ]
      .join(' ')
      .toLowerCase();

    const techKeywords = ['kod', 'linux', 'rust', 'go', 'docker', 'api', 'clean code', 'mimari', 'backend', 'terminal'];
    const techHits = techKeywords.filter((k) => allText.includes(k)).length;
    const techDensity = Math.min(1.0, techHits / 4.0);

    const pixelEventsCount = (dataset.events || []).length;
    const pixelCtaCount = (dataset.events || []).filter((e) => e.name === 'pricing_view' || e.name === 'trial_requested').length;
    const pixelCtaRatio = pixelEventsCount > 0 ? pixelCtaCount / pixelEventsCount : 0.05;

    const hasProof = (dataset.products?.[0]?.facts || []).length >= 2 ? 1 : 0;
    const hasCodeSnippet = allText.includes('talk is cheap') || allText.includes('terminal') || allText.includes('code') ? 1 : 0;

    return {
      ig_followers_log: 4.3,
      ig_engagement_rate: 0.045,
      ig_male_ratio: igMaleObs / 100.0,
      ig_top_age_idx: igAgeObs > 40 ? 1.0 : 0.0,
      ig_story_interaction_rate: 0.07,
      x_followers_log: 4.1,
      x_tech_density: techDensity,
      x_retweet_ratio: 0.12,
      x_critique_ratio: 0.25,
      pixel_events_log: Math.log10(Math.max(1, pixelEventsCount)),
      pixel_cta_ratio: pixelCtaRatio,
      pixel_avg_dwell_sec: 75.0,
      pixel_scroll_depth: 60.0,
      category_idx: Number(catIdx),
      has_proof_facts: hasProof,
      has_code_snippet: hasCodeSnippet,
    };
  }

  public extractFeatureReport(dataset: AudienceDatasetV1): FeatureReport {
    dataset = parseAudienceDataset(dataset);
    const values = this.extractFeaturesFromDataset(dataset);
    const refs: Partial<Record<string, { basis: 'computed' | 'observed'; refs: string[] }>> = {
      category_idx: { basis:'computed', refs:['brand:description'] },
      x_tech_density: { basis:'computed', refs:['brand:description', ...dataset.content.map(c => `content:${c.id}`), ...dataset.research.map(r => `research:${r.id}`)] },
      has_proof_facts: { basis:'computed', refs:dataset.products[0].facts.map(f => `fact:${f.id}`) },
      has_code_snippet: { basis:'computed', refs:['brand:description', ...dataset.products.flatMap(p => p.facts.map(f => `fact:${f.id}`))] },
    };
    const male = dataset.observations.find(o => o.dimensions.gender === 'M');
    const age = dataset.observations.find(o => o.dimensions.age === '25-34');
    if (male?.value !== null && male?.value !== undefined) refs.ig_male_ratio = { basis:'computed', refs:[`observation:${male.id}`] };
    if (age?.value !== null && age?.value !== undefined) refs.ig_top_age_idx = { basis:'computed', refs:[`observation:${age.id}`] };
    refs.pixel_events_log = { basis:'computed', refs:dataset.events.slice(0, 12).map(e => `event:${e.id}`) };
    if (dataset.events.length) refs.pixel_cta_ratio = { basis:'computed', refs:dataset.events.slice(0, 12).map(e => `event:${e.id}`) };
    const features = ML_FEATURE_NAMES.map(name => ({ name, value:values[name], basis:refs[name]?.basis || 'assumed' as const, evidenceRefs:refs[name]?.refs || [] }));
    return { values, features, measuredOrComputedFeatures: features.filter(f => f.basis !== 'assumed').length,
      assumedFeatures: features.filter(f => f.basis === 'assumed').length, datasetSynthetic: dataset.synthetic };
  }
}
