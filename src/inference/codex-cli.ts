import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InferenceResult, InferenceReceipt, InferenceUsage, InferenceImage } from '../core/types.js';
import { validateImages } from '../core/experiment-input.js';
import { evaluationOutputSchema } from './output-schema.js';
import { LAB_PROMPT_VERSION } from '../core/prompts.js';

export class LabInferenceError extends Error {
  constructor(
    public code: string,
    public receipt: InferenceReceipt,
    public retryable = false,
  ) {
    super(code);
  }
}

export type LabInferenceRequest = {
  task?: 'variant-generation' | 'single-evaluation' | 'pair-evaluation';
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  requestId?: string;
  images?: InferenceImage[];
};

export const CODEX_DEFAULT_MODEL = 'gpt-6-luna';
export const CODEX_DEFAULT_REASONING_EFFORT = 'medium';

function parseJsonOutput(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const block = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (block) return JSON.parse(block[1]);
    throw new Error('CODEX_JSON_PARSE_FAILED');
  }
}

/** Runs the existing authenticated CLI. Billing and returned-model identity are not inferred. */
export class CodexCliEvaluator {
  private binaryPath: string | null = null;
  private checked = false;

  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  /** Checks the executable only; a successful live call is needed to verify model access. */
  isAvailable(): boolean {
    if (this.checked) return this.binaryPath !== null;
    this.checked = true;
    try {
      const result = spawnSync('which', ['codex'], { encoding: 'utf8', timeout: 2000 });
      if (result.status === 0 && result.stdout.trim()) {
        this.binaryPath = result.stdout.trim();
        return true;
      }
    } catch {}
    if (existsSync('/opt/homebrew/bin/codex')) {
      this.binaryPath = '/opt/homebrew/bin/codex';
      return true;
    }
    return false;
  }

