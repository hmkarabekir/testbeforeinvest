import {
  rubricScore,
  RUBRIC_VERSION,
  type PairEvaluation,
  type SingleEvaluation,
} from './evaluation-contract.js';

export type PanelWeightBasis =
  | 'observed-disjoint'
  | 'equal-scenario'
  | 'merchant-scenario';
export type AggregateInput = {
  expectedAgents: Array<{ id: string; personaId: string }>;
  expectedRepeats: number;
  personas: Array<{
    id: string;
    weight: { value: number; basis: PanelWeightBasis };
  }>;
  results: Array<{
    agentId: string;
    personaId: string;
    repeatIndex: number;
    singleA?: SingleEvaluation;
    singleB?: SingleEvaluation;
    pair?: PairEvaluation;
  }>;
  variantAId: string;
  variantBId: string;
};
type Vote = 'a' | 'b' | 'tie' | 'neither' | 'insufficientContext' | 'missing';
type Counters = Record<Vote, number>;
const counters = (): Counters => ({
  a: 0,
  b: 0,
  tie: 0,
  neither: 0,
  insufficientContext: 0,
  missing: 0,
});
const round = (n: number) => Math.round(n * 10000) / 10000;
const fail = (): never => {
  throw new Error('AUDIENCE_LAB_AGGREGATE_INVALID');
};

