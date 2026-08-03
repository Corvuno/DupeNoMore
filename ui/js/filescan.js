/* filescan.js — File scanning is now integrated into the main Scan workflow.
   This page redirects to Scan settings with 'Files' type pre-selected. */
const Page_files = (() => {
  function init(container) {
    container.innerHTML = `
      <div class="page-title">File Scan</div>
      <div class="page-subtitle">File scanning is now integrated into the main scan workflow.</div>
      <div class="settings-section" style="max-width:480px">
        <div style="font-size:14px;margin-bottom:16px">
          To scan files, go to <b>Scan</b> settings and choose your scan type:
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
          <div style="padding:10px 14px;background:var(--bg-3);border-radius:6px;border:1px solid var(--border)">
            <div style="font-weight:600">🖼 Images</div>
            <div class="text-muted text-sm">Perceptual hash scan for image duplicates</div>
          </div>
          <div style="padding:10px 14px;background:var(--bg-3);border-radius:6px;border:1px solid var(--border)">
            <div style="font-weight:600">📄 Files</div>
            <div class="text-muted text-sm">MD5, copy patterns, wildcards, version groups for any file type</div>
          </div>
          <div style="padding:10px 14px;background:var(--bg-3);border-radius:6px;border:1px solid var(--border)">
            <div style="font-weight:600">🖼+📄 Both</div>
            <div class="text-muted text-sm">Image scan + file scan in one run</div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="Nav.go('scan')">→ Go to Scan settings</button>
      </div>
    `;
  }
  function refresh(c) { init(c); }
  return { init, refresh };
})();
