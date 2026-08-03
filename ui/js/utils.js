/* utils.js — shared helpers */

function el(id) { return document.getElementById(id); }
function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function escH(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstChild;
}

function confirm(title, body, dangerLabel = 'Confirm') {
  return new Promise((resolve) => {
    el('confirm-title').textContent = title;
    el('confirm-body').textContent = body;
    el('confirm-ok').textContent = dangerLabel;
    el('confirm-overlay').classList.remove('hidden');

    const ok = el('confirm-ok');
    const cancel = el('confirm-cancel');

    function cleanup() {
      el('confirm-overlay').classList.add('hidden');
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
    }

    el('confirm-ok').addEventListener('click', () => { cleanup(); resolve(true); }, { once: true });
    el('confirm-cancel').addEventListener('click', () => { cleanup(); resolve(false); }, { once: true });
  });
}

function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(2)} MB`;
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function toast(msg, type = 'info', duration = 3000) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:${el('error-bar')?.classList.contains('hidden') ? '20' : '60'}px;
    right:20px;z-index:250;background:var(--bg-2);border:1px solid var(--border);
    border-radius:6px;padding:10px 16px;font-size:13px;box-shadow:var(--shadow-lg);
    animation:fadeIn 200ms ease;max-width:360px;
  `;
  if (type === 'success') t.style.borderColor = 'var(--green)';
  if (type === 'error') t.style.borderColor = 'var(--red)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// Drag-and-drop list reorder
function makeSortable(listEl, onReorder) {
  let dragSrc = null;

  listEl.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('[draggable]');
    if (dragSrc) { dragSrc.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; }
  });
  listEl.addEventListener('dragend', e => {
    if (dragSrc) dragSrc.style.opacity = '';
    qsa('[draggable]', listEl).forEach(r => r.classList.remove('drag-over'));
  });
  listEl.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('[draggable]');
    if (target && target !== dragSrc) {
      qsa('[draggable]', listEl).forEach(r => r.classList.remove('drag-over'));
      target.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    }
  });
  listEl.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('[draggable]');
    if (target && dragSrc && target !== dragSrc) {
      const items = qsa('[draggable]', listEl);
      const srcIdx = items.indexOf(dragSrc);
      const tgtIdx = items.indexOf(target);
      if (srcIdx < tgtIdx) target.after(dragSrc);
      else target.before(dragSrc);
      target.classList.remove('drag-over');
      onReorder();
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
