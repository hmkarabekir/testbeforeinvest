import { CRITERIA } from '../core/evaluation-contract.js';

const text = { type: 'string' };
const strings = { type: 'array', items: text };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Shape constraints complement, rather than replace, semantic contract validation. */
export function evaluationOutputSchema(task: string, prompt: string) {
  let claimIds: string[] = [];
  let input: Record<string, any> = {};
  try {
    const parsed = JSON.parse(prompt);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
    const ids = input.identity?.knowledgeClaimIds;
    if (Array.isArray(ids)) claimIds = ids.filter((id): id is string => typeof id === 'string');
  } catch { /* The evaluator will reject malformed input; never invent claim IDs. */ }
  const refs = {
    type: 'array', minItems: claimIds.length ? 1 : 0,
    ...(claimIds.length ? {} : { maxItems: 0 }),
    items: claimIds.length ? { type: 'string', enum: claimIds } : text,
  };
  const quote = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return text;
    // Every candidate is a contiguous, bounded substring of the actual creative.
    const candidates = [...new Set([
      ...value.split('\n'), ...(value.match(/[^.!?\n]+[.!?]?/g) || []), value,
    ].map((s) => s.trim().slice(0, 500)).filter(Boolean))].slice(0, 40);
    return { type: 'string', enum: candidates };
  };
  if (task === 'variant-generation') return object({
    schemaVersion: { type: 'integer', enum: [1] },
    variants: { type: 'array', minItems: 2, maxItems: 2, items: object({
      headline: text, body: text, callToAction: text, html: text,
      productFactRefs: strings, assumptions: strings,
      productClaims: { type: 'array', items: object({ factRef: text, quote: text }) },
    }) },
    changedElement: text,
  });
  if (task === 'single-evaluation') {
    return object({
      schemaVersion: { type: 'integer', enum: [1] },
      criterionScores: object(Object.fromEntries(CRITERIA.map((key) => [key, {
        type: 'integer', minimum: 0, maximum: 4,
      }]))),
      reasons: {
        type: 'array', minItems: 6, maxItems: 6,
        items: object({
          criterion: { type: 'string', enum: CRITERIA },
          personaClaimIds: refs,
          creativeExcerpt: quote(input.creative?.text),
          explanation: text,
        }),
      },
      intendedAction: { type: 'string', enum: ['skip', 'inspect', 'click', 'ask_question', 'insufficient_context'] },
      unansweredQuestions: strings,
      unsupportedClaims: strings,
    });
  }
  if (task === 'pair-evaluation') {
    return object({
      schemaVersion: { type: 'integer', enum: [1] },
      preference: { type: 'string', enum: ['left', 'right', 'tie', 'neither', 'insufficient_context'] },
      personaClaimIds: refs,
      leftExcerpt: quote(input.left?.text),
      rightExcerpt: quote(input.right?.text),
      explanation: text,
    });
  }
  return null;
}
