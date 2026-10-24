import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { AudienceLabOrchestrator } from './orchestrator.js';
import { AudienceLabEngine } from './inference/index.js';
import type { AudienceDatasetV1 } from './core/types.js';

const PORT = Number(process.env.PORT) || 3344;
const engine = new AudienceLabEngine();
const orchestrator = new AudienceLabOrchestrator(engine);

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
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
      const config = engine.configuration();
      return sendJson(res, 200, {
        status: 'ok',
        engine: config,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Load Sample Fixtures
    if (pathname === '/api/fixtures' && req.method === 'GET') {
      const fixturesDir = join(process.cwd(), 'src', 'fixtures');
      const files = ['creator-brand.json', 'specialty-coffee.json', 'b2b-software.json'];
      const result: Record<string, any> = {};
      for (const file of files) {
        const p = join(fixturesDir, file);
        if (existsSync(p)) {
          result[file] = JSON.parse(readFileSync(p, 'utf8'));
        }
      }
      return sendJson(res, 200, result);
    }

    // 3. Compile Panel
    if (pathname === '/api/compile-panel' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const dataset = body.dataset as AudienceDatasetV1;
      if (!dataset) return sendJson(res, 400, { error: 'dataset is required' });
      const panel = orchestrator.compilePanel(dataset);
      return sendJson(res, 200, {
        personasCount: panel.personas.length,
        identitiesCount: panel.identities.length,
        personas: panel.personas,
      });
    }

    // 4. Derive Variant B from Variant A
    if (pathname === '/api/derive-b' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { dataset, sourceVariantA, angle, testedVariable } = body;
      if (!dataset || !sourceVariantA) {
        return sendJson(res, 400, { error: 'dataset and sourceVariantA are required' });
      }
      const derived = await orchestrator.deriveVariantB({
        dataset,
        sourceVariantA,
        angle,
        testedVariable,
      });
      return sendJson(res, 200, derived);
    }

    // 5. Run A/B Experiment
    if (pathname === '/api/run-experiment' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { dataset, variantA, variantB, repeats } = body;
      if (!dataset || !variantA || !variantB) {
        return sendJson(res, 400, { error: 'dataset, variantA, and variantB are required' });
      }
      const experiment = await orchestrator.runExperiment({
        dataset,
        variantA,
        variantB,
        repeats: repeats || 2,
      });
      return sendJson(res, 200, experiment);
    }

    // 6. Serve static files from public/
    const publicDir = join(process.cwd(), 'public');
    let target = join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (existsSync(target)) {
      return serveStatic(res, target);
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`⚡ OctopIQ Audience Agent Lab server running at: http://localhost:${PORT}`);
  console.log(`⚡ Engine configured: ${JSON.stringify(engine.configuration())}`);
});