  async infer(request: LabInferenceRequest): Promise<InferenceResult> {
    if (process.env.AUDIENCE_LAB_DISABLE_LIVE === '1') throw new Error('AUDIENCE_LAB_LIVE_DISABLED');
    const started = performance.now();
    const task = request.task || 'single-evaluation';
    const model = process.env.AUDIENCE_LAB_MODEL?.trim() || CODEX_DEFAULT_MODEL;
    const effort = process.env.AUDIENCE_LAB_REASONING_EFFORT?.trim()
      || (task === 'variant-generation' ? 'high' : CODEX_DEFAULT_REASONING_EFFORT);
    const timeoutMs = this.options.timeoutMs ?? Number(process.env.AUDIENCE_LAB_TIMEOUT_MS || 75_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
      throw new Error('AUDIENCE_LAB_TIMEOUT_INVALID');
    }
    const schema = evaluationOutputSchema(task, request.prompt);
    if ((request.images?.length || 0) > 6) throw new Error('AUDIENCE_LAB_EXPERIMENT_INVALID');
    const images = [...validateImages(request.images?.slice(0, 3)), ...validateImages(request.images?.slice(3))];
    const receipt: InferenceReceipt = {
      provider: 'codex',
      requestedModel: model,
      returnedModel: null,
      requestId: request.requestId || randomUUID(),
      providerRequestId: null,
      responseId: null,
      task,
      promptVersion: LAB_PROMPT_VERSION,
      schemaVersion: 1,
      inputHash: createHash('sha256').update(JSON.stringify({ task, system: request.system, prompt: request.prompt, schema, images, model, effort })).digest('hex'),
      latencyMs: 0,
      dispatchState: 'not-dispatched',
      outcome: 'unknown',
      httpStatus: null,
      usage: null,
      usageState: 'missing',
      cost: {
        state: 'unknown', reason: 'cli-does-not-report-billing',
        providerChargeNanoUsd: null, currency: 'USD', invoice: false,
      },
    };
    if (!this.isAvailable()) {
      receipt.outcome = 'rejected';
      throw new LabInferenceError('AUDIENCE_LAB_PROVIDER_NOT_CONFIGURED', receipt);
    }

    // A separate working directory avoids loading this project's agent/development instructions.
    const workDir = mkdtempSync(join(tmpdir(), 'audience-lab-'));
    const outputFile = join(workDir, 'answer.json');
    const imageFiles = images.map((image, index) => {
      const file = join(workDir, `attachment-${index + 1}.${image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`);
      writeFileSync(file, Buffer.from(image.data, 'base64'), { mode: 0o600 });
      return file;
    });
    const schemaFile = join(workDir, 'schema.json');
    if (schema) writeFileSync(schemaFile, JSON.stringify(schema), { mode: 0o600 });

    return new Promise<InferenceResult>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stderr = '';
      let pending = '';
      let usage: InferenceUsage | null = null;
      let eventError = '';
      const finish = (error?: LabInferenceError, value?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        receipt.latencyMs = Math.max(1, Math.round(performance.now() - started));
        receipt.usage = usage;
        receipt.usageState = usage ? 'reported' : 'missing';
        rmSync(workDir, { recursive: true, force: true });
        if (error) reject(error);
        else {
          receipt.outcome = 'completed';
          resolve({ value, receipt });
        }
      };
      const failure = (code: string, retryable = false) => {
        receipt.outcome = receipt.dispatchState === 'dispatched'
          && ['AUDIENCE_LAB_PROVIDER_TIMEOUT', 'AUDIENCE_LAB_PROVIDER_UNAVAILABLE'].includes(code) ? 'unknown' : 'rejected';
        finish(new LabInferenceError(code, receipt, retryable));
      };
      const event = (line: string) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'turn.completed' && parsed.usage) {
            const u = parsed.usage;
            if ([u.input_tokens, u.cached_input_tokens, u.output_tokens].every((n) => Number.isInteger(n) && n >= 0)) {
              usage = {
                inputTokens: u.input_tokens, cachedInputTokens: u.cached_input_tokens,
                outputTokens: u.output_tokens, reasoningTokens: null,
                totalTokens: u.input_tokens + u.output_tokens,
              };
            }
          }
          if (parsed.type === 'error' || parsed.type === 'turn.failed') {
            eventError = String(parsed.message || parsed.error?.message || '').slice(0, 4000);
          }
        } catch { /* Ignore non-event diagnostics; the final response is validated separately. */ }
      };
      const args = [
        'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only',
        '-m', model, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
        '--json', ...(schema ? ['--output-schema', schemaFile] : []),
        ...imageFiles.flatMap((file) => ['--image', file]),
        '-o', outputFile, '-',
      ];
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.binaryPath || 'codex', args, {
          cwd: workDir, stdio: ['pipe', 'pipe', 'pipe'],
        });
        receipt.dispatchState = 'dispatched';
      } catch {
        failure('AUDIENCE_LAB_PROVIDER_UNAVAILABLE', true);
        return;
      }
      child.stdout!.on('data', (chunk) => {
        if (settled) return;
        pending += chunk.toString();
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          event(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
        }
        if (pending.length > 2_000_000) {
          failure('AUDIENCE_LAB_PROVIDER_RESPONSE_INVALID');
          child.kill('SIGKILL');
        }
      });
      child.stderr!.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16_000); });
      child.on('error', () => {
        receipt.dispatchState = 'not-dispatched';
        failure('AUDIENCE_LAB_PROVIDER_UNAVAILABLE', true);
      });
      child.stdin!.on('error', () => {
        failure('AUDIENCE_LAB_PROVIDER_UNAVAILABLE', true);
        child.kill('SIGKILL');
      });
      child.on('close', (code) => {
        if (settled) return;
        if (pending.trim()) event(pending);
        if (code !== 0 || eventError) {
          const retryable = /429|rate.?limit|temporar|overloaded|502|503/i.test(stderr + eventError);
          failure('AUDIENCE_LAB_PROVIDER_REJECTED', retryable);
          return;
        }
        try {
          const value = parseJsonOutput(readFileSync(outputFile, 'utf8'));
          finish(undefined, value);
        } catch {
          failure('AUDIENCE_LAB_PROVIDER_RESPONSE_INVALID', true);
        }
      });
      timer = setTimeout(() => {
        failure('AUDIENCE_LAB_PROVIDER_TIMEOUT', true);
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdin!.end(`Evaluate only the supplied data. Do not use tools or inspect files.\n\nSYSTEM INSTRUCTIONS:\n${request.system}\n\nUSER PROMPT:\n${request.prompt}\n`);
    });
  }
}
