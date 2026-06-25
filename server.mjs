// Tiny zero-dependency web server for the treasury dashboard.
// - Serves the static front-end in public/ (and the design tokens in ds/).
// - GET /api/data runs the Nordea flow SERVER-SIDE so the client secret + token
//   never reach the browser, and returns normalised JSON to the page.
// Run: npm start  ->  http://localhost:3000

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAll } from './nordea.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// cache the API result briefly so reloads don't hammer the sandbox
let cache = { at: 0, data: null };
const TTL = 60_000;

async function getData() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  const data = await fetchAll();
  cache = { at: Date.now(), data };
  // also keep a snapshot on disk for the static demo build
  writeFile(join(ROOT, 'public', 'demo-data.json'), JSON.stringify(data, null, 2)).catch(() => {});
  return data;
}

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  // map /<file> to public/, but allow /ds/* from project root
  const rel = path.startsWith('/ds/') ? path.slice(1) : join('public', path);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  try {
    const buf = await readFile(file);
    send(res, 200, buf, MIME[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = createServer(async (req, res) => {
  if (req.url.split('?')[0] === '/api/data') {
    try {
      const data = await getData();
      send(res, 200, JSON.stringify(data), MIME['.json']);
    } catch (e) {
      send(res, 502, JSON.stringify({ error: e.message }), MIME['.json']);
    }
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  Treasury dashboard → http://localhost:${PORT}\n  (pulling live from the Nordea sandbox)\n`);
});
