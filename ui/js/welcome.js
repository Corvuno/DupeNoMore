/* welcome.js — the main-area empty state.
 * Shown when no scan is loaded. Guides a first-time user and gives returning
 * users a one-glance summary + quick actions.
 */

const Page_welcome = (() => {
  async function init(container) { render(container); }
  async function refresh(container) { render(container); }

  async function render(container) {
    let resultCount = 0, folderCount = 0;
    try { resultCount = (await API.getResults()).length; } catch {}
    try { const cfg = await API.getConfig(); folderCount = (cfg.folders || []).length; } catch {}

    const firstTime = folderCount === 0 && resultCount === 0;

    container.innerHTML = `
      <div class="welcome">
        <div class="welcome-logo">◈</div>
        <h1 class="welcome-h1">${firstTime ? 'Welcome to DupeNoMore' : 'Ready when you are'}</h1>
        <p class="welcome-sub">${firstTime
          ? 'Find and clean up duplicate photos and videos across your folders — without deleting anything by accident.'
          : 'Set up a new scan on the left, or open a previous scan to keep reviewing.'}</p>

        ${firstTime ? `
          <div class="welcome-steps">
            <div class="welcome-step">
              <div class="welcome-step-num">1</div>
              <div><b>Add your folders</b><br><span>Point DupeNoMore at the folders holding your images and videos.</span></div>
            </div>
            <div class="welcome-step">
              <div class="welcome-step-num">2</div>
              <div><b>Pick how thorough</b><br><span>Choose a scan intensity — from "exact copies only" to "find everything similar".</span></div>
            </div>
            <div class="welcome-step">
              <div class="welcome-step-num">3</div>
              <div><b>Review &amp; clean up</b><br><span>Compare duplicates side by side and choose what to keep. Nothing is deleted until you say so.</span></div>
            </div>
          </div>
          <button class="btn btn-primary welcome-cta" id="welcome-start">Add folders to begin →</button>
        ` : `
          <div class="welcome-stats">
            <div class="welcome-stat"><div class="welcome-stat-n">${folderCount}</div><div class="welcome-stat-l">folders configured</div></div>
            <div class="welcome-stat"><div class="welcome-stat-n">${resultCount}</div><div class="welcome-stat-l">saved scans</div></div>
          </div>
          <div class="welcome-actions">
            <button class="btn btn-primary" id="welcome-scan">▶ Start a new scan</button>
          </div>
        `}

        <div class="welcome-safety">
          🛡 Your files are safe: removed duplicates go to a recoverable trash, and you can preview every change before it happens.
        </div>
      </div>
    `;

    container.querySelector('#welcome-start')?.addEventListener('click', () => {
      Shell.openSetup();
      setTimeout(() => { const inp = el('mount-folders')?.querySelector('input'); if (inp) inp.focus(); }, 100);
    });

    container.querySelector('#welcome-scan')?.addEventListener('click', async () => {
      try { Shell.openRun(); await API.startScan(); }
      catch (e) { toast(e.message, 'error'); if (e.message.toLowerCase().includes('folder')) Shell.openSetup(); }
    });
  }

  return { init, refresh };
})();
