import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAudienceDataset } from './dataset-contract.js';
import { hashCanonical } from './dataset-normalizer.js';
import type { AudienceDatasetV1 } from './types.js';

export class DemoDataError extends Error { readonly code = 'DEMO_OPTIONS_INVALID'; readonly status = 400; }
const scenarios = [
  { id:'software-builders', title:'Yazılım · bağımsız geliştiriciler', fixture:'b2b-software', focus:['api entegrasyon','kurulum adımları','veri aktarımı'], behavior:'explore' },
  { id:'software-teams', title:'Yazılım · ekip ve güvenlik', fixture:'b2b-software', focus:['ekip rol yetki','güvenlik ve veri','plan fiyat kota'], behavior:'compare' },
  { id:'software-buyers', title:'Yazılım · satın alma kararı', fixture:'b2b-software', focus:['fiyat plan kapsamı','kanıt örnek entegrasyon','destek kurulum'], behavior:'high-intent' },
  { id:'coffee-explorers', title:'Kahve · tat keşfi', fixture:'specialty-coffee', focus:['tat aroma nota','köken çekirdek bölge','demleme ekipmanı'], behavior:'explore' },
  { id:'coffee-routine', title:'Kahve · pratik günlük kullanım', fixture:'specialty-coffee', focus:['pratik hazırlama tarif','paket fiyat gram','abonelik düzenli sipariş'], behavior:'high-intent' },
  { id:'coffee-gifts', title:'Kahve · hediye seçimi', fixture:'specialty-coffee', focus:['hediye kutusu seçki','tat aroma','teslimat paket'], behavior:'compare' },
  { id:'furniture-small-space', title:'Mobilya · küçük alanlar', fixture:'furniture-studio', focus:['ölçü küçük alan boyut','modüler katlanabilir','teslimat kurulum'], behavior:'compare' },
  { id:'furniture-design', title:'Mobilya · tasarım ve malzeme', fixture:'furniture-studio', focus:['tasarım renk dekor','malzeme ahşap bakım','mekan uyumu'], behavior:'explore' },
  { id:'furniture-value', title:'Mobilya · toplam maliyet', fixture:'furniture-studio', focus:['fiyat toplam bedel','teslimat kurulum kargo','dayanıklılık bakım'], behavior:'high-intent' },
  { id:'creator-beginners', title:'İçerik · yeni başlayanlar', fixture:'personal-brand-creator', focus:['adım adım rehber şablon','başlangıç için pratik örnek','nasıl yapılır taktik'], behavior:'explore' },
  { id:'creator-technical', title:'İçerik · teknik derinlik', fixture:'personal-brand-creator', focus:['teknik mimari kod api','benchmark kanıt analiz','open source developer araçları'], behavior:'compare' },
  { id:'creator-builders', title:'İçerik · kurucu yolculuğu', fixture:'personal-brand-creator', focus:['kurucu yolculuk deneyim','hata öğrenim buildinpublic','hızlı otomasyon verim'], behavior:'high-intent' },
] as const;
export type DemoSource = 'json' | 'mixed' | 'facebook' | 'instagram' | 'grok' | 'pixel';
const sizes = { small:{posts:12,events:60,research:3}, medium:{posts:36,events:300,research:9}, large:{posts:90,events:1200,research:18} };
export function demoCatalog() { return { scenarios:scenarios.map(({id,title,behavior})=>({id,title,behavior})),
  sources:['json','mixed','facebook','instagram','grok','pixel'], sizes,
  pixelScenarios:[{id:'explore',title:'Keşif ağırlıklı'},{id:'compare',title:'Fiyat ve plan araştırması'},{id:'high-intent',title:'Eylem ağırlıklı'}],
  defaults:{scenarioId:'software-builders',source:'json',size:'medium'}, seedBehavior:'Omitted seed creates a new sample; fixed seed reproduces the same sample at fixed asOf.' }; }
