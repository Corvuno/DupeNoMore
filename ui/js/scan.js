/* scan.js — Epic 3 & 4: Scan settings & filters */

const Page_scan = (() => {
  let config = null;

  const ALGOS = [
    { id: 'dhash', label: 'dHash', desc: 'Edge patterns — fast' },
    { id: 'phash', label: 'pHash', desc: 'Perceptual — robust' },
    { id: 'ahash', label: 'aHash', desc: 'Average — very fast' },
    { id: 'whash', label: 'wHash', desc: 'Wavelet — scale-robust' },
    { id: 'mhash', label: 'mHash', desc: 'Pattern — texture detail' },
    { id: 'bhash', label: 'bHash', desc: 'Block — fast & simple' }
  ];

  async function init(container) {
    config = await API.getConfig();
    render(container);
  }

  function render(container) {
    const sc = config.scan || {};
    const fi = config.filters || {};

    container.innerHTML = `
      <div class="page-title">Scan Settings</div>
      <div class="page-subtitle">Configure how duplicates are detected. Changes are saved automatically.</div>

      <!-- Profiles -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">Scan profiles</div>
          <span class="text-muted text-sm">One-click presets for common use cases</span>
        </div>
        <div id="profile-list" style="display:flex;flex-direction:column;gap:8px">
          <div class="text-muted text-sm">Loading profiles...</div>
        </div>
      </div>

      <!-- Hash algorithms (US-019) -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Hash Algorithms</div>
          <span class="text-muted text-sm">At least one required</span>
        </div>
        <div class="chip-group" id="algo-chips">
          ${ALGOS.map(a => `
            <button class="chip${(sc.algorithms || {})[a.id] ? ' active' : ''}" data-algo="${a.id}" title="${a.desc}">
              ${a.label}
            </button>
          `).join('')}
        </div>

        <!-- Thresholds (US-020) -->
        <div class="section-title">Thresholds (bits distance — lower = stricter)</div>
        <div id="threshold-rows" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${ALGOS.map(a => `
            <div id="thresh-wrap-${a.id}" ${!(sc.algorithms || {})[a.id] ? 'style="opacity:0.35;pointer-events:none"' : ''}>
              <label>${a.label} — <span id="thresh-val-${a.id}">${(sc.thresholds || {})[a.id] ?? 10}</span> bits</label>
              <div class="slider-row">
                <input type="range" min="0" max="20" value="${(sc.thresholds || {})[a.id] ?? 10}" data-algo="${a.id}" class="thresh-slider">
                <span class="slider-val" id="thresh-display-${a.id}">${(sc.thresholds || {})[a.id] ?? 10}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Ensemble & matching (US-021, US-030) -->
      <div class="card">
        <div class="card-header"><div class="card-title">Match Logic</div></div>
        <div class="settings-row">
          <label>Ensemble minimum <span class="text-muted">(matches needed)</span></label>
          <input type="number" id="ensemble-min" class="input" min="1" max="6" value="${sc.ensureMin ?? 2}" style="width:80px">
        </div>
        <div class="settings-row">
          <label>Search depth <span class="text-muted" id="search-depth-val">${['Fast','Fast+','Normal','Thorough','Maximum'][(sc.searchDepth||1)-1]}</span></label>
          <input type="range" id="search-depth" min="1" max="5" value="${sc.searchDepth ?? 1}" style="width:140px">
        </div>
        <div class="settings-row">
          <label>Match logic</label>
          <select id="match-logic" class="select" style="max-width:200px">
            <option value="threshold" ${sc.matchLogic === 'threshold' ? 'selected' : ''}>Threshold (default)</option>
            <option value="or" ${sc.matchLogic === 'or' ? 'selected' : ''}>OR — any match</option>
            <option value="and" ${sc.matchLogic === 'and' ? 'selected' : ''}>AND — all must match</option>
          </select>
        </div>
        <div class="settings-row">
          <label>Anchor hash <span class="text-muted">(must always match)</span></label>
          <select id="anchor-hash" class="select" style="max-width:200px">
            <option value="">None</option>
            ${ALGOS.map(a => `<option value="${a.id}" ${sc.anchorHash === a.id ? 'selected' : ''}>${a.label}</option>`).join('')}
          </select>
        </div>
        <div class="settings-row">
          <label>Comparison size</label>
          <select id="compare-size" class="select" style="max-width:200px">
            ${[8,16,32].map(s => `<option value="${s}" ${(sc.compareSize||16) == s ? 'selected' : ''}>${s}×${s} px</option>`).join('')}
          </select>
        </div>
        <div class="settings-row">
          <label>bHash mode</label>
          <select id="bhash-mode" class="select" style="max-width:200px">
            <option value="fast" ${(sc.bhashMode||'fast')==='fast' ? 'selected' : ''}>Fast</option>
            <option value="precise" ${sc.bhashMode==='precise' ? 'selected' : ''}>Precise</option>
          </select>
        </div>
      </div>

      <!-- Variants (US-024-026) -->
      <div class="card">
        <div class="card-header"><div class="card-title">Variant Detection</div></div>
        <div class="toggle-row">
          <input type="checkbox" class="toggle" id="rotation" ${sc.rotation ? 'checked' : ''}>
          <label for="rotation">Rotation — detect rotated copies <span class="text-muted">(slower)</span></label>
        </div>
        <div class="toggle-row">
          <input type="checkbox" class="toggle" id="mirror" ${sc.mirror ? 'checked' : ''}>
          <label for="mirror">Mirror — detect mirrored copies</label>
        </div>
        <div class="toggle-row">
          <input type="checkbox" class="toggle" id="color-change" ${sc.colorChange ? 'checked' : ''}>
          <label for="color-change">Color change — detect B&W variants</label>
        </div>
      </div>

      <!-- Filters (US-012–018) -->
      <div class="card">
        <div class="card-header"><div class="card-title">File Filters</div></div>
        <div class="settings-row">
          <label>Min size (KB)</label>
          <input type="number" id="min-size" class="input" value="${fi.minSizeKB ?? 10}" style="width:120px"> 
        </div>
        <div class="settings-row">
          <label>Max size (MB) <span class="text-muted">(0 = no limit)</span></label>
          <input type="number" id="max-size" class="input" value="${fi.maxSizeMB ?? 0}" style="width:120px">
        </div>
        <div class="settings-row">
          <label>Date from</label>
          <input type="date" id="date-from" class="input" value="${fi.dateFrom || ''}" style="max-width:200px">
        </div>
        <div class="settings-row">
          <label>Date to</label>
          <input type="date" id="date-to" class="input" value="${fi.dateTo || ''}" style="max-width:200px">
        </div>
        <div class="settings-row">
          <label>Date type</label>
          <select id="date-type" class="select" style="max-width:200px">
            <option value="file" ${(fi.dateType||'file')==='file' ? 'selected' : ''}>File date</option>
            <option value="exif" ${fi.dateType==='exif' ? 'selected' : ''}>EXIF date</option>
            <option value="both" ${fi.dateType==='both' ? 'selected' : ''}>Both</option>
          </select>
        </div>
        <div class="settings-row">
          <label>Extensions <span class="text-muted">(comma-separated, empty = all images)</span></label>
          <input type="text" id="extensions" class="input" value="${(fi.extensions||[]).join(', ')}" placeholder="jpg, png, webp…">
        </div>
        <div class="toggle-row">
          <input type="checkbox" class="toggle" id="include-videos" ${fi.includeVideos ? 'checked' : ''}>
          <label for="include-videos">Include video files</label>
        </div>
        <div class="toggle-row">
          <input type="checkbox" class="toggle" id="skip-system" ${fi.skipSystemFolders !== false ? 'checked' : ''}>
          <label for="skip-system">Skip Windows system folders</label>
        </div>
        <div class="settings-row" style="align-items:flex-start">
          <label style="padding-top:6px">Exclude patterns <span class="text-muted">(one per line, wildcards ok)</span></label>
          <textarea id="exclude-patterns" class="textarea" rows="4" style="max-width:400px">${(fi.excludePatterns||[]).join('\n')}</textarea>
        </div>
      </div>

      <div class="mt-4" style="display:flex;gap:10px">
        <button class="btn btn-primary" id="save-scan-settings">Save settings</button>
        <button class="btn btn-ghost" id="reset-scan-settings">Reset to defaults</button>
      </div>
    `;

    // Wire algo chips
    qsa('.chip', container).forEach(chip => {
      chip.addEventListener('click', () => {
        const algo = chip.dataset.algo;
        const active = chip.classList.toggle('active');
        // Ensure at least one active
        const anyActive = qsa('.chip.active', container).length > 0;
        if (!anyActive) { chip.classList.add('active'); return; }
        config.scan.algorithms = config.scan.algorithms || {};
        config.scan.algorithms[algo] = chip.classList.contains('active');
        // Update threshold opacity
        const wrap = el(`thresh-wrap-${algo}`);
        if (wrap) wrap.style.cssText = active ? '' : 'opacity:0.35;pointer-events:none';
        autosave();
      });
    });

    // Wire threshold sliders
    qsa('.thresh-slider', container).forEach(slider => {
      slider.addEventListener('input', () => {
        const algo = slider.dataset.algo;
        const v = parseInt(slider.value);
        el(`thresh-display-${algo}`).textContent = v;
        el(`thresh-val-${algo}`).textContent = v;
        config.scan.thresholds = config.scan.thresholds || {};
        config.scan.thresholds[algo] = v;
        autosave();
      });
    });

    // Wire simple fields
    [
      ['ensemble-min', v => config.scan.ensureMin = parseInt(v)],
      ['match-logic',  v => config.scan.matchLogic = v],
      ['anchor-hash',  v => config.scan.anchorHash = v || null],
      ['compare-size', v => config.scan.compareSize = parseInt(v)],
      ['search-depth', v => { config.scan.searchDepth = parseInt(v); el('search-depth-val').textContent = ['Fast','Fast+','Normal','Thorough','Maximum'][parseInt(v)-1]; }],
      ['bhash-mode',   v => config.scan.bhashMode = v],
      ['min-size',     v => config.filters.minSizeKB = parseFloat(v)],
      ['max-size',     v => config.filters.maxSizeMB = parseFloat(v)],
      ['date-from',    v => config.filters.dateFrom = v || null],
      ['date-to',      v => config.filters.dateTo = v || null],
      ['date-type',    v => config.filters.dateType = v],
      ['extensions',   v => config.filters.extensions = v.split(',').map(s=>s.trim().replace(/^\./, '')).filter(Boolean)],
    ].forEach(([id, setter]) => {
      el(id)?.addEventListener('change', () => { setter(el(id).value); autosave(); });
    });

    [
      ['rotation',       v => config.scan.rotation = v],
      ['mirror',         v => config.scan.mirror = v],
      ['color-change',   v => config.scan.colorChange = v],
      ['include-videos', v => config.filters.includeVideos = v],
      ['skip-system',    v => config.filters.skipSystemFolders = v],
    ].forEach(([id, setter]) => {
      el(id)?.addEventListener('change', () => { setter(el(id).checked); autosave(); });
    });

    el('exclude-patterns')?.addEventListener('change', () => {
      config.filters.excludePatterns = el('exclude-patterns').value.split('\n').map(s=>s.trim()).filter(Boolean);
      autosave();
    });

    el('save-scan-settings').addEventListener('click', () => save(true));
    loadProfiles();

    // Wire scan type selector
    container.querySelectorAll('input[name="scan-type"]').forEach(radio => {
      radio.closest('label').addEventListener('click', () => {
        config.scan.scanType = radio.value;
        const isImages = radio.value !== 'files';
        const isFiles  = radio.value !== 'images';
        el('image-scan-options').style.display = isImages ? '' : 'none';
        el('file-scan-options').style.display  = isFiles  ? '' : 'none';
        // Update label highlighting
        container.querySelectorAll('input[name="scan-type"]').forEach(r => {
          const lbl = r.closest('label');
          const active = r.value === radio.value;
          lbl.style.background = active ? 'var(--accent)' : 'var(--bg-3)';
          lbl.style.color      = active ? '#fff' : 'var(--text-2)';
          lbl.style.fontWeight = active ? '700' : '400';
        });
        autosave();
      });
    });

    // Wire file scan option toggles
    const saveFileScanOpts = () => {
      if (!config.scan.fileScanOptions) config.scan.fileScanOptions = {};
      const fso = config.scan.fileScanOptions;
      fso.extensions            = (el('fs-ext')?.value||'').split(/[\s,;]+/).map(e=>e.replace(/^\./,'').toLowerCase()).filter(Boolean);
      fso.minSizeKB             = parseInt(el('fs-min-kb')?.value)||0;
      fso.maxSizeMB             = parseInt(el('fs-max-mb')?.value)||0;
      fso.useMd5                = el('fs-md5')?.checked !== false;
      fso.useCopyPatterns       = el('fs-copy')?.checked === true;
      fso.useVersionGroups      = el('fs-ver')?.checked === true;
      fso.useNameSimilarity     = el('fs-nsim')?.checked === true;
      fso.nameSimilarityThreshold = parseInt(el('fs-nsim-thresh')?.value)||80;
      fso.useWildcards          = el('fs-wc')?.checked === true;
      fso.wildcardPatterns      = (el('fs-wc-patterns')?.value||'').split(/[\s,]+/).filter(Boolean);
      fso.wildcardLogic         = document.querySelector('input[name="scan-wc-logic"]:checked')?.value || 'or';
      autosave();
    };

    ['fs-ext','fs-min-kb','fs-max-mb','fs-nsim-thresh','fs-wc-patterns'].forEach(id => {
      el(id)?.addEventListener('input', saveFileScanOpts);
    });
    ['fs-md5','fs-copy','fs-ver','fs-nsim','fs-wc'].forEach(id => {
      el(id)?.addEventListener('change', () => {
        if (id === 'fs-nsim') el('fs-nsim-opts').style.display = el('fs-nsim')?.checked ? '' : 'none';
        if (id === 'fs-wc')   el('fs-wc-opts').style.display   = el('fs-wc')?.checked   ? '' : 'none';
        saveFileScanOpts();
      });
    });
    container.querySelectorAll('input[name="scan-wc-logic"]').forEach(r =>
      r.addEventListener('change', saveFileScanOpts));
    el('reset-scan-settings').addEventListener('click', async () => {
      const ok = await confirm('Reset settings', 'Reset scan settings to defaults? Folder list will not be affected.');
      if (ok) {
        const defaults = (await API.getConfig()).scan; // original defaults come from server DEFAULT
        config.scan = Object.assign({}, config.scan, {
          algorithms: { dhash: true, phash: true },
          thresholds: { dhash: 8, phash: 12, ahash: 10, whash: 10, mhash: 10, bhash: 10 },
          ensureMin: 2, matchLogic: 'threshold', anchorHash: null, compareSize: 16, bhashMode: 'fast'
        });
        await save(false);
        render(container);
        toast('Settings reset.', 'info');
      }
    });
  }

  async function loadProfiles() {
    const profileList = el('profile-list');
    if (!profileList) return;
    try {
      const profiles = await API.getProfiles();
      const builtinIds = ['exact_only','strict','balanced','loose','media_library'];
      profileList.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
          <button class="btn btn-primary btn-sm" id="new-profile-btn">＋ New profile</button>
        </div>` +
        profiles.map(p => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:10px;background:var(--bg-3);border-radius:6px;border:1px solid var(--border);margin-bottom:6px">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${p.name}${builtinIds.includes(p.id)?'<span style="font-size:10px;color:var(--text-3);margin-left:6px">built-in</span>':''}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px">${p.description}</div>
          </div>
          <button class="btn btn-ghost btn-sm apply-profile" data-id="${p.id}">Apply</button>
          ${!builtinIds.includes(p.id) ? `
            <button class="btn btn-ghost btn-sm edit-profile" data-id="${p.id}">Edit</button>
            <button class="btn btn-ghost btn-sm delete-profile" data-id="${p.id}" style="color:var(--red)">✕</button>
          ` : ''}
        </div>
      `).join('');

      profileList.querySelector('#new-profile-btn')?.addEventListener('click', () => {
        ProfileEditor.open(null, () => loadProfiles());
      });
      profileList.querySelectorAll('.edit-profile').forEach(btn => {
        btn.addEventListener('click', () => {
          const profile = profiles.find(p => p.id === btn.dataset.id);
          if (profile) ProfileEditor.open(profile, () => loadProfiles());
        });
      });
      profileList.querySelectorAll('.delete-profile').forEach(btn => {
        btn.addEventListener('click', async () => {
          const profile = profiles.find(p => p.id === btn.dataset.id);
          if (!profile) return;
          if (!await confirm('Delete profile', 'Delete "' + profile.name + '"?', 'Delete')) return;
          const all = await API.getProfiles();
          const builtins = ['exact_only','strict','balanced','loose','media_library'];
          const remaining = all.filter(p => p.id !== btn.dataset.id && !builtins.includes(p.id));
          await API.post('/profiles', remaining);
          toast('Profile deleted', 'success');
          loadProfiles();
        });
      });

      profileList.querySelectorAll('.apply-profile').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const profile = profiles.find(p => p.id === btn.dataset.id);
          if (!profile) return;
          config.scan = { ...config.scan, ...profile.scan };
          await save(false);
          // Re-render scan settings with new values
          const container = document.getElementById('page-scan');
          if (container) render(container);
          toast('Profile applied: ' + profile.name, 'success');
        });
      });
    } catch (e) {
      if (profileList) profileList.innerHTML = '<div class="text-muted text-sm">Could not load profiles</div>';
    }
  }

  const autosave = debounce(() => save(false), 600);

  async function save(notify = false) {
    try {
      await API.saveConfig(config);
      if (notify) toast('Settings saved.', 'success');
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
    }
  }

  async function refresh(container) { config = await API.getConfig(); render(container); }
  return { init, refresh };
})();
