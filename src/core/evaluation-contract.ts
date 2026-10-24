/** Model output is untrusted. Identity/exposure fields are stamped by the server. */
export const RUBRIC_VERSION = 'audience-lab-rubric-1';
export const CRITERION_WEIGHTS = {
  relevance: 0.25,
  credibility: 0.2,
  clarity: 0.15,
  objectionResolution: 0.15,
  attention: 0.15,
  ctaFit: 0.1,
} as const;
export type Criterion = keyof typeof CRITERION_WEIGHTS;
export type CriterionScores = Record<Criterion, number>;
export const CRITERIA = Object.keys(CRITERION_WEIGHTS) as Criterion[];
export type SingleEvaluationContext = {
  agentId: string;
  exposureId: string;
  personaClaimIds: readonly string[];
  creativeText: string;
};
export type SingleEvaluation = {
  schemaVersion: 1;
  agentId: string;
  exposureId: string;
  criterionScores: CriterionScores;
  reasons: Array<{
    criterion: Criterion;
    personaClaimIds: string[];
    creativeExcerpt: string;
    explanation: string;
  }>;
  intendedAction:
    | 'skip'
    | 'inspect'
    | 'click'
    | 'ask_question'
    | 'insufficient_context';
  unansweredQuestions: string[];
  unsupportedClaims: string[];
  score: number;
  creativeStatus: 'supported' | 'invalid-creative';
};
export type PairPreference =
  | 'left'
  | 'right'
  | 'tie'
  | 'neither'
  | 'insufficient_context';
