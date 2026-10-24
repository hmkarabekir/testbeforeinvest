import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import fixture from '../fixtures/b2b-software.v1.json';
import { AudienceLabOrchestrator } from '../orchestrator.js';
import { AudienceLabEngine } from '../inference/index.js';
import { CodexCliEvaluator } from '../inference/codex-cli.js';
import { LocalAgentEvaluator } from '../inference/local-evaluator.js';
import { parseAudienceDataset } from '../core/dataset-contract.js';
import type { CreativeVariantV1, InferencePort, InferenceResult } from '../core/types.js';

const dataset = parseAudienceDataset(fixture);
const common: Omit<CreativeVariantV1, 'id' | 'headline'> = {
  version: 1, productId: dataset.products[0].id, platform: 'instagram', format: 'text-ad' as const,
  body: 'CSV ile veri içe aktarma. Kurulum kontrol listesi bulunur.', callToAction: 'Planı incele',
  testedVariable: 'hook', productFactRefs: ['fact-1-2', 'fact-1-3'], assumptions: [],
  generation: 'manual' as const, productClaims: [], claimValidation: 'supported' as const, contentHash: '',
};
const variantA: CreativeVariantV1 = { ...common, id: 'a', headline: 'Ekip işlerini tek yerde inceleyin' };
const variantB: CreativeVariantV1 = { ...common, id: 'b', headline: 'Yeni bir çalışma alanı nereden başlar?' };
const params = { dataset, variantA, variantB, panelMode: 'demo' as const, repeats: 2 };
afterEach(() => jest.restoreAllMocks());

