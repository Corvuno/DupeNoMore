'use strict';
// sharp/libvips decode images on the libuv thread pool (default: 4 threads).
// Size it to the CPU so parallel hashing can use every core. Must be set
// before anything touches the thread pool.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(Math.max(4, Math.min(64, require('os').cpus().length)));
}
const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const routes = require('./api/routes');
const scanManager = require('./core/scanManager');

const PORT = process.env.PORT || 8888;
const UI_DIR = path.join(__dirname, '../ui');

// Session token — regenerated each server start. Injected into the served HTML,
// required on every state-changing request. Prevents other websites from making
// authenticated calls to the local server (the app is same-origin, so it has the token).
const SESSION_TOKEN = crypto.randomBytes(24).toString('hex');

// ── Log file ─────────────────────────────────────────────────────────────────
// Mirror console output to data/app.log so a user can send it for support when
// something goes wrong. Rotates when it exceeds ~2MB.
(function setupLogFile() {
  try {
    const fs2 = require('fs');
    const cfg = require('./core/config');
    const logDir = cfg.getDataDir();
    fs2.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'app.log');
    // Rotate if too big
    try {
      if (fs2.existsSync(logFile) && fs2.statSync(logFile).size > 2 * 1024 * 1024) {
        fs2.renameSync(logFile, logFile + '.old');
      }
    } catch {}
    const stream = fs2.createWriteStream(logFile, { flags: 'a' });
    const stamp = () => new Date().toISOString();
    ['log', 'warn', 'error'].forEach(level => {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        try {
          const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
          // Strip ANSI/box-drawing noise from the banner
          stream.write(`[${stamp()}] ${line}\n`);
        } catch {}
      };
    });
    process.on('uncaughtException', e => { try { stream.write(`[${stamp()}] UNCAUGHT: ${e.stack}\n`); } catch {}; });
  } catch {}
})();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ── Security: reject cross-origin and cross-host requests ────────────────────
// The UI is served from this same server, so no CORS is needed. A request whose
// Origin is a different site is an external page trying to reach the local
// server — reject it. Host header is validated loosely (localhost/127.0.0.1 on
// any port) so the app keeps working if the port changes.
function isLocalHost(hostHeader) {
  if (!hostHeader) return true; // no host (e.g. same-process test client) — allow
  const h = hostHeader.split(':')[0].toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}
app.use((req, res, next) => {
  if (!isLocalHost(req.headers.host)) {
    return res.status(403).json({ error: 'Invalid host' });
  }
  // Origin, when present, must be a localhost origin (blocks other websites)
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!isLocalHost(new URL(origin).host)) return res.status(403).json({ error: 'Cross-origin blocked' });
    } catch { return res.status(403).json({ error: 'Bad origin' }); }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// ── Session token check on state-changing API calls ──────────────────────────
const DISABLE_TOKEN = process.env.NODE_ENV === 'test' || process.env.DNM_NO_TOKEN === '1';
app.use('/api', (req, res, next) => {
  if (DISABLE_TOKEN) return next();
  // Safe methods and a few read-only endpoints don't need the token
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const token = req.headers['x-session-token'] || req.query._t;
  if (token !== SESSION_TOKEN) {
    return res.status(403).json({ error: 'Missing or invalid session token' });
  }
  next();
});

// Expose the token to the same-origin UI only
app.get('/api/session-token', (req, res) => res.json({ token: SESSION_TOKEN }));
// Prevent browser from caching UI files — ensures version updates are visible immediately
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
// API routes (mounted before static so /api/* is handled first)
app.use('/api', routes);

// Serve index.html with the session token injected
const fsMod = require('fs');
function serveIndex(res) {
  let html = fsMod.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  html = html.replace('</head>', `  <script>window.__SESSION_TOKEN__=${JSON.stringify(SESSION_TOKEN)};</script>\n</head>`);
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
}
app.get('/', (req, res) => serveIndex(res));

app.use(express.static(UI_DIR));

// Serve UI for all non-API routes (SPA)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) serveIndex(res);
});

// WebSocket: broadcast scan events to all connected clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws, req) => {
  // Reject WebSocket connections from other origins
  const origin = req.headers.origin;
  if (origin) {
    try {
      const oHost = new URL(origin).host;
      if (!isLocalHost(new URL(origin).host)) { ws.close(); return; }
    } catch { ws.close(); return; }
  }
  // Send current scan states on connect
  ws.send(JSON.stringify({ type: 'init', scans: scanManager.getAll() }));
  ws.on('error', () => {});
});

scanManager.on('scan:any', ({ id, event, state }) => {
  broadcast({ type: 'scan:' + event, id, state });
});

server.listen(PORT, '127.0.0.1', () => {
  const pkg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'../package.json'),'utf8'));
  console.log('');
  console.log('  ██████╗ ██╗   ██╗██████╗ ███████╗███╗   ██╗ ██████╗ ███╗   ███╗ ██████╗ ██████╗ ███████╗');
  console.log('  ██╔══██╗██║   ██║██╔══██╗██╔════╝████╗  ██║██╔═══██╗████╗ ████║██╔═══██╗██╔══██╗██╔════╝');
  console.log('  ██║  ██║██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║   ██║██╔████╔██║██║   ██║██████╔╝█████╗  ');
  console.log('  ██║  ██║██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║   ██║██║╚██╔╝██║██║   ██║██╔══██╗██╔══╝  ');
  console.log('  ██████╔╝╚██████╔╝██║     ███████╗██║ ╚████║╚██████╔╝██║ ╚═╝ ██║╚██████╔╝██║  ██║███████╗');
  console.log('  ╚═════╝  ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝');
  console.log('');
  console.log(`  v${pkg.version}  →  http://localhost:${PORT}`);
  console.log('  Browser window can be closed — scans continue running here.');
  console.log('  Close this window (or Ctrl+C) to stop the server.');
  console.log('');
  console.log('  Waiting for scan activity...');
  console.log('  ─────────────────────────────────────────────────────────────────────────────');
});

// Graceful shutdown
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });

module.exports = { app, server };
