import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fixture from '../fixtures/b2b-software.v1.json';
import { parseAudienceDataset } from '../core/dataset-contract.js';
import { normalizeExperimentVariant } from '../core/experiment-input.js';
import { AudienceLabOrchestrator } from '../orchestrator.js';
import { AudienceLabEngine } from '../inference/index.js';
import { CodexCliEvaluator } from '../inference/codex-cli.js';
import { SocialAudienceIngestionService } from '../core/social-ingestion.js';
import type { InferencePort } from '../core/types.js';

const dataset = parseAudienceDataset(fixture);
const A = { id:'a', format:'text', headline:'CSV ile veri içe aktarma.', body:'CSV ile veri içe aktarma. Kurulum kontrol listesi bulunur.', callToAction:'Planı incele' };
const B = { ...A, id:'b', headline:'Kuruluma nereden başlarsınız?' };
const image = { name:'screen.png', mimeType:'image/png' as const, data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=' };
afterEach(()=>jest.restoreAllMocks());

describe('Generic inputs and images',()=>{
  it('normalizes browser payloads without invented product identity or lost HTML',async()=>{
    const result=await new AudienceLabOrchestrator(new AudienceLabEngine('local')).runExperiment({dataset,variantA:A,variantB:B,panelMode:'demo',context:{objective:'task-completion',task:'Plan seçmek',surface:'web',changedElement:'Başlık'}});
    expect(result.variantA.productId).toBe(dataset.products[0].id);
    expect(result.context).toMatchObject({task:'Plan seçmek',objective:'task-completion',surface:'web'});
    expect(result.aggregate.completion.ratio).toBe(1);
  });
  it('rejects empty, identical, malformed image, and foreign-product inputs before inference',async()=>{
    const engine=new AudienceLabEngine('local');const infer=jest.spyOn(engine,'infer');const lab=new AudienceLabOrchestrator(engine);
    await expect(lab.runExperiment({dataset,variantA:{},variantB:B})).rejects.toThrow('AUDIENCE_LAB_EXPERIMENT_INVALID');
    await expect(lab.runExperiment({dataset,variantA:A,variantB:{...A,id:'b'}})).rejects.toThrow('AUDIENCE_LAB_IDENTICAL_VARIANTS');
    expect(()=>normalizeExperimentVariant({...A,images:[{...image,data:Buffer.from('<script>x</script>').toString('base64')}]},dataset,'a')).toThrow();
    expect(()=>normalizeExperimentVariant({...A,productId:'foreign'},dataset,'a')).toThrow();
    expect(infer).not.toHaveBeenCalled();
  });
  it('never claims that local rules inspected uploaded pixels',async()=>{
    const lab=new AudienceLabOrchestrator(new AudienceLabEngine('local'));
    await expect(lab.runExperiment({dataset,variantA:{...A,format:'screen',images:[image]},variantB:{...B,format:'screen',images:[image]}})).rejects.toThrow('AUDIENCE_LAB_VISION_REQUIRES_MODEL');
  });
  it('sends the correct arm images and task in both pair orders (mock model only)',async()=>{
    const local=new AudienceLabEngine('local');const requests:any[]=[];
    const mock:InferencePort={configuration:()=>({ready:true,provider:'codex',model:'gpt-6-luna'}),infer:async request=>{
      requests.push(request);
      const result=await local.infer({...request,images:[]});
      return {...result,receipt:{...result.receipt,provider:'codex',requestedModel:'gpt-6-luna'}};
    }};
    const rightImage={...image,name:'new-screen.png'};
    await new AudienceLabOrchestrator(mock).runExperiment({dataset,variantA:{...A,format:'screen',images:[image]},variantB:{...B,format:'screen',images:[rightImage]},panelMode:'demo',context:{task:'Kayıt olmak',objective:'task-completion',surface:'mobile'}});
    const pairs=requests.filter(r=>r.task==='pair-evaluation');
    expect(pairs[0].images.map((i:any)=>i.name)).toEqual(['screen.png','new-screen.png']);
    expect(pairs.find(r=>r.images[0].name==='new-screen.png')).toBeDefined();
    for(const request of pairs){const input=JSON.parse(request.prompt);expect(input.exposure.task).toBe('Kayıt olmak');expect(input.left.attachments[0].attachmentIndex).toBe(1);expect(input.right.attachments[0].attachmentIndex).toBe(2);}
    expect(requests[0].prompt).not.toContain(image.data);
  });
  it('writes actual image bytes and supplies --image to the CLI without launching a real process',async()=>{
    jest.spyOn(CodexCliEvaluator.prototype,'isAvailable').mockReturnValue(true);
    const child:any=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:jest.fn()});
    let workDir='';
    jest.spyOn(childProcess,'spawn').mockImplementation(((_bin:string,args:string[],options:any)=>{
      workDir=options.cwd;
      const file=args[args.indexOf('--image')+1];
      expect(fs.readFileSync(file).equals(Buffer.from(image.data,'base64'))).toBe(true);
      process.nextTick(()=>{fs.writeFileSync(args[args.indexOf('-o')+1],'{}');child.emit('close',0);});return child;
    }) as any);
    await new CodexCliEvaluator().infer({system:'test',prompt:'{}',images:[image]});
    expect(fs.existsSync(workDir)).toBe(false);
  });
});

