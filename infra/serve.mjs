import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const ROOT = resolve(process.env.ROOT || 'dist');
const LIVE = resolve(process.env.OUT || 'live');
const PORT = +process.env.PORT || 8080;
const STALE_S = +process.env.STALE_S || 180;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

function cacheControl(path) {
  if (path.startsWith('/live/snap/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('/live/')) return 'public, max-age=5, s-maxage=15, stale-while-revalidate=30, stale-if-error=600';
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('/data/') || path.startsWith('/fonts/') || path.startsWith('/images/')) return 'public, max-age=3600, s-maxage=86400';
  return 'public, max-age=0, s-maxage=60, must-revalidate';
}

const cache = new Map();
function load(file) {
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit;
  const body = readFileSync(file), ext = extname(file);
  const sibling = suffix => existsSync(file + suffix) && statSync(file + suffix).mtimeMs >= mtimeMs ? readFileSync(file + suffix) : null;
  const entry = {
    mtimeMs, size, body, type: TYPES[ext] || 'application/octet-stream',
    etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`,
    br: COMPRESSIBLE.has(ext) ? sibling('.br') ?? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : null,
    gz: COMPRESSIBLE.has(ext) ? sibling('.gz') ?? gzipSync(body, { level: 9 }) : null,
  };
  cache.set(file, entry);
  return entry;
}

function resolveFile(path) {
  const base = path.startsWith('/live/') ? LIVE : ROOT;
  const rel = normalize(path.startsWith('/live/') ? path.slice(6) : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(base, rel);
  if (!file.startsWith(base)) return null;
  try { if (statSync(file).isFile()) return file; } catch {}
  return path.startsWith('/live/') || extname(path) ? null : join(ROOT, 'index.html');
}

const routes = new Map();
function lookup(path) {
  const hit = routes.get(path), now = Date.now();
  if (hit && now - hit.checked < 1000) return hit.entry;
  const file = resolveFile(path), entry = file ? load(file) : null;
  if (entry) { if (routes.size > 5000) routes.clear(); routes.set(path, { entry, checked: now }); }
  return entry;
}

function health(res) {
  let status = null;
  try { status = JSON.parse(readFileSync(join(LIVE, 'status.json'), 'utf8')); } catch {}
  const age = status ? Math.round((Date.now() - status.t) / 1000) : null;
  const ok = age != null && age <= STALE_S;
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ ok, ageSeconds: age, tse: status?.tse ?? null, sections: status?.h?.br ? `${status.h.br[0]}/${status.h.br[1]}` : null, error: status?.error ?? null }));
}

export const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/healthz') return health(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const entry = lookup(path);
  if (!entry) { res.writeHead(404, { 'cache-control': 'public, max-age=5' }).end('not found'); return; }
  const headers = { 'content-type': entry.type, 'cache-control': cacheControl(path), etag: entry.etag, vary: 'Accept-Encoding', 'x-content-type-options': 'nosniff' };
  if (path.startsWith('/live/')) headers['access-control-allow-origin'] = '*';
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers).end(); return; }
  const accept = req.headers['accept-encoding'] || '';
  let body = entry.body;
  if (entry.br && /\bbr\b/.test(accept)) { body = entry.br; headers['content-encoding'] = 'br'; }
  else if (entry.gz && /\bgzip\b/.test(accept)) { body = entry.gz; headers['content-encoding'] = 'gzip'; }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`servindo ${ROOT} e /live -> ${LIVE} em http://127.0.0.1:${PORT}`));
