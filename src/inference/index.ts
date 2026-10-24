import { CodexCliEvaluator, CODEX_DEFAULT_MODEL } from './codex-cli.js';
import { LocalAgentEvaluator, LOCAL_RULES_MODEL } from './local-evaluator.js';
import type { InferencePort, InferenceResult } from '../core/types.js';

export { CodexCliEvaluator, CODEX_DEFAULT_MODEL } from './codex-cli.js';
export { LocalAgentEvaluator, LOCAL_RULES_MODEL } from './local-evaluator.js';

export type EngineMode = 'auto' | 'codex' | 'local';

export class AudienceLabEngine implements InferencePort {
  private readonly codex = new CodexCliEvaluator();
  private readonly local = new LocalAgentEvaluator();

  constructor(private readonly preferredEngine: EngineMode = 'auto') {}

  configuration() {
    const envEngine = (process.env.AUDIENCE_LAB_ENGINE?.trim() || this.preferredEngine) as EngineMode;

    if (envEngine === 'codex' || (envEngine === 'auto' && this.codex.isAvailable())) {
      const model = process.env.AUDIENCE_LAB_MODEL?.trim() || CODEX_DEFAULT_MODEL;
      return {
        ready: this.codex.isAvailable(),
        provider: 'codex' as const,
        model,
      };
    }

    return {
      ready: true,
      provider: 'local-rules' as const,
      model: LOCAL_RULES_MODEL,
    };
  }

  async infer(request: {
    task?: 'variant-generation' | 'single-evaluation' | 'pair-evaluation';
    system: string;
    prompt: string;
    maxOutputTokens?: number;
    requestId?: string;
  }): Promise<InferenceResult> {
    const config = this.configuration();
    if (config.provider === 'codex' && config.ready) {
      return this.codex.infer(request as any);
    }
    return this.local.infer(request as any);
  }
}