export function seededRandom(seed:string) {
  let value = parseInt(hashCanonical(seed).slice(0,8),16);
  return () => { value = (value + 0x6D2B79F5) | 0; let t = Math.imul(value ^ value >>> 15,1 | value);
    t ^= t + Math.imul(t ^ t >>> 7,61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function generateDemoData(options: { scenarioId?: string; source?: string; size?: string; seed?: string | number; asOf?: string } = {}) {
  const scenario = scenarios.find(s=>s.id===(options.scenarioId || 'software-builders'));
  const source = options.source || 'json', size = options.size || 'medium';
  if (!scenario || !['json','mixed','facebook','instagram','grok','pixel'].includes(source) || !Object.hasOwn(sizes,size)
    || (options.seed !== undefined && !['string','number'].includes(typeof options.seed)) || String(options.seed || '').length > 128) throw new DemoDataError('Geçersiz demo senaryosu, kaynak, boyut veya seed.');
  const seed = String(options.seed ?? randomUUID()), rng = seededRandom(`${scenario.id}:${seed}`);
  const pick = <T>(values:readonly T[]) => values[Math.floor(rng()*values.length)];
  const integer = (min:number,max:number) => min+Math.floor(rng()*(max-min+1));
  const now = options.asOf ? new Date(options.asOf) : new Date();
  if (!Number.isFinite(now.getTime())) throw new DemoDataError('Geçersiz asOf.');
  const iso = now.toISOString(), at = (days:number)=>new Date(now.getTime()-days*86400000).toISOString();
  const base = parseAudienceDataset(JSON.parse(readFileSync(resolve(__dirname,'../../src/fixtures',`${scenario.fixture}.v1.json`),'utf8')));
  const dataset:AudienceDatasetV1 = {...base,label:`Demo · ${scenario.title} · ${seed.slice(0,12)}`,synthetic:true,asOf:iso,
    window:{from:at(30),to:iso},sources:[],observations:[],content:[],events:[],research:[]};
  const count=sizes[size as keyof typeof sizes], prefix=hashCanonical([scenario.id,seed,source,size]).slice(0,12);
  const platforms = ['json','mixed'].includes(source) ? ['instagram','facebook','grok','pixel'] : [source];
  const product=dataset.products[0];
  const templates = [
    (focus:string)=>`${focus} hakkında somut örnek görmek istiyorum. Genel vaat yerine ayrıntılar karar vermemi kolaylaştırır.`,
    (focus:string)=>`Benim için önce ${focus}. Kendi kullanım senaryoma nasıl uyduğunu açıkça görmek istiyorum.`,
    (focus:string)=>`${focus} seçimini karşılaştırıyorum. Kapsam, koşullar ve sonraki adım daha açık anlatılmalı.`,
    (focus:string)=>`${focus} için kısa bir rehber arıyorum; ilk adımı bilmeden devam etmek istemiyorum.`,
  ];
  let demographic = { male: integer(48, 55), total: integer(24000, 52000), ages: [integer(20, 28), integer(40, 50), integer(15, 25)] };
  let cities = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Eskişehir'];

  if (scenario.fixture === 'b2b-software') {
    demographic = { male: integer(72, 79), total: integer(32000, 68000), ages: [18, 56, 18] };
    cities = ['İstanbul (Teknopark)', 'Ankara (ODTÜ)', 'İzmir', 'Eskişehir', 'Berlin', 'London'];
  } else if (scenario.fixture === 'specialty-coffee') {
    demographic = { male: integer(42, 46), total: integer(16000, 29000), ages: [30, 46, 16] };
    cities = ['Kadıköy / İst', 'İzmir (Alsancak)', 'Ankara (Çankaya)', 'Eskişehir', 'Bursa', 'Antalya'];
  } else if (scenario.fixture === 'furniture-studio') {
    demographic = { male: integer(34, 40), total: integer(22000, 44000), ages: [12, 36, 42] };
    cities = ['İstanbul (Nişantaşı)', 'Bodrum', 'Antalya', 'Ankara', 'İzmir (Urla)', 'Bursa'];
  } else if (scenario.fixture === 'personal-brand-creator') {
    demographic = { male: integer(50, 54), total: integer(52000, 94000), ages: [38, 42, 12] };
    cities = ['İstanbul', 'Berlin', 'London', 'Amsterdam', 'İzmir', 'Ankara'];
  }

  // Shuffle the city order as well as the shares; every seed changes the sample.
  const cityOrder=[...cities];
  for(let i=cityOrder.length-1;i>0;i--){const j=integer(0,i);[cityOrder[i],cityOrder[j]]=[cityOrder[j],cityOrder[i]];}
  const shuffled = cityOrder.slice(0,3), cityShares=[integer(24,42),integer(14,24),integer(8,18)];
  for (const platform of platforms) {
    const sourceId=`src-demo-${platform}`;
    dataset.sources.push({id:sourceId,platform:platform==='grok'?'x':platform==='pixel'?'custom':platform,
      population:platform==='pixel'?'site-visitors':platform==='grok'?'declared-research':'followers',sampled:true,complete:false,collectedAt:iso});
    if (platform==='instagram'||platform==='facebook') {
      const add=(suffix:string,metric:string,dimensions:Record<string,string>,value:number,unit:'count'|'percent'='percent')=>dataset.observations.push({
        id:`demo-${platform}-${suffix}`,sourceRef:sourceId,metric,dimensions,value,unit,status:'observed',denominatorRef:null,observedAt:iso });
      add('followers','followers_count',{},demographic.total+(platform==='facebook'?integer(100,5000):0),'count');
      add('male','follower_demographics',{gender:'M'},demographic.male);add('female','follower_demographics',{gender:'F'},100-demographic.male);
      const ages=[...demographic.ages,100-demographic.ages.reduce((s,n)=>s+n,0)];
      ['18-24','25-34','35-44','45+'].forEach((age,i)=>add(`age-${i}`,'follower_demographics',{age},ages[i]));
      [...shuffled,'Diğer'].forEach((city,i)=>add(`city-${i}`,'follower_demographics',{city},i===3?100-cityShares.reduce((s,n)=>s+n,0):cityShares[i]));
      for (let i=0;i<count.posts;i++) {
        const focus=pick(scenario.focus);dataset.content.push({id:`demo-${prefix}-${platform}-post-${i}`,sourceRef:sourceId,productRefs:[product.id],
          text:`${pick(templates)(focus)} Örnek içerik ${i+1}.`,publishedAt:at(rng()*29),likes:integer(8,2200),comments:integer(0,180),themeTags:focus.split(' ').slice(0,4)});
      }
    }
    if (platform==='grok') for (let i=0;i<count.research;i++) {
      const focus=pick(scenario.focus);dataset.research.push({id:`demo-${prefix}-research-${i}`,sourceRef:sourceId,
        statement:`SENTETİK ARAŞTIRMA KARTI ${i+1}: ${focus}. Temel ihtiyaç: ${pick(templates)(focus)} Çekince: Genel vaat yerine somut koşulları ve sonraki adımı görmek. Karar kriteri: Açık örnek ve kullanım kapsamı.`,theme:focus,sampleSize:null});
    }
    if (platform==='pixel') {
      const choices=scenario.behavior==='explore'?['page_view','page_view','scroll_depth','time_on_page','product_view']:
        scenario.behavior==='compare'?['page_view','pricing_view','pricing_view','integration_docs_view','scroll_depth']:
        ['page_view','cta_click','trial_requested','add_to_cart','checkout_started'];
      for (let i=0;i<count.events;i++) dataset.events.push({id:`demo-${prefix}-event-${i}`,sourceRef:sourceId,
        profileRef:`demo-${prefix}-visitor-${integer(1,Math.max(10,Math.round(count.events/4)))}`,name:pick(choices) as AudienceDatasetV1['events'][number]['name'],productRef:product.id,eventTime:at(rng()*29),receivedAt:iso});
    }
  }
  const reportText=dataset.research.slice(0,3).map((r,i)=>`MÜŞTERİ KARTI ${i+1}: ${scenario.focus[i%3]}\n- Temel İhtiyaç: ${r.statement}\n- Not: Sentetik demo; gerçek Grok/X araması yapılmadı.`).join('\n\n');

  const factTexts = product.facts.slice(0,2).map(f=>f.text).join(' ');
  const sampleExperiment = {
    context: { objective: 'consideration', surface: 'content', task: `${product.name} için uygunluğu değerlendirmek`, changedElement: 'Ana mesaj ve bilgi sırası' },
    variantA: { id: 'demo-a', productId: product.id, format: 'text', headline: product.name, body: factTexts, callToAction: 'İncele' },
    variantB: { id: 'demo-b', productId: product.id, format: 'text', headline: `${scenario.focus[0]} senin için önemli mi?`, body: factTexts, callToAction: 'Ayrıntıları incele' }
  };

  return { dataset: parseAudienceDataset(dataset), reportText,
    demo: { synthetic: true, scenarioId: scenario.id, title: scenario.title, seed, source, size, behavior: scenario.behavior,
      counts: { posts: dataset.content.length, events: dataset.events.length, research: dataset.research.length, observations: dataset.observations.length } },
    sampleExperiment };
}

/** Append a demo source without losing the user's product or invalidating references. */
export function appendDemoDataset(baseInput:AudienceDatasetV1, addition:AudienceDatasetV1):AudienceDatasetV1 {
  const base=parseAudienceDataset(JSON.parse(JSON.stringify(baseInput)));
  const incoming=parseAudienceDataset(addition), productId=base.products[0].id;
  const merge=<T extends {id:string}>(a:T[],b:T[])=>[...new Map([...a,...b].map(row=>[row.id,row])).values()];
  base.sources=merge(base.sources,incoming.sources);base.observations=merge(base.observations,incoming.observations);
  base.content=merge(base.content,incoming.content.map(c=>({...c,productRefs:[productId]})));
  base.events=merge(base.events,incoming.events.map(e=>({...e,productRef:productId})));
  base.research=merge(base.research,incoming.research);base.synthetic=base.synthetic||incoming.synthetic;
  base.asOf=incoming.asOf>base.asOf?incoming.asOf:base.asOf;
  base.window={from:incoming.window.from<base.window.from?incoming.window.from:base.window.from,to:base.asOf};
  return parseAudienceDataset(base);
}
