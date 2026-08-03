/* settings.js — App configuration */
const Page_settings = (() => {
  function init(container) {
    API.get('/config').then(cfg => render(container, cfg)).catch(() => render(container, {}));
  }
  function refresh(c) { init(c); }

  function render(container, cfg) {
    const s = cfg.settings || {};
    container.innerHTML = `
      <div class="page-title">Settings</div>

      <!-- 1. Storage ─────────────────────────────────────────────────────── -->
      <div class="settings-section">
        <div class="section-title" style="margin-top:0">Storage</div>

        <label class="label">Scan results folder</label>
        <div class="input-group" style="max-width:480px">
          <input id="scans-dir" class="input" value="${escH(s.scansDir||'')}" placeholder="Default: ./scans next to start.bat">
          <button class="btn btn-ghost btn-sm" id="pick-scans-dir">Browse</button>
        </div>
        <div class="text-muted text-sm mt-2">Where duplicate result JSON files are saved.</div>

        <div style="margin-top:16px">
          <label class="label">Trash</label>
          <div class="text-muted text-sm" id="trash-stats">Loading…</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-ghost btn-sm" id="refresh-trash-btn">↺ Refresh</button>
            <button class="btn btn-danger btn-sm" id="empty-trash-btn">🗑 Empty trash</button>
          </div>
          <div class="text-muted text-sm mt-2">Recycled files are held here until manually emptied.</div>
        </div>
      </div>

      <hr class="divider">

      <!-- 2. Performance ──────────────────────────────────────────────────── -->
      <div class="settings-section">
        <div class="section-title" style="margin-top:0">Performance</div>

        <label class="label">Hash cache</label>
        <div class="text-muted text-sm" id="cache-stats">Loading…</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-ghost btn-sm" id="refresh-cache-stats">↺ Refresh stats</button>
          <button class="btn btn-danger btn-sm" id="clear-cache-btn">Clear cache</button>
        </div>
        <div class="text-muted text-sm mt-2">Hash cache lets the app skip files it has already seen. Clearing forces a full recompute on next scan.</div>
      </div>

      <hr class="divider">

      <!-- 3. Integrations ─────────────────────────────────────────────────── -->
      <div class="settings-section">
        <div class="section-title" style="margin-top:0">Integrations</div>

        <label class="label">Video thumbnails (ffmpeg)</label>
        <div class="text-sm" id="ffmpeg-status">Checking…</div>

        <label class="label mt-4">HuggingFace token <span class="tag">Optional</span></label>
        <div class="input-group" style="max-width:400px">
          <input id="hf-token" class="input" type="password" value="${escH(s.huggingfaceToken||'')}" placeholder="hf_…">
          <button class="btn btn-ghost btn-sm" id="toggle-hf-token">Show</button>
        </div>
        <div class="text-muted text-sm" id="hf-status">${s.huggingfaceToken ? '✓ Token set' : 'No token set'}</div>
        <div class="text-muted text-sm mt-1">Required for CLIP model download and authenticated HuggingFace access.</div>

        <label class="label mt-4">CLIP search timeout (seconds)</label>
        <input id="clip-timeout" class="input" type="number" value="${s.clipTimeout||30}" min="5" max="300" style="max-width:100px">
        <div class="text-muted text-sm mt-1">Max seconds to wait for a CLIP embedding to complete.</div>
      </div>

      <hr class="divider">

      <!-- 4. Application ──────────────────────────────────────────────────── -->
      <div class="settings-section">
        <div class="section-title" style="margin-top:0">Application</div>

        <div id="version-info" class="text-muted text-sm" style="margin-bottom:12px">Loading version…</div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="restart-btn">↺ Restart server</button>
          <button class="btn btn-ghost" id="upgrade-btn">↑ Check for updates</button>
        </div>
        <div id="upgrade-log" class="log-wrap mt-4 hidden" style="height:80px"></div>
        <div class="text-muted text-sm mt-2">
          Restart closes the server process — start.bat will relaunch it automatically.
        </div>
      </div>
    `;

    wireSettings(container);
    loadTrashStats();
    loadCacheStats();
    loadVersionInfo();
  }

  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function saveField(path, value) {
    API.get('/config').then(cfg => {
      const parts = path.split('.');
      let obj = cfg;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length-1]] = value;
      return API.post('/config', cfg);
    }).catch(e => toast(e.message, 'error'));
  }

  function loadTrashStats() {
    API.get('/trash/stats').then(s => {
      const el2 = document.getElementById('trash-stats');
      if (el2) el2.textContent = s.count
        ? s.count + ' files · ' + (s.size_fmt || '')
        : 'Trash is empty';
    }).catch(() => {});
  }

  function loadCacheStats() {
    API.get('/cache/stats').then(s => {
      const el2 = document.getElementById('cache-stats');
      if (el2 && s) el2.textContent = (s.count||0) + ' cached hashes · ' + (s.size_fmt||'');
    }).catch(() => {
      const el2 = document.getElementById('cache-stats');
      if (el2) el2.textContent = 'Cache info unavailable';
    });
  }

  function loadVersionInfo() {
    API.get('/version').then(v => {
      const el2 = document.getElementById('version-info');
      if (!el2) return;
      const integrity = v.ok ? '✓ All files intact' : '⚠ Missing: ' + (v.missing||[]).join(', ');
      el2.innerHTML = `<b>DupeNoMore v${v.version}</b> &nbsp;·&nbsp; Node ${v.nodeVersion} &nbsp;·&nbsp; ${integrity}`;
    }).catch(() => {
      // Fall back to health endpoint
      API.get('/health').then(h => {
        const el2 = document.getElementById('version-info');
        if (el2) el2.textContent = 'DupeNoMore v' + (h.version||'?');
      }).catch(() => {});
    });
  }

  function wireSettings(container) {
    // Storage
    el('pick-scans-dir')?.addEventListener('click', async () => {
      const { path, unsupported } = await API.pickFolder().catch(() => ({ path: null }));
      if (unsupported) { toast('Native picker only on Windows — type the path manually.', 'info'); return; }
      if (path) { el('scans-dir').value = path; saveField('settings.scansDir', path); }
    });
    el('scans-dir')?.addEventListener('change', () => saveField('settings.scansDir', el('scans-dir').value.trim()));

    // Trash
    el('refresh-trash-btn')?.addEventListener('click', loadTrashStats);
    el('empty-trash-btn')?.addEventListener('click', async () => {
      const stats = await API.get('/trash/stats').catch(() => ({count:0}));
      if (!stats.count) { toast('Trash is already empty', 'info'); return; }
      if (!await confirm('Empty trash', stats.count + ' files will be permanently deleted. This cannot be undone.', 'Delete permanently')) return;
      const r = await API.del('/trash').catch(e => ({error: e.message}));
      if (r.error) { toast(r.error, 'error'); return; }
      toast('Deleted ' + r.deleted + ' files', 'success');
      loadTrashStats();
    });

    // Cache
    el('refresh-cache-stats')?.addEventListener('click', loadCacheStats);
    el('clear-cache-btn')?.addEventListener('click', async () => {
      if (!await confirm('Clear cache', 'Clear the hash cache? The next scan will recompute all hashes from scratch.', 'Clear')) return;
      await API.clearCache().catch(e => toast(e.message, 'error'));
      loadCacheStats();
      toast('Cache cleared', 'success');
    });

    // ffmpeg
    API.get('/health').then(h => {
      const el2 = el('ffmpeg-status');
      if (el2) el2.innerHTML = h.ffmpegAvailable
        ? '<span style="color:var(--green)">✓ ffmpeg found — video thumbnails enabled</span>'
        : '<span style="color:var(--text-3)">✗ ffmpeg not found — install ffmpeg to enable video thumbnails</span>';
    }).catch(() => {});

    // HF token
    el('toggle-hf-token')?.addEventListener('click', () => {
      const inp = el('hf-token');
      const show = inp.type === 'text';
      inp.type = show ? 'password' : 'text';
      el('toggle-hf-token').textContent = show ? 'Show' : 'Hide';
    });
    el('hf-token')?.addEventListener('change', () => {
      const val = el('hf-token').value.trim();
      saveField('settings.huggingfaceToken', val);
      el('hf-status').textContent = val ? '✓ Token set' : 'No token set';
    });
    el('clip-timeout')?.addEventListener('change', () => saveField('settings.clipTimeout', parseInt(el('clip-timeout').value)));

    // Restart
    el('restart-btn')?.addEventListener('click', async () => {
      if (!await confirm('Restart server', 'The server will stop. start.bat will relaunch it automatically.', 'Restart')) return;
      toast('Restarting… please wait 5 seconds then refresh.', 'info', 6000);
      API.post('/restart', {}).catch(() => {});
      setTimeout(() => window.location.reload(), 5500);
    });

    // Upgrade
    el('upgrade-btn')?.addEventListener('click', async () => {
      if (!await confirm('Check for updates', 'This will run npm install to update packages. Continue?', 'Update')) return;
      el('upgrade-log').classList.remove('hidden');
      el('upgrade-log').textContent = 'Running npm install…\n(Close and rerun start.bat when done)';
      toast('Update triggered. Close the server window and run start.bat again.', 'info', 6000);
    });
  }

  return { init, refresh };
})();
