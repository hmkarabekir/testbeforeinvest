import fixture from '../fixtures/b2b-software.v1.json';
import { AudienceLabOrchestrator } from '../orchestrator.js';
import { AudienceLabEngine } from '../inference/index.js';
import { analyzeExperiment } from '../core/experiment-analysis.js';
import { aggregateEvaluations, type AggregateInput } from '../core/evaluation-aggregate.js';
import { CRITERIA, validateSingleEvaluation, validatePairEvaluation } from '../core/evaluation-contract.js';
import { normalizeExperimentVariant, experimentContext } from '../core/experiment-input.js';
import { parseAudienceDataset } from '../core/dataset-contract.js';

const dataset = parseAudienceDataset(fixture);
const panel = new AudienceLabOrchestrator(new AudienceLabEngine('local')).compilePanel(dataset);
const persona = { ...panel.personas[0], weight:{value:1,basis:'equal-scenario' as const} };
const a = normalizeExperimentVariant({ id:'a', headline:'CSV ile veri içe aktarma.', format:'text' },dataset,'a');
const b = normalizeExperimentVariant({ id:'b', headline:'Kurulum kontrol listesi bulunur.', format:'text' },dataset,'b');
function row(i:number, preference:'a'|'b'|'tie'='b', scoreA=2, scoreB=3):AggregateInput['results'][number] {
 const single=(side:'a'|'b',score:number)=>validateSingleEvaluation({schemaVersion:1,
  criterionScores:Object.fromEntries(CRITERIA.map(c=>[c,score])),
  reasons:CRITERIA.map(c=>({criterion:c,personaClaimIds:[persona.assumptions[0].id],creativeExcerpt:side==='a'?a.headline:b.headline,explanation:`${side}-${c} gerekçesi`})),
  intendedAction:'inspect',unansweredQuestions:['Planın kapsamı nedir?'],unsupportedClaims:[]},
  {agentId:'agent',exposureId:`single-${side}-${i}`,personaClaimIds:[persona.assumptions[0].id],creativeText:side==='a'?a.headline:b.headline});
 const pair=validatePairEvaluation({schemaVersion:1,preference:preference==='tie'?'tie':preference==='a'?'left':'right',
  personaClaimIds:[persona.assumptions[0].id],leftExcerpt:a.headline,rightExcerpt:b.headline,explanation:`${preference} tercih gerekçesi ${i}`},
  {agentId:'agent',exposureId:`pair-${i}`,leftVariantId:a.id,rightVariantId:b.id,personaClaimIds:[persona.assumptions[0].id],leftText:a.headline,rightText:b.headline});
 return {agentId:'agent',personaId:persona.id,repeatIndex:i,singleA:single('a',scoreA),singleB:single('b',scoreB),pair};
}
function analyze(rows:AggregateInput['results']) {
 const aggregate=aggregateEvaluations({expectedAgents:[{id:'agent',personaId:persona.id}],expectedRepeats:rows.length,
  personas:[persona],results:rows,variantAId:a.id,variantBId:b.id});
 return {aggregate,analysis:analyzeExperiment({rows,personas:[persona],aggregate,variantA:a,variantB:b,context:experimentContext({task:'Plan seçmek'})})};
}
describe('Analysis derived from actual assessments',()=>{
 it('selects a reason matching the majority and retains a contradictory first assessment',()=>{
  const {analysis,aggregate}=analyze([row(0,'a'),row(1,'b'),row(2,'b')]);
  expect(analysis.decision).toBe(aggregate.decision);
  expect(analysis.segments[0]).toMatchObject({preference:'b',consensus:'majority',agreementRatio:0.67});
  expect(analysis.segments[0].representativeReason?.explanation).toBe('b tercih gerekçesi 1');
  expect(analysis.segments[0].counterExamples[0].explanation).toBe('a tercih gerekçesi 0');
  expect(analysis.provenance.additionalModelCalls).toBe(0);
 });
 it('does not turn divided repeats into a confident segment winner',()=>{
  const {analysis}=analyze([row(0,'a'),row(1,'b')]);
  expect(analysis.segments[0]).toMatchObject({preference:'mixed',consensus:'divided',representativeReason:null});
  expect(analysis.diagnostics.dividedSegments).toEqual([persona.id]);
 });
 it('uses a common cohort for criterion comparisons when one arm is missing',()=>{
  const first=row(0,'b',1,3),second=row(1,'b',4,4);delete second.singleB;
  const {analysis}=analyze([first,second]);
  expect(analysis.criteria[0]).toMatchObject({a:1,b:3,delta:2,commonAssessments:1,commonPanelWeight:0.5});
  expect(analysis.diagnostics.coverage).toBeLessThan(1);
  expect(analysis.nextEdits[0].evidenceIds.length).toBeGreaterThan(0);
 });
 it('retains empty scores and questions rather than manufacturing evaluations',()=>{
  const {analysis}=analyze([{agentId:'agent',personaId:persona.id,repeatIndex:0}]);
  expect(analysis.criteria.every(c=>c.a===null&&c.b===null)).toBe(true);
  expect(analysis.nextEdits).toEqual([]);expect(analysis.diagnostics.missingPairWeightPercent).toBe(100);
 });
 it('links edit recommendations and deduplicated questions to actual evidence',()=>{
  const {analysis}=analyze([row(0),row(1)]);
  expect(analysis.unansweredQuestions[0]).toMatchObject({question:'Planın kapsamı nedir?',occurrences:4,variants:['a','b']});
  expect(analysis.criteria[0].evidenceA[0].claims[0]).toMatchObject({id:persona.assumptions[0].id,kind:'assumed'});
  expect(analysis.criteria[0].evidenceA[0].exposureIds).toHaveLength(2);
  expect(analysis.design.changedFields).toEqual(['headline']);
  expect(analysis.design.comparisonScope).toBe('single-field');
 });
 it('gives unsupported claims priority while preserving the original invalid decision',()=>{
  const sample=row(0);sample.singleB={...sample.singleB!,unsupportedClaims:['Garanti kaynağı yok'],creativeStatus:'invalid-creative'};
  const {analysis}=analyze([sample]);expect(analysis.decision).toBe('invalid-creative');
  expect(analysis.nextEdits[0]).toMatchObject({id:'verify-claims',priority:1});
 });
 it('returns audience card data with resolvable records without model calls',()=>{
  expect(panel.analysis.cards).toHaveLength(panel.personas.length);
  expect(panel.analysis.provenance.modelCalls).toBe(0);
  expect(panel.analysis.cards.every(c=>c.evidence.every(e=>e.id&&e.text))).toBe(true);
  expect(panel.analysis.cards.reduce((sum,c)=>sum+c.scenarioWeightPercent,0)).toBeCloseTo(100,0);
 });
});
