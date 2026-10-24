import fixture from '../fixtures/b2b-software.v1.json';
import { generateDemoData, demoCatalog, appendDemoDataset } from '../core/demo-data.js';
import { SocialAudienceIngestionService } from '../core/social-ingestion.js';
import { parseAudienceDataset } from '../core/dataset-contract.js';
import { AudienceLabOrchestrator } from '../orchestrator.js';
import { AudienceLabEngine } from '../inference/index.js';

const asOf='2026-10-24T12:00:00.000Z';
const service=new SocialAudienceIngestionService();
describe('Seeded, varied demo inputs without external models',()=>{
 it.each(demoCatalog().scenarios.map(s=>s.id))('builds a valid large dataset and panel for %s',scenarioId=>{
  const generated=generateDemoData({scenarioId,seed:'test',asOf,size:'large'});
  const data=parseAudienceDataset(generated.dataset);expect(data.synthetic).toBe(true);
  expect(data.content).toHaveLength(180);expect(data.events).toHaveLength(1200);expect(data.research).toHaveLength(18);
  expect(new AudienceLabOrchestrator(new AudienceLabEngine('local')).compilePanel(data).personas.length).toBeGreaterThanOrEqual(3);
 });
 it('reproduces fixed seeds, varies demographics and events for different seeds, and creates fresh defaults',()=>{
  const a=generateDemoData({seed:'one',asOf}),same=generateDemoData({seed:'one',asOf}),b=generateDemoData({seed:'two',asOf});
  expect(a.dataset).toEqual(same.dataset);expect(a.dataset.observations).not.toEqual(b.dataset.observations);
  expect(a.dataset.events).not.toEqual(b.dataset.events);expect(generateDemoData().demo.seed).not.toBe(generateDemoData().demo.seed);
  const summary=service.importFromJson(a.dataset).summary;
  expect(summary.totalAudience).toBeGreaterThan(0);expect(summary.metrics.eventCount).toBe(300);
  expect(summary.provenance.kind).toBe('synthetic-demo');
  expect(Object.values(summary.demographics.ageDistribution).reduce((s,n)=>s+n,0)).toBe(100);
 });
 it.each(['facebook','instagram','grok','pixel'])('builds source-specific %s examples',source=>{
  const result=generateDemoData({source,seed:1,asOf});expect(result.dataset.sources).toHaveLength(1);
  if(source==='grok'){expect(result.reportText).toContain('MÜŞTERİ KARTI 3');expect(result.dataset.research.length).toBeGreaterThan(0);}
  if(source==='pixel')expect(result.dataset.events).toHaveLength(300);
  if(source==='facebook'||source==='instagram')expect(service.importFromJson(result.dataset).summary.metrics.contentCount).toBe(36);
 });
 it('preserves the existing brief when appending demo research and deduplicates identical imports',()=>{
  const original=parseAudienceDataset(fixture);const demo=generateDemoData({source:'grok',seed:8,asOf});
  const merged=appendDemoDataset(original,demo.dataset),again=appendDemoDataset(merged,demo.dataset);
  expect(merged.products).toEqual(original.products);expect(merged.brand).toEqual(original.brand);
  expect(again).toEqual(merged);expect(merged.research.length).toBe(original.research.length+9);
 });
 it('appends three imported Grok cards while preserving product facts',()=>{
  const original=parseAudienceDataset(fixture);const text=[1,2,3].map(i=>`MÜŞTERİ KARTI ${i}: Plan ${i}\nTemel ihtiyaç: Açık koşullar ve somut örnekler görmek istiyorum.`).join('\n\n');
  const result=service.importGrokReport(text,original);
  expect(result.dataset.products).toEqual(original.products);
  expect(result.dataset.research.length).toBe(original.research.length+3);
 });
 it('rejects invalid bounds and changes scenario context instead of forcing a winner',async()=>{
  expect(()=>generateDemoData({size:'huge'})).toThrow('Geçersiz');expect(()=>generateDemoData({scenarioId:'missing'})).toThrow('Geçersiz');
  const lab=new AudienceLabOrchestrator(new AudienceLabEngine('local'));
  const outputs=[];
  for(const scenarioId of ['software-builders','coffee-routine']){
   const input=generateDemoData({scenarioId,seed:'compare',asOf,size:'small'});
   outputs.push(await lab.runExperiment({dataset:input.dataset,...input.sampleExperiment,context:{objective:'consideration',task:'Ürünü değerlendirmek',surface:'content',changedElement:'Ana mesaj'},panelMode:'demo'}));
  }
  expect(outputs[0].datasetHash).not.toBe(outputs[1].datasetHash);
  expect(outputs[0].criterionComparison).not.toEqual(outputs[1].criterionComparison);
 });
});
