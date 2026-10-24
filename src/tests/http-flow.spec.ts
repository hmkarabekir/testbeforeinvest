import type { AddressInfo } from 'node:net';
import fixture from '../fixtures/b2b-software.v1.json';
import { server } from '../server.js';
import { XgBoostPersonaService } from '../ml/xgboost-bridge.js';
const dataset=fixture;
const variantA={id:'a',format:'text',headline:'CSV ile veri içe aktarma.',body:'CSV ile veri içe aktarma. Kurulum kontrol listesi bulunur.',callToAction:'Planı incele'};
const variantB={...variantA,id:'b',headline:'Kuruluma nereden başlarsınız?'};
let base:string;let oldLive:string|undefined;
const httpFetch=global.fetch;
const post=async(path:string,value:any)=>{
 const response=await httpFetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 return{status:response.status,value:await response.json()};
};
afterEach(()=>jest.restoreAllMocks());
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
 it('exposes analysis for result cards without additional inference',async()=>{
  const response=await post('/api/run-experiment',{dataset,variantA,variantB,panelMode:'demo',engine:'local'});
  expect(response.status).toBe(200);expect(response.value.analysis.decision).toBe(response.value.aggregate.decision);
  expect(response.value.analysis.provenance.additionalModelCalls).toBe(0);expect(response.value.analysis.criteria).toHaveLength(6);
  expect(response.value.analysis.segments).toHaveLength(6);expect(response.value.evaluations).toHaveLength(12);
 });
 it('keeps audience cards available if optional ML cannot run',async()=>{
  jest.spyOn(XgBoostPersonaService.prototype,'predictDataset').mockRejectedValue(Object.assign(new Error('missing'),{code:'ML_RUNTIME_UNAVAILABLE'}));
  const response=await post('/api/audience-analysis',{dataset,engine:'local',includeMl:true});
  expect(response.status).toBe(200);expect(response.value.personasCount).toBe(6);
  expect(response.value.analysis.cards).toHaveLength(6);expect(response.value.ml).toEqual({status:'unavailable',code:'ML_RUNTIME_UNAVAILABLE'});
 });
 it('rejects invalid ML requests before starting Python or training',async()=>{
  expect((await post('/api/ml/predict',{features:[1]})).status).toBe(400);
  expect((await post('/api/ml/train',{numSamples:1e9})).status).toBe(400);
  const status=await (await fetch(base+'/api/ml/status')).json();expect(status.receipt.provenance.trainingData).toBe('synthetic');
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
 it('loads varied JSON, Grok and social demo inputs and serves a downloadable JSON package',async()=>{
  const catalog=await (await httpFetch(base+'/api/demo/catalog')).json();expect(catalog.scenarios).toHaveLength(12);
  const first=await post('/api/demo/load',{scenarioId:'coffee-routine',seed:'first',size:'small'});
  const second=await post('/api/demo/load',{scenarioId:'coffee-routine',seed:'second',size:'small'});
  expect(first.status).toBe(200);expect(first.value.summary.totalAudience).not.toBe(second.value.summary.totalAudience);
  expect(first.value.summary.metrics.contentCount).toBe(24);
  const grok=await post('/api/grok/synthetic/load',{scenarioId:'software-teams',seed:2,dataset});
  expect(grok.status).toBe(200);expect(grok.value.dataset.products).toEqual(dataset.products);expect(grok.value.reportText).toContain('MÜŞTERİ KARTI 3');
  const social=await post('/api/social/synthetic/load',{platform:'facebook',seed:3});expect(social.status).toBe(200);expect(social.value.summary.provenance.kind).toBe('synthetic-demo');
  const download=await httpFetch(base+'/api/demo/export?source=json&seed=export');expect(download.status).toBe(200);expect(download.headers.get('content-disposition')).toContain('.json');
  expect((await download.json()).schemaVersion).toBe(1);
  expect((await post('/api/demo/load',{size:'huge'})).status).toBe(400);
 });
 it('creates a usable panel from pixel-only demo input without requiring a connected audience',async()=>{
  const response=await post('/api/pixel/synthetic/load',{count:24,scenario:'high-intent',seed:'pixel-alone'});
  expect(response.status).toBe(200);expect(response.value.panel.personasCount).toBe(6);
  expect(response.value.dataset.events).toHaveLength(24);expect(response.value.summary.metrics.eventCount).toBe(24);
  const merged=await post('/api/social/multi-fetch',{includePixel:true,engine:'local'});
  expect(merged.status).toBe(200);expect(merged.value.dataset.synthetic).toBe(true);
  expect(merged.value.dataset.events.some((e:any)=>e.name==='cta_click')).toBe(true);
 });
 it('uses Instagram authorization and Instagram Graph without sending the user through Facebook',async()=>{
  const before={id:process.env.INSTAGRAM_APP_ID,secret:process.env.INSTAGRAM_APP_SECRET};
  try{
   process.env.INSTAGRAM_APP_ID='test-ig-id';process.env.INSTAGRAM_APP_SECRET='test-ig-secret';
   const config=await (await httpFetch(base+'/api/auth/instagram/config')).json();
   const auth=new URL(config.oauthUrl);expect(auth.hostname).toBe('www.instagram.com');expect(auth.searchParams.get('enable_fb_login')).toBe('0');
   const outgoing:string[]=[];jest.spyOn(global,'fetch').mockImplementation(async(input:any)=>{
    const url=String(input);outgoing.push(url);
    const body=url.includes('api.instagram.com/oauth')?{access_token:'fake-ig-token'}:url.includes('/me?')?{user_id:'ig-test',username:'demo'}:
     url.includes('/ig-test?')?{id:'ig-test',username:'demo',followers_count:287}:{data:[]};
    return new Response(JSON.stringify(body));
   });
   const callback=await httpFetch(base+'/api/auth/instagram/callback?code=fake&state='+auth.searchParams.get('state'));
   expect(callback.status).toBe(200);expect(await callback.text()).toContain('META_AUTH_SUCCESS');
   expect(outgoing.some(url=>url.includes('graph.instagram.com'))).toBe(true);expect(outgoing.some(url=>url.includes('facebook.com'))).toBe(false);
   expect((await httpFetch(base+'/api/auth/instagram/callback?code=fake&state='+auth.searchParams.get('state'))).status).toBe(400);
  }finally{
   if(before.id===undefined)delete process.env.INSTAGRAM_APP_ID;else process.env.INSTAGRAM_APP_ID=before.id;
   if(before.secret===undefined)delete process.env.INSTAGRAM_APP_SECRET;else process.env.INSTAGRAM_APP_SECRET=before.secret;
  }
 });
});
