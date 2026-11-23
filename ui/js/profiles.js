/* profiles.js — Profile editor modal */
const ProfileEditor = (() => {

  function open(existingProfile, onSave) {
    const isNew = !existingProfile;
    const p = existingProfile || {
      id: 'custom_' + Date.now(),
      name: '',
      description: '',
      scan: {
        algorithms: { dhash: true, phash: true, ahash: false, whash: false, mhash: false, bhash: false },
        thresholds: { dhash: 8, phash: 12, ahash: 10, whash: 10, mhash: 10, bhash: 10 },
        ensureMin: 2,
        matchLogic: 'threshold',
        anchorHash: null
      }
    };

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog" style="max-width:520px;width:100%">
        <div style="font-size:17px;font-weight:700;margin-bottom:16px">${isNew ? 'New profile' : 'Edit profile'}</div>

        <label class="label">Name</label>
        <input id="pe-name" class="input" style="margin-bottom:10px" value="${escH(p.name)}" placeholder="e.g. My strict settings">

        <label class="label">Description</label>
        <input id="pe-desc" class="input" style="margin-bottom:16px" value="${escH(p.description)}" placeholder="What this profile is for">

        <div class="section-title" style="margin-top:0">Algorithms</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${['dhash','phash','ahash','whash','mhash','bhash'].map(a => `
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer">
              <input type="checkbox" id="pe-algo-${a}" ${p.scan.algorithms[a] ? 'checked' : ''}>
              <span style="font-size:13px">${a}</span>
            </label>`).join('')}
        </div>

        <div class="section-title">Thresholds <span class="text-muted" style="font-size:11px;text-transform:none">(bits — lower = stricter)</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:14px">
          ${['dhash','phash','ahash','whash','mhash','bhash'].map(a => `
            <div style="display:flex;align-items:center;gap:8px">
              <label style="font-size:12px;width:48px;color:var(--text-2)">${a}</label>
              <input type="range" id="pe-thresh-${a}" min="0" max="20" value="${p.scan.thresholds[a]??10}"
                style="flex:1" oninput="document.getElementById('pe-tv-${a}').textContent=this.value">
              <span id="pe-tv-${a}" style="font-size:12px;width:20px;text-align:right">${p.scan.thresholds[a]??10}</span>
            </div>`).join('')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label class="label">Ensemble minimum</label>
            <input type="number" id="pe-ensureMin" class="input" min="1" max="6" value="${p.scan.ensureMin??2}" style="width:80px">
          </div>
          <div>
            <label class="label">Match logic</label>
            <select id="pe-matchLogic" class="select">
              <option value="threshold" ${p.scan.matchLogic==='threshold'?'selected':''}>Threshold — enough must match</option>
              <option value="and" ${p.scan.matchLogic==='and'?'selected':''}>AND — all must match</option>
              <option value="or"  ${p.scan.matchLogic==='or'?'selected':''}>OR — any match</option>
            </select>
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-ghost" id="pe-cancel">Cancel</button>
          <button class="btn btn-primary" id="pe-save">Save profile</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#pe-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#pe-save').addEventListener('click', async () => {
      const name = overlay.querySelector('#pe-name').value.trim();
      if (!name) { toast('Name is required', 'error'); return; }

      const algos = {};
      ['dhash','phash','ahash','whash','mhash','bhash'].forEach(a => {
        algos[a] = overlay.querySelector(`#pe-algo-${a}`).checked;
      });
      const thresholds = {};
      ['dhash','phash','ahash','whash','mhash','bhash'].forEach(a => {
        thresholds[a] = parseInt(overlay.querySelector(`#pe-thresh-${a}`).value);
      });

      const saved = {
        id: p.id,
        name,
        description: overlay.querySelector('#pe-desc').value.trim(),
        scan: {
          ...p.scan,
          algorithms: algos,
          thresholds,
          ensureMin: parseInt(overlay.querySelector('#pe-ensureMin').value) || 2,
          matchLogic: overlay.querySelector('#pe-matchLogic').value
        }
      };

      try {
        // Load current custom profiles, add/replace, save
        const all = await API.getProfiles();
        const builtinIds = ['exact_only','strict','balanced','loose','media_library'];
        const custom = all.filter(x => !builtinIds.includes(x.id) && x.id !== saved.id);
        custom.push(saved);
        await API.post('/profiles', custom);
        toast(`Profile "${name}" saved`, 'success');
        overlay.remove();
        onSave?.();
      } catch(e) {
        toast('Save failed: ' + e.message, 'error');
      }
    });
  }

  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { open };
})();
