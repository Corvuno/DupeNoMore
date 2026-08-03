/* history.js — sidebar "Previous scans" list.
 * Compact, searchable, scales to many scans. Replaces the old Results page.
 * Advanced tools (import/export/incremental) live in a "⋯ More" popover so
 * they don't clutter the common path.
 */

const History = (() => {
  let allResults = [];
  let activeFile = null;
  let container = null;

  async function init(c) {
    container = c;
    await load();

    // Search box (lives in the sidebar, above the list)
    const searchInput = document.getElementById('history-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => render(searchInput.value.trim().toLowerCase()));
    }
  }

  async function refresh() { await load(); }

  async function load() {
    if (!container) return;
    container.innerHTML = '<div class="hd-empty">Loading…</div>';
    try {
      allResults = await API.getResults();
      render('');
      // Also surface any resumable checkpoints
      loadCheckpoints();
    } catch (e) {
      container.innerHTML = `<div class="hd-empty">Couldn't load scans</div>`;
    }
  }

  function render(query) {
    if (!container) return;
    // Update the top-bar count badge
    const badge = document.getElementById('tb-recent-count');
    if (badge) badge.textContent = allResults.length || '';

    const results = query
      ? allResults.filter(r => {
          const date = r.scannedAt ? new Date(r.scannedAt).toLocaleString('en-GB') : '';
          return (r.filename + ' ' + date + ' ' + (r.settingsSummary||'')).toLowerCase().includes(query);
        })
      : allResults;

    if (!results.length) {
      container.innerHTML = query
        ? '<div class="hd-empty">No scans match your search.</div>'
        : '<div class="hd-empty">No previous scans yet.<br>Start a new scan to see it here.</div>';
      return;
    }

    container.innerHTML = '';
    results.forEach((r, i) => container.appendChild(buildItem(r, i === 0 && !query)));
  }

  function buildItem(result, isLatest) {
    const div = document.createElement('div');
    div.className = `hd-scan${result.filename === activeFile ? ' active' : ''}`;

    const d = result.scannedAt ? new Date(result.scannedAt) : null;
    const dateStr = d ? d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const timeStr = d ? d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '';
    const settings = result.settingsSummary || result.scanSummary || '';

    div.innerHTML = `
      <div class="hd-scan-main">
        <div class="hd-scan-title">${isLatest ? '<span class="hd-star">★</span>' : ''}${dateStr} <span class="hd-scan-time">${timeStr}</span></div>
        <div class="hd-scan-sub">${result.groupCount} duplicate groups${settings ? ' · <span class="hd-scan-cfg">'+escH(settings)+'</span>' : ''}</div>
      </div>
      <button class="hd-scan-open">Open →</button>
      <button class="hd-scan-menu" title="More">⋯</button>
    `;

    div.querySelector('.hd-scan-main').addEventListener('click', () => open(result.filename));
    div.querySelector('.hd-scan-open').addEventListener('click', () => open(result.filename));
    div.querySelector('.hd-scan-menu').addEventListener('click', (e) => { e.stopPropagation(); showItemMenu(e.currentTarget, result); });
    return div;
  }

  function showItemMenu(anchor, result) {
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'sb-popover';
    menu.innerHTML = `
      <div class="sb-pop-item" data-act="review">Open in review</div>
      <div class="sb-pop-sep"></div>
      <div class="sb-pop-label">Export as</div>
      ${['html','csv','json','txt','zip'].map(f =>
        `<div class="sb-pop-item" data-export="${f}">${f.toUpperCase()}</div>`).join('')}
      <div class="sb-pop-sep"></div>
      <div class="sb-pop-item sb-pop-danger" data-act="delete">Delete scan</div>
    `;
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
    menu.style.top  = (rect.bottom + 4) + 'px';

    menu.addEventListener('click', async (e) => {
      const exp = e.target.dataset.export;
      const act = e.target.dataset.act;
      if (exp) { window.open(API.exportUrl(result.filename, exp), '_blank'); closeMenus(); }
      else if (act === 'review') { open(result.filename); closeMenus(); }
      else if (act === 'delete') {
        closeMenus();
        const ok = await confirm('Delete scan', `Delete this scan permanently? The duplicate data will be removed (your actual files are not touched).`, 'Delete');
        if (ok) { await API.deleteResult(result.filename).catch(err => toast(err.message,'error')); await load(); }
      }
    });
    setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
  }

  function closeMenus() { qsa('.sb-popover').forEach(m => m.remove()); }

  function open(filename) {
    activeFile = filename;
    qsa('.hd-scan').forEach(s => s.classList.remove('active'));
    Shell.openReview(filename);
    Shell.closeDrawer();
    render(document.getElementById('history-search')?.value.trim().toLowerCase() || '');
  }

  async function loadCheckpoints() {
    try {
      const cps = await API.getCheckpoints();
      if (!cps || !cps.length) return;
      // Prepend a resumable banner to the list
      const banner = document.createElement('div');
      banner.className = 'hd-resume';
      banner.innerHTML = `<span>⟳ ${cps.length} interrupted scan${cps.length>1?'s':''}</span><button class="hd-resume-btn">Resume</button>`;
      banner.querySelector('.hd-resume-btn').addEventListener('click', async () => {
        await API.post('/scans/resume', { checkpoint: cps[0].file }).catch(()=>{});
        Shell.openRun();
      });
      container.prepend(banner);
    } catch {}
  }

  // Advanced tools popover (import/export state, incremental, import result)
  function showAdvanced(anchor) {
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'sb-popover';
    menu.innerHTML = `
      <div class="sb-pop-item" data-act="import-result">Import a result file</div>
      <div class="sb-pop-item" data-act="incremental">Incremental scan…</div>
      <div class="sb-pop-sep"></div>
      <div class="sb-pop-item" data-act="export-state">Back up everything</div>
      <div class="sb-pop-item" data-act="import-state">Restore backup</div>
    `;
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      closeMenus();
      if (act === 'export-state') { window.open('/api/state/export','_blank'); toast('Downloading backup…','info'); }
      else if (act === 'import-state') pickAndImportState();
      else if (act === 'import-result') pickAndImportResult();
      else if (act === 'incremental') showIncremental();
    });
    setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
  }

  function pickAndImportState() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.zip';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      toast('Restoring…','info');
      const buf = await f.arrayBuffer();
      const res = await fetch('/api/state/import', { method:'POST', headers:{'Content-Type':'application/zip'}, body:buf }).then(r=>r.json());
      if (res.ok) { toast('Restored','success'); await load(); } else toast('Restore failed','error');
    };
    inp.click();
  }

  function pickAndImportResult() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const text = await f.text();
      const res = await fetch('/api/results/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:text }).then(r=>r.json());
      if (res.ok) { toast('Result imported','success'); await load(); } else toast('Import failed','error');
    };
    inp.click();
  }

  async function showIncremental() {
    const path = await new Promise(res => {
      const r = API.pickFolder ? API.pickFolder() : Promise.resolve({path:null});
      r.then(x => res(x.path)).catch(() => res(null));
    });
    if (!path) return;
    const res = await API.post('/scans/incremental', { folderPath: path }).catch(e => ({error:e.message}));
    if (res.id) { toast('Incremental scan started','success'); Shell.openRun(); }
    else toast('Failed: ' + (res.error||'?'), 'error');
  }

  return { init, refresh, load, showAdvanced, closeMenus };
})();
