import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import fixture from '../fixtures/b2b-software.v1.json';
import { parseAudienceDataset } from '../core/dataset-contract.js';
import { XgBoostPersonaService, ML_FEATURE_NAMES } from '../ml/xgboost-bridge.js';

let artifactDir:string;
const features=[4.5,0.04,0.85,1,0.08,4.2,0.75,0.15,0.35,3.2,0.06,85,65,0,1,1];
beforeEach(()=>{
 artifactDir=mkdtempSync(join(tmpdir(),'octopiq-ml-test-'));
 const model='{"testArtifact":true}';writeFileSync(join(artifactDir,'xgboost_persona_model.json'),model);
 writeFileSync(join(artifactDir,'training_receipt.json'),JSON.stringify({status:'trained',engine:'xgboost-test',dataset:{featureNames:ML_FEATURE_NAMES},artifact:{sha256:createHash('sha256').update(model).digest('hex')}}));
});
afterEach(()=>{jest.restoreAllMocks();rmSync(artifactDir,{recursive:true,force:true});});
function mockProcess(output:unknown, mode:'success'|'error'|'pending'='success') {
 const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=jest.fn();
 jest.spyOn(childProcess,'spawn').mockImplementation((()=>{
  queueMicrotask(()=>{if(mode==='pending')return;if(mode==='error')child.emit('error',new Error('ENOENT'));
   else {child.stdout.write(typeof output==='string'?output:JSON.stringify(output));child.emit('close',0);}});return child;
 }) as any);return child;
}
const validOutput=()=>({dominantPersona:'Persona 0',dominantIndex:0,personaScores:[0.7,0.1,0.05,0.05,0.05,0.05].map((probability,index)=>({index,label:`Persona ${index}`,probability,isDominant:index===0,recommendedWeight:Math.max(0.05,probability)})),featuresUsed:{}});
describe('Local ML reliability without training or Luna calls',()=>{
 it('preserves the demo features and reports which ones use defaults',()=>{
  const service=new XgBoostPersonaService({artifactDir});const dataset=parseAudienceDataset(fixture);
  const report=service.extractFeatureReport(dataset);
  expect(report.values).toEqual(service.extractFeaturesFromDataset(dataset));
  expect(Object.keys(report.values)).toHaveLength(16);
  expect(report.features.find(f=>f.name==='pixel_avg_dwell_sec')).toMatchObject({value:75,basis:'assumed'});
  expect(report.features.find(f=>f.name==='has_proof_facts')?.basis).toBe('computed');
  expect(report.assumedFeatures+report.measuredOrComputedFeatures).toBe(16);
 });
 it('checks artifact hashes before dispatching a prediction',async()=>{
  const service=new XgBoostPersonaService({artifactDir});expect(service.getReceipt()?.provenance?.artifactVerified).toBe(true);
  writeFileSync(join(artifactDir,'xgboost_persona_model.json'),'changed');const spawn=jest.spyOn(childProcess,'spawn');
  await expect(service.predict(features)).rejects.toMatchObject({code:'ML_MODEL_NOT_READY'});expect(spawn).not.toHaveBeenCalled();
 });
 it('converts Meta count cells using their source denominator and keeps defaults when it is absent',()=>{
  const service=new XgBoostPersonaService({artifactDir});const dataset=parseAudienceDataset(fixture);const sourceRef=dataset.sources[0].id;
  dataset.sources[0].platform='instagram';
  const common={sourceRef,dimensions:{},unit:'count' as const,status:'observed' as const,denominatorRef:null,observedAt:dataset.asOf};
  dataset.observations=[{...common,id:'ml-total',metric:'followers_count',value:200},
   {...common,id:'ml-male',metric:'follower_demographics',dimensions:{gender:'M'},value:120,denominatorRef:'ml-total'}];
  let report=service.extractFeatureReport(dataset);
  expect(report.values.ig_male_ratio).toBe(0.6);expect(report.values.ig_followers_log).toBeCloseTo(Math.log10(200));
  expect(report.features.find(f=>f.name==='ig_male_ratio')?.evidenceRefs).toContain('observation:ml-total');
  dataset.observations[1].denominatorRef=null;report=service.extractFeatureReport(dataset);
  expect(report.values.ig_male_ratio).toBe(0.6);expect(report.features.find(f=>f.name==='ig_male_ratio')?.basis).toBe('assumed');
 });
 it('rejects malformed feature inputs and oversized training before creating processes',async()=>{
  const service=new XgBoostPersonaService({artifactDir});const spawn=jest.spyOn(childProcess,'spawn');
  for(const input of [[],{},features.slice(1),features.map((v,i)=>i===0?NaN:v),features.map((v,i)=>i===2?2:v)])
   await expect(service.predict(input)).rejects.toMatchObject({code:'ML_FEATURES_INVALID',status:400});
  await expect(service.train(1e9)).rejects.toMatchObject({code:'ML_SAMPLE_COUNT_INVALID',status:400});expect(spawn).not.toHaveBeenCalled();
 });
 it('returns original scores plus timing, normalized scenario weights and model identity',async()=>{
  mockProcess(validOutput());const service=new XgBoostPersonaService({artifactDir});const result=await service.predictDataset(parseAudienceDataset(fixture));
  expect(result.personaScores).toEqual(validOutput().personaScores);
  expect(result.provenance?.trainingData).toBe('synthetic');expect(result.model?.latencyMs).toBeGreaterThan(0);
  expect(result.scenarioWeights?.reduce((sum,s)=>sum+s.weight,0)).toBeCloseTo(1,4);
  expect(result.diagnostics).toMatchObject({inputBasis:'dataset',separation:'clear'});
  expect(result.featureReport?.values).toHaveProperty('ig_followers_log');
 });
 it('rejects invalid JSON and malformed model scores',async()=>{
  mockProcess('not JSON');const service=new XgBoostPersonaService({artifactDir});
  await expect(service.predict(features)).rejects.toMatchObject({code:'ML_OUTPUT_INVALID'});
  jest.restoreAllMocks();const bad=validOutput();bad.personaScores[0].probability=4;mockProcess(bad);
  await expect(service.predict(features)).rejects.toMatchObject({code:'ML_OUTPUT_INVALID'});
 });
 it('handles missing Python and kills a timed-out process',async()=>{
  mockProcess(null,'error');const service=new XgBoostPersonaService({artifactDir});
  await expect(service.predict(features)).rejects.toMatchObject({code:'ML_RUNTIME_UNAVAILABLE'});
  jest.restoreAllMocks();const child=mockProcess(null,'pending');
  await expect(new XgBoostPersonaService({artifactDir,timeoutMs:10}).predict(features)).rejects.toMatchObject({code:'ML_TIMEOUT'});
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
 });
 it('bounds training concurrency and clears the lock after failure',async()=>{
  mockProcess(null,'pending');const service=new XgBoostPersonaService({artifactDir,timeoutMs:15});
  const first=service.train(600);const rejected=expect(first).rejects.toMatchObject({code:'ML_TIMEOUT'});
  await expect(service.train(600)).rejects.toMatchObject({code:'ML_TRAINING_BUSY',status:409});await rejected;
  jest.restoreAllMocks();mockProcess(validOutput());await expect(service.predict(features)).resolves.toHaveProperty('dominantIndex',0);
 });
});