describe('Engine selection', () => {
  it('rejects an explicit Codex request when CLI is missing instead of using local rules', async () => {
    jest.spyOn(CodexCliEvaluator.prototype, 'isAvailable').mockReturnValue(false);
    const fallback = jest.spyOn(LocalAgentEvaluator.prototype, 'infer');
    const engine = new AudienceLabEngine('codex');
    expect(engine.configuration()).toMatchObject({ provider: 'codex', ready: false });
    await expect(engine.infer({ system: 'test', prompt: '{}' })).rejects.toMatchObject({ code: 'AUDIENCE_LAB_PROVIDER_NOT_CONFIGURED' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('keeps explicit local tests local even if the environment selects Codex', () => {
    const previous = process.env.AUDIENCE_LAB_ENGINE;
    try {
      process.env.AUDIENCE_LAB_ENGINE = 'codex';
      expect(new AudienceLabEngine('local').configuration().provider).toBe('local-rules');
    } finally {
      if (previous === undefined) delete process.env.AUDIENCE_LAB_ENGINE;
      else process.env.AUDIENCE_LAB_ENGINE = previous;
    }
  });
});

function engineWith(transform?: (result: InferenceResult, request: Parameters<InferencePort['infer']>[0]) => InferenceResult): InferencePort {
  const local = new AudienceLabEngine('local');
  return {
    configuration: () => local.configuration(),
    infer: jest.fn(async (request) => {
      const result = await local.infer(request);
      return transform ? transform(result, request) : result;
    }),
  };
}

describe('Panel execution and result fidelity', () => {
  it('covers six distinct personas in demo mode, counterbalances order, and bounds concurrency', async () => {
    const local = engineWith();
    let active = 0, maximum = 0;
    const requests: Array<Parameters<InferencePort['infer']>[0]> = [];
    const engine: InferencePort = {
      configuration: local.configuration,
      infer: async (request) => {
        active++; maximum = Math.max(maximum, active); requests.push(request);
        await new Promise((resolve) => setTimeout(resolve, 2));
        try { return await local.infer(request); } finally { active--; }
      },
    };
    const result = await new AudienceLabOrchestrator(engine).runExperiment({ ...params, concurrency: 2 });
    expect(result.panelSize).toBe(6);
    expect(result.timing.calls).toHaveLength(36);
    expect(result.aggregate.personas).toHaveLength(6);
    expect(result.aggregate.completion.ratio).toBe(1);
    expect(result.evaluationMode).toBe('local-rules');
    expect(result.provenance).toMatchObject({ datasetSynthetic: true, panelSynthetic: true, weightBasis: 'equal-scenario' });
    expect(maximum).toBe(2);
    expect(result.timing.totalMs).toBeGreaterThan(0);
    const pairs = requests.filter((r) => r.task === 'pair-evaluation').map((r) => JSON.parse(r.prompt));
    const groups = new Map<string, typeof pairs>();
    for (const p of pairs) {
      expect(p.identity.scenario.attention).toBe('normal');
      const key = p.identity.knowledgeClaimIds.join(',');
      groups.set(key, [...(groups.get(key) || []), p]);
    }
    expect(groups.size).toBe(6);
    for (const [first, second] of groups.values()) {
      expect(first.left.text).toBe(second.right.text);
      expect(first.right.text).toBe(second.left.text);
    }
  });

  it('preserves the default full panel of 18 identities and 108 assessments', async () => {
    const result = await new AudienceLabOrchestrator(engineWith()).runExperiment({ dataset, variantA, variantB });
    expect(result.panelMode).toBe('full');
    expect(result.panelSize).toBe(18);
    expect(result.repeats).toBe(2);
    expect(result.timing.calls).toHaveLength(108);
  });

  it('keeps invalid responses missing after one retry, without renormalizing their votes', async () => {
    let invalid = 2;
    const engine = engineWith((result, request) => request.task === 'pair-evaluation' && invalid-- > 0
      ? { ...result, value: {} } : result);
    const result = await new AudienceLabOrchestrator(engine).runExperiment({ ...params, concurrency: 1 });
    expect(result.timing.calls.filter((c) => c.status === 'failed')).toHaveLength(2);
    expect(result.aggregate.completion.failedOrMissingTasks).toBe(1);
    expect(result.summary.votes.missing).toBeCloseTo(100 / 12, 3);
    expect(result.timing.calls).toHaveLength(37);
  });

  it('preserves insufficient-data and null scores if every response fails contract validation', async () => {
    const result = await new AudienceLabOrchestrator(engineWith((r) => ({ ...r, value: {} }))).runExperiment(params);
    expect(result.summary.decision).toBe('insufficient-data');
    expect(result.summary.winner).toBe('insufficient-data');
    expect(result.summary.averageScores).toEqual({ a: null, b: null });
    expect(result.summary.votes.missing).toBe(100);
    expect(result.aggregate.warnings).toContain('INCOMPLETE_PANEL_COVERAGE');
    expect(result.timing.calls).toHaveLength(72);
  });

  it('does not turn an order-unstable mixed decision into a tie', async () => {
    const engine = engineWith((r, request) => request.task === 'pair-evaluation'
      ? { ...r, value: { ...(r.value as object), preference: 'left' } } : r);
    const result = await new AudienceLabOrchestrator(engine).runExperiment(params);
    expect(result.summary.decision).toBe('mixed');
    expect(result.summary.winner).toBe('mixed');
    expect(result.aggregate.warnings).toContain('ORDER_STABILITY_UNPROVEN');
  });

  it('cannot declare a winner with only one presentation order', async () => {
    const result = await new AudienceLabOrchestrator(engineWith()).runExperiment({ ...params, repeats: 1 });
    expect(['a', 'b']).not.toContain(result.summary.winner);
    expect(result.aggregate.orderStability.consistency).toBeNull();
    expect(result.aggregate.warnings).toContain('ORDER_STABILITY_UNPROVEN');
  });

  it('retains a supported A recommendation when score and preference agree in both orders', async () => {
    const engine = engineWith((r, request) => {
      const payload = JSON.parse(request.prompt);
      const value = r.value as any;
      if (request.task === 'pair-evaluation') {
        return { ...r, value: { ...value, preference: payload.left.text.includes(variantA.headline) ? 'left' : 'right' } };
      }
      return { ...r, value: { ...value, unsupportedClaims: [], criterionScores: Object.fromEntries(
        Object.keys(value.criterionScores).map((key) => [key, payload.creative.text.includes(variantA.headline) ? 4 : 0]),
      ) } };
    });
    const result = await new AudienceLabOrchestrator(engine).runExperiment(params);
    expect(result.summary.decision).toBe('A');
    expect(result.summary.winner).toBe('a');
    expect(result.aggregate.recommendation).toBe(variantA.id);
    expect(result.aggregate.orderStability.consistency).toBe(1);
  });

  it('retains invalid-creative instead of showing it as a tie or zero score', async () => {
    const engine = engineWith((r, request) => request.task === 'single-evaluation'
      ? { ...r, value: { ...(r.value as object), unsupportedClaims: ['Kaynakta bulunmayan vaat'] } } : r);
    const result = await new AudienceLabOrchestrator(engine).runExperiment(params);
    expect(result.summary.decision).toBe('invalid-creative');
    expect(result.summary.winner).toBe('invalid-creative');
    expect(result.summary.averageScores).toEqual({ a: null, b: null });
  });

  it('rejects mismatched provider receipts instead of labeling local output as Luna', async () => {
    const engine = engineWith((r) => ({ ...r, receipt: { ...r.receipt, provider: 'codex' } }));
    await expect(new AudienceLabOrchestrator(engine).runExperiment({ ...params, concurrency: 1 }))
      .rejects.toThrow('AUDIENCE_LAB_PROVIDER_MISMATCH');
    expect(engine.infer).toHaveBeenCalledTimes(1);
  });

  it('validates run settings before inference starts', async () => {
    const engine = engineWith();
    await expect(new AudienceLabOrchestrator(engine).runExperiment({ ...params, repeats: 0 }))
      .rejects.toThrow('AUDIENCE_LAB_EXPERIMENT_INVALID');
    await expect(new AudienceLabOrchestrator(engine).runExperiment({ ...params, concurrency: 3 }))
      .rejects.toThrow('AUDIENCE_LAB_EXPERIMENT_INVALID');
    expect(engine.infer).not.toHaveBeenCalled();
  });
});

function mockProcess(action: (child: any, args: string[], options: any) => void) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: jest.fn(() => true),
  });
  const spawn = jest.spyOn(childProcess, 'spawn').mockImplementation(((_bin: string, args: string[], options: any) => {
    process.nextTick(() => action(child, args, options));
    return child;
  }) as any);
  jest.spyOn(CodexCliEvaluator.prototype, 'isAvailable').mockReturnValue(true);
  return { child, spawn };
}

describe('Codex CLI transport (mock process; no live inference)', () => {
  const request = { task: 'single-evaluation' as const, system: 'test', prompt: '{}' };
  it('passes an output schema, reads provider usage, and removes temporary files', async () => {
    let workDir = '';
    const { spawn } = mockProcess((child, args, options) => {
      workDir = options.cwd;
      const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.reasons.items.properties.personaClaimIds).toMatchObject({
        minItems: 1, items: { enum: ['claim-1'] },
      });
      writeFileSync(args[args.indexOf('-o') + 1], '{"ok":true}');
      child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}\n');
      child.emit('close', 0);
    });
    const result = await new CodexCliEvaluator().infer({ ...request, prompt: JSON.stringify({ identity: { knowledgeClaimIds: ['claim-1'] } }) });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.value).toEqual({ ok: true });
    expect(result.receipt).toMatchObject({ returnedModel: null, httpStatus: null, usageState: 'reported',
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: null, totalTokens: 130 },
      cost: { state: 'unknown', providerChargeNanoUsd: null } });
    expect(existsSync(workDir)).toBe(false);
  });

  it('rejects invalid JSON and marks usage as missing when none was reported', async () => {
    mockProcess((child, args) => {
      writeFileSync(args[args.indexOf('-o') + 1], 'not JSON');
      child.emit('close', 0);
    });
    await expect(new CodexCliEvaluator().infer(request)).rejects.toMatchObject({
      code: 'AUDIENCE_LAB_PROVIDER_RESPONSE_INVALID', retryable: true,
      receipt: { usage: null, usageState: 'missing' },
    });
  });

  it('reports a provider rejection without fabricating an HTTP status or retrying authentication errors', async () => {
    mockProcess((child) => { child.stderr.write('Authentication failed'); child.emit('close', 1); });
    await expect(new CodexCliEvaluator().infer(request)).rejects.toMatchObject({
      code: 'AUDIENCE_LAB_PROVIDER_REJECTED', retryable: false, receipt: { httpStatus: null, returnedModel: null },
    });
  });

  it('marks rate-limit rejections as retryable', async () => {
    mockProcess((child) => { child.stderr.write('429 rate limit'); child.emit('close', 1); });
    await expect(new CodexCliEvaluator().infer(request)).rejects.toMatchObject({
      code: 'AUDIENCE_LAB_PROVIDER_REJECTED', retryable: true,
    });
  });

  it('kills a timed-out process, cleans up, and ignores a later close event', async () => {
    let workDir = '';
    const { child } = mockProcess((_child, _args, options) => { workDir = options.cwd; });
    await expect(new CodexCliEvaluator({ timeoutMs: 20 }).infer(request)).rejects.toMatchObject({
      code: 'AUDIENCE_LAB_PROVIDER_TIMEOUT', receipt: { outcome: 'unknown' },
    });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(existsSync(workDir)).toBe(false);
    child.emit('close', null);
  });

  it('handles a process launch failure and cleans up temporary files', async () => {
    let workDir = '';
    mockProcess((child, _args, options) => { workDir = options.cwd; child.emit('error', new Error('ENOENT')); });
    await expect(new CodexCliEvaluator().infer(request)).rejects.toMatchObject({ code: 'AUDIENCE_LAB_PROVIDER_UNAVAILABLE' });
    expect(existsSync(workDir)).toBe(false);
  });
});
