/* shell.js — single full-width workspace with a top bar.
 * Views (setup / run / review / settings / search / files / welcome) each take
 * the full content width. History lives in a drawer that slides down from the
 * top bar, so it never competes with content for space.
 */

const Shell = (() => {
  let view = 'welcome';
  const mounted = {};

  const VIEWS = {
    welcome:  { el: 'mount-welcome',  mod: () => Page_welcome },
    setup:    { el: 'mount-setup',    mod: null },
    run:      { el: 'mount-run',      mod: () => Page_run },
    review:   { el: 'mount-review',   mod: () => Page_review },
    settings: { el: 'mount-settings', mod: () => Page_settings },
    search:   { el: 'mount-search',   mod: () => Page_search },
    files:    { el: 'mount-files',    mod: () => Page_files },
  };

  function show(v) {
    closeDrawer();
    Object.values(VIEWS).forEach(m => el(m.el)?.classList.add('hidden'));
    const t = VIEWS[v];
    if (!t) return;
    el(t.el).classList.remove('hidden');
    view = v;

    const mod = t.mod && t.mod();
    if (mod) {
      if (v === 'welcome') mod.init(el(t.el));
      else if (!mounted[v]) { mod.init(el(t.el)); mounted[v] = true; }
      else if (mod.refresh) mod.refresh(el(t.el));
    }
    el('tb-new')?.classList.toggle('active', v === 'setup');
    el('tb-settings')?.classList.toggle('active', v === 'settings');
    el('tb-search')?.classList.toggle('active', v === 'search');
    el('content')?.scrollTo?.(0, 0);
  }

  let setupMounted = false;
  function openSetup() {
    show('setup');
    if (!setupMounted) {
      Page_folders.init(el('mount-folders'));
      Page_scan.init(el('mount-scan'));
      setupMounted = true;
    } else {
      Page_folders.refresh?.(el('mount-folders'));
      Page_scan.refresh?.(el('mount-scan'));
    }
  }

  let drawerOpen = false;
  function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }
  function openDrawer() {
    el('history-drawer')?.classList.remove('hidden');
    el('drawer-scrim')?.classList.remove('hidden');
    el('tb-recent')?.classList.add('active');
    drawerOpen = true;
    History.refresh();
    setTimeout(() => el('history-search')?.focus(), 50);
  }
  function closeDrawer() {
    el('history-drawer')?.classList.add('hidden');
    el('drawer-scrim')?.classList.add('hidden');
    el('tb-recent')?.classList.remove('active');
    drawerOpen = false;
  }

  function openReview(file) {
    show('review');
    if (file && Page_review._loadFile) Page_review._loadFile(file);
  }
  function openRun()     { show('run'); }
  function openWelcome() { show('welcome'); }

  return { show, openSetup, openReview, openRun, openWelcome,
           toggleDrawer, openDrawer, closeDrawer, current: () => view };
})();

const Nav = {
  go(page) {
    switch (page) {
      case 'review':   Shell.openReview(); break;
      case 'run':      Shell.openRun(); break;
      case 'results':  Shell.openDrawer(); break;
      case 'folders':
      case 'scan':     Shell.openSetup(); break;
      case 'settings': Shell.show('settings'); break;
      case 'search':   Shell.show('search'); break;
      case 'files':    Shell.show('files'); break;
      default:         Shell.openWelcome();
    }
  },
  register() {}, registerRef() {}, current: () => Shell.current(),
};

const Theme = (() => {
  const apply = t => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('theme', t); } catch {} };
  const current = () => document.documentElement.getAttribute('data-theme') || 'dark';
  return { apply, current, toggle: () => apply(current() === 'dark' ? 'light' : 'dark'),
           init: () => apply((() => { try { return localStorage.getItem('theme'); } catch { return null; } })() || 'dark') };
})();

async function startScanFlow() {
  try { Shell.openRun(); await API.startScan(); }
  catch (e) { toast(e.message, 'error', 5000); if (/folder/i.test(e.message)) Shell.openSetup(); }
}

document.addEventListener('DOMContentLoaded', async () => {
  Theme.init();
  el('theme-toggle')?.addEventListener('click', Theme.toggle);
  el('tb-home')?.addEventListener('click', () => Shell.openWelcome());
  el('tb-new')?.addEventListener('click', () => Shell.openSetup());
  el('tb-recent')?.addEventListener('click', () => Shell.toggleDrawer());
  el('tb-live')?.addEventListener('click', () => Shell.openRun());
  el('tb-settings')?.addEventListener('click', () => Shell.show(Shell.current() === 'settings' ? 'welcome' : 'settings'));
  el('tb-search')?.addEventListener('click', () => Shell.show(Shell.current() === 'search' ? 'welcome' : 'search'));
  el('hd-close')?.addEventListener('click', () => Shell.closeDrawer());
  el('drawer-scrim')?.addEventListener('click', () => Shell.closeDrawer());
  el('hd-more')?.addEventListener('click', (e) => History.showAdvanced(e.currentTarget));
  el('setup-scan-btn')?.addEventListener('click', startScanFlow);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') Shell.closeDrawer(); });

  // ── Live scan indicator in the top bar ──
  const liveBtn = el('tb-live'), liveLabel = el('tb-live-label');
  const activeScans = new Map();
  function refreshLive() {
    const running = [...activeScans.values()].filter(s => s && (s.status === 'running' || s.status === 'paused'));
    if (running.length) {
      liveBtn?.classList.remove('hidden');
      const s = running[0];
      const pct = s.progress?.total ? Math.round((s.progress.current / s.progress.total) * 100) : null;
      const verb = s.status === 'paused' ? 'Paused' : 'Scanning';
      if (liveLabel) liveLabel.textContent = running.length > 1 ? `${running.length} scans…` : (pct != null ? `${verb} ${pct}%` : `${verb}…`);
    } else {
      liveBtn?.classList.add('hidden');
    }
  }
  function onScanState(st) {
    if (!st || !st.id) return;
    if (st.status === 'done' || st.status === 'error' || st.status === 'aborted') {
      activeScans.delete(st.id);
      if (st.status === 'done') History.refresh();
    } else {
      activeScans.set(st.id, st);
    }
    refreshLive();
  }
  ['scan:started','scan:progress','scan:log','scan:done','scan:error','scan:paused','scan:resumed','scan:aborted']
    .forEach(ev => WS.on(ev, m => onScanState(m?.state)));
  WS.on('init', m => { (m?.scans || []).forEach(onScanState); });

  Page_run.setup();   // Run page listens from the start, not only once it is opened
  WS.connect();
  try {
    const health = await API.get('/health');
    if (health.version) el('app-version').textContent = `v${health.version.split('.').slice(0,2).join('.')}`;
  } catch {}

  History.init(el('mount-history'));
  Shell.openWelcome();
});
