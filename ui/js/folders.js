/* folders.js — Epic 2: Folder management */

const Page_folders = (() => {
  let config = null;

  async function init(container) {
    if (container.querySelector('#folder-list')) { config = await API.getConfig(); render(); return; }
    container.innerHTML = `
      <div class="page-title">Folders</div>
      <div class="page-subtitle">Add folders to scan. Drag to set priority — top folder wins on exact matches.</div>

      <div class="card">
        <div class="section-title">Add folder</div>
        <div class="input-group">
          <input id="folder-input" class="input" type="text" placeholder="Paste path or use Browse button…">
          <button class="btn btn-ghost" id="folder-add-btn">Add</button>
          <button class="btn btn-primary" id="folder-browse-btn">＋ Browse for folder</button>
        </div>
        <div class="text-muted text-sm mt-2">Separate multiple paths with semicolons or new lines</div>
      </div>

      <div class="section-title">Configured folders <span id="folder-count" class="tag"></span></div>
      <div id="folder-list" class="folder-list"></div>

      <div id="folder-empty" class="empty-state hidden">
        <div style="font-size:32px">📁</div>
        <p>No folders added yet. Add a folder above to get started.</p>
      </div>
    `;

    el('folder-browse-btn').addEventListener('click', browsePick);
    el('folder-add-btn').addEventListener('click', addFromInput);
    el('folder-input').addEventListener('keydown', e => { if (e.key === 'Enter') addFromInput(); });

    config = await API.getConfig();
    render();
    makeSortable(el('folder-list'), onReorder);
  }

  async function browsePick() {
    try {
      const { path, unsupported } = await API.pickFolder();
      if (unsupported) {
        toast('Native folder picker is only available on Windows. Please type the path.', 'info');
        return;
      }
      if (path) {
        addFolder(path);
      }
    } catch (e) {
      toast('Could not open folder picker: ' + e.message, 'error');
    }
  }

  function addFromInput() {
    const raw = el('folder-input').value.trim();
    if (!raw) return;
    // Support semicolons and newlines
    const paths = raw.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    paths.forEach(addFolder);
    el('folder-input').value = '';
  }

  function addFolder(path) {
    if (!config) { toast('Still loading — please wait a moment.', 'info'); return; }
    if (!config.folders) config.folders = [];
    if (config.folders.some(f => f.path === path)) {
      toast(`${path} is already in the list.`, 'info');
      return;
    }
    config.folders.push({ path, active: true, recursive: true });
    save();
    render();
  }

  function render() {
    const list = el('folder-list');
    const empty = el('folder-empty');
    const count = el('folder-count');
    list.innerHTML = '';

    const folders = config.folders || [];
    count.textContent = folders.length;

    if (folders.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    folders.forEach((folder, i) => {
      const row = buildRow(folder, i);
      list.appendChild(row);
    });
  }

  function buildRow(folder, i) {
    const exists = true; // Existence is checked at scan time; show warning if path has warning flag
    const row = document.createElement('div');
    row.className = `folder-row${folder.active === false ? ' disabled' : ''}`;
    row.setAttribute('draggable', 'true');
    row.dataset.index = i;

    row.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="folder-path mono${folder._warn ? ' warn' : ''}" title="${folder.path}">${folder.path}</span>
      <div class="folder-controls">
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
          <input type="checkbox" class="toggle" ${folder.recursive !== false ? 'checked' : ''} data-prop="recursive" title="Include subfolders">
          <span>Recursive</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
          <input type="checkbox" class="toggle" ${folder.active !== false ? 'checked' : ''} data-prop="active" title="Enable this folder">
          <span>Active</span>
        </label>
        <button class="btn btn-ghost btn-sm delete-folder" title="Remove folder">✕</button>
      </div>
    `;

    row.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const prop = cb.dataset.prop;
        config.folders[i][prop] = cb.checked;
        if (prop === 'active') row.classList.toggle('disabled', !cb.checked);
        save();
      });
    });

    row.querySelector('.delete-folder').addEventListener('click', async () => {
      const ok = await confirm('Remove folder', `Remove "${folder.path}" from the list? Files will not be touched.`);
      if (ok) {
        config.folders.splice(i, 1);
        save();
        render();
      }
    });

    return row;
  }

  function onReorder() {
    const rows = qsa('[draggable]', el('folder-list'));
    const reordered = rows.map(r => config.folders[parseInt(r.dataset.index)]).filter(Boolean);
    config.folders = reordered;
    // Re-render to sync indices
    render();
    save();
  }

  async function save() {
    try {
      await API.patchConfig({ folders: config.folders });
    } catch (e) {
      toast('Failed to save: ' + e.message, 'error');
    }
  }

  async function refresh(container) {
    // Always reload from server and re-render on revisit
    config = await API.getConfig();
    render();
  }

  return { init, refresh };
})();