/** A repeated model response is not another human. Missing panel weight remains missing. */
export function aggregateEvaluations(input: AggregateInput) {
  if (
    !input.variantAId ||
    !input.variantBId ||
    input.variantAId === input.variantBId ||
    !Number.isInteger(input.expectedRepeats) ||
    input.expectedRepeats < 1 ||
    input.expectedRepeats > 6 ||
    !input.personas.length ||
    input.personas.length > 8 ||
    !input.expectedAgents.length ||
    input.expectedAgents.length > 64 ||
    new Set(input.personas.map((p) => p.id)).size !== input.personas.length ||
    new Set(input.expectedAgents.map((a) => a.id)).size !==
      input.expectedAgents.length
  )
    return fail();
  const basis = new Set(input.personas.map((p) => p.weight.basis));
  if (
    basis.size !== 1 ||
    input.personas.some(
      (p) =>
        !p.id ||
        !p.weight ||
        !['observed-disjoint', 'equal-scenario', 'merchant-scenario'].includes(
          p.weight.basis,
        ) ||
        !Number.isFinite(p.weight.value) ||
        p.weight.value <= 0 ||
        p.weight.value > 1,
    )
  )
    return fail();
  const totalPanelWeight = input.personas.reduce(
    (sum, p) => sum + p.weight.value,
    0,
  );
  if (
    totalPanelWeight > 1 + 1e-8 ||
    (basis.has('equal-scenario') && Math.abs(totalPanelWeight - 1) > 1e-8) ||
    (basis.has('merchant-scenario') && Math.abs(totalPanelWeight - 1) > 1e-8)
  )
    return fail();
  const agents = new Map(
    input.expectedAgents.map((agent) => [agent.id, agent]),
  );
  const personas = new Map(
    input.personas.map((persona) => [persona.id, persona]),
  );
  const members = new Map<string, number>();
  for (const agent of input.expectedAgents) {
    if (!agent.id || !personas.has(agent.personaId)) return fail();
    members.set(agent.personaId, (members.get(agent.personaId) || 0) + 1);
  }
  if (input.personas.some((p) => !members.get(p.id))) return fail();
  const results = new Map<string, AggregateInput['results'][number]>();
  const exposureIds = new Set<string>();
  for (const row of input.results) {
    const agent = agents.get(row.agentId),
      key = `${row.agentId}:${row.repeatIndex}`;
    if (
      !agent ||
      agent.personaId !== row.personaId ||
      !Number.isInteger(row.repeatIndex) ||
      row.repeatIndex < 0 ||
      row.repeatIndex >= input.expectedRepeats ||
      results.has(key)
    )
      return fail();
    if (
      (row.singleA && row.singleA.agentId !== row.agentId) ||
      (row.singleB && row.singleB.agentId !== row.agentId) ||
      (row.pair &&
        (row.pair.agentId !== row.agentId ||
          new Set([row.pair.leftVariantId, row.pair.rightVariantId]).size !==
            2 ||
          ![row.pair.leftVariantId, row.pair.rightVariantId].every(
            (id) => id === input.variantAId || id === input.variantBId,
          )))
    )
      return fail();
    for (const evaluation of [row.singleA, row.singleB, row.pair])
      if (evaluation) {
        if (!evaluation.exposureId || exposureIds.has(evaluation.exposureId))
          return fail();
        exposureIds.add(evaluation.exposureId);
      }
    results.set(key, row);
  }
  const vote = (pair?: PairEvaluation): Vote => {
    if (!pair) return 'missing';
    if (pair.preference === 'left' || pair.preference === 'right') {
      const id =
        pair.preference === 'left' ? pair.leftVariantId : pair.rightVariantId;
      return id === input.variantAId ? 'a' : 'b';
    }
    if (pair.preference === 'insufficient_context')
      return 'insufficientContext';
    if (pair.preference === 'tie' || pair.preference === 'neither')
      return pair.preference;
    return fail();
  };
  const totalVotes = counters();
  let validTasks = 0,
    validPairs = 0,
    invalidCreatives = 0;
  let commonScoreWeight = 0,
    sumA = 0,
    sumB = 0;
  let comparableOrders = 0,
    consistentOrders = 0;
  const byPersona: Array<{
    personaId: string;
    weight: number;
    expectedTasks: number;
    validTasks: number;
    completionRatio: number;
    votes: Counters;
    scoreA: number | null;
    scoreB: number | null;
  }> = [];
  for (const persona of input.personas) {
    const personaAgents = input.expectedAgents.filter(
      (a) => a.personaId === persona.id,
    );
    const localVotes = counters();
    let localValid = 0,
      localSumA = 0,
      localSumB = 0,
      localCommon = 0;
    const cellWeight =
      persona.weight.value / personaAgents.length / input.expectedRepeats;
    for (const agent of personaAgents) {
      const ordered: PairEvaluation[] = [];
      for (let repeat = 0; repeat < input.expectedRepeats; repeat++) {
        const row = results.get(`${agent.id}:${repeat}`);
        const a = row?.singleA,
          b = row?.singleB,
          pair = row?.pair;
        const goodA = Boolean(
          a && a.creativeStatus === 'supported' && !a.unsupportedClaims.length,
        );
        const goodB = Boolean(
          b && b.creativeStatus === 'supported' && !b.unsupportedClaims.length,
        );
        if (a && !goodA) invalidCreatives++;
        if (b && !goodB) invalidCreatives++;
        const goodTasks = Number(goodA) + Number(goodB) + Number(Boolean(pair));
        validTasks += goodTasks;
        localValid += goodTasks;
        const v = vote(pair);
        totalVotes[v] += cellWeight;
        localVotes[v] += 1 / personaAgents.length / input.expectedRepeats;
        if (pair) {
          validPairs++;
          ordered.push(pair);
        }
        if (goodA && goodB) {
          const scoreA = rubricScore(a!.criterionScores),
            scoreB = rubricScore(b!.criterionScores);
          sumA += scoreA * cellWeight;
          sumB += scoreB * cellWeight;
          commonScoreWeight += cellWeight;
          localSumA += scoreA;
          localSumB += scoreB;
          localCommon++;
        }
      }
      for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1],
          current = ordered[i];
        if (
          previous.leftVariantId !== current.rightVariantId ||
          previous.rightVariantId !== current.leftVariantId ||
          previous.preference === 'insufficient_context' ||
          current.preference === 'insufficient_context'
        )
          continue;
        comparableOrders++;
        if (vote(previous) === vote(current)) consistentOrders++;
      }
    }
    const expected = personaAgents.length * input.expectedRepeats * 3;
    byPersona.push({
      personaId: persona.id,
      weight: persona.weight.value,
      expectedTasks: expected,
      validTasks: localValid,
      completionRatio: round(localValid / expected),
      votes: localVotes,
      scoreA: localCommon ? round(localSumA / localCommon) : null,
      scoreB: localCommon ? round(localSumB / localCommon) : null,
    });
  }
  const expectedTasks = input.expectedAgents.length * input.expectedRepeats * 3;
  const completionRatio = validTasks / expectedTasks;
  const scoreA = commonScoreWeight ? sumA / commonScoreWeight : null;
  const scoreB = commonScoreWeight ? sumB / commonScoreWeight : null;
  const delta = scoreA === null || scoreB === null ? null : scoreA - scoreB;
  const orderConsistency = comparableOrders
    ? consistentOrders / comparableOrders
    : null;
  const orderCoverage =
    comparableOrders /
    (input.expectedAgents.length * Math.max(1, input.expectedRepeats - 1));
  const hasCoverage =
    completionRatio >= 0.9 && byPersona.every((p) => p.completionRatio >= 0.8);
  const supportA = totalVotes.a >= 0.6 - 1e-9,
    supportB = totalVotes.b >= 0.6 - 1e-9;
  const orderOK =
    orderConsistency !== null &&
    orderConsistency >= 0.8 &&
    orderCoverage >= 0.8;
  let decision:
    | 'A'
    | 'B'
    | 'mixed'
    | 'tie'
    | 'neither'
    | 'insufficient-data'
    | 'invalid-creative';
  if (invalidCreatives) decision = 'invalid-creative';
  else if (!hasCoverage) decision = 'insufficient-data';
  else if (totalVotes.insufficientContext >= 0.5)
    decision = 'insufficient-data';
  else if (orderOK && supportA && delta !== null && delta >= 5) decision = 'A';
  else if (orderOK && supportB && delta !== null && delta <= -5) decision = 'B';
  else if (totalVotes.neither >= 0.5) decision = 'neither';
  else if (
    Math.abs(totalVotes.a - totalVotes.b) < 1e-9 &&
    totalVotes.tie >= 0.25
  )
    decision = 'tie';
  else decision = 'mixed';
  const preferences = (weights: number[]) =>
    byPersona.reduce(
      (acc, persona, index) => ({
        a: acc.a + persona.votes.a * weights[index],
        b: acc.b + persona.votes.b * weights[index],
      }),
      { a: 0, b: 0 },
    );
  const original = byPersona.map((p) => p.weight);
  const sensitivity = [
    { label: 'baseline', ...preferences(original) },
    {
      label: 'equal-scenario',
      ...preferences(byPersona.map(() => totalPanelWeight / byPersona.length)),
    },
  ];
  for (let i = 0; i < original.length; i++)
    for (const factor of [0.8, 1.2]) {
      const modified = original.map((w, j) => w * (i === j ? factor : 1));
      const sum = modified.reduce((a, b) => a + b, 0);
      sensitivity.push({
        label: `persona-${i + 1}-${factor}`,
        ...preferences(modified.map((w) => (w / sum) * totalPanelWeight)),
      });
    }
  const direction = (a: number, b: number) =>
    Math.abs(a - b) < 1e-9 ? 'tie' : a > b ? 'A' : 'B';
  const warnings: string[] = [];
  if (!hasCoverage) warnings.push('INCOMPLETE_PANEL_COVERAGE');
  if (!orderOK) warnings.push('ORDER_STABILITY_UNPROVEN');
  if (
    delta !== null &&
    ((totalVotes.a > totalVotes.b && delta < 0) ||
      (totalVotes.b > totalVotes.a && delta > 0))
  )
    warnings.push('SCORE_PREFERENCE_DISAGREEMENT');
  const stable = sensitivity.every(
    (s) => direction(s.a, s.b) === direction(totalVotes.a, totalVotes.b),
  );
  if (!stable) warnings.push('SCENARIO_WEIGHT_SENSITIVE');
  if (totalPanelWeight < 1 - 1e-9)
    warnings.push('UNREPRESENTED_POPULATION_WEIGHT');
  return {
    schemaVersion: 1 as const,
    rubricVersion: RUBRIC_VERSION,
    decision,
    recommendation:
      decision === 'A'
        ? input.variantAId
        : decision === 'B'
          ? input.variantBId
          : null,
    weightBasis: input.personas[0].weight.basis,
    preferenceDenominator: 'entire-panel-including-missing' as const,
    preferencePercent: {
      ...Object.fromEntries(
        Object.entries(totalVotes).map(([k, v]) => [k, round(v * 100)]),
      ),
      unrepresented: round((1 - totalPanelWeight) * 100),
    } as Record<Vote | 'unrepresented', number>,
    completion: {
      expectedTasks,
      validTasks,
      failedOrMissingTasks: expectedTasks - validTasks,
      ratio: round(completionRatio),
      expectedPairJudgments:
        input.expectedAgents.length * input.expectedRepeats,
      validPairJudgments: validPairs,
    },
    scores: {
      a: scoreA === null ? null : round(scoreA),
      b: scoreB === null ? null : round(scoreB),
      delta: delta === null ? null : round(delta),
      commonPanelWeight: round(commonScoreWeight),
    },
    orderStability: {
      comparablePairs: comparableOrders,
      consistentPairs: consistentOrders,
      consistency: orderConsistency === null ? null : round(orderConsistency),
      coverage: round(orderCoverage),
    },
    personas: byPersona.map((p) => ({
      ...p,
      votes: Object.fromEntries(
        Object.entries(p.votes).map(([k, v]) => [k, round(v)]),
      ),
    })),
    sensitivity: {
      kind: 'scenario-sensitivity-not-confidence-interval' as const,
      directionStable: stable,
      scenarios: sensitivity.map((s) => ({
        label: s.label,
        a: round(s.a * 100),
        b: round(s.b * 100),
        direction: direction(s.a, s.b),
      })),
    },
    warnings,
  };
}
