/* search.js — US-075/076: CLIP semantic image search */
const Page_search = (() => {
  let status = null;

  async function init(container) {
    container.innerHTML = `
      <div class="page-title">Search</div>
      <div class="page-subtitle">Find images by description using AI (CLIP). Searches your indexed images semantically — not just by filename.</div>

      <div id="clip-not-available" class="hidden">
        <div class="settings-section" style="border:1px solid var(--red);border-radius:8px">
          <div class="section-title" style="color:var(--red);margin-top:0">CLIP not yet downloaded</div>
          <p style="color:var(--text-2);font-size:13px">
            CLIP requires downloading a ~350MB AI model from HuggingFace. This is a one-time download.
            The model runs completely locally — no images leave your machine.
          </p>
          <p style="color:var(--text-2);font-size:12px">
            Optional: set your HuggingFace token in <a href="#settings" style="color:var(--accent)" onclick="Nav.go('settings')">Settings</a>
            to access gated models or increase download speed.
          </p>
          <button class="btn btn-primary" id="clip-download-btn">⬇ Download CLIP model (~350MB)</button>
          <div id="clip-download-progress" class="hidden" style="margin-top:12px">
            <div id="clip-dl-status" class="text-muted text-sm" style="margin-bottom:6px">Downloading…</div>
            <div id="clip-dl-log" class="log-wrap" style="height:120px"></div>
          </div>
        </div>
      </div>

      <div id="clip-available" class="hidden">
        <!-- Index section -->
        <div class="settings-section">
          <div class="section-title" style="margin-top:0">📂 Index images</div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:10px">
            Index a folder to make its images searchable. Already-indexed images are skipped on re-index.
          </div>
          <div id="clip-index-stats" class="text-muted text-sm" style="margin-bottom:10px"></div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <input id="clip-index-folder" class="input" placeholder="Folder path to index…" style="flex:1">
            <button class="btn btn-ghost btn-sm" id="clip-index-browse">Browse</button>
            <button class="btn btn-primary btn-sm" id="clip-index-btn">▶ Index</button>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin-bottom:10px">
            <input type="checkbox" id="clip-recursive" checked> Scan subfolders recursively
          </label>
          <div id="clip-index-progress" class="hidden">
            <div id="clip-idx-status" class="text-muted text-sm" style="margin-bottom:4px"></div>
            <div id="clip-idx-log" class="log-wrap" style="height:100px"></div>
          </div>
        </div>

        <!-- Text search -->
        <div class="settings-section">
          <div class="section-title" style="margin-top:0">🔍 Search by description</div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <input id="clip-search-input" class="input" placeholder="e.g. dog on a beach, sunset, people at a party…" style="flex:1">
            <button class="btn btn-primary" id="clip-search-btn">Search</button>
          </div>
          <div style="display:flex;gap:16px;align-items:center;margin-bottom:12px;font-size:12px;color:var(--text-2)">
            <label>Min similarity:
              <input type="range" id="clip-threshold" min="5" max="50" value="20"
                oninput="document.getElementById('clip-thresh-val').textContent=this.value+'%'">
              <span id="clip-thresh-val">20%</span>
            </label>
            <label>Max results:
              <select id="clip-max-results" class="select" style="width:80px">
                <option value="10">10</option>
                <option value="20" selected>20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
          </div>
          <div id="clip-search-results"></div>
        </div>

        <!-- Similar image search -->
        <div class="settings-section">
          <div class="section-title" style="margin-top:0">🖼 Find similar images</div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
            Find indexed images visually similar to a given image — even if not pixel-perfect duplicates.
          </div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <input id="clip-similar-input" class="input" placeholder="Image path…" style="flex:1">
            <button class="btn btn-ghost btn-sm" id="clip-similar-browse">Browse</button>
            <button class="btn btn-primary btn-sm" id="clip-similar-btn">Find similar</button>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:12px">
            Min similarity:
            <input type="range" id="clip-sim-threshold" min="50" max="99" value="80"
              oninput="document.getElementById('clip-sim-thresh-val').textContent=this.value+'%'">
            <span id="clip-sim-thresh-val">80%</span>
          </label>
          <div id="clip-similar-results"></div>
        </div>
      </div>
    `;

    wireEvents(container);
    await checkStatus();
  }

  async function refresh(c) { await init(c); }

  async function checkStatus() {
    try {
      status = await API.get('/clip/status');
      el('clip-not-available').classList.toggle('hidden', status.available);
      el('clip-available').classList.toggle('hidden', !status.available);
      if (status.available && status.stats) {
        const s = status.stats;
        const statsEl = el('clip-index-stats');
        if (statsEl) statsEl.textContent = `Index: ${s.existing} images indexed${s.stale > 0 ? ' · ' + s.stale + ' stale (files moved/deleted)' : ''}`;
      }
    } catch(e) {
      console.error('CLIP status error:', e);
    }
  }

  function wireEvents(container) {
    // Download
    el('clip-download-btn')?.addEventListener('click', startDownload);

    // Index
    el('clip-index-browse')?.addEventListener('click', async () => {
      const r = await API.pickFolder().catch(() => ({path:null}));
      if (r.path) el('clip-index-folder').value = r.path;
    });
    el('clip-index-btn')?.addEventListener('click', startIndex);

    // Text search
    el('clip-search-btn')?.addEventListener('click', doTextSearch);
    el('clip-search-input')?.addEventListener('keydown', e => { if (e.key==='Enter') doTextSearch(); });

    // Similar search
    el('clip-similar-browse')?.addEventListener('click', async () => {
      const r = await API.pickFolder().catch(() => ({path:null}));
      if (r.path) el('clip-similar-input').value = r.path;
    });
    el('clip-similar-btn')?.addEventListener('click', doSimilarSearch);
  }

  async function startDownload() {
    const btn = el('clip-download-btn');
    const prog = el('clip-download-progress');
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove('hidden');

    const r = await API.post('/clip/download', {}).catch(e => ({error:e.message}));
    if (r.error) { toast(r.error, 'error'); if (btn) btn.disabled=false; return; }

    pollJob('/clip/download/' + r.jobId, el('clip-dl-log'), el('clip-dl-status'), async () => {
      await checkStatus();
      if (btn) btn.disabled = false;
    });
  }

  async function startIndex() {
    const folder = el('clip-index-folder')?.value?.trim();
    if (!folder) { toast('Enter a folder path first', 'error'); return; }

    const btn  = el('clip-index-btn');
    const prog = el('clip-index-progress');
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove('hidden');

    const r = await API.post('/clip/index', {
      folderPath: folder,
      recursive: el('clip-recursive')?.checked !== false
    }).catch(e => ({error:e.message}));

    if (r.error) { toast(r.error, 'error'); if(btn) btn.disabled=false; return; }

    pollJob('/clip/index/' + r.jobId, el('clip-idx-log'), el('clip-idx-status'), async (job) => {
      if (btn) btn.disabled = false;
      if (job.result) {
        toast(`Indexed ${job.result.processed} images (${job.result.skipped} already cached)`, 'success');
        await checkStatus();
      }
    });
  }

  function pollJob(endpoint, logEl, statusEl, onDone) {
    const timer = setInterval(async () => {
      const job = await API.get(endpoint).catch(() => null);
      if (!job) return;
      if (logEl) logEl.innerHTML = (job.log||[]).slice(-40).map(l =>
        `<div>${new Date(l.ts).toISOString().slice(11,19)} ${escH(l.message)}</div>`).join('');
      if (statusEl) statusEl.textContent = `Status: ${job.status}${job.progress?` (${job.progress}%)` : ''}`;
      if (job.status !== 'running') {
        clearInterval(timer);
        onDone?.(job);
        if (job.status === 'error') toast('Error: ' + job.error, 'error');
      }
    }, 800);
  }

  async function doTextSearch() {
    const query = el('clip-search-input')?.value?.trim();
    if (!query) return;
    const threshold = parseInt(el('clip-threshold')?.value || '20') / 100;
    const limit     = parseInt(el('clip-max-results')?.value || '20');
    const wrap      = el('clip-search-results');
    if (wrap) wrap.innerHTML = '<div class="text-muted text-sm">Searching…</div>';

    try {
      const r = await API.get(`/clip/search?q=${encodeURIComponent(query)}&limit=${limit}&threshold=${threshold}`);
      renderResults(wrap, r.results, query);
    } catch(e) {
      if (wrap) wrap.innerHTML = `<div style="color:var(--red)">${escH(e.message)}</div>`;
    }
  }

  async function doSimilarSearch() {
    const imgPath   = el('clip-similar-input')?.value?.trim();
    if (!imgPath) return;
    const threshold = parseInt(el('clip-sim-threshold')?.value || '80') / 100;
    const wrap      = el('clip-similar-results');
    if (wrap) wrap.innerHTML = '<div class="text-muted text-sm">Searching…</div>';

    try {
      const r = await API.get(`/clip/search-similar?path=${encodeURIComponent(imgPath)}&threshold=${threshold}&limit=20`);
      renderResults(wrap, r.results, imgPath);
    } catch(e) {
      if (wrap) wrap.innerHTML = `<div style="color:var(--red)">${escH(e.message)}</div>`;
    }
  }

  function renderResults(wrap, results, query) {
    if (!wrap) return;
    if (!results || !results.length) {
      wrap.innerHTML = '<div class="empty-state"><p>No results found. Try a lower similarity threshold or index more images.</p></div>';
      return;
    }
    wrap.innerHTML = `<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">${results.length} results for "${escH(String(query).slice(0,60))}"</div>` +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">' +
      results.map(r => {
        const name = r.path.split(/[\\/]/).pop();
        const pct  = Math.round(r.similarity * 100);
        const thumb = '/api/thumbnail?path=' + encodeURIComponent(r.path);
        return `<div style="background:var(--bg-3);border-radius:8px;overflow:hidden;border:1px solid var(--border);cursor:pointer"
                     onclick="fetch('/api/open-file?path='+encodeURIComponent('${escH(r.path)}'))" title="${escH(r.path)}">
          <div style="position:relative">
            <img src="${thumb}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
              alt="${escH(name)}">
            <div style="display:none;width:100%;aspect-ratio:1;align-items:center;justify-content:center;font-size:24px;background:var(--bg-4)">🖼</div>
            <div style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:2px 6px;border-radius:10px;font-weight:700">${pct}%</div>
          </div>
          <div style="padding:6px 8px">
            <div style="font-size:11px;font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escH(name)}</div>
          </div>
        </div>`;
      }).join('') + '</div>';
  }

  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  return { init, refresh };
})();
