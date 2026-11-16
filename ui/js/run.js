/* run.js — Run page */
'use strict';

const Page_run = (() => {
  const PHASES  = ['collect', 'hash', 'compare', 'save'];

  // ── Live state ──────────────────────────────────────────────────────────────
  // Every scan the server tells us about (over the WebSocket or a fetch) lands in
  // _scans. Cards are redrawn at most once per animation frame, and only the cards
  // whose scan changed, so a fast scan doesn't rebuild the page dozens of times a
  // second (which also swallowed clicks on Pause/Kill mid-rebuild).
  const _scans = new Map();
  const _dirty = new Set();
  let _frame = null;
  let _setUp = false;

  function _handleState(scan) {
    if (!scan || !scan.id) return;
    _scans.set(scan.id, scan);
    _dirty.add(scan.id);
    if (!_frame) _frame = requestAnimationFrame(() => { _frame = null; draw(); });
  }

  // Called once at app start, before the WebSocket connects, so the Run page is
  // live whether or not it has been opened yet.
  function setup() {
    if (_setUp) return;
    _setUp = true;
    ['scan:started','scan:progress','scan:log','scan:done','scan:error','scan:paused','scan:resumed','scan:aborted']
      .forEach(ev => WS.on(ev, m => _handleState(m?.state)));
    WS.on('init', m => (m?.scans || []).forEach(_handleState));
    setInterval(tickElapsed, 1000);
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init(container) {
    if (!container.querySelector('#scan-cards-wrap')) {
      container.innerHTML = `
        <div class="page-title">Run</div>
        <div class="page-subtitle">Active and completed scans. Browser can be closed — scans continue in background.</div>
        <div id="scan-cards-wrap"></div>
        <div id="run-empty" class="empty-state">
          <div style="font-size:32px">◎</div>
          <p>No scans running. Click ＋ New scan in the top bar to start one.</p>
        </div>
      `;
    }
    setup();
    renderAll();
  }

  function refresh(container) {
    if (document.getElementById('scan-cards-wrap')) renderAll();
    else init(container);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  // Pull the full list from the server (catches anything missed while the socket
  // was down, and drops dismissed scans), then draw.
  async function renderAll() {
    let scans;
    try { scans = await API.getScans(); } catch { return; }
    _scans.clear();
    scans.forEach(s => { _scans.set(s.id, s); _dirty.add(s.id); });
    draw();
  }

  // Running and paused scans first, then the rest, newest first, so the scan
  // you are waiting on is always at the top of the page.
  function sorted() {
    const live = s => (s.status === 'running' || s.status === 'paused') ? 0 : 1;
    return [..._scans.values()].sort((a, b) => live(a) - live(b) || (b.startedAt || 0) - (a.startedAt || 0));
  }

  function draw() {
    const wrap  = document.getElementById('scan-cards-wrap');
    const empty = document.getElementById('run-empty');
    if (!wrap) { _dirty.clear(); return; }
    const list = sorted();
    empty?.classList.toggle('hidden', list.length > 0);

    const keep = new Set(list.map(s => s.id));
    wrap.querySelectorAll('[data-scan-id]').forEach(c => { if (!keep.has(c.dataset.scanId)) c.remove(); });

    list.forEach((scan, i) => {
      let card = wrap.querySelector(`[data-scan-id="${scan.id}"]`);
      if (!card || _dirty.has(scan.id)) {
        const fresh = buildCard(scan);
        if (card) card.replaceWith(fresh);
        card = fresh;
      }
      if (wrap.children[i] !== card) wrap.insertBefore(card, wrap.children[i] || null);
    });
    _dirty.clear();
  }

  // ── Card ────────────────────────────────────────────────────────────────────
  function buildCard(scan) {
    const card = document.createElement('div');
    card.className = 'scan-card';
    card.dataset.scanId = scan.id;

    const p         = scan.progress || {};
    const phaseIdx  = PHASES.indexOf(p.phase || 'collect');
    const isRunning = scan.status === 'running';
    const isDone    = scan.status === 'done';
    const startedAt = scan.startedAt || Date.now();

    const elapsed = scan.finishedAt
      ? fmtDur(scan.finishedAt - startedAt)
      : fmtDur(Date.now() - startedAt);

    let rate = '';
    if (p.current > 1 && isRunning) {
      const secs = (Date.now() - startedAt) / 1000;
      if (secs > 2) rate = `${Math.round(p.current / secs)} files/s`;
    }

    card.innerHTML = `
      <div class="scan-card-header">
        <span class="status-badge status-${scan.status}">${statusIcon(scan.status)} ${scan.status}</span>
        <span class="text-muted text-sm mono">${scan.id.slice(0, 8)}</span>
        ${scan.groupCount > 0 ? `<span class="tag">${scan.groupCount} groups found</span>` : ''}
        <span class="text-muted text-sm" style="margin-left:8px">
          Started: ${fmtTime(startedAt)}
          &nbsp;·&nbsp;
          Elapsed: <span class="elapsed-timer" data-started="${startedAt}" data-finished="${scan.finishedAt || ''}">${elapsed}</span>
          ${rate ? `&nbsp;·&nbsp; ${rate}` : ''}
        </span>
        <div class="scan-card-controls">
          ${isRunning ? `<button class="btn btn-ghost btn-sm" data-action="pause">⏸ Pause</button>` : ''}
          ${scan.status === 'paused' ? `<button class="btn btn-ghost btn-sm" data-action="resume">▶ Resume</button>` : ''}
          ${['running','paused'].includes(scan.status) ? `<button class="btn btn-danger btn-sm" data-action="abort">⏹ Kill</button>` : ''}
          ${isDone && scan.resultFile ? `<button class="btn btn-primary btn-sm" data-action="review">→ Review</button>` : ''}
          ${scan.interimFile ? `<button class="btn btn-ghost btn-sm" data-action="interim">◎ Load interim</button>` : ''}
          ${['done','error','aborted'].includes(scan.status) ? `<button class="btn btn-ghost btn-sm" data-action="dismiss">✕ Dismiss</button>` : ''}
        </div>
      </div>

      <div class="phase-track">
        ${PHASES.map((ph, i) => `
          <div class="phase-step ${i < phaseIdx ? 'done' : i === phaseIdx && isRunning ? 'active' : ''}">
            ${i < phaseIdx ? '✓' : i === phaseIdx && isRunning ? '▶' : '○'} ${ph}
          </div>`).join('')}
      </div>

      ${['running','paused'].includes(scan.status) ? `
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${p.percent || 0}%"></div>
        </div>
        <div class="progress-stats">
          <span>${p.percent || 0}%</span>
          ${p.total ? `<span>${p.current || 0} / ${p.total} files</span>` : ''}
          ${rate ? `<span>${rate}</span>` : ''}
        </div>
      ` : ''}

      <div class="log-wrap" id="log-${scan.id}">
        ${(()=>{
          const raw = (scan.log || []).slice(-500);
          // Filter PIL Palette warnings and collapse repeated state/checkpoint lines
          const deduped = [];
          for (const l of raw) {
            // Filter PIL Palette warnings (from image processing)
            if (/PIL.*Palette|palette.*warning/i.test(l.message)) continue;
            // Filter verbose interim/checkpoint lines — keep only latest
            const isCheckpt = /checkpoint.*saved|state saved|\[interim\]/i.test(l.message);
            if (isCheckpt) {
              const i = deduped.findLastIndex(x => /checkpoint.*saved|state saved|interim/i.test(x.message));
              if (i >= 0) { deduped[i] = l; continue; }
            }
            // Deduplicate: progress lines update in-place
            const m = l.message.match(/^(Hashing|Comparing):/);
            if (m) {
              const i = deduped.findLastIndex(x => x.message.startsWith(m[0]));
              if (i >= 0) { deduped[i] = l; continue; }
            }
            deduped.push(l);
          }
          return deduped.slice(-150).map(l => `<div class="log-line${cls(l.message)}"><span class="log-ts">${fmtTime(l.ts)}</span>${esc(l.message)}</div>`).join('');
        })()}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:4px">
        <button class="btn btn-ghost btn-xs" data-action="copy-log">Copy log</button>
      </div>
    `;

    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        switch (btn.dataset.action) {
          case 'pause':   await API.pauseScan(scan.id).catch(()=>{}); break;
          case 'resume':  await API.resumeScan(scan.id).catch(()=>{}); break;
          case 'abort':
            if (await confirm('Stop scan', 'Kill this scan? Progress will be lost.'))
              await API.abortScan(scan.id).catch(()=>{});
            break;
          case 'interim':
            try {
              const ir = await API.get('/scans/' + scan.id + '/interim');
              if (ir && ir.groups) {
                // Save interim data as a named result so review can load it
                const fn = await API.post('/results/save-interim', ir);
                if (fn && fn.filename) {
                  Nav.go('review');
                  Page_review._loadFile(fn.filename);
                } else {
                  toast('Could not save interim results','error');
                }
              } else toast('No interim results yet — scan is still in hash phase','info');
            } catch(e) { toast('Could not load interim: ' + e.message,'error'); }
            break;
          case 'dismiss':
            await API.dismissScan(scan.id).catch(()=>{});
            _scans.delete(scan.id);
            draw();
            break;
          case 'review':
            if (scan.resultFile) {
              Page_review._loadFile?.(scan.resultFile.split(/[\\/]/).pop());
              Nav.go('review');
            }
            break;
          case 'copy-log': {
            const txt = (scan.log||[]).map(l=>`[${new Date(l.ts).toISOString()}] ${l.message}`).join('\n');
            navigator.clipboard?.writeText(txt).catch(()=>{});
            toast('Log copied','success');
            break;
          }
        }
      });
    });

    // Scroll log to bottom
    requestAnimationFrame(() => {
      const logEl = document.getElementById(`log-${scan.id}`);
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });

    return card;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function tickElapsed() {
    // data-finished is always present; it is empty while the scan is still going.
    document.querySelectorAll('.elapsed-timer[data-finished=""]').forEach(s => {
      const started = parseInt(s.dataset.started);
      if (started) s.textContent = fmtDur(Date.now() - started);
    });
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  }

  function fmtDur(ms) {
    if (!ms || ms < 0) return '0s';
    const s = Math.floor(ms / 1000);
    if (s < 60)  return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ${s % 60}s`;
    return `${Math.floor(m/60)}h ${m%60}m`;
  }

  function statusIcon(s) {
    return {running:'⟳', done:'✓', paused:'⏸', error:'✗', aborted:'⏹'}[s] || '○';
  }

  function cls(msg) {
    const m = (msg||'').toLowerCase();
    if (m.startsWith('[warn') || m.startsWith('⚠')) return ' warn';
    if (m.startsWith('error') || m.startsWith('✗')) return ' error';
    return '';
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, refresh, setup };
})();
