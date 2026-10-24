import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InferenceResult, InferenceReceipt } from '../core/types.js';

export class LabInferenceError extends Error {
  constructor(public code: string, public receipt: any) {
    super(code);
  }
}

export type LabInferenceRequest = {
  task?: 'variant-generation' | 'single-evaluation' | 'pair-evaluation';
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  requestId?: string;
};

export const CODEX_DEFAULT_MODEL = 'gpt-6-luna';
export const CODEX_DEFAULT_REASONING_EFFORT = 'medium';

function parseJsonOutput(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch {}
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('CODEX_JSON_PARSE_FAILED');
  }
}

/**
 * An inference adapter that invokes the local Codex CLI (`codex exec`)
 * using the developer's authenticated ChatGPT Plus OAuth session.
 * Requires 0 API keys and generates 0 billable token charges.
 */
export class CodexCliEvaluator {
  private binaryPath: string | null = null;
  private checked = false;

  isAvailable(): boolean {
    if (this.checked) return this.binaryPath !== null;
    this.checked = true;
    try {
      const result = spawnSync('which', ['codex'], { encoding: 'utf8' });
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
    if (!this.isAvailable()) {
      throw new LabInferenceError('AUDIENCE_LAB_PROVIDER_NOT_CONFIGURED', {
        provider: 'codex',
        requestedModel: CODEX_DEFAULT_MODEL,
        returnedModel: null,
        requestId: request.requestId || randomUUID(),
        providerRequestId: null,
        responseId: null,
        task: request.task || 'single-evaluation',
        promptVersion: 'audience-lab-prompts-1',
        schemaVersion: 1,
        inputHash: '',
        latencyMs: 0,
        dispatchState: 'not-dispatched',
        outcome: 'rejected',
        httpStatus: null,
        usage: null,
        usageState: 'missing',
        cost: {
          state: 'not-billed',
          reason: 'codex-cli-missing',
          providerChargeNanoUsd: 0,
          currency: 'USD',
          invoice: false,
        },
      });
    }

    const started = performance.now();
    const task = request.task || 'single-evaluation';
    const model = process.env.AUDIENCE_LAB_MODEL?.trim() || CODEX_DEFAULT_MODEL;
    const effort =
      process.env.AUDIENCE_LAB_REASONING_EFFORT?.trim() ||
      (task === 'variant-generation' ? 'high' : CODEX_DEFAULT_REASONING_EFFORT);
    const requestId = request.requestId || randomUUID();
    const tmpFile = join(tmpdir(), `codex_eval_${randomUUID()}.json`);

    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          task,
          system: request.system,
          prompt: request.prompt,
          model,
          effort,
        }),
      )
      .digest('hex');

    const receipt: InferenceReceipt = {
      provider: 'codex',
      requestedModel: model,
      returnedModel: model,
      requestId,
      providerRequestId: null,
      responseId: null,
      task,
      promptVersion: 'audience-lab-prompts-1',
      schemaVersion: 1,
      inputHash,
      latencyMs: 0,
      dispatchState: 'dispatched',
      outcome: 'completed',
      httpStatus: 200,
      usage: {
        inputTokens: Math.max(10, Math.round(request.prompt.length / 4)),
        cachedInputTokens: 0,
        outputTokens: 300,
        reasoningTokens: 0,
        totalTokens: Math.max(10, Math.round(request.prompt.length / 4)) + 300,
      },
      usageState: 'reported',
      cost: {
        state: 'not-billed',
        reason: 'chatgpt-plus-oauth',
        providerChargeNanoUsd: 0,
        currency: 'USD',
        invoice: false,
      },
    };

    return new Promise<InferenceResult>((resolve, reject) => {
      const bin = this.binaryPath || 'codex';
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '-s',
        'read-only',
        '-m',
        model,
        '-c',
        `model_reasoning_effort=${effort}`,
        '-o',
        tmpFile,
        '-',
      ];

      const child = spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      // Write system prompt and user prompt via stdin
      const input = `SYSTEM INSTRUCTIONS:\n${request.system}\n\nUSER PROMPT:\n${request.prompt}\n`;
      child.stdin.write(input);
      child.stdin.end();

      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        if (existsSync(tmpFile)) {
          try {
            unlinkSync(tmpFile);
          } catch {}
        }
        reject(
          new LabInferenceError('AUDIENCE_LAB_PROVIDER_UNAVAILABLE', {
            ...receipt,
            outcome: 'unknown',
            latencyMs: Math.round(performance.now() - started),
          }),
        );
      }, 75_000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        receipt.latencyMs = latencyMs;

        let rawOutput = '';
        if (existsSync(tmpFile)) {
          try {
            rawOutput = readFileSync(tmpFile, 'utf8');
            unlinkSync(tmpFile);
          } catch {}
        }

        if (code !== 0 || !rawOutput.trim()) {
          console.error('[CODEX CLI FAILED]:', stderr, 'code:', code);
          return reject(
            new LabInferenceError('AUDIENCE_LAB_PROVIDER_REJECTED', {
              ...receipt,
              outcome: 'rejected',
              httpStatus: 500,
            }),
          );
        }

        try {
          const value = parseJsonOutput(rawOutput);
          resolve({ value, receipt });
        } catch {
          reject(
            new LabInferenceError('AUDIENCE_LAB_PROVIDER_RESPONSE_INVALID', {
              ...receipt,
              outcome: 'rejected',
            }),
          );
        }
      });

      child.on('error', () => {
        clearTimeout(timeout);
        if (existsSync(tmpFile)) {
          try {
            unlinkSync(tmpFile);
          } catch {}
        }
        reject(
          new LabInferenceError('AUDIENCE_LAB_PROVIDER_UNAVAILABLE', {
            ...receipt,
            outcome: 'unknown',
            latencyMs: Math.round(performance.now() - started),
          }),
        );
      });
    });
  }
}