describe('Alternative generation',()=>{
  it('returns a valid product-bound alternative using only local rules',async()=>{
    const result=await new AudienceLabOrchestrator(new AudienceLabEngine('local')).deriveVariantB({dataset,sourceVariantA:A,angle:'problem'});
    expect(result.variantB.productId).toBe(dataset.products[0].id);
    expect(result.variantB.body).toBe(A.body);expect(result.variantB.callToAction).toBe(A.callToAction);
    expect(result.variantB.headline).not.toBe(A.headline);expect(result.evaluationMode).toBe('local-rules');
  });
  it('rejects malformed or unchanged model output without silently copying A',async()=>{
    const local=new AudienceLabEngine('local');const engine:InferencePort={configuration:()=>local.configuration(),infer:async request=>({...await local.infer(request),value:{variants:[]}})};
    await expect(new AudienceLabOrchestrator(engine).deriveVariantB({dataset,sourceVariantA:A})).rejects.toThrow('AUDIENCE_LAB_DERIVATION_INVALID');
  });
  it('keeps HTML structure and generates an actual editable HTML change locally',async()=>{
    const html='<main><h1>CSV ile veri içe aktarma.</h1><button>Planı incele</button></main>';
    const result=await new AudienceLabOrchestrator(new AudienceLabEngine('local')).deriveVariantB({dataset,sourceVariantA:{...A,format:'html',html},angle:'concise',testedVariable:'bundle'});
    expect(result.variantB.html).toContain('<main>');expect(result.variantB.html).not.toBe(html);
    expect(result.variantB.format).toBe('html');
  });
});

describe('Source provenance',()=>{
  it('requires explicit demo mode instead of fabricating data after a missing token',async()=>{
    const service=new SocialAudienceIngestionService();
    await expect(service.ingestSocialAudience({platform:'facebook',handle:'demo'})).rejects.toThrow('SOCIAL_TOKEN_REQUIRED');
    const result=await service.ingestSocialAudience({platform:'facebook',handle:'demo',demo:true});
    expect(result.dataset.synthetic).toBe(true);expect(result.summary.provenance.kind).toBe('synthetic-demo');
  });
  it('fails invalid Meta responses instead of returning synthetic:false with fake counts',async()=>{
    jest.spyOn(global,'fetch').mockImplementation(async()=>new Response(JSON.stringify({error:{message:'invalid token'}}),{status:400}));
    await expect(new SocialAudienceIngestionService().ingestSocialAudience({platform:'facebook',handle:'page',accessToken:'not-real'})).rejects.toThrow('META_REQUEST_FAILED');
  });
  it('keeps unavailable Facebook demographics null and counts only actual returned values',async()=>{
    jest.spyOn(global,'fetch').mockImplementation(async input=>{
      const url=String(input);
      const value=url.includes('/me/accounts')?{data:[{id:'page',name:'Page'}]}:url.includes('published_posts')?{data:[]}: {id:'page',name:'Page',followers_count:431};
      return new Response(JSON.stringify(value));
    });
    const result=await new SocialAudienceIngestionService().ingestSocialAudience({platform:'facebook',handle:'page',accessToken:'not-real'});
    expect(result.summary.totalAudience).toBe(431);expect(result.dataset.sources[0].platform).toBe('facebook');
    expect(result.summary.demographics.gender).toEqual({male:null,female:null});expect(result.summary.demographics.topCities).toEqual([]);
  });
  it('routes professional Instagram to its own account and parses only returned breakdowns',async()=>{
    const urls:string[]=[];jest.spyOn(global,'fetch').mockImplementation(async input=>{
      const url=String(input);urls.push(url);
      const value=url.includes('/me/accounts')?{data:[{id:'page',name:'Page',instagram_business_account:{id:'ig'}}]}:url.includes('/ig?')?{id:'ig',username:'account',followers_count:1000}:url.includes('breakdown=gender')?{data:[{total_value:{breakdowns:[{results:[{dimension_values:['F'],value:300},{dimension_values:['M'],value:200}]}]}}]}:{data:[]};
      return new Response(JSON.stringify(value));
    });
    const result=await new SocialAudienceIngestionService().ingestSocialAudience({platform:'instagram',handle:'page',accessToken:'not-real'});
    expect(urls.some(u=>u.includes('/ig/insights'))).toBe(true);expect(result.dataset.sources[0].platform).toBe('instagram');
    expect(result.summary.demographics.gender).toEqual({male:20,female:30});
  });
  it('imports Grok hypotheses without invented demographics, posts, engagement, or product features',()=>{
    const report='İhtiyaç: Fiyatlandırmayı açık görmek. Kaynak E1: https://x.com/example/status/123. Bu bir kitle hipotezidir.';
    const result=new SocialAudienceIngestionService().importGrokReport(report);
    expect(result.dataset.observations).toEqual([]);expect(result.dataset.content).toEqual([]);
    expect(result.summary.totalAudience).toBeNull();expect(result.summary.provenance.kind).toBe('declared-research');
    expect(result.dataset.research.map(r=>r.statement).join('')).toContain('https://x.com/example/status/123');
    expect(result.dataset.products[0].facts.some(f=>f.text.includes('Fiyatlandırmayı açık görmek'))).toBe(false);
  });
  it('does not turn a declared brief into observed demographic or engagement data',()=>{
    const result=new SocialAudienceIngestionService().createCustomProductDataset({productName:'Signup',facts:['E-posta ile hesap açılır.'],samplePosts:['Üye olmak istiyorum.'],region:'Global'});
    expect(result.dataset.observations).toEqual([]);expect(result.dataset.content[0].likes).toBeNull();
    expect(result.summary.demographics.topCities).toEqual([]);expect(result.summary.demographics.gender.male).toBeNull();
  });
});
