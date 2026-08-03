/* api.js — fetch wrapper + WebSocket */

// Global fetch shim: automatically attach the session token to any same-origin
// /api request, so raw fetch() calls throughout the app stay authenticated
// without each call having to remember the header.
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/api') || url.includes('://localhost') || url.includes('127.0.0.1')) {
      init = { ...init };
      init.headers = new Headers(init.headers || {});
      if (!init.headers.has('X-Session-Token')) {
        init.headers.set('X-Session-Token', window.__SESSION_TOKEN__ || '');
      }
    }
    return _fetch(input, init);
  };
})();

const API = (() => {
  const BASE = '/api';

  async function request(method, path, body) {
    let res;
    try {
      const opts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': window.__SESSION_TOKEN__ || ''
        }
      };
      if (body !== undefined) opts.body = JSON.stringify(body);
      res = await fetch(BASE + path, opts);
    } catch (e) {
      const err = new Error(`Network error: ${e.message}`);
      ErrorLog.push(path, err);
      throw err;
    }

    // Only parse JSON if the response is actually JSON
    const ct = res.headers.get('content-type') || '';
    if (!res.ok && !ct.includes('application/json')) {
      const err = new Error(`HTTP ${res.status} ${res.statusText} — ${path}`);
      ErrorLog.push(path, err);
      throw err;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      const err = new Error(`Server returned non-JSON response for ${path} (HTTP ${res.status})`);
      ErrorLog.push(path, err);
      throw err;
    }

    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      ErrorLog.push(path, err);
      throw err;
    }
    return data;
  }

  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    del: (p) => request('DELETE', p),
    patch: (p, b) => request('PATCH', p, b),

    // Convenience
    getConfig: () => API.get('/config'),
    saveConfig: (cfg) => API.post('/config', cfg),
    pickFolder: () => API.get('/pick-folder'),

    getScans: () => API.get('/scans'),
    startScan: () => API.post('/scans/start', {}),
    pauseScan: (id) => API.post(`/scans/${id}/pause`),
    resumeScan: (id) => API.post(`/scans/${id}/resume`),
    abortScan: (id) => API.post(`/scans/${id}/abort`),
    dismissScan: (id) => API.del(`/scans/${id}`),

    getResults: () => API.get('/results'),
    getResult: (fn) => API.get(`/results/${encodeURIComponent(fn)}`),
    deleteResult: (fn) => API.del(`/results/${encodeURIComponent(fn)}`),
    filterResult: (fn, type, value) => API.post(`/results/${encodeURIComponent(fn)}/filter`, { type, value }),
    saveOverrides: (fn, overrides) => API.post(`/results/${encodeURIComponent(fn)}/overrides`, { overrides }),
    runActions: (fn, actionSpec, dryRun) => API.post(`/results/${encodeURIComponent(fn)}/actions`, { actionSpec, dryRun }),

    getUndoLog: () => API.get('/actions/undo-log'),
    undo: (idx) => API.post(`/actions/undo/${idx}`),

    getProfiles: () => API.get('/profiles'),
    saveProfiles: (p) => API.post('/profiles', p),

    getCacheStats: () => API.get('/cache/stats'),
    clearCache: () => API.del('/cache'),

    exportUrl: (fn, fmt) => `${BASE}/results/${encodeURIComponent(fn)}/export/${fmt}`,

    restart: () => API.post('/restart'),

    // Checkpoints
    getCheckpoints:   ()   => API.get('/checkpoints'),
    resumeScan:       (id) => API.post(`/scans/resume/${id}`, {}),
    deleteCheckpoint: (id) => API.del(`/checkpoints/${id}`),
    getInterim:       (id) => API.get(`/scans/${id}/interim`)
  };
})();

// ─── WebSocket ────────────────────────────────────────────────────────────────
const WS = (() => {
  let ws = null;
  const handlers = {};

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const h = handlers[msg.type];
        if (h) h.forEach(fn => fn(msg));
        const any = handlers['*'];
        if (any) any.forEach(fn => fn(msg));
      } catch {}
    };
    ws.onclose = () => { setTimeout(connect, 2000); };
    ws.onerror = () => {};
  }

  return {
    connect,
    on: (type, fn) => {
      if (!handlers[type]) handlers[type] = [];
      handlers[type].push(fn);
    },
    off: (type, fn) => {
      if (!handlers[type]) return;
      handlers[type] = handlers[type].filter(h => h !== fn);
    }
  };
})();

// ─── Error log ────────────────────────────────────────────────────────────────
const ErrorLog = (() => {
  const entries = [];

  function push(context, err) {
    const entry = {
      ts: new Date().toISOString(),
      context,
      message: err.message,
      stack: err.stack || '',
      browser: navigator.userAgent
    };
    entries.push(entry);
    showBar(entry);
  }

  function showBar(entry) {
    const bar = document.getElementById('error-bar');
    const msg = document.getElementById('error-msg');
    if (!bar || !msg) return;
    msg.textContent = `Error: ${entry.message}`;
    bar.classList.remove('hidden');
  }

  function getAll() { return [...entries]; }

  return { push, getAll };
})();

// Wire up error bar buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('dismiss-error')?.addEventListener('click', () => {
    document.getElementById('error-bar')?.classList.add('hidden');
  });

  document.getElementById('copy-error-log')?.addEventListener('click', () => {
    const text = ErrorLog.getAll().map(e =>
      `[${e.ts}] ${e.context}: ${e.message}\n${e.stack}`
    ).join('\n\n');
    navigator.clipboard?.writeText(text).catch(() => {
      const w = window.open('', '_blank');
      w.document.write('<pre>' + text + '</pre>');
    });
  });

  // Global error catcher
  window.addEventListener('error', (e) => {
    ErrorLog.push('window', e.error || new Error(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    ErrorLog.push('promise', e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
  });
});
