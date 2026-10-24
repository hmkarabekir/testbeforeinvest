import fs from 'node:fs';
import path from 'node:path';
import fixture from '../fixtures/b2b-software.v1.json';
import { SocialAudienceIngestionService } from '../core/social-ingestion.js';
import { AudienceLabOrchestrator } from '../orchestrator.js';
import { AudienceLabEngine } from '../inference/index.js';
import { parseAudienceDataset } from '../core/dataset-contract.js';
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const dataset=parseAudienceDataset(fixture);
const service=new SocialAudienceIngestionService();
const lab=new AudienceLabOrchestrator(new AudienceLabEngine('local'));
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'public/lab.js'),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));

async function workspace() {
  const dom=new JSDOM(html,{url:'http://localhost:3345',runScripts:'outside-only'});
  const w=dom.window;const requests:any[]=[];let lastResult:any;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.alert=jest.fn();
  w.fetch=async(url:string,options:any)=>{
    const payload=options?.body?JSON.parse(options.body):null;requests.push({url,payload});
    let value:any={};
    if(url==='/api/fixtures')value={'b2b-software.v1.json':dataset};
    else if(url==='/api/pixel/events')value={totalEvents:0,syntheticEvents:0};
    else if(url==='/api/social/import'){
      const input=service.importFromJson(payload.rawJson),panel=lab.compilePanel(input.dataset);value={...input,panel:{personas:panel.personas}};
    } else if(url==='/api/run-experiment'){
      if(payload.engine!=='local')throw new Error('Test attempted nonlocal inference');
      value=await lab.runExperiment(payload);lastResult=value;
    } else if(url==='/api/derive-b'){
      if(payload.engine!=='local')throw new Error('Test attempted nonlocal generation');
      value=await lab.deriveVariantB(payload);
    } else throw new Error('Unexpected test URL: '+url);
    return {ok:true,json:async()=>value};
  };
  for(const [,inline] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(inline.trim())w.eval(inline);
  w.eval(script);
  for(let i=0;i<100 && !w.OctopiqUI.state.dataset;i++)await pause();
  if(!w.OctopiqUI.state.dataset)throw new Error('Workspace failed to initialize');
  return {dom,w,requests,result:()=>lastResult};
}

describe('Actual workspace DOM, with local service handlers only',()=>{
  let view:any;
  afterEach(()=>{view?.dom.window.close();});
  it('initializes a valid dataset, uses local mode, and renders Merts-style cards with avatars and evidence counts',async()=>{
    view=await workspace();const d=view.w.document;
    expect(d.getElementById('engineSelector').value).toBe('local');
    expect(d.querySelectorAll('.lab-persona')).toHaveLength(6);
    expect(d.querySelector('.lab-avatar img').getAttribute('src')).toBe('/avatars/persona-1.svg');
    expect(d.querySelector('.lab-evidence-bar')).not.toBeNull();
    expect(d.querySelector('.lab-persona').textContent).toContain('varsayım');
    expect(d.getElementById('btnRun').disabled).toBe(false);
    expect(view.requests.some((r:any)=>r.url==='/api/run-experiment')).toBe(false);
    expect(view.w.alert).not.toHaveBeenCalled();
  });
  it('submits actual form context and shows the returned decision, mode, scores and diagnostics',async()=>{
    view=await workspace();const d=view.w.document;
    d.getElementById('testTask').value='Plan seçmek';
    await view.w.OctopiqUI.run();
    const sent=view.requests.find((r:any)=>r.url==='/api/run-experiment').payload;
    expect(sent.context).toMatchObject({task:'Plan seçmek',surface:'web',objective:'task-completion'});
    expect(sent.variantA.productId).toBe(dataset.products[0].id);
    expect(d.getElementById('resEngine').textContent).toContain('model kullanılmadı');
    expect(d.getElementById('resTiming').textContent).toContain('36/36');
    expect(d.querySelectorAll('.lab-segment')).toHaveLength(6);
    expect(d.getElementById('resultsArea').classList.contains('lab-hidden')).toBe(false);
  });
  it('requires the user task before sending inference',async()=>{
    view=await workspace();view.w.document.getElementById('testTask').value='';await view.w.OctopiqUI.run();
    expect(view.requests.some((r:any)=>r.url==='/api/run-experiment')).toBe(false);
    expect(view.w.document.getElementById('labMessage').textContent).toContain('görevi yazın');
  });
  it('preserves supplied HTML and previews it in a sandbox with external requests and scripts disabled',async()=>{
    view=await workspace();const w=view.w,d=w.document;
    d.getElementById('artifactType').value='html';d.getElementById('artifactType').dispatchEvent(new w.Event('change'));
    d.getElementById('artifactContentA').value='<main><h1>Plan A</h1><button>İncele</button></main>';
    d.getElementById('artifactContentB').value='<main><button>İncele</button><h1>Plan B</h1></main>';
    d.getElementById('artifactContentA').dispatchEvent(new w.Event('input'));
    expect(d.getElementById('artifactHtmlA').getAttribute('sandbox')).toBe('');
    expect(d.getElementById('artifactHtmlA').srcdoc).toContain("default-src 'none'");
    await w.OctopiqUI.run();
    const sent=view.requests.find((r:any)=>r.url==='/api/run-experiment').payload;
    expect(sent.variantA.html).toBe(d.getElementById('artifactContentA').value);
    expect(sent.variantA.format).toBe('html');
  });
  it('creates an editable HTML B without replacing it with a fixed unrelated template',async()=>{
    view=await workspace();const w=view.w,d=w.document;
    d.getElementById('artifactType').value='html';
    const original='<main><h1>CSV ile veri içe aktarma.</h1><button>Planı incele</button></main>';
    d.getElementById('artifactContentA').value=original;
    await w.OctopiqUI.derive();
    expect(d.getElementById('artifactContentA').value).toBe(original);
    expect(d.getElementById('artifactContentB').value).toContain('<main>');
    expect(d.getElementById('artifactContentB').value).not.toBe(original);
    expect(d.getElementById('labMessage').textContent).toContain('Yerel örnek');
  });
  it('shows all seven decisions distinctly and retains missing panel weight',async()=>{
    view=await workspace();await view.w.OctopiqUI.run();const result=view.result(),d=view.w.document;
    const labels:any={A:'Panel tercihi: A',B:'Panel tercihi: B',mixed:'Panel bölündü',tie:'Panelde beraberlik',neither:'İki seçenek de tercih edilmedi','insufficient-data':'yeterli bağlam','invalid-creative':'Desteklenmeyen'};
    for(const [decision,label]of Object.entries(labels)){view.w.OctopiqUI.renderResults({...result,summary:{...result.summary,decision}});expect(d.getElementById('resWinnerTitle').textContent).toContain(label);}
    view.w.OctopiqUI.renderResults({...result,summary:{...result.summary,votes:{...result.summary.votes,a:20,b:30,missing:50}}});
    expect(d.getElementById('barVoteA').style.width).toBe('20%');expect(d.getElementById('barVoteB').style.width).toBe('30%');expect(d.getElementById('barVoteTie').style.width).toBe('50%');
  });
  it('does not display an old response after inputs change while a run is pending',async()=>{
    view=await workspace();const w=view.w,d=w.document;
    const original=w.fetch;let release:any;
    w.fetch=async(url:string,options:any)=>url==='/api/run-experiment'?new Promise(resolve=>{release=async()=>resolve(await original(url,options));}):original(url,options);
    const pending=w.OctopiqUI.run();
    d.getElementById('testTask').value='Farklı görev';d.getElementById('testTask').dispatchEvent(new w.Event('input'));
    await release();await pending;
    expect(d.getElementById('labMessage').textContent).toContain('Girdiler değiştiği');
    expect(d.getElementById('resultsArea').classList.contains('lab-hidden')).toBe(true);
  });
  it('keeps imported demographic unknowns unknown and escapes persona content',async()=>{
    view=await workspace();const w=view.w,d=w.document;
    const input=service.createCustomProductDataset({productName:'Signup',facts:['E-posta ile hesap açılır.']});
    const panel=lab.compilePanel(input.dataset);panel.personas[0].title='<img src=x onerror=alert(1)>';
    w.OctopiqUI.renderAudience(input.summary,panel,input.dataset);
    expect(d.getElementById('tdGender').textContent).toContain('Bilinmiyor');expect(d.getElementById('tdCities').textContent).toBe('Bilinmiyor');
    expect(d.querySelector('.lab-persona h3').textContent).toBe('<img src=x onerror=alert(1)>');expect(d.querySelector('.lab-persona h3 img')).toBeNull();
    expect(d.getElementById('activeDatasetLabel').textContent).toContain('beyanı');
  });
});
