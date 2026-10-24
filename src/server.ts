import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AudienceLabOrchestrator } from './orchestrator.js';
import { AudienceLabEngine } from './inference/index.js';
import type { AudienceDatasetV1 } from './core/types.js';
import { SocialAudienceIngestionService } from './core/social-ingestion.js';
import { XgBoostPersonaService } from './ml/xgboost-bridge.js';
import { appendDemoDataset, demoCatalog, generateDemoData, seededRandom } from './core/demo-data.js';

// Native .env loader
if (existsSync(join(process.cwd(), '.env'))) {
  const envContent = readFileSync(join(process.cwd(), '.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const PORT = Number(process.env.PORT) || 3344;
const defaultEngine = new AudienceLabEngine();
const codexEngine = new AudienceLabEngine('codex');
const localEngine = new AudienceLabEngine('local');
const socialService = new SocialAudienceIngestionService();
const xgboostService = new XgBoostPersonaService();

export type PixelEventRecord = {
  id: string;
  siteId: string;
  anonymousId: string;
  eventName: string;
  pageUrl: string;
  pageTitle?: string;
  referrer?: string | null;
  details?: Record<string, any>;
  timestamp: string;
  synthetic: boolean;
};

function generateSyntheticPixelEvents(count: number, startAnonIndex = 1, options: { scenario?: string; seed?: string | number } = {}): PixelEventRecord[] {
  const events: PixelEventRecord[] = [];
  const scenario=options.scenario || 'explore';
  if (!['explore','compare','high-intent'].includes(scenario)) throw Object.assign(new Error('DEMO_OPTIONS_INVALID'),{code:'DEMO_OPTIONS_INVALID',status:400});
  const rng=seededRandom(String(options.seed ?? randomUUID()));
  const eventTypes = scenario==='explore'?['page_view','page_view','scroll_depth','cta_click','product_view','time_on_page']:
    scenario==='compare'?['page_view','pricing_view','pricing_view','integration_docs_view','scroll_depth','cta_click']:
    ['page_view','cta_click','cta_click','trial_requested','add_to_cart','checkout_started'];
  const pages = [
    'https://octopiq.io/',
    'https://octopiq.io/pricing',
    'https://octopiq.io/features',
    'https://octopiq.io/demo',
    'https://octopiq.io/docs/audience-builder',
  ];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const anonId = `anon-usr-${String(startAnonIndex + (i % 73)).padStart(3, '0')}`;
    const evType = eventTypes[i < eventTypes.length ? i : Math.floor(rng()*eventTypes.length)];
    const pageUrl = evType==='pricing_view'?pages[1]:evType==='integration_docs_view'?pages[4]:pages[Math.floor(rng()*pages.length)];
    const timeOffset = (count - i) * 17000;
    events.push({
      id: `ev-synth-${i + 1}-${randomUUID().slice(0, 6)}`,
      siteId: 'octopiq-site',
      anonymousId: anonId,
      eventName: evType,
      pageUrl,
      pageTitle: pageUrl.includes('pricing') ? 'Pricing Plans | OctopIQ' : 'Audience Lab | OctopIQ',
      referrer: i % 3 === 0 ? 'https://x.com/' : i % 3 === 1 ? 'https://google.com/' : null,
      details: { scrollPercent: 20 + Math.floor(rng()*80), durationSec: 10 + Math.floor(rng()*220) },
      timestamp: new Date(now - timeOffset).toISOString(),
      synthetic: true,
    });
  }
  return events;
}

// Keep the established synthetic starter panel so the pixel dashboard has a visible demo on launch.
const pixelEventsBuffer: PixelEventRecord[] = generateSyntheticPixelEvents(243, 1);
const oauthSessions = new Map<string, { platform: 'facebook' | 'instagram'; handle: string; redirectUri: string; expires: number }>();

function getOrchestrator(mode?: string) {
  if (mode !== undefined && !['auto', 'local', 'codex'].includes(mode)) {
    throw new Error('AUDIENCE_LAB_ENGINE_INVALID');
  }
  if (mode === 'local') return new AudienceLabOrchestrator(localEngine);
  if (mode === 'codex') return new AudienceLabOrchestrator(codexEngine);
  return new AudienceLabOrchestrator(defaultEngine);
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 18 * 1024 * 1024) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res: ServerResponse, filePath: string) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
  const ext = extname(filePath).toLowerCase();
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // 1. Health check & Capabilities
    if (pathname === '/api/health' && req.method === 'GET') {
      const config = defaultEngine.configuration();
      return sendJson(res, 200, {
        status: 'ok',
        engine: config,
        timestamp: new Date().toISOString(),
      });
    }

    // 1.5 XGBoost ML Status, Training, and Prediction
    if (pathname === '/api/ml/status' && req.method === 'GET') {
      const receipt = xgboostService.getReceipt();
      return sendJson(res, 200, {
        ready: Boolean(receipt),
        engine: receipt?.engine || 'xgboost-3.4.1',
        receipt,
        role: 'persona-scenario-suggestion',
        trainingData: 'synthetic',
      });
    }

    if (pathname === '/api/ml/train' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const receipt = await xgboostService.train(body.numSamples ?? 3500);
      return sendJson(res, 200, receipt);
    }

    if (pathname === '/api/ml/predict' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const prediction = body.dataset !== undefined ? await xgboostService.predictDataset(body.dataset)
        : await xgboostService.predict(body.features);
      return sendJson(res, 200, prediction);
    }

    if (pathname === '/api/demo/catalog' && req.method === 'GET') return sendJson(res,200,demoCatalog());
    if (pathname === '/api/demo/export' && req.method === 'GET') {
      const generated=generateDemoData(Object.fromEntries(url.searchParams));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="demo-${generated.demo.scenarioId}.json"`});
      return res.end(JSON.stringify(generated.dataset,null,2));
    }
    if (['/api/demo/load','/api/audience/synthetic/load','/api/social/synthetic/load','/api/grok/synthetic/load'].includes(pathname) && req.method==='POST') {
      const body=await parseJsonBody(req);
      const source=pathname==='/api/grok/synthetic/load'?'grok':pathname==='/api/social/synthetic/load'?(body.platform || 'instagram'):body.source;
      const generated=generateDemoData({...body,source});
      const dataset=body.dataset && body.mode!=='replace'?appendDemoDataset(body.dataset,generated.dataset):generated.dataset;
      const { summary } = socialService.importFromJson(dataset);
      const panel = getOrchestrator('local').compilePanel(dataset);
      const product=dataset.products[0],bodyText=product.facts.slice(0,2).map(f=>f.text).join(' ');
      const sampleExperiment={...generated.sampleExperiment,context:{...generated.sampleExperiment.context,task:`${product.name} için uygunluğu değerlendirmek`},
        variantA:{...generated.sampleExperiment.variantA,productId:product.id,headline:product.name,body:bodyText},
        variantB:{...generated.sampleExperiment.variantB,productId:product.id,body:bodyText}};
      return sendJson(res,200,{...generated,dataset,summary,sampleExperiment,datasetHash:panel.datasetHash,
        panel:{personas:panel.personas,personasCount:panel.personas.length,identitiesCount:panel.identities.length,analysis:panel.analysis}});
    }

    // 2. Load Sample Fixtures
    if (pathname === '/api/fixtures' && req.method === 'GET') {
      const fixturesDir = join(process.cwd(), 'src', 'fixtures');
      const files = [
        'personal-brand-creator.v1.json',
        'specialty-coffee.v1.json',
        'b2b-software.v1.json',
        'furniture-studio.v1.json',
      ];
      const result: Record<string, any> = {};
      for (const file of files) {
        const p = join(fixturesDir, file);
        if (existsSync(p)) {
          result[file] = JSON.parse(readFileSync(p, 'utf8'));
        }
      }
      return sendJson(res, 200, result);
    }

    // Pixel Script Serving
    if (pathname === '/pixel.js' && req.method === 'GET') {
      const pixelPath = join(process.cwd(), 'public', 'pixel.js');
      return serveStatic(res, pixelPath);
    }

    // Pixel Event Collector
    if (pathname === '/api/pixel/event' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const record: PixelEventRecord = {
        id: `ev-${randomUUID().slice(0, 8)}`,
        siteId: String(body.siteId || 'default-site'),
        anonymousId: String(body.anonymousId || 'anon'),
        eventName: String(body.eventName || 'page_view'),
        pageUrl: String(body.pageUrl || ''),
        pageTitle: body.pageTitle ? String(body.pageTitle) : undefined,
        referrer: body.referrer ? String(body.referrer) : null,
        details: typeof body.details === 'object' && body.details !== null ? body.details : {},
        timestamp: body.timestamp || new Date().toISOString(),
        synthetic: body.synthetic === true,
      };

      pixelEventsBuffer.unshift(record);
      if (pixelEventsBuffer.length > 2500) {
        pixelEventsBuffer.pop();
      }

      return sendJson(res, 200, { status: 'ok', eventId: record.id });
    }

    // Pixel Synthetic Ingestion / Load
    if (pathname === '/api/pixel/synthetic/load' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const requestedCount = body.count ?? 120;
      if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 1000) return sendJson(res, 400, { error: 'Demo olay sayısı 1–1000 arasında olmalıdır.' });
      const newEvents = generateSyntheticPixelEvents(requestedCount, pixelEventsBuffer.length + 1,{scenario:body.scenario,seed:body.seed});
      let baseDataset=body.dataset;
      if(!baseDataset){
        baseDataset=generateDemoData({source:'pixel',scenarioId:body.scenarioId,seed:body.seed}).dataset;
        baseDataset.events=[];baseDataset.sources=baseDataset.sources.map((s:any)=>({...s,id:'src-pixel-demo'}));
      }
      const result = socialService.appendPixelEvents(baseDataset, newEvents);
      const panel = getOrchestrator('local').compilePanel(result.dataset);
      pixelEventsBuffer.unshift(...newEvents);
      if (pixelEventsBuffer.length > 2500) {
        pixelEventsBuffer.length = 2500;
      }
      const uniqueVisitors = new Set(pixelEventsBuffer.map((e) => e.anonymousId)).size;
      return sendJson(res, 200, {
        ...(result || {}), ...(panel ? { panel: { personas: panel.personas, personasCount: panel.personas.length, identitiesCount: panel.identities.length } } : {}),
        success: true,
        addedCount: requestedCount,
        demo:{synthetic:true,scenario:body.scenario || 'explore',seed:body.seed ?? null},
        totalEvents: pixelEventsBuffer.length,
        uniqueVisitors,
        message: `${requestedCount} sentetik demo olayı oluşturuldu.`,
      });
    }

    // Pixel Live Events and Summary
    if (pathname === '/api/pixel/events' && req.method === 'GET') {
      const pageViews = pixelEventsBuffer.filter((e) => e.eventName === 'page_view').length;
      const ctaClicks = pixelEventsBuffer.filter((e) => e.eventName === 'cta_click').length;
      const scrollEvents = pixelEventsBuffer.filter((e) => e.eventName === 'scroll_depth').length;
      const uniqueVisitors = new Set(pixelEventsBuffer.map((e) => e.anonymousId)).size;

      const topPagesMap = new Map<string, number>();
      for (const e of pixelEventsBuffer) {
        if (e.pageUrl) {
          try {
            const path = new URL(e.pageUrl).pathname;
            topPagesMap.set(path, (topPagesMap.get(path) || 0) + 1);
          } catch {
            topPagesMap.set(e.pageUrl, (topPagesMap.get(e.pageUrl) || 0) + 1);
          }
        }
      }

      const topPages = Array.from(topPagesMap.entries())
        .map(([url, count]) => ({ url, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return sendJson(res, 200, {
        totalEvents: pixelEventsBuffer.length,
        syntheticEvents: pixelEventsBuffer.filter((e) => e.synthetic).length,
        collectedEvents: pixelEventsBuffer.filter((e) => !e.synthetic).length,
        metrics: {
          pageViews,
          ctaClicks,
          scrollEvents,
          uniqueVisitors,
          topPages,
        },
        recent: pixelEventsBuffer.slice(0, 15),
      });
    }

    // Only verified token exchange can return a successful connection. No demo fallback.
    if (['/api/auth/meta/config','/api/auth/instagram/config'].includes(pathname) && req.method === 'GET') {
      const platform = pathname.includes('/instagram/') || url.searchParams.get('platform') === 'instagram' ? 'instagram' : 'facebook';
      const instagram=platform==='instagram';
      const appId = instagram ? process.env.INSTAGRAM_APP_ID || '' : process.env.META_APP_ID || '';
      const configured = Boolean(appId && (instagram?process.env.INSTAGRAM_APP_SECRET:process.env.META_APP_SECRET));
      const redirectUri = (instagram?process.env.INSTAGRAM_OAUTH_REDIRECT_URI:process.env.META_OAUTH_REDIRECT_URI)
        || `http://localhost:${PORT}/api/auth/${instagram?'instagram':'meta'}/callback`;
      const state = randomUUID();
      for (const [key, value] of oauthSessions) if (value.expires < Date.now()) oauthSessions.delete(key);
      if (configured) oauthSessions.set(state, { platform, redirectUri, handle: url.searchParams.get('handle') || 'connected-account', expires: Date.now() + 600000 });
      const scope = instagram ? process.env.INSTAGRAM_OAUTH_SCOPES || 'instagram_business_basic,instagram_business_manage_insights' : 'pages_show_list,pages_read_engagement';
      const target=new URL(instagram?'https://www.instagram.com/oauth/authorize':'https://www.facebook.com/v25.0/dialog/oauth');
      target.search=new URLSearchParams({client_id:appId,redirect_uri:redirectUri,scope,response_type:'code',state,...(instagram?{enable_fb_login:'0'}:{})}).toString();
      return sendJson(res, 200, { platform,loginProvider:platform,configured, oauthUrl:configured?target.toString():null,
        hasTestToken: Boolean(instagram?process.env.INSTAGRAM_TEST_ACCESS_TOKEN:process.env.META_TEST_ACCESS_TOKEN),
        note: configured ? 'Hesabın izin verdiği alanlar alınır.' : `${instagram?'INSTAGRAM':'META'}_APP_ID ve APP_SECRET sunucuda yapılandırılmalı.` });
    }
    if (['/api/auth/meta/connect-test','/api/auth/instagram/connect-test'].includes(pathname) && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const instagram=pathname.includes('/instagram/') || body.platform==='instagram';
      const token = instagram?process.env.INSTAGRAM_TEST_ACCESS_TOKEN:process.env.META_TEST_ACCESS_TOKEN;
      if (!token) return sendJson(res, 400, { error: 'Sunucuda Meta test tokenı yapılandırılmadı.' });
      const result = await socialService.ingestSocialAudience({ platform: instagram ? 'instagram' : 'facebook',login:instagram?'instagram':'facebook',
        handle: body.handle || 'connected-account', accessToken: token, population: 'followers' });
      const panel = getOrchestrator('local').compilePanel(result.dataset);
      return sendJson(res, 200, { ...result, panel: { personas: panel.personas, personasCount: panel.personas.length, identitiesCount: panel.identities.length } });
    }
    if (['/api/auth/meta/callback','/api/auth/instagram/callback'].includes(pathname) && req.method === 'GET') {
      if (pathname === '/api/auth/instagram/callback' && !url.searchParams.has('code')
        && !url.searchParams.has('state') && !url.searchParams.has('error')) {
        return sendJson(res, 200, { status: 'ready', endpoint: 'instagram-oauth-callback' });
      }
      const state = url.searchParams.get('state') || '';
      const session = oauthSessions.get(state);
      oauthSessions.delete(state);
      if (!session || session.expires < Date.now() || !url.searchParams.get('code') || url.searchParams.has('error')
        || (pathname.includes('/instagram/') && session.platform!=='instagram')) {
        return sendJson(res, 400, { error: 'Meta yetkilendirmesi tamamlanmadı veya oturum süresi doldu.' });
      }
      const instagram=session.platform==='instagram';
      const fields=new URLSearchParams({client_id:(instagram?process.env.INSTAGRAM_APP_ID:process.env.META_APP_ID)||'',
        client_secret:(instagram?process.env.INSTAGRAM_APP_SECRET:process.env.META_APP_SECRET)||'',redirect_uri:session.redirectUri,code:url.searchParams.get('code')!,
        ...(instagram?{grant_type:'authorization_code'}:{})});
      const tokenResponse = instagram ? await fetch('https://api.instagram.com/oauth/access_token',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields.toString(),signal:AbortSignal.timeout(12000)})
        : await fetch(`https://graph.facebook.com/v25.0/oauth/access_token?${fields}`,{signal:AbortSignal.timeout(12000)});
      const rawToken = await tokenResponse.json() as any;
      const token=Array.isArray(rawToken.data)&&rawToken.data.length===1?rawToken.data[0]:rawToken;
      if (!tokenResponse.ok || !token.access_token || token.error) throw new Error('META_REQUEST_FAILED');
      const result = await socialService.ingestSocialAudience({ platform: session.platform, handle: session.handle, accessToken: token.access_token,
        login:instagram?'instagram':'facebook',population: 'followers' });
      const panel = getOrchestrator('local').compilePanel(result.dataset);
      const payload = JSON.stringify({ type: 'META_AUTH_SUCCESS', ...result, panel: { personas: panel.personas, personasCount: panel.personas.length, identitiesCount: panel.identities.length } }).replace(/</g, '\\u003c');
      const appOrigin = process.env.AUDIENCE_LAB_APP_ORIGIN || `http://localhost:${PORT}`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="tr"><meta charset="utf-8"><title>Meta bağlantısı</title><body><p>İzin verilen hesap verileri alındı. Bu pencereyi kapatabilirsiniz.</p><script>if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(appOrigin)});window.close();}</script></body></html>`);
    }

    // 2.5 Social Audience Extraction (Meta & X)
    if (pathname === '/api/social/fetch' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { platform = 'instagram', handle, accessToken, population, brandName, brandDescription, category, demo, seed, scenarioId, size, login } = body;
      if (!handle) return sendJson(res, 400, { error: 'handle is required' });
      const { dataset, summary } = await socialService.ingestSocialAudience({
        platform,
        handle,
        accessToken,
        demo: demo === true,
        seed,scenarioId,size,login,
        population,
        brandName,
        brandDescription,
        category,
      });
      const activeOrchestrator = getOrchestrator(body.engine);
      const panel = activeOrchestrator.compilePanel(dataset);
      return sendJson(res, 200, {
        dataset,
        summary,
        panel: {
          personasCount: panel.personas.length,
          identitiesCount: panel.identities.length,
          personas: panel.personas,
        },
      });
    }

    // 2.55 Multi-Source Real Audience Ingestion (Meta + X + Pixel unified)
    if (pathname === '/api/social/multi-fetch' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { instagram, x, includePixel, engine } = body;

      const { dataset, summary } = await socialService.ingestMultiSourceAudience({
        instagram,
        x,
        includePixel: Boolean(includePixel),
        pixelEvents: includePixel ? pixelEventsBuffer : [],
        dataset:body.dataset,
      });

      const activeOrchestrator = getOrchestrator(engine);
      const panel = activeOrchestrator.compilePanel(dataset);

      return sendJson(res, 200, {
        dataset,
        summary,
        panel: {
          personasCount: panel.personas.length,
          identitiesCount: panel.identities.length,
          personas: panel.personas,
        },
      });
    }

    // 2.6 Social Audience Import (JSON)
    if (pathname === '/api/social/import' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const rawJson = body.rawJson || body;
      const { dataset, summary } = socialService.importFromJson(rawJson);
      const activeOrchestrator = getOrchestrator(body.engine);
      const panel = activeOrchestrator.compilePanel(dataset);
      return sendJson(res, 200, {
        dataset,
        summary,
        panel: {
          personasCount: panel.personas.length,
          identitiesCount: panel.identities.length,
          personas: panel.personas,
        },
      });
    }

    // 2.7 Create Custom Planned Product & Persona Panel (Define Your Audience)
    if ((pathname === '/api/custom-product' || pathname === '/api/social/synthesize-product') && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const {
        productName = 'Planned Experiment Product',
        brandName,
        category,
        description,
        facts,
        targetAudienceHypothesis,
        audienceHypothesis,
        samplePosts,
        price,
        region,
        knowledgeLevel,
        ageRange,
        topics,
        motivations,
        objections,
        userProfile,
        decisionCriteria,
        engine,
      } = body;

      const finalProductName = (typeof productName === 'string' && productName.trim()) ? productName.trim() : 'Audience Experiment';

      const { dataset, summary } = socialService.createCustomProductDataset({
        productName: finalProductName,
        brandName,
        category,
        description,
        facts: Array.isArray(facts) ? facts : (typeof facts === 'string' ? facts.split(/\r?\n/) : []),
        targetAudienceHypothesis: targetAudienceHypothesis || audienceHypothesis,
        samplePosts: Array.isArray(samplePosts) ? samplePosts : (typeof samplePosts === 'string' ? samplePosts.split(/\r?\n/) : []),
        price: typeof price === 'number' ? price : (price ? Number(price) : null),
        region,
        knowledgeLevel,
        ageRange,
        topics: Array.isArray(topics) ? topics : [],
        motivations: Array.isArray(motivations) ? motivations : [],
        objections: Array.isArray(objections) ? objections : [],
        userProfile,
        decisionCriteria: Array.isArray(decisionCriteria) ? decisionCriteria : [],
      });

      const activeOrchestrator = getOrchestrator(engine);
      const panel = activeOrchestrator.compilePanel(dataset);

      return sendJson(res, 200, {
        dataset,
        summary,
        panel: {
          personasCount: panel.personas.length,
          identitiesCount: panel.identities.length,
          personas: panel.personas,
        },
      });
    }

    // 2.75 Grok Audience Report Ingestion & Prompt
    if (pathname === '/api/grok/prompt' && req.method === 'GET') {
      const promptPath = join(process.cwd(), 'docs/GROK_AUDIENCE_PROMPT_TR.md');
      let promptContent = '';
      try {
        const raw = readFileSync(promptPath, 'utf-8');
        const match = raw.match(/```text\s*([\s\S]*?)\s*```/);
        promptContent = match && match[1] ? match[1].trim() : raw.trim();
      } catch {
        promptContent = 'X (Twitter) uzerinde acik paylasimlari tarayarak 3 farkli musteri persona karti cikar.';
      }
      return sendJson(res, 200, { prompt: promptContent });
    }

    if (pathname === '/api/grok/import' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { reportText, engine } = body;
      if (!reportText || typeof reportText !== 'string' || !reportText.trim()) {
        return sendJson(res, 400, { error: 'reportText is required' });
      }
      const { dataset, summary } = socialService.importGrokReport(reportText.trim(),body.dataset);
      const activeOrchestrator = getOrchestrator(engine);
      const panel = activeOrchestrator.compilePanel(dataset);
      return sendJson(res, 200, {
        dataset,
        summary,
        panel: {
          personasCount: panel.personas.length,
          identitiesCount: panel.identities.length,
          personas: panel.personas,
        },
      });
    }

    // 3. Compile Panel
    if (['/api/compile-panel', '/api/audience-analysis'].includes(pathname) && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const dataset = body.dataset as AudienceDatasetV1;
      if (!dataset) return sendJson(res, 400, { error: 'dataset is required' });
      const activeOrchestrator = getOrchestrator(body.engine);
      const panel = activeOrchestrator.compilePanel(dataset);
      let ml: unknown;
      if (body.includeMl === true) {
        try { ml = { status: 'ready', prediction: await xgboostService.predictDataset(dataset) }; }
        catch (error: any) { ml = { status: 'unavailable', code: error.code || 'ML_PROCESS_FAILED' }; }
      }
      return sendJson(res, 200, {
        personasCount: panel.personas.length,
        identitiesCount: panel.identities.length,
        personas: panel.personas,
        datasetHash: panel.datasetHash,
        analysis: panel.analysis,
        ...(ml ? { ml } : {}),
      });
    }

    function getDefaultDataset(): any {
      const p = join(process.cwd(), 'src', 'fixtures', 'b2b-software.v1.json');
      if (existsSync(p)) {
        try {
          return JSON.parse(readFileSync(p, 'utf8'));
        } catch {}
      }
      return null;
    }

    // 4. Derive Variant B from Variant A
    if (pathname === '/api/derive-b' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      let { dataset, sourceVariantA, angle = 'concise', testedVariable = 'hook', context, engine: mode } = body;
      if (!sourceVariantA) {
        return sendJson(res, 400, { error: 'sourceVariantA is required' });
      }
      if (dataset === undefined) {
        dataset = getDefaultDataset();
      }
      const activeOrchestrator = getOrchestrator(mode);
      const derived = await activeOrchestrator.deriveVariantB({
        dataset,
        sourceVariantA,
        context,
        angle,
        testedVariable,
      });
      return sendJson(res, 200, derived);
    }

    // 5. Run A/B Experiment
    if (pathname === '/api/run-experiment' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      let { dataset, variantA, variantB, repeats, panelMode, concurrency, context, engine: mode, selectedPersonaIds } = body;
      if (!variantA || !variantB) {
        return sendJson(res, 400, { error: 'variantA and variantB are required' });
      }
      if (dataset === undefined) {
        dataset = getDefaultDataset();
      }
      if (dataset?.products?.length) {
        const defaultProdId = dataset.products[0].id;
        variantA.productId = variantA.productId || defaultProdId;
        variantB.productId = variantB.productId || defaultProdId;
      }
      if (!variantA.id) variantA.id = 'variant-a';
      if (!variantB.id) variantB.id = 'variant-b';
      if (!variantA.productFactRefs) variantA.productFactRefs = dataset?.products?.[0]?.facts?.map((f: any) => f.id) || ['f1'];
      if (!variantB.productFactRefs) variantB.productFactRefs = dataset?.products?.[0]?.facts?.map((f: any) => f.id) || ['f1'];

      const activeOrchestrator = getOrchestrator(mode);
      const experiment = await activeOrchestrator.runExperiment({
        dataset,
        variantA,
        variantB,
        context,
        repeats: repeats ?? 2,
        panelMode: panelMode || 'demo',
        concurrency: concurrency ?? 2,
        selectedPersonaIds,
      });
      return sendJson(res, 200, experiment);
    }

    // 6. Serve static files from public/
    const publicDir = join(process.cwd(), 'public');
    if (pathname === '/landing') {
      return serveStatic(res, join(publicDir, 'landing.html'));
    }
    let target = join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (existsSync(target)) {
      return serveStatic(res, target);
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (err: any) {
    const messages: Record<string, string> = {
      AUDIENCE_LAB_PROVIDER_NOT_CONFIGURED: 'Codex CLI bulunamadı. Luna için CLI kurulumunu kontrol edin veya Yerel Kurallar modunu seçin.',
      AUDIENCE_LAB_PROVIDER_REJECTED: 'Luna çağrısı reddedildi. CLI oturumunu ve seçilen modele erişimi kontrol edin.',
      AUDIENCE_LAB_PROVIDER_TIMEOUT: 'Luna çağrısı zaman aşımına uğradı.',
      AUDIENCE_LAB_PROVIDER_UNAVAILABLE: 'Codex CLI çağrısı başlatılamadı.',
      AUDIENCE_LAB_EXPERIMENT_INVALID: 'Deney ayarları geçersiz. Tekrar 1–6, eşzamanlılık 1–2 ve panel demo/full olmalıdır.',
      AUDIENCE_LAB_IDENTICAL_VARIANTS: 'A ve B materyalleri aynı. Karşılaştırılacak değişikliği ekleyin.',
      AUDIENCE_LAB_LIVE_DISABLED: 'Bu oturumda gerçek model çağrıları kapalı. Yerel kuralları seçin.',
      AUDIENCE_LAB_ENGINE_INVALID: 'Karar motoru auto, codex veya local olmalıdır.',
      AUDIENCE_LAB_VISION_REQUIRES_MODEL: 'Yerel kurallar görüntü okuyamaz. Görsel değerlendirmek için Luna seçin; yerel doğrulama için metin veya HTML kullanın.',
      AUDIENCE_LAB_DERIVATION_INVALID: 'Alternatif seçilen değişiklik sınırlarını sağlamadı. A korunuyor; B alanını elle düzenleyebilir veya yeniden üretebilirsiniz.',
      AUDIENCE_LAB_IMAGE_GENERATION_UNSUPPORTED: 'Bu yardımcı metin ve HTML alternatifi üretir. Görsel karşılaştırması için A ve B ekran görüntülerini yükleyin.',
      SOCIAL_TOKEN_REQUIRED: 'Gerçek hesap verisi için Meta bağlantısı gerekir. Demo için örnek veri seçin.',
      X_DIRECT_DISABLED_USE_GROK: 'X için Grok araştırma raporunu içe aktarın.',
      META_REQUEST_FAILED: 'Meta isteği reddedildi. Token, hesap ve izinleri kontrol edin; örnek veriyle değiştirilmedi.',
      META_INSTAGRAM_ACCOUNT_REQUIRED: 'Seçilen sayfaya bağlı profesyonel Instagram hesabı bulunamadı.',
      META_ACCOUNT_SELECTION_REQUIRED: 'Hesap seçimi gerekli. Bağlanacak sayfanın adını veya hesabını belirtin.',
      GROK_REPORT_INVALID: 'En az 40 karakterlik araştırma raporunu yapıştırın.',
      ML_FEATURES_INVALID: 'Model için 16 özelliği eksiksiz ve sayısal gönderin veya dataset kullanın.',
      ML_SAMPLE_COUNT_INVALID: 'Eğitim örnek sayısı 500–20000 arasında bir tam sayı olmalıdır.',
      ML_TRAINING_BUSY: 'Model eğitimi devam ediyor. Tamamlandıktan sonra tekrar deneyin.',
      ML_MODEL_NOT_READY: 'Model dosyası hazır değil veya bütünlük kontrolünden geçmedi.',
      ML_TIMEOUT: 'Yerel model işlemi zaman aşımına uğradı.',
      ML_RUNTIME_UNAVAILABLE: 'Python bulunamadı. AUDIENCE_LAB_PYTHON yolunu yapılandırın.',
      ML_DEPENDENCIES_MISSING: 'Python ortamında ML bağımlılıkları eksik. ml/requirements.txt dosyasını kullanın.',
      DEMO_OPTIONS_INVALID: 'Demo senaryosu, kaynak, boyut veya seed geçersiz. /api/demo/catalog listesini kullanın.',
      SOCIAL_SOURCE_REQUIRED:'Bir veri kaynağı veya pixel olayları ekleyin; demo için /api/demo/load kullanın.',
    };
    const code = err.code || err.message;
    const status = typeof err.status === 'number' ? err.status : ['AUDIENCE_LAB_EXPERIMENT_INVALID', 'AUDIENCE_LAB_ENGINE_INVALID', 'AUDIENCE_LAB_IDENTICAL_VARIANTS', 'AUDIENCE_LAB_LIVE_DISABLED', 'AUDIENCE_LAB_VISION_REQUIRES_MODEL', 'AUDIENCE_LAB_DERIVATION_INVALID', 'AUDIENCE_LAB_IMAGE_GENERATION_UNSUPPORTED', 'SOCIAL_TOKEN_REQUIRED', 'SOCIAL_SOURCE_REQUIRED','X_DIRECT_DISABLED_USE_GROK', 'GROK_REPORT_INVALID', 'META_ACCOUNT_SELECTION_REQUIRED', 'META_INSTAGRAM_ACCOUNT_REQUIRED'].includes(code) || err.code === 'AUDIENCE_LAB_INPUT_INVALID' ? 400
      : code === 'META_REQUEST_FAILED' ? 502
      : String(code).startsWith('AUDIENCE_LAB_PROVIDER_') ? 503 : 500;
    sendJson(res, status, { error: messages[code] || err.message || 'Internal server error', code });
  }
});

export { server };
if (require.main === module) server.listen(PORT, () => {
  console.log(`[OctopIQ] Audience Agent Lab server running at: http://localhost:${PORT}`);
  console.log(`[OctopIQ] Engine configured: ${JSON.stringify(defaultEngine.configuration())}`);
});
