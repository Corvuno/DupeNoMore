/* review.js — Review page: large thumbnail cards, side-by-side per group */

const Page_review = (() => {
  let currentFile = null;
  let groups      = [];
  let overrides   = {};
  let locked      = {};
  let visConf     = { certain: true, probable: true, uncertain: true };
  let showMultiKeep = false;
  let showNoSel     = false;
  let showDeselOnly = false;
  // Groups the user unticked: skipped entirely when actions run. Keyed by group source path.
  let deselectedGroups = new Set();
  let actionsOpen   = false;

  // Filter state (must be before wireBar)
  let _simMin = 0;
  let _simMax = 100;
  let _hifiOnly = false;
  let _hifiThr  = 1.5;
  window._bloatThreshold = 1.5;
  let deselectFilters = [];
  let ignoreEntries = [];
  let ignoredFiles = new Set();  // individually ignored file paths
  let _changeCount = 0;
  const AUTO_SAVE_INTERVAL = 50;
  let _page = 0;
  const PAGE_SIZE = 500;  // save every 50 changes
  let container     = null;

  // Current action config — used for badge labels
  let actionCfg = { certain:'keep_in_place', probable:'keep_in_place', uncertain:'keep_in_place', removeTarget:null };

  async function init(c) {
    container = c;
    container.className = 'page full-width';
    if (!container.querySelector('#review-filter-bar')) {
      renderShell();
    }
    if (!currentFile) {
      const results = await API.getResults().catch(() => []);
      // A specific scan may have been asked for while the list was loading
      // (opening a scan from Recent or from the top bar); don't overwrite it.
      if (!currentFile && results.length > 0) await loadFile(results[0].filename);
    } else {
      await populateDropdown();
    }
  }

  async function refresh(c) {
    container = c || container;
    await populateDropdown();
    if (groups.length > 0) applyFilters();
  }

  // ── Shell ─────────────────────────────────────────────────────────────────
  function renderShell() {
    container.innerHTML = `
      <div id="review-toolbar" style="position:sticky;top:0;z-index:50;background:var(--bg)">
      <!-- Row 1: Result picker + confidence filters + match% + hi-fi + actions -->
      <div class="filter-bar" id="review-filter-bar" style="position:static;flex-wrap:wrap;gap:6px 10px">
        <select id="review-result-select" class="select" style="max-width:260px">
          <option value="">— Select result —</option>
        </select>
        <div class="sep"></div>
        <button class="chip active" data-conf="certain">Certain</button>
        <button class="chip active" data-conf="probable">Probable</button>
        <button class="chip active" data-conf="uncertain">Uncertain</button>
        <div class="sep"></div>
        <button class="chip" id="chip-multi-keep">Multi-keep</button>
        <button class="chip" id="chip-no-sel">No selection</button>
        <button class="chip" id="chip-desel-only" title="Show only groups you deselected">Deselected</button>
        <div class="sep"></div>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2);cursor:default">
          Match
          <input type="number" id="sim-min" min="0" max="100" step="5" value="0"
            style="width:42px;text-align:center;padding:1px 2px" class="input" title="Min match %">
          <span style="color:var(--text-3)">–</span>
          <input type="number" id="sim-max" min="0" max="100" step="5" value="100"
            style="width:42px;text-align:center;padding:1px 2px" class="input" title="Max match %">
          <span style="font-size:11px;color:var(--text-3)">%</span>
        </label>
        <div class="sep"></div>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-2);cursor:pointer">
          <input type="checkbox" id="hifi-filter"> Hi-fi&thinsp;≥
          <input type="number" id="hifi-thr" value="1.5" min="1.0" max="20" step="0.1"
                 style="width:44px;text-align:center;padding:0 4px;cursor:pointer" class="input">&thinsp;×
        </label>
        <div style="flex:1"></div>
        <select id="sort-groups" class="select" style="max-width:160px;font-size:12px" title="Sort groups">
          <option value="default">Sort: default</option>
          <option value="pct-asc">Match % ↑ (borderline first)</option>
          <option value="pct-desc">Match % ↓ (best first)</option>
          <option value="size-desc">Space saved ↓ (biggest first)</option>
          <option value="files-desc">File count ↓</option>
          <option value="unreviewed">Unreviewed first</option>
        </select>
        <span id="review-stats" class="text-muted text-sm" style="display:flex;gap:12px;align-items:center">
          <span id="review-count"></span>
          <span id="review-savings" style="color:var(--green)"></span>
          <span id="review-progress" style="color:var(--accent)"></span>
        </span>
        <button class="btn btn-ghost btn-sm" id="save-overrides-btn">💾 Save</button>
        <button class="btn btn-primary btn-sm" id="actions-toggle-btn">⚡ Actions</button>
      </div>

      <!-- Row 2: Auto-select + bulk selection shortcuts -->
      <div style="padding:5px 24px;border-bottom:1px solid var(--border);display:flex;gap:5px;align-items:center;flex-wrap:wrap;background:var(--bg-2)">
        <button class="btn btn-ghost btn-xs" data-sel="dismiss_md5" title="Auto-select best for all 100% MD5 groups (byte-identical — nothing to review)">✓ Accept all MD5</button>
        <button class="btn btn-primary btn-xs" data-sel="auto_optimal"
                title="Most pixels → Biggest file → Oldest EXIF date → Highest-priority folder">⭐ Auto-select best</button>
        <button class="btn btn-ghost btn-xs" data-sel="auto_rename"
                title="Find groups where a removed file has a better name than the kept file">✏ Auto-rename</button>
        <div class="sep" style="height:16px;margin:0 2px"></div>
        <span class="text-muted text-sm" style="white-space:nowrap">Select:</span>
        <button class="btn btn-ghost btn-xs" data-sel="keep_largest">Largest</button>
        <button class="btn btn-ghost btn-xs" data-sel="keep_highest_res">Most pixels</button>
        <button class="btn btn-ghost btn-xs" data-sel="keep_newest">Newest</button>
        <button class="btn btn-ghost btn-xs" data-sel="keep_oldest">Oldest</button>
        <button class="btn btn-ghost btn-xs" data-sel="keep_reference">Priority folder</button>
        <button class="btn btn-ghost btn-xs" data-sel="keep_shortest_name">Shortest name</button>
        <div class="sep" style="height:16px;margin:0 2px"></div>
        <button class="btn btn-ghost btn-xs" data-sel="keep_all">Keep all</button>
        <button class="btn btn-ghost btn-xs" data-sel="remove_all">Remove all</button>
        <button class="btn btn-ghost btn-xs" data-sel="invert">Invert</button>
        <div class="sep" style="height:16px;margin:0 2px"></div>
        <span class="text-muted text-sm" style="white-space:nowrap">Groups:</span>
        <button class="btn btn-ghost btn-xs" data-sel="select_groups" title="Tick all visible groups so actions apply to them">☑ Select visible</button>
        <button class="btn btn-ghost btn-xs" data-sel="deselect_groups" title="Untick all visible groups — actions will skip them entirely">☐ Deselect visible</button>
        <div class="sep" style="height:16px;margin:0 2px"></div>
        <button class="btn btn-ghost btn-xs" data-sel="ignore_visible" title="Add all visible groups to the ignore list — they won't appear in future reviews">🚫 Ignore visible</button>
        <div class="sep" style="height:16px;margin:0 2px"></div>
        <span class="text-muted text-sm" style="white-space:nowrap">Match%:</span>
        <button class="btn btn-ghost btn-xs" id="filter-pct-below" title="Permanently remove groups below a match %">－ Below %</button>
        <button class="btn btn-ghost btn-xs" id="filter-pct-above" title="Permanently remove groups above a match %">－ Above %</button>
        <button class="btn btn-ghost btn-xs" id="filter-pct-range" title="Permanently remove groups within a match % range">－ Range %</button>
      </div>

      <!-- Row 3: Folder-based selection + group filters -->
      <div style="padding:5px 24px;border-bottom:1px solid var(--border);display:flex;gap:5px;align-items:center;flex-wrap:wrap;background:var(--bg)">
        <span class="text-muted text-sm" style="white-space:nowrap">Folder:</span>
        <input id="folder-sel-input" class="input" placeholder="Path or wildcard…" style="max-width:220px">
        <button class="btn btn-ghost btn-xs" data-folder-action="keep">＋ Keep</button>
        <button class="btn btn-ghost btn-xs" data-folder-action="remove">－ Remove</button>
        <button class="btn btn-ghost btn-xs" data-folder-action="lock">🔒 Lock</button>
        <button class="btn btn-ghost btn-xs" data-folder-action="unlock">🔓 Unlock</button>
        <div class="sep" style="height:16px;margin:0 2px"></div>
        <button class="btn btn-ghost btn-xs" id="filter-folder-btn">－ Filter folder out</button>
        <button class="btn btn-ghost btn-xs" id="filter-singletons-btn">－ Singletons</button>
        <button class="btn btn-ghost btn-xs" id="filter-empty-btn">－ Empty groups</button>
        <button class="btn btn-ghost btn-xs" id="filter-missing-btn" title="Check every file in this result still exists on disk; drop missing files and groups that are no longer duplicates">🔍 Re-check files on disk</button>
      </div>

      <div id="actions-panel" class="hidden" style="padding:16px 24px;border-bottom:1px solid var(--border);background:var(--bg-2);max-height:55vh;overflow-y:auto;overscroll-behavior:contain">
        ${buildActionsPanel()}
      </div>

      <div id="interim-banner" class="hidden" style="background:var(--orange-bg);color:var(--orange);padding:10px 24px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px">
        ⚠ Scan still running — these are partial results. Groups may change when scan completes.
        <button class="btn btn-ghost btn-xs" onclick="el('interim-banner').classList.add('hidden')" style="margin-left:auto">✕</button>
      </div>
      </div>
      <div id="diag-banner" style="display:none;margin:12px 24px;padding:10px 16px;background:var(--bg-3);border:1px solid var(--accent);border-radius:8px"></div>
      <div id="review-groups" style="padding:16px 24px"></div>
      <div class="kbd-hint" id="kbd-hint">
        <kbd>j</kbd>/<kbd>↓</kbd> next group &nbsp;
        <kbd>k</kbd>/<kbd>↑</kbd> prev group<br>
        <kbd>a</kbd> auto-select &nbsp;
        <kbd>Space</kbd> toggle &nbsp;
        <kbd>n</kbd> next unreviewed<br>
        <kbd>Esc</kbd> close zoom
      </div>
      <div id="rename-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1100;
        display:none;align-items:center;justify-content:center;padding:20px">
        <div style="background:var(--bg);border-radius:12px;max-width:800px;width:100%;max-height:85vh;display:flex;flex-direction:column;border:1px solid var(--border)">
          <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:600;font-size:15px">Auto-rename — preview</div>
              <div id="rename-subtitle" style="font-size:12px;color:var(--text-3)"></div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ghost btn-sm" id="rename-select-all">Select all</button>
              <button class="btn btn-ghost btn-sm" id="rename-deselect-all">Deselect all</button>
            </div>
          </div>
          <div id="rename-list" style="overflow-y:auto;flex:1;padding:8px 20px"></div>
          <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <div id="rename-summary" style="font-size:12px;color:var(--text-3)"></div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ghost btn-sm" id="rename-cancel">Cancel</button>
              <button class="btn btn-primary btn-sm" id="rename-apply">Apply selected</button>
            </div>
          </div>
        </div>
      </div>

      <div id="zoom-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:1000;
        flex-direction:column;align-items:center;justify-content:center;padding:20px">
        <div id="zoom-container" style="display:flex;gap:12px;align-items:center;justify-content:center;max-width:95vw;max-height:85vh;flex:1">
          <img id="zoom-img" style="max-width:95vw;max-height:85vh;object-fit:contain;border-radius:4px;cursor:zoom-out" onclick="document.getElementById('zoom-overlay').style.display='none'">
          <img id="zoom-img2" style="display:none;max-width:45vw;max-height:85vh;object-fit:contain;border-radius:4px;cursor:zoom-out" onclick="this.style.display='none';document.getElementById('zoom-img').style.maxWidth='95vw'">
        </div>
        <div id="zoom-info" style="color:#fff;font-size:13px;background:rgba(0,0,0,0.7);padding:6px 16px;border-radius:20px;white-space:nowrap;margin-top:10px"></div>
        <div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:6px">Click image to close · Click another thumbnail to compare side-by-side · Esc to close</div>
      </div>
    `;
    wireBar();
    populateDropdown();
  }

  function buildActionsPanel() {
    const OPTS = [
      ['keep_in_place',    'Keep in place (no change)'],
      ['execute_selected', 'Execute as selected ✓'],
      ['recycle_removed',  '♻ Recycle removed files'],
      ['keep_largest',     'Keep largest file'],
      ['keep_highest_res', 'Keep highest resolution'],
      ['keep_newest_file', 'Keep newest (file date)'],
      ['keep_oldest_file', 'Keep oldest (file date)'],
      ['keep_newest_exif', 'Keep newest (EXIF date)'],
      ['keep_oldest_exif', 'Keep oldest (EXIF date)'],
      ['keep_reference',   'Keep reference (priority folder)'],
      ['move_removed',     '📁 Move removed to folder…'],
      ['delete_permanent', '🗑 Delete permanently (no undo!)'],
    ];
    const opts = OPTS.map(([v,l]) => '<option value="' + v + '">' + l + '</option>').join('');
    return `
      <div style="font-weight:600;margin-bottom:12px">⚡ Execute actions</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;align-items:center;margin-bottom:14px">
        ${['certain','probable','uncertain'].map(conf => `
          <span class="confidence-badge ${conf}">${conf}</span>
          <select class="select action-select" data-conf="${conf}" style="max-width:300px">${opts}</select>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px 10px;align-items:center;margin-bottom:12px">
        <label style="color:var(--red);font-size:12px;white-space:nowrap">Removed → move to</label>
        <input id="remove-target" class="input" placeholder="Quarantine folder path…">
        <button class="btn btn-ghost btn-sm" id="pick-remove-target">Browse</button>
        <label style="color:var(--green);font-size:12px;white-space:nowrap">Kept → move to</label>
        <input id="keep-target" class="input" placeholder="Target folder (optional)…">
        <button class="btn btn-ghost btn-sm" id="pick-keep-target">Browse</button>
      </div>
      <label class="toggle-row" style="margin-bottom:12px">
        <input type="checkbox" class="toggle" id="reproduce-structure">
        <span>Reproduce folder structure in destination</span>
      </label>
      <details style="margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:8px 12px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-2)">⚙ Deselect filters (US-071) — protect files from removal</summary>
        <div style="margin-top:10px;font-size:12px;color:var(--text-2);margin-bottom:8px">
          Files matching these filters will be skipped (not removed) even if marked as remove.
        </div>
        <div id="deselect-filters-list" style="display:flex;flex-direction:column;gap:6px"></div>
        <button class="btn btn-ghost btn-sm" id="add-deselect-filter" style="margin-top:8px">＋ Add filter</button>
      </details>

      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" id="dry-run-btn">▶ Dry run</button>
        <button class="btn btn-danger" id="run-actions-btn">▶ Run actions</button>
        <button class="btn btn-ghost btn-sm" id="undo-btn" style="margin-left:auto">↩ Undo last</button>
      </div>
      <div id="action-result" class="hidden" style="margin-top:10px"></div>
    `;
  }

  function wireBar() {
    container.querySelectorAll('[data-conf].chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        visConf[chip.dataset.conf] = chip.classList.contains('active');
        applyFilters();
      });
    });
    el('chip-multi-keep')?.addEventListener('click', () => { showMultiKeep=!showMultiKeep; el('chip-multi-keep').classList.toggle('active',showMultiKeep); applyFilters(); });
    el('chip-no-sel')?.addEventListener('click',      () => { showNoSel=!showNoSel; el('chip-no-sel').classList.toggle('active',showNoSel); applyFilters(); });
    el('chip-desel-only')?.addEventListener('click',  () => { showDeselOnly=!showDeselOnly; el('chip-desel-only').classList.toggle('active',showDeselOnly); applyFilters(); });
    container.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => applySelAction(b.dataset.sel)));
    container.querySelectorAll('[data-folder-action]').forEach(b => b.addEventListener('click', () => applyFolderAction(b.dataset.folderAction)));
    el('filter-folder-btn')?.addEventListener('click', filterFolderOut);
    el('filter-singletons-btn')?.addEventListener('click', () => filterFromFile('singletons'));
    el('filter-empty-btn')?.addEventListener('click', () => filterFromFile('empty'));
    el('filter-missing-btn')?.addEventListener('click', recheckMissing);
    el('filter-pct-below')?.addEventListener('click', async () => {
      const val = prompt('Remove groups where best match is BELOW this %.\n\n84% = dhash threshold boundary.\nEnter 0-100:');
      if (val === null) return;
      const thr = parseInt(val);
      if (isNaN(thr) || thr < 0 || thr > 100) { toast('Invalid percentage', 'error'); return; }
      await filterFromFile('match_pct_below', thr);
    });
    el('filter-pct-above')?.addEventListener('click', async () => {
      const val = prompt('Remove groups where best match is ABOVE this %.\n\nUseful to remove exact copies and keep only fuzzy matches for review.\nEnter 0-100:');
      if (val === null) return;
      const thr = parseInt(val);
      if (isNaN(thr) || thr < 0 || thr > 100) { toast('Invalid percentage', 'error'); return; }
      await filterFromFile('match_pct_above', thr);
    });
    el('filter-pct-range')?.addEventListener('click', async () => {
      const val = prompt('Remove groups where best match is BETWEEN these values.\nFormat: min-max (e.g. 80-90)\n\nEnter range:');
      if (val === null) return;
      const parts = val.split(/[\-–]/);
      const lo = parseInt(parts[0]), hi = parseInt(parts[1]);
      if (isNaN(lo) || isNaN(hi) || lo < 0 || hi > 100 || lo >= hi) { toast('Invalid range — use format: 80-90', 'error'); return; }
      // Remove below lo first, then above hi... actually we want to remove BETWEEN lo and hi
      // We need to do this as two sequential filters: remove below hi, then remove above lo
      // Actually we need a single operation. Let me call both:
      await filterFromFile('match_pct_below', hi + 1);  // remove everything below hi+1 that's also...
      // No, that's wrong. We need a custom filter. Let me just call both sequentially:
      // First remove everything below lo (keeps lo and above)
      // Then remove everything above hi (keeps hi and below)
      // Result: only groups between lo and hi remain... but that's the OPPOSITE of what we want.
      // The user wants to REMOVE groups in the range. So:
      // We can't easily do "remove between" with two "remove below/above" calls.
      // Let me add a match_pct_range filter type instead.
      toast('Removing groups between ' + lo + '% and ' + hi + '%...', 'info');
      try {
        const r = await API.filterResult(currentFile, 'match_pct_range', lo + '-' + hi);
        toast('Removed ' + r.removed + ' groups, ' + r.remaining + ' remain.', 'success');
        await loadFile(currentFile);
      } catch(e) { toast(e.message, 'error'); }
    });
    el('save-overrides-btn')?.addEventListener('click', saveOverrides);
    el('actions-toggle-btn')?.addEventListener('click', () => { actionsOpen=!actionsOpen; el('actions-panel').classList.toggle('hidden',!actionsOpen); });
    el('review-result-select')?.addEventListener('change', e => { if (e.target.value) loadFile(e.target.value); });

    // ── Filter + sort wiring (direct getElementById) ─────────────────────
    const _simMinEl  = document.getElementById('sim-min');
    const _simMaxEl  = document.getElementById('sim-max');
    const _hifiEl    = document.getElementById('hifi-filter');
    const _hifiThrEl = document.getElementById('hifi-thr');
    const _sortEl    = document.getElementById('sort-groups');

    if (_simMinEl) {
      _simMinEl.oninput = _simMinEl.onchange = function() {
        _simMin = parseInt(this.value) || 0;
        console.log('[filter] sim-min =', _simMin);
        applyFilters();
      };
    } else { console.warn('[wireBar] sim-min NOT FOUND'); }

    if (_simMaxEl) {
      _simMaxEl.oninput = _simMaxEl.onchange = function() {
        _simMax = parseInt(this.value);
        if (isNaN(_simMax)) _simMax = 100;
        console.log('[filter] sim-max =', _simMax);
        applyFilters();
      };
    } else { console.warn('[wireBar] sim-max NOT FOUND'); }

    if (_hifiEl) {
      _hifiEl.onchange = function() {
        _hifiOnly = this.checked;
        console.log('[filter] hifi-only =', _hifiOnly);
        applyFilters();
      };
    } else { console.warn('[wireBar] hifi-filter NOT FOUND'); }

    if (_hifiThrEl) {
      _hifiThrEl.oninput = _hifiThrEl.onchange = function() {
        _hifiThr = parseFloat(this.value) || 1.5;
        window._bloatThreshold = _hifiThr;
        if (_hifiOnly) applyFilters();
      };
    }

    if (_sortEl) {
      _sortEl.onchange = function() { sortGroups(this.value); };
    }

    // Auto-save on page leave / browser close
    window.addEventListener('beforeunload', () => {
      if (currentFile && (Object.keys(overrides).length || deselectedGroups.size)) {
        fetch('/api/results/' + encodeURIComponent(currentFile) + '/overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides, deselectedGroups: [...deselectedGroups] }),
          keepalive: true
        }).catch(() => {});
      }
    });

    console.log('[wireBar] Wired:', {simMin:!!_simMinEl, simMax:!!_simMaxEl, hifi:!!_hifiEl, sort:!!_sortEl});

    // ── Keyboard navigation ──────────────────────────────────────────────────
    let focusedGroupIdx = -1;
    function focusGroup(idx) {
      const visible = [...container.querySelectorAll('.review-group')].filter(el => el.style.display !== 'none');
      if (!visible.length) return;
      idx = Math.max(0, Math.min(visible.length - 1, idx));
      focusedGroupIdx = idx;
      // Remove old focus
      container.querySelectorAll('.review-group.focused').forEach(el => el.classList.remove('focused'));
      visible[idx].classList.add('focused');
      visible[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function getFocusedCards() {
      const grp = container.querySelector('.review-group.focused');
      if (!grp) return [];
      return [...grp.querySelectorAll('.rev-card')];
    }
    document.addEventListener('keydown', e => {
      // Don't intercept when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      // Only when review page is visible
      if (container.offsetParent === null) return;
      const visible = [...container.querySelectorAll('.review-group')].filter(el => el.style.display !== 'none');
      switch (e.key) {
        case 'ArrowDown': case 'j':
          e.preventDefault(); focusGroup(focusedGroupIdx + 1); break;
        case 'ArrowUp': case 'k':
          e.preventDefault(); focusGroup(focusedGroupIdx - 1); break;
        case 'a': // Auto-select best for focused group
          { const grp = container.querySelector('.review-group.focused');
            if (grp) { const g = groups.find(x => x.id === grp.dataset.groupId);
              if (g) { selectOptimal(g); updateAll(); saveOverrides(); toast('Auto-selected', 'success', 1500); } }
          } break;
        case ' ': // Toggle keep/remove on first non-source card in focused group
          e.preventDefault();
          { const cards = getFocusedCards();
            if (cards.length > 1) {
              const path = cards[1].dataset.path;
              overrides[path] = overrides[path] === 'remove' ? 'keep' : 'remove';
              updateCard(cards[1], path); applyFilters(); saveOverrides();
            }
          } break;
        case 'Escape':
          { const overlay = document.getElementById('zoom-overlay');
            if (overlay) overlay.style.display = 'none';
          } break;
        case 'n': // Next unreviewed group
          { const idx = visible.findIndex((el, i) => {
              if (i <= focusedGroupIdx) return false;
              const g = groups.find(x => x.id === el.dataset.groupId);
              return g && !allFiles(g).some(f => overrides[f.path]);
            });
            if (idx >= 0) focusGroup(idx);
            else toast('No more unreviewed groups', 'info', 1500);
          } break;
      }
    });

    // Update badge labels when action settings change
    container.querySelectorAll('.action-select').forEach(sel => {
      sel.addEventListener('change', updateActionCfg);
    });
    const removeTargetInput = el('remove-target');
    if (removeTargetInput) removeTargetInput.addEventListener('input', updateActionCfg);

    // Deselect filter management (deselectFilters is module-level)
    function renderDeselectFilters() {
      const list = el('deselect-filters-list');
      if (!list) return;
      list.innerHTML = deselectFilters.map((f,i) => `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg-3);border-radius:4px">
          <select class="select select-sm desel-type" data-i="${i}" style="width:90px">
            <option value="folder" ${f.type==='folder'?'selected':''}>Folder</option>
            <option value="name"   ${f.type==='name'?'selected':''}>Name</option>
            <option value="size"   ${f.type==='size'?'selected':''}>Size</option>
          </select>
          ${f.type==='folder' ? `
            <select class="select select-sm desel-mode" data-i="${i}" style="width:60px">
              <option value="in"     ${f.mode==='in'?'selected':''}>in</option>
              <option value="not_in" ${f.mode==='not_in'?'selected':''}>not in</option>
            </select>` : ''}
          ${f.type==='size' ? `
            <select class="select select-sm desel-size-mode" data-i="${i}" style="width:70px">
              <option value="above" ${f.sizeMode==='above'?'selected':''}>above</option>
              <option value="below" ${f.sizeMode==='below'?'selected':''}>below</option>
            </select>
            <input type="number" class="input desel-size-kb" data-i="${i}" placeholder="KB" value="${f.sizeKB||0}" style="width:70px">` : ''}
          ${f.type!=='size' ? `<input class="input desel-value" data-i="${i}" placeholder="${f.type==='folder'?'I:\\folder\\path':'*.pattern.jpg'}" value="${escH(f.value||'')}" style="flex:1">` : ''}
          <button class="btn btn-ghost btn-xs desel-remove" data-i="${i}">✕</button>
        </div>`).join('');
      // Wire events
      list.querySelectorAll('.desel-type').forEach(s => {
        s.addEventListener('change', e => { deselectFilters[+s.dataset.i].type = s.value; renderDeselectFilters(); });
      });
      list.querySelectorAll('.desel-mode').forEach(s => {
        s.addEventListener('change', e => { deselectFilters[+s.dataset.i].mode = s.value; });
      });
      list.querySelectorAll('.desel-size-mode').forEach(s => {
        s.addEventListener('change', e => { deselectFilters[+s.dataset.i].sizeMode = s.value; });
      });
      list.querySelectorAll('.desel-value').forEach(inp => {
        inp.addEventListener('input', e => { deselectFilters[+inp.dataset.i].value = inp.value; });
      });
      list.querySelectorAll('.desel-size-kb').forEach(inp => {
        inp.addEventListener('input', e => { deselectFilters[+inp.dataset.i].sizeKB = parseFloat(inp.value)||0; });
      });
      list.querySelectorAll('.desel-remove').forEach(btn => {
        btn.addEventListener('click', e => { deselectFilters.splice(+btn.dataset.i,1); renderDeselectFilters(); });
      });
    }
    el('add-deselect-filter')?.addEventListener('click', () => {
      deselectFilters.push({ type:'folder', mode:'in', value:'' });
      renderDeselectFilters();
    });

    container.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'pick-remove-target') { const r = await API.pickFolder().catch(()=>({path:null})); if (r.path) { el('remove-target').value=r.path; updateActionCfg(); } }
      if (b.id === 'pick-keep-target')   { const r = await API.pickFolder().catch(()=>({path:null})); if (r.path) { el('keep-target').value=r.path; } }
      if (b.id === 'dry-run-btn')    runActions(true);
      if (b.id === 'run-actions-btn') runActions(false);
      if (b.id === 'undo-btn')       undoLast();
    });
  }

  // Read current action settings and update the actionCfg object + all badges
  function updateActionCfg() {
    container.querySelectorAll('.action-select').forEach(s => {
      actionCfg[s.dataset.conf] = s.value;
    });
    actionCfg.removeTarget = el('remove-target')?.value.trim() || null;

    // Refresh all visible badge labels
    container.querySelectorAll('.rev-card[data-path]').forEach(card => {
      const path = card.dataset.path;
      const confAttr = card.dataset.conf || 'certain';
      updateCard(card, path, confAttr);
    });
  }

  // Label for the "remove" action badge based on current settings
  function removeLabel(conf) {
    const strategy = actionCfg[conf] || 'keep_in_place';
    if (strategy === 'keep_in_place') return '✗ Remove (no action)';
    if (strategy === 'recycle_removed') return '♻ Recycle';
    if (strategy === 'delete_permanent') return '🗑 Delete';
    if (actionCfg.removeTarget) {
      const folder = actionCfg.removeTarget.split(/[\\/]/).pop() || actionCfg.removeTarget;
      return '📁 → ' + folder;
    }
    return '✗ Remove';
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  async function loadFile(filename) {
    currentFile = filename;
    // Show/hide interim banner
    const banner = el('interim-banner');
    if (banner) banner.classList.toggle('hidden', !filename.includes('interim_'));
    const wrap = el('review-groups');
    if (wrap) wrap.innerHTML = '<div class="text-muted" style="padding:20px">Loading…</div>';
    try {
      const data = await API.getResult(filename);
      groups = data.groups || [];
      const resultConfig = data.scanConfig || null;
      showDiagnostics(resultConfig);

      // Load ignore list and filter out ignored groups
      try { ignoreEntries = await API.get('/ignore'); } catch { ignoreEntries = []; }
      const beforeCount = groups.length;
      groups = groups.filter(g => {
        const paths = allFiles(g).map(f => f.path);
        return !isGroupIgnored(paths);
      });
      if (groups.length < beforeCount) console.log('[ignore] Filtered ' + (beforeCount - groups.length) + ' ignored groups');
      // Build set of individually ignored files
      ignoredFiles = new Set();
      ignoreEntries.forEach(e => { if (e.paths.length === 1) ignoredFiles.add(e.paths[0]); });
      if (ignoredFiles.size) console.log('[ignore] ' + ignoredFiles.size + ' individually ignored files');
      overrides = data.overrides || {};
      deselectedGroups = new Set(data.deselectedGroups || []);
      locked = {};
      applyDefaults();
      await populateDropdown();
      renderGroups();
    } catch(e) {
      if (wrap) wrap.innerHTML = '<div class="text-muted" style="padding:20px">Error: ' + escH(e.message) + '</div>';
    }
  }

  function applyDefaults() {
    groups.forEach(g => {
      const files = allFiles(g);
      files.forEach(f => { if (overrides[f.path]) return; });
      const anySet = files.some(f => overrides[f.path]);
      if (anySet) return;
      if (g.confidenceLabel === 'certain') {
        const hasMd5 = (g.matches||[]).some(m => m.md5_match);
        if (hasMd5) {
          overrides[g.source] = 'keep';
          (g.matches||[]).forEach(m => { overrides[m.path] = m.md5_match ? 'remove' : 'keep'; });
        } else {
          // Sort: 1) most megapixels, 2) largest file, 3) newest EXIF or mtime (US-060)
          const dateMs = f => {
            const d = f.exif_date || f.mtime;
            const ms = d ? new Date(d).getTime() : 0;
            return isNaN(ms) ? 0 : ms;
          };
          const sorted = [...files].sort((a,b) =>
            ((b.width||0)*(b.height||0)) - ((a.width||0)*(a.height||0)) ||
            (b.size||0) - (a.size||0) ||
            dateMs(b) - dateMs(a)
          );
          overrides[sorted[0].path] = 'keep';
          sorted.slice(1).forEach(f => { overrides[f.path] = 'remove'; });
        }
      } else {
        files.forEach(f => { overrides[f.path] = overrides[f.path] || 'keep'; });
      }
    });
  }

  function allFiles(g) {
    const si = g.source_info || {};
    return [
      { path:g.source, isSource:true, size:si.size, size_fmt:si.size_fmt, width:si.width, height:si.height, mtime:si.mtime_fmt, exif_date:si.exif_date },
      ...(g.matches||[]).map(m=>({ path:m.path, isSource:false, size:m.size, size_fmt:m.size_fmt, width:m.width, height:m.height, mtime:m.mtime_fmt, exif_date:m.exif_date, md5_match:m.md5_match, distances:m.distances }))
    ];
  }

  async function populateDropdown() {
    const sel = el('review-result-select');
    if (!sel) return;
    try {
      const results = await API.getResults();
      sel.innerHTML = '<option value="">— Select result —</option>' +
        results.map((r,i) => '<option value="' + escH(r.filename) + '"' + (r.filename===currentFile?' selected':'') + '>' +
          (i===0?'★ ':'') + (r.scannedAt ? new Date(r.scannedAt).toLocaleString('en-GB') : r.filename) + ' (' + r.groupCount + ' groups)</option>'
        ).join('');
    } catch {}
  }

  function showDiagnostics(resultConfig) {
    const banner = el('diag-banner');
    if (!banner) return;
    if (!resultConfig) { banner.style.display = 'none'; return; }

    const sc    = resultConfig.scan || {};
    const algos = Object.entries(sc.algorithms||{}).filter(([,v])=>v).map(([k])=>k);
    const ths   = sc.thresholds || {};
    const depth = sc.searchDepth || 1;
    const depthLabel = ['fast','fast+','normal','thorough','max'][depth-1] || depth;

    banner.style.display = '';
    banner.innerHTML = '<span style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">' +
      (algos.length ? algos.map(a => a + ':' + (ths[a]??10)).join(' \xb7 ') : 'MD5 only') +
      ' \xb7 ensemble=' + (sc.ensureMin??1) +
      ' \xb7 depth=' + depthLabel +
      ' \xb7 ' + (sc.matchLogic||'threshold') +
      '</span>';
  }


  function getVisible() {
    return groups.filter(g => {
      if (!visConf[g.confidenceLabel||'certain']) return false;
      if (showDeselOnly && !deselectedGroups.has(g.source)) return false;
      if (showMultiKeep||showNoSel) {
        const keeps = allFiles(g).filter(f=>overrides[f.path]!=='remove').length;
        if (showMultiKeep && keeps<=1) return false;
        if (showNoSel && keeps>0) return false;
      }
      // Match % filter
      if (_simMin > 0 || _simMax < 100) {
        const best = allFiles(g).reduce((b,f)=>{ const p=matchPct(f); return (p!==null&&p>b)?p:b; }, 0);
        if (_simMin > 0 && best < _simMin) return false;
        if (_simMax < 100 && best > _simMax) return false;
      }
      // Hi-fi filter
      if (_hifiOnly && !allFiles(g).some(f => bloatCheck(f, g, _hifiThr))) return false;
      return true;
    });
  }

  function sortGroups(mode) {
    groups.sort((a, b) => {
      const pctA = allFiles(a).reduce((best, f) => { const p = matchPct(f); return (p !== null && p > best) ? p : best; }, 0);
      const pctB = allFiles(b).reduce((best, f) => { const p = matchPct(f); return (p !== null && p > best) ? p : best; }, 0);
      const sizeA = allFiles(a).filter(f => overrides[f.path] === 'remove').reduce((s, f) => s + (f.size||0), 0);
      const sizeB = allFiles(b).filter(f => overrides[f.path] === 'remove').reduce((s, f) => s + (f.size||0), 0);
      const revA  = allFiles(a).some(f => overrides[f.path]) ? 1 : 0;
      const revB  = allFiles(b).some(f => overrides[f.path]) ? 1 : 0;
      switch (mode) {
        case 'pct-asc':    return pctA - pctB;
        case 'pct-desc':   return pctB - pctA;
        case 'size-desc':  return sizeB - sizeA;
        case 'files-desc': return allFiles(b).length - allFiles(a).length;
        case 'unreviewed': return revA - revB;
        default: return 0;
      }
    });
    _page = 0;
    renderPage();
  }

  function applyFilters() {
    renderPage();
  }

  function updateStats(visible) {
    const c2 = el('review-count');
    const deselCount = groups.filter(g => deselectedGroups.has(g.source)).length;
    if (c2) c2.textContent = visible.length + ' of ' + groups.length + ' groups' + (deselCount ? ' · ' + deselCount + ' deselected' : '');

    let removeBytes = 0, removeCount = 0, reviewedCount = 0;
    for (const g of groups) {
      if (deselectedGroups.has(g.source)) continue;  // skipped by actions, so no savings
      const files = allFiles(g);
      let hasDecision = false;
      for (const f of files) {
        if (overrides[f.path] === 'remove') { removeBytes += (f.size||0); removeCount++; }
        if (overrides[f.path]) hasDecision = true;
      }
      if (hasDecision) reviewedCount++;
    }
    const savingsEl = el('review-savings');
    if (savingsEl) {
      if (removeCount > 0) {
        const mb = (removeBytes / 1048576).toFixed(1);
        const gb = (removeBytes / 1073741824).toFixed(2);
        savingsEl.textContent = '🗑 ' + removeCount + ' files · ' + (removeBytes > 1073741824 ? gb + ' GB' : mb + ' MB');
      } else savingsEl.textContent = '';
    }
    const progEl = el('review-progress');
    if (progEl) progEl.textContent = reviewedCount > 0 ? '✓ ' + reviewedCount + '/' + groups.length + ' reviewed' : '';
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderGroups() {
    _page = 0;
    renderPage();
  }

  function renderPage() {
    const wrap = el('review-groups');
    if (!wrap) return;
    wrap.innerHTML = '';

    const visible = getVisible();
    if (!visible.length) {
      wrap.innerHTML = '<div class="empty-state"><div style="font-size:32px">✓</div><p>No groups match current filters.</p></div>';
      updateStats(visible);
      return;
    }

    const totalPages = Math.ceil(visible.length / PAGE_SIZE);
    _page = Math.max(0, Math.min(_page, totalPages - 1));
    const start = _page * PAGE_SIZE;
    const pageGroups = visible.slice(start, start + PAGE_SIZE);

    // Pagination controls
    const pag = document.createElement('div');
    pag.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;padding:10px;font-size:13px;color:var(--text-2)';
    if (totalPages > 1) {
      pag.innerHTML =
        '<button class="btn btn-ghost btn-sm" id="page-prev"' + (_page===0?' disabled':'') + '>← Prev</button>' +
        '<span>Page ' + (_page+1) + ' of ' + totalPages + ' · showing ' + (start+1) + '–' + Math.min(start+PAGE_SIZE, visible.length) + ' of ' + visible.length + ' groups</span>' +
        '<button class="btn btn-ghost btn-sm" id="page-next"' + (_page>=totalPages-1?' disabled':'') + '>Next →</button>';
    }
    wrap.appendChild(pag);

    // Render only this page's groups
    const frag = document.createDocumentFragment();
    pageGroups.forEach(g => frag.appendChild(buildGroupEl(g)));
    wrap.appendChild(frag);

    // Bottom pagination too
    if (totalPages > 1) {
      const pag2 = pag.cloneNode(true);
      pag2.id = 'page-bottom';
      wrap.appendChild(pag2);
    }

    // Wire pagination buttons
    wrap.querySelectorAll('#page-prev, [id=page-prev]').forEach(b => b.onclick = () => { _page--; renderPage(); wrap.scrollIntoView(); });
    wrap.querySelectorAll('#page-next, [id=page-next]').forEach(b => b.onclick = () => { _page++; renderPage(); wrap.scrollIntoView(); });

    updateStats(visible);
    applyCardVisibility();
  }

  // Per-card match% visibility: hide individual cards below threshold
  function applyCardVisibility() {
    if (_simMin <= 0 && _simMax >= 100) return; // no per-card filter
    document.querySelectorAll('.rev-card').forEach(card => {
      const path = card.dataset.path;
      // Find the file and its match %
      for (const g of groups) {
        const f = allFiles(g).find(x => x.path === path);
        if (!f) continue;
        if (f.isSource) { card.style.display = ''; break; } // source always visible
        const pct = matchPct(f);
        if (pct === null) { card.style.display = ''; break; } // no data = show
        const inRange = (pct >= _simMin) && (pct <= _simMax);
        card.style.display = inRange ? '' : 'none';
        break;
      }
    });
  }

  function buildGroupEl(group) {
    const div = document.createElement('div');
    const isDesel = deselectedGroups.has(group.source);
    div.className = 'review-group' + (isDesel ? ' group-deselected' : '');
    div.dataset.groupId = group.id;
    const files = allFiles(group);
    const hasMd5 = files.some(f=>f.md5_match);
    const bigGroup = files.length > 20;

    // Common folder prefix for header
    const allPaths   = files.map(f => f.path);
    const common     = commonFolder(allPaths);
    const keptFile   = files.find(f => (overrides[f.path]||'keep') === 'keep');
    const keptName   = keptFile ? baseName(keptFile.path) : '';

    // Compute match % range for header
    const pcts = files.map(f => matchPct(f)).filter(p => p !== null);
    const minPct = pcts.length ? Math.min(...pcts) : null;
    const maxPct = pcts.length ? Math.max(...pcts) : null;
    const pctStr = minPct !== null
      ? (minPct === maxPct ? minPct + '%' : minPct + '–' + maxPct + '%')
      : '';
    const pctBadgeStyle = maxPct !== null
      ? (maxPct >= 95 ? 'color:#fff;background:rgba(34,197,94,0.7)' : maxPct >= 80 ? 'color:#fff;background:rgba(245,158,11,0.6)' : 'color:var(--text-3);background:var(--bg-4)')
      : '';

    const headerHtml = '<div class="review-group-header" style="justify-content:space-between;flex-wrap:wrap;gap:6px">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<label class="group-select" title="Untick to skip this whole group when actions run">' +
        '<input type="checkbox" class="group-select-cb"' + (isDesel ? '' : ' checked') + '>' +
        '<span class="group-desel-label">' + (isDesel ? 'Skipped' : '') + '</span>' +
      '</label>' +
      '<span class="confidence-badge ' + (group.confidenceLabel||'certain') + '">' + (group.confidenceLabel||'certain') + '</span>' +
      '<span class="text-muted text-sm">' + files.length + ' files</span>' +
      (hasMd5 ? '<span class="badge-md5">MD5✓</span>' : '') +
      (pctStr ? '<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;' + pctBadgeStyle + '">' + pctStr + '</span>' : '') +
      (bigGroup ? '<span style="background:var(--orange-bg);color:var(--orange);font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px">⚠ Large group</span>' : '') +
      (files.length > 1 && new Set(files.map(f => f.path.replace(/[\\/][^\\/]+$/, ''))).size === 1
        ? '<span style="font-size:10px;color:var(--orange);padding:1px 5px;border-radius:3px;background:var(--orange-bg)" title="All files in the same folder — likely accidental copies">📁 Same folder</span>' : '') +
      (common ? '<span class="mono" style="font-size:10px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px;direction:rtl;unicode-bidi:plaintext" title="' + escH(common) + '">' + escH(common) + '</span>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">' +
      (keptName ? '<span style="color:var(--green);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="' + escH(keptFile?.path||'') + '">✓ ' + escH(keptName) + '</span>' : '') +
      '<button class="btn btn-ghost btn-xs ignore-group-btn" title="Ignore this group in future scans">🚫</button>' +
      '<button class="btn btn-ghost btn-xs collapse-group-btn" title="Collapse/expand">▾</button>' +
      '</div>' +
    '</div>';

    const cardsHtml = '<div class="review-cards-row">' +
      files.map(f => buildCardHTML(f, group)).join('') +
      '</div>';

    div.innerHTML = headerHtml + cardsHtml;

    div.querySelectorAll('.rev-card').forEach(card => {
      const path = card.dataset.path;
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        if (!locked[path]) {
          overrides[path] = overrides[path]==='keep' ? 'remove' : 'keep';
          updateCard(card, path, card.dataset.conf);
          applyFilters();
        }
      });
      card.querySelector('.btn-lock')?.addEventListener('click', e => {
        e.stopPropagation();
        locked[path] = !locked[path];
        if (locked[path]) overrides[path] = 'keep';
        updateCard(card, path, card.dataset.conf);
        applyFilters();
      });
      // Click thumbnail to zoom
    });

    // Group select checkbox: unticked groups are skipped entirely by actions
    div.querySelector('.group-select-cb')?.addEventListener('change', e => {
      setGroupSelected(group, e.target.checked);
      persistDeselected();
      if (showDeselOnly) applyFilters();
      else { syncGroupEl(div, group); updateStats(getVisible()); }
    });

    // Ignore group button
    div.querySelector('.ignore-group-btn')?.addEventListener('click', async () => {
      const paths = allFiles(group).map(f => f.path);
      await fetch('/api/ignore', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths}) });
      div.style.display = 'none';
      groups = groups.filter(g => g.id !== group.id);
      applyFilters();
      toast('Group ignored — will not appear in future reviews', 'success', 2000);
    });

    // Collapse toggle
    div.querySelector('.collapse-group-btn')?.addEventListener('click', () => {
      const cards = div.querySelector('.review-cards-row');
      if (cards) {
        const collapsed = cards.style.display === 'none';
        cards.style.display = collapsed ? '' : 'none';
        div.querySelector('.collapse-group-btn').textContent = collapsed ? '▾' : '▸';
      }
    });

    div.querySelectorAll('.rev-card').forEach((card, i) => {
      const path = card.dataset.path;
      // Click thumbnail to zoom
      card.querySelector('.rev-thumb')?.addEventListener('click', e => {
        e.stopPropagation();
        const overlay = document.getElementById('zoom-overlay');
        const img = document.getElementById('zoom-img');
        const img2 = document.getElementById('zoom-img2');
        const info = document.getElementById('zoom-info');
        if (!overlay || !img) return;
        const thumbUrl = '/api/thumbnail?path=' + encodeURIComponent(path) + '&full=1';
        const f = allFiles(group).find(x => x.path === path);
        const label = baseName(path) + (f?.size_fmt ? ' · ' + f.size_fmt : '') + (f?.width ? ' · ' + f.width + '×' + f.height : '');

        if (overlay.style.display === 'flex' && img.src && !img.src.endsWith('#')) {
          // Already zoomed — add as second image for side-by-side
          if (img2) {
            img2.src = thumbUrl;
            img2.style.display = '';
            img.style.maxWidth = '45vw';
            if (info) info.textContent = 'Side-by-side comparison';
          }
        } else {
          // First image — show zoom overlay
          img.src = thumbUrl;
          if (img2) { img2.style.display = 'none'; img2.src = ''; }
          img.style.maxWidth = '95vw';
          if (info) info.textContent = label;
          overlay.style.display = 'flex';
        }
      });
      card.querySelector('.btn-use-name')?.addEventListener('click', async e => {
        e.stopPropagation();
        // Find the kept file in this group
        const keptCard = [...card.closest('.review-group').querySelectorAll('.rev-card')].find(c =>
          (overrides[c.dataset.path] || 'keep') === 'keep'
        );
        if (!keptCard) { toast('No kept file in this group', 'info'); return; }
        const keptPath = keptCard.dataset.path;
        const newName  = baseName(path);
        if (baseName(keptPath) === newName) { toast('Same name already', 'info'); return; }
        if (!confirm('Rename kept file:\n' + baseName(keptPath) + '\n→ ' + newName + '?')) return;
        try {
          const r = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: keptPath, newName })
          }).then(r => r.json());
          if (r.ok) {
            toast('Renamed to ' + newName, 'success', 2000);
            // Update the card display
            const nameEl = keptCard.querySelector('.rev-meta-name');
            if (nameEl) nameEl.textContent = newName;
          } else { toast(r.error || 'Rename failed', 'error'); }
        } catch(err) { toast(err.message, 'error'); }
      });
      card.querySelector('.btn-ignore-image')?.addEventListener('click', async e => {
        e.stopPropagation();
        await fetch('/api/ignore', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:[path]}) });
        card.style.display = 'none';
        toast('Image ignored in future scans', 'success', 1500);
      });
      card.querySelector('.btn-view')?.addEventListener('click', e => {
        e.stopPropagation();
        fetch('/api/open-image?path=' + encodeURIComponent(path));
      });
      card.querySelector('.btn-open')?.addEventListener('click', e => {
        e.stopPropagation();
        fetch('/api/open-file?path=' + encodeURIComponent(path)).catch(()=>{});
      });
      card.querySelector('.btn-filter-folder')?.addEventListener('click', async e => {
        e.stopPropagation();
        const dir = path.split(/[\/]/).slice(0, -1).join('\\') || path.split(/[\/]/).slice(0, -1).join('/');
        const inp = el('folder-sel-input');
        if (inp) inp.value = dir;
        if (!await confirm('Filter folder', 'Remove all groups containing files from:\n' + dir + '?', 'Remove')) return;
        try {
          const r = await API.filterResult(currentFile, 'folder', dir);
          toast('Removed ' + r.removed + ' groups from ' + dir.split(/[\/]/).pop(), 'success');
          await loadFile(currentFile);
        } catch(ex) { toast(ex.message, 'error'); }
      });
    });

    return div;
  }

  function setGroupSelected(group, selected) {
    if (selected) deselectedGroups.delete(group.source);
    else deselectedGroups.add(group.source);
  }

  // Quiet save after a single checkbox toggle (the 💾 button toasts; this should not)
  function persistDeselected() {
    if (!currentFile) return;
    API.saveOverrides(currentFile, overrides, [...deselectedGroups]).catch(e => toast(e.message, 'error'));
  }

  function syncGroupEl(div, group) {
    const isDesel = deselectedGroups.has(group.source);
    div.classList.toggle('group-deselected', isDesel);
    const cb = div.querySelector('.group-select-cb');
    if (cb) cb.checked = !isDesel;
    const lbl = div.querySelector('.group-desel-label');
    if (lbl) lbl.textContent = isDesel ? 'Skipped' : '';
  }

  function isGroupIgnored(groupPaths) {
    const gpSet = new Set(groupPaths);
    return ignoreEntries.some(entry =>
      groupPaths.every(p => entry.paths.includes(p))
    );
  }

  // Name quality scoring — higher = better, more descriptive name
  function nameScore(filename) {
    const name = filename.replace(/\.[^.]+$/, ''); // strip extension
    // Hash-like: 16+ hex chars
    if (/^[0-9a-f]{16,}$/i.test(name)) return 0;
    // UUID-like
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) return 0;
    // Pure random alphanumeric (no separators, no words)
    if (/^[A-Za-z0-9]{20,}$/.test(name) && !/[aeiou]{2,}/i.test(name)) return 1;
    // Timestamp-only names
    if (/^\d{4}[-_]?\d{2}[-_]?\d{2}[-_T]?\d{0,6}/.test(name) && name.replace(/[\d_\-T]/g, '').length < 5) return 2;
    // Copy pattern: "file (1)", "file - Copy", "file_copy"
    if (/[\(\[]\d+[\)\]]|\.\d+$|[_\- ](copy|kopie|\d+)$/i.test(name)) return 2;
    // Short generic name
    if (name.length < 6) return 2;
    // Contains recognizable words (has vowels, separators, reasonable length)
    const words = name.split(/[-_ .]+/).filter(w => w.length > 2);
    if (words.length >= 2) return 4; // multiple words = descriptive
    if (words.length === 1 && words[0].length > 5) return 3;
    return 2; // default
  }

  function nameLabel(score) {
    if (score <= 0) return 'hash';
    if (score <= 1) return 'random';
    if (score <= 2) return '';
    return '';
  }

  function matchPct(file) {
    if (file.md5_match) return 100;
    if (!file.distances || !Object.keys(file.distances).length) return null;
    const vals = Object.values(file.distances).filter(v => typeof v === 'number');
    if (!vals.length) return null;
    return Math.round((1 - Math.min(...vals) / 64) * 100);
  }

  // Detailed match info for tooltip
  function matchDetail(file) {
    if (file.md5_match) return 'MD5: byte-for-byte identical';
    if (!file.distances || !Object.keys(file.distances).length) return '';
    return Object.entries(file.distances)
      .filter(([,v]) => typeof v === 'number')
      .map(([algo, dist]) => algo + ': ' + Math.round((1-dist/64)*100) + '% (dist ' + dist + '/64)')
      .join('\n');
  }

  function bloatCheck(file, group, threshold) {
    const thr = threshold ?? 1.5;
    const fileMp = (file.width && file.height) ? file.width * file.height : 0;
    if (!fileMp || !file.size) return false;
    return allFiles(group).some(other => {
      if (other.path === file.path) return false;
      const otherMp = (other.width && other.height) ? other.width * other.height : 0;
      return otherMp > fileMp && file.size >= thr * (other.size || 1);
    });
  }

  function selectOptimal(group) {
    const files = allFiles(group);
    if (files.length < 2) return;
    const scored = files.map(f => ({
      path:   f.path,
      mp:     (f.width && f.height) ? f.width * f.height : 0,
      sz:     f.size || 0,
      dateMs: f.exif_date ? new Date(f.exif_date).getTime() : (f.mtime ? new Date(f.mtime).getTime() : Infinity),
      fi:     typeof f.folderIndex === 'number' ? f.folderIndex : 999
    }));
    scored.sort((a, b) =>
      b.mp - a.mp ||
      b.sz - a.sz ||
      a.dateMs - b.dateMs ||
      a.fi - b.fi
    );
    const best = scored[0].path;
    scored.forEach(s => { overrides[s.path] = s.path === best ? 'keep' : 'remove'; });
  }

  // Compute "best" values across all files in a group for green highlighting
  function groupBests(group) {
    const files = allFiles(group);
    let bestSize = -1, bestMp = -1, bestDate = -1;
    for (const f of files) {
      if ((f.size || 0) > bestSize) bestSize = f.size || 0;
      const mp = (f.width && f.height) ? f.width * f.height : 0;
      if (mp > bestMp) bestMp = mp;
      const exifD  = f.exif_date ? new Date(f.exif_date).getTime() : NaN;
      const mtimeD = f.mtime     ? new Date(f.mtime).getTime()     : NaN;
      const d = !isNaN(exifD) ? exifD : (!isNaN(mtimeD) ? mtimeD : 0);
      if (d > bestDate) bestDate = d;
    }
    // Count ties — if >1 file shares the best, it's a tie (same stat = different highlight)
    const sizeCount = bestSize > 0 ? files.filter(f => (f.size||0) >= bestSize).length : 0;
    const mpCount   = bestMp   > 0 ? files.filter(f => (f.width&&f.height?f.width*f.height:0) >= bestMp).length : 0;
    const dateCount = bestDate > 0 ? files.filter(f => {
      const d = f.exif_date ? new Date(f.exif_date).getTime() : (f.mtime ? new Date(f.mtime).getTime() : 0);
      return d >= bestDate;
    }).length : 0;
    return { bestSize, bestMp, bestDate, sizeCount, mpCount, dateCount };
  }

  function buildCardHTML(file, group) {
    const path     = file.path;
    const sel      = overrides[path] || 'keep';
    const isLock   = locked[path];
    const conf     = group.confidenceLabel || 'certain';
    const cls      = isLock ? 'locked' : sel;
    const name     = baseName(path);
    const fullDir  = path.slice(0, path.length - name.length - 1);
    const isFileScan = !file.width && !file.height && !file.exif_date;
    const thumb    = '/api/thumbnail?path=' + encodeURIComponent(path);

    const pct       = matchPct(file);
    const pctCls    = pct === null ? '' : pct >= 95 ? 'high' : pct >= 80 ? 'mid' : '';
    const pctLabel  = (pct !== null && !file.md5_match) ? pct + '%' : '';
    const isHifi    = bloatCheck(file, group, window._bloatThreshold ?? 1.5);

    // EXIF vs mtime warning (>30 days apart)
    let exifWarn = false;
    if (file.exif_date && file.mtime) {
      const d1 = new Date(file.exif_date).getTime(), d2 = new Date(file.mtime).getTime();
      if (!isNaN(d1) && !isNaN(d2) && Math.abs(d1 - d2) > 30 * 864e5) exifWarn = true;
    }

    // Badge text (old full-width status bar style)
    const actionLabel = isLock ? '🔒 LOCKED'
      : sel === 'keep' ? '✓ KEEP'
      : removeLabel(conf);
    const md5badge  = file.md5_match ? ' <span class="badge-md5">MD5✓</span>' : '';
    const hifiBadge  = isHifi  ? ' <span class="hifi-badge" title="Lower resolution but larger file — may be higher quality (less compression, lossless format)">Hi-fi ★</span>' : '';
    const pctDetail = matchDetail(file);
    const pctBadge  = pctLabel ? ' <span class="sim-badge ' + pctCls + '" title="' + escH(pctDetail) + '">' + pctLabel + '</span>' : '';
    const filetypeBadge = (!file.md5_match && file.matchType)
      ? ' <span style="font-size:10px;opacity:.7">' + escH(file.matchType) + '</span>' : '';

    // Labeled metadata rows — fixed label column, values aligned
    const bests   = groupBests(group);
    const fileMp  = (file.width && file.height) ? file.width * file.height : 0;

    const isBestSize = (file.size || 0) >= bests.bestSize && bests.bestSize > 0;
    const isBestMp   = fileMp >= bests.bestMp && bests.bestMp > 0;
    const exifD   = file.exif_date ? new Date(file.exif_date).getTime() : NaN;
    const mtimeD  = file.mtime     ? new Date(file.mtime).getTime()     : NaN;
    const fileMs  = !isNaN(exifD) ? exifD : (!isNaN(mtimeD) ? mtimeD : 0);
    const isBestDate = fileMs > 0 && fileMs >= bests.bestDate;

    // Color: unique best = green, tied best = blue, normal = text-2
    const statStyle = (isBest, count) => {
      if (!isBest) return '';
      return count === 1
        ? ' style="color:#4ade80"'           // unique best — soft green
        : ' style="color:#60a5fa"';          // tied best   — soft blue
    };

    const dims  = (file.width && file.height) ? file.width + '×' + file.height : '—';
    const mpStr = fileMp ? (fileMp/1e6).toFixed(1) + ' MP' : null;

    // Date rows
    const fileDateStr = file.mtime     || null;
    const exifDateStr = file.exif_date || null;

    const fileDateStyle = statStyle(isBestDate && new Date(fileDateStr||0).getTime()===bests.bestDate, bests.dateCount);
    const exifDateStyle = statStyle(isBestDate && new Date(exifDateStr||0).getTime()===bests.bestDate, bests.dateCount);

    const dateRows = (fileDateStr && exifDateStr && fileDateStr !== exifDateStr)
      ? '<tr><td class="rml">File date</td><td' + fileDateStyle + '>' + escH(fileDateStr) + '</td></tr>'
        + '<tr><td class="rml">EXIF date</td><td' + exifDateStyle + '>' + escH(exifDateStr)
        + (exifWarn ? ' <span style="color:var(--orange)">⚠</span>' : '') + '</td></tr>'
      : '<tr><td class="rml">' + (exifDateStr ? 'EXIF date' : 'File date') + '</td><td'
        + statStyle(isBestDate, bests.dateCount) + '>'
        + escH(exifDateStr || fileDateStr || '—') + '</td></tr>';

    const rows = '<table class="rev-meta-table"><tbody>'
      + '<tr><td class="rml">Size</td><td' + statStyle(isBestSize, bests.sizeCount) + '>' + (file.size_fmt||'—') + '</td></tr>'
      + (isFileScan ? '' : '<tr><td class="rml">Dimensions</td><td' + statStyle(isBestMp, bests.mpCount) + '>'
          + dims + (mpStr ? ' · ' + mpStr : '') + '</td></tr>')
      + dateRows
      + '</tbody></table>';

    // Build HTML using array join to avoid quote escaping issues
    const isIgnoredFile = ignoredFiles.has(path);
    const parts = [
      '<div class="rev-card ' + cls + (isIgnoredFile ? ' card-ignored' : '') + '" data-path="' + escH(path) + '" data-conf="' + conf + '"' + (isIgnoredFile ? ' style="display:none"' : '') + '>',

        // Full-width status bar (old layout)
        '<div class="rev-card-status ' + cls + '" style="display:flex;align-items:center;gap:5px;flex-wrap:nowrap"><span class="action-text">' + actionLabel + '</span>' + (md5badge||filetypeBadge) + hifiBadge + pctBadge + '</div>',

        // Thumbnail
        isFileScan
          ? '<div class="rev-thumb-wrap rev-thumb-file">' + fileIcon(name) + '</div>'
          : isVideoPath(name)
            // Video: try ffmpeg thumbnail first, fall back to browser <video> element
            ? '<div class="rev-thumb-wrap">'
              + '<img class="rev-thumb" src="' + thumb + '" loading="lazy" '
              + 'onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;&quot;" '
              + 'alt="' + escH(name) + '">'
              + '<video class="rev-thumb" style="display:none;width:100%;height:100%;object-fit:cover" '
              + 'src="/api/stream?path=' + encodeURIComponent(path) + '" preload="metadata" muted '
              + 'onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;">'
              + '</video>'
              + '<div class="rev-thumb-placeholder" style="display:none">🎬</div>'
              + '</div>'
            // Image: standard img with fallback
            : '<div class="rev-thumb-wrap"><img class="rev-thumb" src="' + thumb + '" loading="lazy" '
              + 'onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;" '
              + 'alt="' + escH(name) + '"><div class="rev-thumb-placeholder" style="display:none">'
              + '🖼</div></div>',

        // Filename + full path + metadata table
        '<div class="rev-meta">',
          '<div class="rev-meta-name">' + escH(name) +
          (nameScore(name) <= 1 ? ' <span style="font-size:9px;color:var(--orange);opacity:0.7">' + nameLabel(nameScore(name)) + '</span>' : '') +
          '</div>',
          '<div class="rev-meta-dir" title="' + escH(fullDir) + '">' + escH(fullDir) + '</div>',
          rows,
        '</div>',

        // Action buttons
        '<div class="rev-card-btns">',
          '<button class="btn btn-ghost btn-xs btn-lock" title="' + (isLock?'Unlock':'Lock') + '">' + (isLock?'🔒':'🔓') + '</button>',
          '<button class="btn btn-ghost btn-xs btn-view" title="Open image in default viewer">👁</button>',
          '<button class="btn btn-ghost btn-xs btn-open" title="Show in folder">📂</button>',
          '<button class="btn btn-ghost btn-xs btn-filter-folder" title="Filter folder from results">－</button>',
          '<button class="btn btn-ghost btn-xs btn-ignore-image" title="Ignore this image in future scans">🚫</button>',
          '<button class="btn btn-ghost btn-xs btn-use-name" title="Rename the kept file to this filename">✏</button>',
        '</div>',
      '</div>'
    ];
    return parts.join('');
  }

  // Find longest common folder path across a list of file paths
  function commonFolder(paths) {
    if (!paths.length) return '';
    const parts = paths.map(p => p.split('\\').join('/').split('/').slice(0, -1));
    const min = parts.reduce((a, b) => a.length <= b.length ? a : b);
    let i = 0;
    while (i < min.length && parts.every(p => p[i] === min[i])) i++;
    return min.slice(0, i).join('/').replace(/\//g, '\\') || '';
  }

  function isVideoPath(name) {
    return /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|mpg|mpeg)$/i.test(name);
  }
  function fileIcon(name) {
    const ext = (name.split('.').pop()||'').toLowerCase();
    if (/^(doc|docx|odt|rtf)$/.test(ext)) return '📝';
    if (/^(xls|xlsx|csv|ods)$/.test(ext)) return '📊';
    if (/^(ppt|pptx|odp)$/.test(ext)) return '📊';
    if (/^(pdf)$/.test(ext)) return '📄';
    if (/^(zip|7z|rar|tar|gz|bz2|iso|cab)$/.test(ext)) return '📦';
    if (/^(exe|msi|dmg|pkg|deb|rpm)$/.test(ext)) return '⚙️';
    if (/^(mp3|flac|wav|aac|ogg|m4a)$/.test(ext)) return '🎵';
    if (/^(txt|log|md|json|xml|yaml|yml|ini|cfg)$/.test(ext)) return '📃';
    if (/^(js|ts|py|java|c|cpp|cs|go|rs|php|html|css)$/.test(ext)) return '💾';
    return '📄';
  }

  function _autoSave() {
    _changeCount++;
    if (_changeCount >= AUTO_SAVE_INTERVAL) {
      _changeCount = 0;
      saveOverrides().then(() => console.log('[auto-save] Selections saved'));
    }
  }

  function updateCard(cardEl, path, conf) {
    const sel     = overrides[path] || 'keep';
    const isLock  = locked[path];
    const cls     = isLock ? 'locked' : sel;
    const confStr = conf || cardEl.dataset.conf || 'certain';
    cardEl.className = 'rev-card ' + cls;

    const badge = cardEl.querySelector('.rev-card-status');
    if (badge) {
      badge.className = 'rev-card-status ' + cls;
      const actionSpan = badge.querySelector('.action-text');
      if (actionSpan) {
        actionSpan.textContent = isLock ? '🔒 LOCKED'
          : sel === 'keep' ? '✓ KEEP'
          : removeLabel(confStr);
      }
    }
    const lb = cardEl.querySelector('.btn-lock');
    if (lb) lb.textContent = isLock ? '🔒' : '🔓';
  }

  // ── Selection actions ─────────────────────────────────────────────────────
  async function applySelAction(action) {
    if (action === 'dismiss_md5') {
      let count = 0;
      getVisible().forEach(g => {
        if (!allFiles(g).some(f => f.md5_match)) return; // skip non-MD5 groups
        selectOptimal(g);
        count++;
      });
      updateAll();
      saveOverrides().then(() => toast(count + ' MD5 groups auto-selected — nothing to review for byte-identical files', 'success', 4000));
      return;
    }
    if (action === 'auto_rename') {
      const visible = getVisible();
      if (!visible.length) { toast('No visible groups', 'info'); return; }

      // Find groups where a removed file has a better name than the kept file
      const proposals = [];
      for (const g of visible) {
        const files = allFiles(g);
        // Find the kept file
        const keptFile = files.find(f => (overrides[f.path] || 'keep') === 'keep');
        if (!keptFile) continue;
        const keptName = baseName(keptFile.path);
        const keptScore = nameScore(keptName);

        // Find the best-named non-kept file
        let bestAlt = null, bestAltScore = keptScore;
        for (const f of files) {
          if (f.path === keptFile.path) continue;
          const name = baseName(f.path);
          const score = nameScore(name);
          if (score > bestAltScore) {
            bestAlt = f;
            bestAltScore = score;
          }
        }
        if (bestAlt && bestAltScore > keptScore) {
          proposals.push({
            keptPath: keptFile.path,
            keptName,
            keptScore,
            newName: baseName(bestAlt.path),
            newScore: bestAltScore,
            sourcePath: bestAlt.path,
            checked: true
          });
        }
      }

      if (!proposals.length) {
        toast('No renames needed — all kept files already have the best names', 'info', 3000);
        return;
      }

      // Show the rename preview overlay
      const overlay = document.getElementById('rename-overlay');
      const list = document.getElementById('rename-list');
      const subtitle = document.getElementById('rename-subtitle');
      const summary = document.getElementById('rename-summary');

      subtitle.textContent = proposals.length + ' groups where a removed file has a better name';

      function renderList() {
        const checked = proposals.filter(p => p.checked).length;
        summary.textContent = checked + ' of ' + proposals.length + ' selected';

        list.innerHTML = proposals.map((p, i) =>
          '<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px">' +
            '<input type="checkbox" ' + (p.checked ? 'checked' : '') + ' data-idx="' + i + '" style="margin-top:3px;flex-shrink:0">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="display:flex;gap:8px;align-items:center">' +
                '<span style="color:var(--red);text-decoration:line-through;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(p.keptName) + '</span>' +
                '<span style="color:var(--text-3)">→</span>' +
                '<span style="color:var(--green);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(p.newName) + '</span>' +
              '</div>' +
              '<div style="font-size:11px;color:var(--text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escH(p.keptPath) + '">' + escH(p.keptPath) + '</div>' +
            '</div>' +
          '</label>'
        ).join('');

        // Wire checkboxes
        list.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.onchange = () => {
            proposals[parseInt(cb.dataset.idx)].checked = cb.checked;
            const c2 = proposals.filter(p => p.checked).length;
            summary.textContent = c2 + ' of ' + proposals.length + ' selected';
          };
        });
      }

      renderList();
      overlay.style.display = 'flex';

      // Wire overlay buttons
      document.getElementById('rename-select-all').onclick = () => { proposals.forEach(p => p.checked = true); renderList(); };
      document.getElementById('rename-deselect-all').onclick = () => { proposals.forEach(p => p.checked = false); renderList(); };
      document.getElementById('rename-cancel').onclick = () => { overlay.style.display = 'none'; };

      document.getElementById('rename-apply').onclick = async () => {
        const selected = proposals.filter(p => p.checked);
        if (!selected.length) { toast('Nothing selected', 'info'); return; }

        let renamed = 0, failed = 0, skipped = 0;
        for (const p of selected) {
          try {
            const r = await fetch('/api/rename', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: p.keptPath, newName: p.newName })
            }).then(r => r.json());
            if (r.ok) {
              renamed++;
              // Update the card display if visible
              const card = document.querySelector('.rev-card[data-path="' + CSS.escape(p.keptPath) + '"]');
              if (card) {
                const nameEl = card.querySelector('.rev-meta-name');
                if (nameEl) nameEl.textContent = p.newName;
              }
            } else { failed++; }
          } catch { failed++; }
        }
        skipped = proposals.length - selected.length;

        overlay.style.display = 'none';
        toast('Renamed: ' + renamed + (skipped ? ', skipped: ' + skipped : '') + (failed ? ', failed: ' + failed : ''), renamed > 0 ? 'success' : 'error', 4000);
      };

      return;
    }
    if (action === 'ignore_visible') {
      // Collect only VISIBLE cards (not hidden by match% filter)
      const visiblePaths = [];
      document.querySelectorAll('.rev-card').forEach(card => {
        if (card.style.display !== 'none' && card.offsetParent !== null) {
          visiblePaths.push(card.dataset.path);
        }
      });
      if (!visiblePaths.length) { toast('No visible cards', 'info'); return; }
      try {
        const r = await fetch('/api/ignore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: visiblePaths })
        }).then(r => r.json());
        toast(visiblePaths.length + ' images added to ignore list', 'success', 3000);
        // Hide them from UI
        document.querySelectorAll('.rev-card').forEach(card => {
          if (visiblePaths.includes(card.dataset.path)) card.style.display = 'none';
        });
      } catch(e) { toast(e.message, 'error'); }
      return;
    }
    if (action === 'select_groups' || action === 'deselect_groups') {
      const sel = action === 'select_groups';
      const vis = getVisible();
      vis.forEach(g => setGroupSelected(g, sel));
      applyFilters();
      persistDeselected();
      toast((sel ? 'Selected ' : 'Deselected ') + vis.length + ' visible groups', 'success', 2000);
      return;
    }
    if (action === 'auto_optimal') {
      getVisible().forEach(g => selectOptimal(g));
      container.querySelectorAll('.rev-card').forEach(card => updateCard(card, card.dataset.path, card.dataset.conf));
      applyFilters();
      saveOverrides().then(() => toast('Auto-selection applied to all visible groups', 'success', 3000));
      return;
    }
    getVisible().forEach(g => {
      const files = allFiles(g);
      if (action==='keep_all')   { files.forEach(f=>{if(!locked[f.path])overrides[f.path]='keep';}); return; }
      if (action==='remove_all') { files.forEach(f=>{if(!locked[f.path])overrides[f.path]='remove';}); return; }
      if (action==='invert')     { files.forEach(f=>{if(!locked[f.path])overrides[f.path]=overrides[f.path]==='keep'?'remove':'keep';}); return; }
      let winner = null;
      if (action==='keep_largest')       winner=files.reduce((a,b)=>(b.size||0)>(a.size||0)?b:a);
      else if(action==='keep_highest_res') winner=files.reduce((a,b)=>((b.width||0)*(b.height||0))>((a.width||0)*(a.height||0))?b:a);
      else if(action==='keep_newest')    winner=files.reduce((a,b)=>(b.mtime||'')>(a.mtime||'')?b:a);
      else if(action==='keep_oldest')    winner=files.reduce((a,b)=>(b.mtime||'')>(a.mtime||'')?a:b);
      else if(action==='keep_reference') winner=files.find(f=>f.isSource)||files[0];
      else if(action==='keep_shortest_name') winner=files.reduce((a,b)=>baseName(b.path).length<baseName(a.path).length?b:a);
      if (winner) files.forEach(f=>{if(!locked[f.path])overrides[f.path]=f.path===winner.path?'keep':'remove';});
    });
    container.querySelectorAll('.rev-card').forEach(c=>updateCard(c,c.dataset.path,c.dataset.conf));
    applyFilters();
  }

  function applyFolderAction(action) {
    const fp = (el('folder-sel-input')?.value||'').trim();
    getVisible().forEach(g => {
      allFiles(g).forEach(f => {
        const hit = fp && (f.path.startsWith(fp) || matchWild(f.path, fp));
        if (!hit && action!=='unlock') return;
        if (action==='keep'   && !locked[f.path]) overrides[f.path]='keep';
        if (action==='remove' && !locked[f.path]) overrides[f.path]='remove';
        if (action==='lock')   { locked[f.path]=true; overrides[f.path]='keep'; }
        if (action==='unlock') locked[f.path]=false;
      });
    });
    container.querySelectorAll('.rev-card').forEach(c=>updateCard(c,c.dataset.path,c.dataset.conf));
    applyFilters();
  }

  function matchWild(s, pat) {
    try { return new RegExp('^'+pat.replace(/[.+^${}()|[\]]/g,'\\$&').replace(/\*/g,'.*')+'$','i').test(s); } catch { return false; }
  }

  async function filterFolderOut() {
    const fp = (el('folder-sel-input')?.value||'').trim();
    if (!fp) { toast('Enter a folder path first','error'); return; }
    if (!await confirm('Filter groups','Remove all groups sourced from "'+fp+'"?','Remove')) return;
    try {
      const r = await API.filterResult(currentFile,'folder',fp);
      toast('Removed '+r.removed+', '+r.remaining+' remain.','success');
      await loadFile(currentFile);
    } catch(e) { toast(e.message,'error'); }
  }

  async function filterFromFile(type, value) {
    const label = value !== undefined ? type + ' ' + value + '%' : type;
    if (!await confirm('Filter groups','Permanently remove all ' + label + ' groups from this result file?','Remove')) return;
    try {
      const r = await API.filterResult(currentFile, type, value);
      toast('Removed ' + r.removed + ', ' + r.remaining + ' remain.', 'success');
      await loadFile(currentFile);
    } catch(e) { toast(e.message, 'error'); }
  }

  // Files moved or deleted outside the app since the scan: drop them from the result
  async function recheckMissing() {
    if (!currentFile) { toast('No result loaded.', 'error'); return; }
    if (!await confirm('Re-check files on disk', 'Check every file in this result still exists?\nMissing files are removed from their groups, and groups with fewer than two files left are removed. This changes the result file.', 'Check')) return;
    try {
      await saveOverrides();
      const r = await API.filterResult(currentFile, 'missing');
      toast(r.missingFiles
        ? r.missingFiles + ' missing files removed · ' + r.removed + ' groups dropped · ' + r.remaining + ' remain'
        : 'All files still on disk — nothing changed', 'success', 5000);
      await loadFile(currentFile);
    } catch(e) { toast(e.message, 'error'); }
  }

  async function saveOverrides() {
    if (!currentFile) return;
    try { await API.saveOverrides(currentFile, overrides, [...deselectedGroups]); toast('Selections saved.','success'); }
    catch(e) { toast(e.message,'error'); }
  }

  async function runActions(dryRun) {
    if (!currentFile) { toast('No result loaded.','error'); return; }
    const actions = {};
    container.querySelectorAll('.action-select').forEach(s => { actions[s.dataset.conf]=s.value; });
    const spec = {
      actions,
      removeTarget: el('remove-target')?.value.trim()||null,
      keepTarget:   el('keep-target')?.value.trim()||null,
      reproduceStructure: el('reproduce-structure')?.checked!==false,
      selections: {...overrides},
      deselectedGroups: [...deselectedGroups],
      deselectFilters: [...deselectFilters],
      locked: Object.keys(locked).filter(p=>locked[p])
    };
    if (!dryRun && Object.values(actions).includes('delete_permanent')) {
      if (!await confirm('⚠ Permanent delete','Files will be permanently deleted — no recovery possible.','Yes, delete permanently')) return;
    }
    const deselNote = deselectedGroups.size ? ' ('+deselectedGroups.size+' deselected groups will be skipped)' : '';
    if (!dryRun && !await confirm('Run actions','Apply to '+getVisible().length+' visible groups?'+deselNote,'Run')) return;
    const res = el('action-result');
    if (res) { res.innerHTML='<div class="text-muted">Running…</div>'; res.classList.remove('hidden'); }
    try {
      await saveOverrides();
      const r = await API.runActions(currentFile, spec, dryRun);
      const s = r.stats;
      const color = dryRun ? 'blue' : (s.errors > 0 ? 'orange' : 'green');
      const label = dryRun ? 'Dry run' : 'Done';
      const skippedNote = (s.skipped||0) > 0 ? ' (locked, deselected, filtered or not on disk)' : '';
      const summary = label + ': ♻' + s.recycled + ' recycled · 📁' + s.moved + ' moved · 🗑' + s.deleted + ' deleted · ✓' + s.kept + ' kept · ⏭' + (s.skipped||0) + ' skipped' + skippedNote + ' · ⚠' + s.errors + ' errors';
      let errDetail = '';
      if (s.errors > 0) {
        errDetail = '<br><small>' + (r.log||[]).filter(l=>l.action==='error').slice(0,5).map(l=>escH(baseName(l.file))+': '+escH(l.reason)).join('<br>') + '</small>';
      }
      const logText = (r.log||[]).map(l => `[${new Date(l.ts).toISOString()}] ${l.action.toUpperCase().padEnd(12)} ${l.file||''}${l.dest?' → '+l.dest:''}${l.reason?' ('+l.reason+')':''}`).join('\n');
      const dlLabel = dryRun ? '↓ Download dry run log' : '↓ Download action log';
      if (res) res.innerHTML = '<div style="padding:8px 12px;border-radius:6px;background:var(--' + color + '-bg);color:var(--' + color + ')">' + summary + errDetail +
        '<div style="margin-top:8px"><button class="btn btn-ghost btn-xs" id="dl-action-log">' + dlLabel + '</button>' +
        (dryRun ? '' : ' &nbsp;<a class="btn btn-ghost btn-xs" href="/api/actions/undo-log/download" download>↓ Full undo log</a>') +
        '</div></div>';
      el('dl-action-log')?.addEventListener('click', () => {
        const blob = new Blob([logText], {type:'text/plain'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = dryRun ? 'dryrun-log.txt' : 'action-log.txt'; a.click();
      });
      if (!dryRun) {
        // Build set of all files that are gone (moved, recycled, deleted, not found on disk)
        const gone = new Set((r.log||[]).filter(l =>
          l.action==='move_remove' || l.action==='recycle' ||
          l.action==='delete'      || l.reason==='not found on disk'
        ).map(l => l.file));

        const before = groups.length;
        groups = groups.filter(g => {
          const files = allFiles(g);
          const removes = files.filter(f => (overrides[f.path]||'keep') === 'remove');
          const keeps   = files.filter(f => (overrides[f.path]||'keep') === 'keep');

          // Retain group if it has multiple keeps — user may still need to decide
          if (keeps.length > 1) return true;

          // Remove group if every file is gone from disk (stale result)
          const allFilesGone = files.every(f => gone.has(f.path));
          if (allFilesGone) return false;

          // Remove group if no removes, but only one keep, and that keep is gone too
          if (removes.length === 0) return true; // nothing to process, keep visible

          // Remove group once all removes are handled
          return !removes.every(f => gone.has(f.path));
        });
        if (groups.length < before) {
          renderGroups();
          toast((before - groups.length) + ' groups cleared — ' + groups.length + ' remaining', 'success', 4000);
        }
        if (s.errors > 0) toast(s.errors + ' files had errors — see log above', 'error', 6000);
        if ((s.skipped||0) > 0 && (s.moved + s.recycled + s.deleted) === 0) {
          toast((s.skipped||0) + ' files not found on disk — result file may be outdated. Run a new scan.', 'info', 8000);
        }
      }
    } catch(e) {
      if (res) res.innerHTML = '<div style="color:var(--red)">Error: ' + escH(e.message) + '</div>';
    }
  }

  async function undoLast() {
    try {
      const log = await API.getUndoLog();
      if (!log.length) { toast('Nothing to undo.','info'); return; }
      const last = log[log.length-1];
      if (!await confirm('Undo','Undo: '+last.action+' on '+baseName(last.from)+'?','Undo')) return;
      const r = await API.undo(log.length-1);
      toast('Restored: '+r.restored,'success');
    } catch(e) { toast(e.message,'error'); }
  }

  function baseName(p) { return (p||'').split(/[\\/]/).pop(); }
  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { init, refresh, _loadFile: loadFile };
})();
