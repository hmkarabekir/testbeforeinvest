/**
 * OctopIQ Audience Agent Lab — Core Types & Contracts
 */

export * from './dataset-contract.js';

export type InferenceImage = { name: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string };
export type ExperimentContext = {
  objective: 'attention' | 'consideration' | 'click-intent' | 'task-completion' | 'clarity' | 'trust';
  task: string;
  surface: 'web' | 'mobile' | 'content' | 'other';
  changedElement: string;
};

export type InferenceUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
};

export type InferenceReceipt = {
  provider: 'codex' | 'local-rules' | 'deepseek';
  requestedModel: string;
  returnedModel: string | null;
  requestId: string;
  providerRequestId: string | null;
  responseId: string | null;
  task: 'variant-generation' | 'single-evaluation' | 'pair-evaluation';
  promptVersion: string;
  schemaVersion: 1;
  inputHash: string;
  latencyMs: number;
  dispatchState: 'not-dispatched' | 'dispatched';
  outcome: 'completed' | 'rejected' | 'unknown';
  httpStatus: number | null;
  usage: InferenceUsage | null;
  usageState: 'reported' | 'missing' | 'invalid';
  cost: {
    state: 'not-billed' | 'unknown' | 'estimated';
    reason: string;
    providerChargeNanoUsd: number | null;
    currency: string;
    invoice: boolean;
  };
};

export type InferenceResult = {
  value: unknown;
  receipt: InferenceReceipt;
};

export interface InferencePort {
  configuration(): {
    ready: boolean;
    provider: 'codex' | 'local-rules' | 'deepseek';
    model: string;
  };
  infer(request: {
    task?: 'variant-generation' | 'single-evaluation' | 'pair-evaluation';
    system: string;
    prompt: string;
    maxOutputTokens?: number;
    requestId?: string;
    images?: InferenceImage[];
  }): Promise<InferenceResult>;
}
