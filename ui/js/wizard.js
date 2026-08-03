/* wizard.js — US-037: 4-step guided scan wizard */
/* No inline onclick — all events wired via addEventListener to avoid scope issues */

const Page_wizard = (() => {
  let step = 1;
  let wc = null;       // wizConfig — local name to avoid global collision
  let container = null;
  const STEPS = ['Folders', 'Mode & Algorithms', 'Filters', 'Review & Start'];

  async function init(c) {
    container = c;
    step = 1;
    wc = await API.getConfig();
    render();
  }

  function refresh(c) { container = c; if (wc) render(); else init(c); }

  // ─── Render shell ─────────────────────────────────────────────────────────
  function render() {
    container.innerHTML = `
      <div class="page-title">Scan Wizard</div>
      <div class="page-subtitle">Step-by-step scan setup. You can always use ▶ Scan for a quick start.</div>

      <div class="wizard-steps">
        ${STEPS.map((s, i) => `
          <div class="wizard-step ${i+1 === step ? 'active' : i+1 < step ? 'done' : ''}">
            ${i+1 < step ? '✓ ' : (i+1) + ' '}${s}
          </div>`).join('')}
      </div>

      <div class="card" id="wizard-body">${renderStep()}</div>

      <div style="display:flex;gap:10px;margin-top:16px;justify-content:space-between">
        <button class="btn btn-ghost" id="wiz-back" ${step===1?'disabled':''}>← Back</button>
        <div style="display:flex;gap:10px">
          <button class="btn btn-ghost" id="wiz-cancel">Cancel</button>
          ${step < 4
            ? `<button class="btn btn-primary" id="wiz-next">Next →</button>`
            : `<button class="btn btn-success" id="wiz-start">▶ Start scan</button>`}
        </div>
      </div>
    `;

    wireStep();

    el('wiz-back')?.addEventListener('click', () => { step = Math.max(1, step-1); render(); });
    el('wiz-cancel')?.addEventListener('click', () => Nav.go('folders'));
    el('wiz-next')?.addEventListener('click', () => { gatherStep(); step++; render(); });
    el('wiz-start')?.addEventListener('click', startScan);
  }

  function renderStep() {
    if (step === 1) return renderFolders();
    if (step === 2) return renderMode();
    if (step === 3) return renderFilters();
    return renderSummary();
  }

  // ─── Step 1: Folders ──────────────────────────────────────────────────────
  function renderFolders() {
    const folders = wc.folders || [];
    return `
      <div class="card-title" style="margin-bottom:14px">Step 1: Select folders to scan</div>
      <div class="input-group" style="margin-bottom:16px">
        <input id="wiz-folder-input" class="input" placeholder="Paste path or use Browse…">
        <button class="btn btn-ghost" id="wiz-add-folder">Add</button>
        <button class="btn btn-primary" id="wiz-browse-folder">＋ Browse</button>
      </div>
      <div id="wiz-folder-list" style="display:flex;flex-direction:column;gap:8px">
        ${folders.length === 0
          ? '<div class="text-muted text-sm">No folders added yet.</div>'
          : folders.map((f, i) => `
            <div class="folder-row" style="display:flex;align-items:center;gap:10px" data-folder-idx="${i}">
              <span style="min-width:22px;color:var(--text-3);font-size:12px">${i+1}</span>
              <span class="mono" style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis" title="${escH(f.path)}">${escH(f.path)}</span>
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
                <input type="checkbox" class="toggle wiz-recursive" data-idx="${i}" ${f.recursive!==false?'checked':''}> Recursive
              </label>
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
                <input type="checkbox" class="toggle wiz-active" data-idx="${i}" ${f.active!==false?'checked':''}> Active
              </label>
              <button class="btn btn-ghost btn-xs wiz-remove-folder" data-idx="${i}">✕</button>
            </div>`).join('')}
      </div>
    `;
  }

  // ─── Step 2: Mode & algorithms ───────────────────────────────────────────
  function renderMode() {
    const sc = wc.scan || {};
    const algos = sc.algorithms || {};
    const thresh = sc.thresholds || {};
    const ALL = ['dhash','phash','ahash','whash','mhash','bhash'];
    return `
      <div class="card-title" style="margin-bottom:14px">Step 2: Scan mode and algorithms</div>

      <div class="section-title">Hash algorithms</div>
      <div class="chip-group" style="margin-bottom:16px">
        ${ALL.map(a => `<button class="chip${algos[a]?' active':''}" data-wiz-algo="${a}">${a}</button>`).join('')}
      </div>

      <div class="section-title">Thresholds (0–20 bits, lower = stricter)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${ALL.map(a => `
          <div>
            <label>${a}: <span id="wt-${a}">${thresh[a]??10}</span> bits</label>
            <input type="range" min="0" max="20" value="${thresh[a]??10}"
              class="wiz-thresh" data-algo="${a}"
              style="width:100%;accent-color:var(--accent)">
          </div>`).join('')}
      </div>

      <div class="section-title">Matching</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <label>Ensemble minimum</label>
          <input type="number" id="wiz-ensemble" class="input" min="1" max="6" value="${sc.ensureMin??2}">
        </div>
        <div>
          <label>Match logic</label>
          <select id="wiz-matchlogic" class="select">
            <option value="threshold" ${(sc.matchLogic||'threshold')==='threshold'?'selected':''}>Threshold</option>
            <option value="or" ${sc.matchLogic==='or'?'selected':''}>OR — any match</option>
            <option value="and" ${sc.matchLogic==='and'?'selected':''}>AND — all must match</option>
          </select>
        </div>
        <div>
          <label>Comparison size</label>
          <select id="wiz-comparesize" class="select">
            ${[8,16,32].map(s=>`<option value="${s}" ${(sc.compareSize||16)==s?'selected':''}>${s}×${s} px</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Anchor hash</label>
          <select id="wiz-anchor" class="select">
            <option value="">None</option>
            ${['dhash','phash','ahash','whash','mhash','bhash'].map(a=>`<option value="${a}" ${sc.anchorHash===a?'selected':''}>${a}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="section-title">Variants</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        ${[['wiz-rotation','rotation','Rotation'],['wiz-mirror','mirror','Mirror'],['wiz-colorchange','colorChange','Color change']].map(([id,k,l])=>`
          <label class="toggle-row">
            <input type="checkbox" class="toggle" id="${id}" ${sc[k]?'checked':''}> <span>${l}</span>
          </label>`).join('')}
      </div>
    `;
  }

  // ─── Step 3: Filters ─────────────────────────────────────────────────────
  function renderFilters() {
    const fi = wc.filters || {};
    return `
      <div class="card-title" style="margin-bottom:14px">Step 3: File filters</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <label>Min size (KB)</label>
          <input type="number" id="wiz-minsize" class="input" value="${fi.minSizeKB??10}">
        </div>
        <div>
          <label>Max size (MB, 0 = no limit)</label>
          <input type="number" id="wiz-maxsize" class="input" value="${fi.maxSizeMB??0}">
        </div>
        <div>
          <label>Date from</label>
          <input type="date" id="wiz-datefrom" class="input" value="${fi.dateFrom||''}">
        </div>
        <div>
          <label>Date to</label>
          <input type="date" id="wiz-dateto" class="input" value="${fi.dateTo||''}">
        </div>
        <div>
          <label>Date type</label>
          <select id="wiz-datetype" class="select">
            <option value="file"  ${(fi.dateType||'file')==='file'?'selected':''}>File date</option>
            <option value="exif"  ${fi.dateType==='exif'?'selected':''}>EXIF date</option>
            <option value="both"  ${fi.dateType==='both'?'selected':''}>Both</option>
          </select>
        </div>
        <div>
          <label>Extensions (empty = all images)</label>
          <input type="text" id="wiz-extensions" class="input" value="${(fi.extensions||[]).join(', ')}" placeholder="jpg, png, webp…">
        </div>
      </div>
      <div style="display:flex;gap:24px;margin-top:14px">
        <label class="toggle-row">
          <input type="checkbox" class="toggle" id="wiz-videos" ${fi.includeVideos?'checked':''}> <span>Include video files</span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" class="toggle" id="wiz-skipsystem" ${fi.skipSystemFolders!==false?'checked':''}> <span>Skip system folders</span>
        </label>
      </div>
      <div style="margin-top:14px">
        <label>Exclude patterns (one per line, wildcards ok)</label>
        <textarea id="wiz-excludes" class="textarea" rows="3">${(fi.excludePatterns||[]).join('\n')}</textarea>
      </div>
    `;
  }

  // ─── Step 4: Summary ──────────────────────────────────────────────────────
  function renderSummary() {
    const active = (wc.folders||[]).filter(f=>f.active!==false);
    const sc = wc.scan||{};
    const fi = wc.filters||{};
    const algos = Object.entries(sc.algorithms||{}).filter(([,v])=>v).map(([k])=>k);
    const noFolders = active.length === 0;
    return `
      <div class="card-title" style="margin-bottom:14px">Step 4: Review & start</div>
      ${noFolders ? `<div style="background:var(--red-bg);color:var(--red);padding:10px 14px;border-radius:6px;margin-bottom:14px">
        ⚠ No active folders — go back to step 1 and add at least one folder.
      </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div>
          <div class="section-title">Folders (${active.length} active)</div>
          ${active.map(f=>`<div class="text-sm mono" style="margin-bottom:4px;color:var(--text-2)">${escH(f.path)}</div>`).join('')}
        </div>
        <div>
          <div class="section-title">Algorithms</div>
          <div style="margin-bottom:6px">${algos.join(', ')||'none selected'}</div>
          <div class="text-sm text-muted">Min ${sc.ensureMin??2} match · ${sc.matchLogic||'threshold'} · ${sc.compareSize||16}px</div>
        </div>
        <div>
          <div class="section-title">Filters</div>
          <div class="text-sm text-muted">
            Min ${fi.minSizeKB||10} KB${fi.maxSizeMB?` · Max ${fi.maxSizeMB} MB`:''}
            ${fi.dateFrom?` · From ${fi.dateFrom}`:''}${fi.dateTo?` · To ${fi.dateTo}`:''}
          </div>
        </div>
        <div>
          <div class="section-title">Variants</div>
          <div class="text-sm text-muted">
            ${[sc.rotation&&'Rotation',sc.mirror&&'Mirror',sc.colorChange&&'Color change'].filter(Boolean).join(', ')||'None'}
          </div>
        </div>
      </div>
      <div class="toggle-row" style="margin-top:20px">
        <input type="checkbox" class="toggle" id="wiz-save-default" checked>
        <label for="wiz-save-default">Save these settings as my default configuration</label>
      </div>
    `;
  }

  // ─── Wire step interactions ───────────────────────────────────────────────
  function wireStep() {
    if (step === 1) {
      el('wiz-add-folder')?.addEventListener('click', addFolderFromInput);
      el('wiz-browse-folder')?.addEventListener('click', browsePick);
      el('wiz-folder-input')?.addEventListener('keydown', e => { if (e.key==='Enter') addFolderFromInput(); });

      // Toggles and removes — delegated
      container.querySelector('#wiz-folder-list')?.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.idx);
        if (isNaN(idx)) return;
        if (e.target.classList.contains('wiz-recursive')) wc.folders[idx].recursive = e.target.checked;
        if (e.target.classList.contains('wiz-active'))    wc.folders[idx].active    = e.target.checked;
      });
      container.querySelector('#wiz-folder-list')?.addEventListener('click', e => {
        const btn = e.target.closest('.wiz-remove-folder');
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx);
        if (!isNaN(idx)) { wc.folders.splice(idx, 1); render(); }
      });
    }

    if (step === 2) {
      // Algo chips
      container.querySelectorAll('[data-wiz-algo]').forEach(chip => {
        chip.addEventListener('click', () => {
          const a = chip.dataset.wizAlgo;
          const nowActive = chip.classList.toggle('active');
          wc.scan.algorithms = wc.scan.algorithms || {};
          wc.scan.algorithms[a] = nowActive;
        });
      });
      // Threshold sliders
      container.querySelectorAll('.wiz-thresh').forEach(slider => {
        slider.addEventListener('input', () => {
          const a = slider.dataset.algo;
          const v = parseInt(slider.value);
          wc.scan.thresholds = wc.scan.thresholds || {};
          wc.scan.thresholds[a] = v;
          const span = el(`wt-${a}`);
          if (span) span.textContent = v;
        });
      });
    }
  }

  // ─── Gather values before moving to next step ────────────────────────────
  function gatherStep() {
    if (step === 2) {
      wc.scan.ensureMin   = parseInt(el('wiz-ensemble')?.value) || 2;
      wc.scan.matchLogic  = el('wiz-matchlogic')?.value || 'threshold';
      wc.scan.compareSize = parseInt(el('wiz-comparesize')?.value) || 16;
      wc.scan.anchorHash  = el('wiz-anchor')?.value || null;
      wc.scan.rotation    = el('wiz-rotation')?.checked || false;
      wc.scan.mirror      = el('wiz-mirror')?.checked || false;
      wc.scan.colorChange = el('wiz-colorchange')?.checked || false;
    }
    if (step === 3) {
      wc.filters.minSizeKB        = parseFloat(el('wiz-minsize')?.value) || 10;
      wc.filters.maxSizeMB        = parseFloat(el('wiz-maxsize')?.value) || 0;
      wc.filters.dateFrom         = el('wiz-datefrom')?.value || null;
      wc.filters.dateTo           = el('wiz-dateto')?.value || null;
      wc.filters.dateType         = el('wiz-datetype')?.value || 'file';
      wc.filters.includeVideos    = el('wiz-videos')?.checked || false;
      wc.filters.skipSystemFolders= el('wiz-skipsystem')?.checked !== false;
      wc.filters.extensions       = (el('wiz-extensions')?.value||'').split(',').map(s=>s.trim().replace(/^\./,'')).filter(Boolean);
      wc.filters.excludePatterns  = (el('wiz-excludes')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    }
    API.saveConfig(wc).catch(e => toast('Failed to save: ' + e.message, 'error'));
  }

  // ─── Folder helpers ───────────────────────────────────────────────────────
  function addFolderFromInput() {
    const inp = el('wiz-folder-input');
    const raw = inp?.value.trim();
    if (!raw) return;
    raw.split(/[;\n]/).map(s=>s.trim()).filter(Boolean).forEach(addFolder);
    if (inp) inp.value = '';
  }

  function addFolder(p) {
    wc.folders = wc.folders || [];
    if (!wc.folders.some(f => f.path === p)) {
      wc.folders.push({ path: p, active: true, recursive: true });
    } else {
      toast(`${p} is already in the list.`, 'info');
      return;
    }
    render();
  }

  async function browsePick() {
    try {
      const { path: p, unsupported } = await API.pickFolder().catch(() => ({ path: null }));
      if (unsupported) { toast('Native picker is Windows-only. Type the path manually.', 'info'); return; }
      if (p) addFolder(p);
    } catch (e) { toast('Picker error: ' + e.message, 'error'); }
  }

  // ─── Start scan ───────────────────────────────────────────────────────────
  async function startScan() {
    if (el('wiz-save-default')?.checked) {
      await API.saveConfig(wc).catch(() => {});
    }
    try {
      await API.startScan();
      Nav.go('run');
    } catch (e) {
      toast(e.message, 'error', 5000);
    }
  }

  function escH(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, refresh };
})();

// Wizard nav button
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('wizard-btn')?.addEventListener('click', () => Nav.go('wizard'));
});
