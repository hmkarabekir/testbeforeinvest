import type { AddressInfo } from 'node:net';
import fixture from '../fixtures/b2b-software.v1.json';
import { server } from '../server.js';
const dataset=fixture;
const variantA={id:'a',format:'text',headline:'CSV ile veri içe aktarma.',body:'CSV ile veri içe aktarma. Kurulum kontrol listesi bulunur.',callToAction:'Planı incele'};
const variantB={...variantA,id:'b',headline:'Kuruluma nereden başlarsınız?'};
let base:string;let oldLive:string|undefined;
const post=async(path:string,value:any)=>{
 const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 return{status:response.status,value:await response.json()};
};
beforeAll(async()=>{
 oldLive=process.env.AUDIENCE_LAB_DISABLE_LIVE;process.env.AUDIENCE_LAB_DISABLE_LIVE='1';
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
});
afterAll(async()=>{
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 if(oldLive===undefined)delete process.env.AUDIENCE_LAB_DISABLE_LIVE;else process.env.AUDIENCE_LAB_DISABLE_LIVE=oldLive;
});
describe('Actual HTTP routes, live inference disabled',()=>{
 it('serves the generic workspace, Merts SVG avatars and stylesheet',async()=>{
  const page=await fetch(base);const html=await page.text();expect(page.status).toBe(200);expect(html).toContain('artifactType');expect(html).toContain('/lab.js');
  const svg=await fetch(base+'/avatars/persona-1.svg');expect(svg.status).toBe(200);expect(svg.headers.get('content-type')).toContain('image/svg+xml');expect(await svg.text()).toContain('Kurgusal');
  expect((await fetch(base+'/lab.css')).status).toBe(200);
 });
 it('completes the browser payload through HTTP without spending model tokens',async()=>{
  const response=await post('/api/run-experiment',{dataset,variantA,variantB,panelMode:'demo',engine:'local',context:{task:'Plan seçmek',surface:'web',objective:'task-completion'}});
  expect(response.status).toBe(200);expect(response.value.evaluationMode).toBe('local-rules');expect(response.value.aggregate.completion.ratio).toBe(1);expect(response.value.timing.calls).toHaveLength(36);
 });
 it('returns a product-bound B and generation mode through HTTP',async()=>{
  const response=await post('/api/derive-b',{dataset,sourceVariantA:variantA,angle:'problem',engine:'local'});
  expect(response.status).toBe(200);expect(response.value.variantB.productId).toBe(dataset.products[0].id);expect(response.value.evaluationMode).toBe('local-rules');
 });
 it('rejects invalid settings, invalid datasets, identical candidates and unsupported local vision',async()=>{
  const basePayload={dataset,variantA,variantB,engine:'local'};
  expect((await post('/api/run-experiment',{...basePayload,repeats:0})).status).toBe(400);
  expect((await post('/api/run-experiment',{...basePayload,dataset:{schemaVersion:1}})).status).toBe(400);
  expect((await post('/api/run-experiment',{...basePayload,variantB:{...variantA,id:'b'}})).status).toBe(400);
 });
 it('blocks any accidental explicit Luna request in this test session',async()=>{
  const response=await post('/api/run-experiment',{dataset,variantA,variantB,engine:'codex',panelMode:'demo'});
  expect(response.status).toBe(400);expect(response.value.code).toBe('AUDIENCE_LAB_LIVE_DISABLED');
 });
 it('imports user-supplied Grok research without synthetic demographics and exposes the copyable prompt',async()=>{
  const response=await post('/api/grok/import',{reportText:'İhtiyaç: Plan kapsamını görmek. Kaynak E1: https://x.com/example/status/123. Bu bir hipotezdir.',engine:'local'});
  expect(response.status).toBe(200);expect(response.value.summary.demographics.gender.male).toBeNull();expect(response.value.dataset.observations).toEqual([]);
  expect((await fetch(base+'/api/grok/prompt')).status).toBe(200);
 });
 it('adds explicitly synthetic pixel events to the data package and reports real buffer counts',async()=>{
  const response=await post('/api/pixel/synthetic/load',{count:12,dataset});
  expect(response.status).toBe(200);expect(response.value.addedCount).toBe(12);expect(response.value.dataset.synthetic).toBe(true);
  expect(response.value.dataset.events.some((e:any)=>e.name==='cta_click'&&e.sourceRef==='src-pixel-demo')).toBe(true);
  const stats=await (await fetch(base+'/api/pixel/events')).json();expect(stats.syntheticEvents).toBeGreaterThanOrEqual(12);expect(stats.collectedEvents).toBe(0);
  expect((await post('/api/pixel/synthetic/load',{count:1e9})).status).toBe(400);
 });
 it('rejects missing social credentials and invalid OAuth state without network calls',async()=>{
  expect((await post('/api/social/fetch',{platform:'facebook',handle:'page',engine:'local'})).status).toBe(400);
  expect((await fetch(base+'/api/auth/meta/callback?code=fake&state=wrong')).status).toBe(400);
 });
});