export type PairEvaluationContext = {
  agentId: string;
  exposureId: string;
  leftVariantId: string;
  rightVariantId: string;
  personaClaimIds: readonly string[];
  leftText: string;
  rightText: string;
};
export type PairEvaluation = {
  schemaVersion: 1;
  agentId: string;
  exposureId: string;
  leftVariantId: string;
  rightVariantId: string;
  preference: PairPreference;
  preferredVariantId: string | null;
  personaClaimIds: string[];
  leftExcerpt: string;
  rightExcerpt: string;
  explanation: string;
};
export class LabEvaluationValidationError extends Error {
  readonly code = 'AUDIENCE_LAB_EVALUATION_INVALID';
  constructor(readonly issue = 'STRUCTURE_INVALID') {
    super('AUDIENCE_LAB_EVALUATION_INVALID');
  }
}
const invalid = (issue?: string): never => {
  throw new LabEvaluationValidationError(issue);
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !record(v) ||
    Object.keys(v).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(v, key))
  )
    return invalid();
  return v;
}
function boundedText(v: unknown, max = 700): string {
  if (typeof v !== 'string' || !v.trim()) return invalid();
  const trimmed = v.trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return invalid();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
function strings(
  v: unknown,
  max: number,
  allowed?: readonly string[],
): string[] {
  if (!Array.isArray(v) || v.length > max) return invalid();
  const result = v.map((item) => {
    let str: unknown = item;
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      str = obj.claim
        ? `${obj.claim}${obj.explanation ? ': ' + obj.explanation : ''}`
        : (obj.text || obj.explanation || obj.question || JSON.stringify(obj));
    }
    return boundedText(str, allowed ? 160 : 700);
  });
  const deduped = [...new Set(result)];
  if (allowed && deduped.some((item) => !allowed.includes(item)))
    return invalid('CLAIM_REFERENCE_INVALID');
  return deduped;
}
function claimRefs(v: unknown, allowed: readonly string[]): string[] {
  const refs = strings(v, 20, allowed);
  if (allowed.length && !refs.length) return invalid('CLAIM_REFERENCE_REQUIRED');
  return refs;
}
function excerpt(v: unknown, creative: string): string {
  const result = boundedText(v, 500);
  if (!creative.includes(result)) return invalid('CREATIVE_EXCERPT_INVALID');
  return result;
}
export function rubricScore(scores: CriterionScores): number {
  if (
    !scores ||
    CRITERIA.some(
      (key) =>
        !Number.isInteger(scores[key]) || scores[key] < 0 || scores[key] > 4,
    )
  )
    return invalid();
  return (
    Math.round(
      25 *
        CRITERIA.reduce(
          (sum, key) => sum + CRITERION_WEIGHTS[key] * scores[key],
          0,
        ) *
        100,
    ) / 100
  );
}
export function validateSingleEvaluation(
  raw: unknown,
  context: SingleEvaluationContext,
): SingleEvaluation {
  const data = exact(raw, [
    'schemaVersion',
    'criterionScores',
    'reasons',
    'intendedAction',
    'unansweredQuestions',
    'unsupportedClaims',
  ]);
  if (
    data.schemaVersion !== 1 ||
    !context.agentId ||
    !context.exposureId ||
    !context.creativeText
  )
    return invalid();
  const ratings = exact(data.criterionScores, CRITERIA);
  const criterionScores = Object.fromEntries(
    CRITERIA.map((key) => [key, ratings[key]]),
  ) as CriterionScores;
  const score = rubricScore(criterionScores);
  if (!Array.isArray(data.reasons) || data.reasons.length !== CRITERIA.length)
    return invalid('REASON_COUNT_INVALID');
  const seen = new Set<string>();
  const reasons = data.reasons.map((value) => {
    const row = exact(value, [
      'criterion',
      'personaClaimIds',
      'creativeExcerpt',
      'explanation',
    ]);
    if (
      !CRITERIA.includes(row.criterion as Criterion) ||
      seen.has(String(row.criterion))
    )
      return invalid('CRITERION_DUPLICATE_OR_UNKNOWN');
    seen.add(String(row.criterion));
    return {
      criterion: row.criterion as Criterion,
      personaClaimIds: claimRefs(row.personaClaimIds, context.personaClaimIds),
      creativeExcerpt: excerpt(row.creativeExcerpt, context.creativeText),
      explanation: boundedText(row.explanation),
    };
  });
  const actions = [
    'skip',
    'inspect',
    'click',
    'ask_question',
    'insufficient_context',
  ];
  if (!actions.includes(String(data.intendedAction))) return invalid();
  const unsupportedClaims = strings(data.unsupportedClaims, 10);
  return {
    schemaVersion: 1,
    agentId: context.agentId,
    exposureId: context.exposureId,
    criterionScores,
    reasons,
    intendedAction: data.intendedAction as SingleEvaluation['intendedAction'],
    unansweredQuestions: strings(data.unansweredQuestions, 10),
    unsupportedClaims,
    score,
    creativeStatus: unsupportedClaims.length ? 'invalid-creative' : 'supported',
  };
}
export function validatePairEvaluation(
  raw: unknown,
  context: PairEvaluationContext,
): PairEvaluation {
  const data = exact(raw, [
    'schemaVersion',
    'preference',
    'personaClaimIds',
    'leftExcerpt',
    'rightExcerpt',
    'explanation',
  ]);
  const preferences: PairPreference[] = [
    'left',
    'right',
    'tie',
    'neither',
    'insufficient_context',
  ];
  if (
    data.schemaVersion !== 1 ||
    !preferences.includes(data.preference as PairPreference) ||
    !context.agentId ||
    !context.exposureId ||
    !context.leftVariantId ||
    !context.rightVariantId ||
    context.leftVariantId === context.rightVariantId
  )
    return invalid();
  const preference = data.preference as PairPreference;
  return {
    schemaVersion: 1,
    agentId: context.agentId,
    exposureId: context.exposureId,
    leftVariantId: context.leftVariantId,
    rightVariantId: context.rightVariantId,
    preference,
    preferredVariantId:
      preference === 'left'
        ? context.leftVariantId
        : preference === 'right'
          ? context.rightVariantId
          : null,
    personaClaimIds: claimRefs(data.personaClaimIds, context.personaClaimIds),
    leftExcerpt: excerpt(data.leftExcerpt, context.leftText),
    rightExcerpt: excerpt(data.rightExcerpt, context.rightText),
    explanation: boundedText(data.explanation),
  };
}
