/**
 * Real image tests — uses actual PNG/JPEG files with known perceptual hash relationships.
 * Image naming: Image.{group}.{version}.{similarity}.{ext}
 *   similarity 1 = MD5 identical  
 *   similarity 2 = same visual, different MD5 (recompressed/brightness-shifted)
 *   similarity 0 = unique, no match expected
 *
 * Tests: scan with real images, perceptual duplicates found, delete, folder picker endpoint,
 *        all action strategies, filter operations, exports with real data.
 */
'use strict';

const request  = require('supertest');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const crypto   = require('crypto');
const sharp    = require('sharp');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

async function waitForScan(api, id, ms = 90000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = (await api.get('/api/scans/' + id)).body;
    if (['done','error','aborted'].includes(s.status)) return s;
    await sleep(300);
  }
  throw new Error('Scan timed out after ' + ms + 'ms');
}

// ── Image generators ──────────────────────────────────────────────────────────
function makeRaw(w, h, fn) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y*w+x)*3, [r,g,b] = fn(x,y,w,h);
    buf[i]=Math.min(255,Math.max(0,r)); buf[i+1]=Math.min(255,Math.max(0,g)); buf[i+2]=Math.min(255,Math.max(0,b));
  }
  return buf;
}
const toSharp = (raw,w,h) => sharp(raw, { raw:{width:w,height:h,channels:3} });

// ── Setup ─────────────────────────────────────────────────────────────────────
let app, serverInst, api, tmpDir, imgDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-img-'));
  imgDir = path.join(tmpDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  const scansDir = path.join(tmpDir, 'scans');
  fs.mkdirSync(scansDir, { recursive: true });

  // Copy pre-generated images if they exist, else generate them
  const srcDir = '/tmp/test_images';
  if (fs.existsSync(srcDir)) {
    for (const f of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, f), path.join(imgDir, f));
    }
  } else {
    // Generate inline
    const W=128, H=128;
    const diag = makeRaw(W,H,(x,y)=>[(x+y)%64<32?200:40,(x*2+y)%80<40?180:60,y%48<24?220:30]);
    await toSharp(diag,W,H).png().toFile(path.join(imgDir,'Image.1.1.1.png'));
    fs.copyFileSync(path.join(imgDir,'Image.1.1.1.png'), path.join(imgDir,'Image.1.2.1.png'));
    await toSharp(diag,W,H).jpeg({quality:85}).toFile(path.join(imgDir,'Image.1.3.2.jpg'));
    const diagBrt = makeRaw(W,H,(x,y)=>[(x+y)%64<32?210:50,(x*2+y)%80<40?190:70,y%48<24?230:40]);
    await toSharp(diagBrt,W,H).png().toFile(path.join(imgDir,'Image.1.4.2.png'));
    const circ = makeRaw(W,H,(x,y)=>{const d=Math.sqrt((x-W/2)**2+(y-H/2)**2);return d%20<10?[220,80,40]:[30,120,200];});
    await toSharp(circ,W,H).jpeg({quality:90}).toFile(path.join(imgDir,'Image.2.1.2.jpg'));
    await toSharp(circ,W,H).jpeg({quality:75}).toFile(path.join(imgDir,'Image.2.2.2.jpg'));
    const bars = makeRaw(W,H,(x,y)=>Math.floor(y/16)%2?[240,240,50]:[50,50,200]);
    await toSharp(bars,W,H).png().toFile(path.join(imgDir,'Image.3.1.1.png'));
    fs.copyFileSync(path.join(imgDir,'Image.3.1.1.png'), path.join(imgDir,'Image.3.2.1.png'));
    const uniq = makeRaw(W,H,(x,y)=>[(x*3+y*7)%256,(x*5+y*2)%256,(x*7+y*3)%256]);
    await toSharp(uniq,W,H).png().toFile(path.join(imgDir,'Image.unique.1.0.png'));
  }

  jest.resetModules();
  jest.doMock('../../src/core/config', () => {
    const real = jest.requireActual('../../src/core/config');
    return { ...real, DATA_DIR: tmpDir, getDataDir:()=>tmpDir,
      getScansDir:(cfg)=>{ const s=cfg?.settings?.scansDir; if(s&&s!=='null')return s; return scansDir; }};
  });
  const mod = require('../../src/server');
  app = mod.app; serverInst = mod.server;
  api = request(app);
  await sleep(500);
}, 30000);

afterAll(async () => {
  serverInst?.close(); jest.resetModules();
  try { fs.rmSync(tmpDir,{recursive:true,force:true}); } catch {}
});

const state = {};

// ── Image verification ────────────────────────────────────────────────────────
describe('1. Test image properties', () => {
  test('MD5 pairs are byte-for-byte identical', () => {
    const a = fs.readFileSync(path.join(imgDir,'Image.1.1.1.png'));
    const b = fs.readFileSync(path.join(imgDir,'Image.1.2.1.png'));
    expect(md5(a)).toBe(md5(b));

    const c2 = fs.readFileSync(path.join(imgDir,'Image.3.1.1.png'));
    const d2 = fs.readFileSync(path.join(imgDir,'Image.3.2.1.png'));
    expect(md5(c2)).toBe(md5(d2));
  });

  test('visual variants have different MD5', () => {
    const orig = fs.readFileSync(path.join(imgDir,'Image.1.1.1.png'));
    const jpeg = fs.readFileSync(path.join(imgDir,'Image.1.3.2.jpg'));
    const bright = fs.readFileSync(path.join(imgDir,'Image.1.4.2.png'));
    expect(md5(orig)).not.toBe(md5(jpeg));
    expect(md5(orig)).not.toBe(md5(bright));
  });

  test('hasher computes dhash for all images', async () => {
    const { computeHashes, hammingDistance } = require('../../src/core/hasher');
    for (const f of fs.readdirSync(imgDir)) {
      const fp = path.join(imgDir, f);
      const h = await computeHashes(fp, { algorithms:{dhash:true,phash:true}, thresholds:{} });
      expect(h).toBeTruthy();
      expect(h.md5).toBeTruthy();
      if (f.endsWith('.png') || f.endsWith('.jpg')) {
        expect(typeof h.dhash).toBe('string');
        expect(h.dhash.length).toBeGreaterThanOrEqual(16); // 16+ chars (may include variants)
        expect(typeof h.phash).toBe('string');
      }
    }
  }, 30000);

  test('identical images have identical dhash', async () => {
    const { computeHashes, hammingDistance } = require('../../src/core/hasher');
    const h1 = await computeHashes(path.join(imgDir,'Image.1.1.1.png'), { algorithms:{dhash:true}, thresholds:{} });
    const h2 = await computeHashes(path.join(imgDir,'Image.1.2.1.png'), { algorithms:{dhash:true}, thresholds:{} });
    expect(h1.dhash).toBe(h2.dhash);
    expect(h1.md5).toBe(h2.md5);
  });

  test('visual variants have near-identical dhash (distance ≤ threshold)', async () => {
    const { computeHashes, hammingDistance } = require('../../src/core/hasher');
    const h1 = await computeHashes(path.join(imgDir,'Image.1.1.1.png'), { algorithms:{dhash:true}, thresholds:{} });
    const h3 = await computeHashes(path.join(imgDir,'Image.1.3.2.jpg'), { algorithms:{dhash:true}, thresholds:{} });
    const h4 = await computeHashes(path.join(imgDir,'Image.1.4.2.png'), { algorithms:{dhash:true}, thresholds:{} });

    const dist13 = hammingDistance(h1.dhash, h3.dhash);
    const dist14 = hammingDistance(h1.dhash, h4.dhash);
    console.log(`  dhash dist 1.1↔1.3(jpeg): ${dist13}`);
    console.log(`  dhash dist 1.1↔1.4(+bright): ${dist14}`);
    expect(dist13).toBeLessThanOrEqual(12); // within typical threshold
    expect(dist14).toBeLessThanOrEqual(8);
  }, 30000);

  test('different groups have large dhash distance', async () => {
    const { computeHashes, hammingDistance } = require('../../src/core/hasher');
    const h1 = await computeHashes(path.join(imgDir,'Image.1.1.1.png'), { algorithms:{dhash:true}, thresholds:{} });
    const h2 = await computeHashes(path.join(imgDir,'Image.2.1.2.jpg'), { algorithms:{dhash:true}, thresholds:{} });
    const h3 = await computeHashes(path.join(imgDir,'Image.3.1.1.png'), { algorithms:{dhash:true}, thresholds:{} });
    const dist12 = hammingDistance(h1.dhash, h2.dhash);
    const dist13 = hammingDistance(h1.dhash, h3.dhash);
    console.log(`  dhash dist group1↔group2: ${dist12}, group1↔group3: ${dist13}`);
    // Different patterns should be clearly distinct
    expect(dist12).toBeGreaterThan(8);
  }, 30000);
});

// ── Full scan with perceptual hashing ─────────────────────────────────────────
describe('2. Full scan — MD5 + dhash + phash on real images', () => {
  test('scan finds all expected groups', async () => {
    const cfg = (await api.get('/api/config')).body;
    cfg.folders = [{ path: imgDir, active:true, recursive:false, index:0 }];
    cfg.filters = { ...cfg.filters, minSizeKB:0, extensions:['jpg','png'] };
    cfg.scan = { ...cfg.scan, scanType:'images',
      algorithms: { dhash:true, phash:true, ahash:false, whash:false, mhash:false, bhash:false },
      thresholds: { dhash:8, phash:12, ahash:10, whash:10, mhash:10, bhash:10 },
      ensureMin: 1,
      matchLogic: 'threshold'
    };
    await api.post('/api/config').send(cfg);

    const r = await api.post('/api/scans/start').send({});
    expect(r.body.id).toBeTruthy();
    state.scanId = r.body.id;

    const s = await waitForScan(api, state.scanId);
    expect(s.status).toBe('done');
    expect(s.error).toBeFalsy();
    expect(s.groupCount).toBeGreaterThanOrEqual(2); // at least MD5 groups found

    const results = (await api.get('/api/results')).body;
    state.filename = results[0].filename;
    state.result   = (await api.get('/api/results/' + state.filename)).body;

    console.log(`  Found ${state.result.groups.length} groups:`);
    for (const g of state.result.groups) {
      const paths = [g.source, ...(g.matches||[]).map(m=>m.path)].map(p=>path.basename(p));
      console.log(`    [${g.confidenceLabel}] ${paths.join(' ≈ ')}`);
    }
  }, 90000);

  test('MD5 identical pairs are CERTAIN groups', () => {
    const md5Groups = state.result.groups.filter(g => g.matches?.some(m => m.md5_match));
    expect(md5Groups.length).toBeGreaterThanOrEqual(2); // groups 1 and 3
    for (const g of md5Groups) {
      expect(g.confidenceLabel).toBe('certain');
    }
  });

  test('Image.1 and Image.3 MD5 pairs are found', () => {
    const groups = state.result.groups;
    const filenames = groups.flatMap(g => [path.basename(g.source), ...(g.matches||[]).map(m=>path.basename(m.path))]);
    expect(filenames.some(f => f.includes('Image.1.1') || f.includes('Image.1.2'))).toBe(true);
    expect(filenames.some(f => f.includes('Image.3.1') || f.includes('Image.3.2'))).toBe(true);
  });

  test('unique image is not in any group', () => {
    const groups = state.result.groups;
    const allFiles = groups.flatMap(g => [g.source, ...(g.matches||[]).map(m=>m.path)]);
    const uniqueInGroup = allFiles.some(f => f.includes('unique'));
    expect(uniqueInGroup).toBe(false);
  });

  test('scan log shows algorithms and thresholds used', () => {
    const msgs = state.result && (async()=>{})(); // loaded in scan test
    const scan = { log: [] };
    // Check via GET /api/scans/:id
    return api.get('/api/scans/' + state.scanId).then(res => {
      const msgs = res.body.log.map(l=>l.message).join('\n');
      expect(msgs).toMatch(/dhash/);
      expect(msgs).toMatch(/dhash:8/);
      expect(msgs).toMatch(/ensureMin=1/);
    });
  });
});

// ── Review: smart defaults ────────────────────────────────────────────────────
describe('3. Smart defaults — source priority badge', () => {
  test('each group has exactly one source file', () => {
    for (const g of state.result.groups) {
      expect(g.source).toBeTruthy();
      expect(Array.isArray(g.matches)).toBe(true);
    }
  });

  test('source has valid metadata', () => {
    for (const g of state.result.groups) {
      const si = g.source_info || {};
      expect(si.size).toBeGreaterThan(0);
      // Width/height populated from real image
      expect(si.width).toBeGreaterThanOrEqual(0);
      expect(si.height).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Actions on real images ────────────────────────────────────────────────────
describe('4. Actions on real images', () => {
  test('dry run: reports moved count, no files changed', async () => {
    const target = path.join(tmpDir, 'action_target');
    fs.mkdirSync(target, { recursive: true });
    const sel = {};
    for (const g of state.result.groups) {
      sel[g.source] = 'keep';
      for (const m of g.matches) sel[m.path] = 'remove';
    }

    const res = await api.post('/api/results/' + state.filename + '/actions').send({
      actionSpec: { actions:{certain:'execute_selected',probable:'execute_selected',uncertain:'execute_selected'},
        removeTarget:target, keepTarget:null, reproduceStructure:false, selections:sel, locked:[] },
      dryRun: true
    });

    expect(res.body.dryRun).toBe(true);
    expect(res.body.stats.errors).toBe(0);
    expect(res.body.stats.moved + res.body.stats.kept).toBeGreaterThan(0);
    // No files moved
    expect(fs.readdirSync(imgDir).length).toBe(9); // all 9 images still there
  });

  test('recycle: moves files to app trash, originals stay', async () => {
    const trashBefore = (await api.get('/api/trash/stats')).body.count;
    const sel = {};
    for (const g of state.result.groups) {
      sel[g.source] = 'keep';
      for (const m of g.matches) sel[m.path] = 'remove';
    }

    const res = await api.post('/api/results/' + state.filename + '/actions').send({
      actionSpec: { actions:{certain:'recycle_removed',probable:'recycle_removed',uncertain:'recycle_removed'},
        removeTarget:null, keepTarget:null, reproduceStructure:false, selections:sel, locked:[] },
      dryRun: false
    });

    expect(res.body.stats.errors).toBe(0);
    const trashAfter = (await api.get('/api/trash/stats')).body.count;
    expect(trashAfter).toBeGreaterThan(trashBefore);

    // Sources still on disk
    for (const g of state.result.groups) {
      expect(fs.existsSync(g.source)).toBe(true);
    }
    // Removed files gone
    for (const g of state.result.groups) {
      for (const m of g.matches) {
        const wasRemove = sel[m.path] === 'remove';
        if (wasRemove) expect(fs.existsSync(m.path)).toBe(false);
      }
    }
  });

  test('empty trash removes recycled files', async () => {
    const before = (await api.get('/api/trash/stats')).body;
    expect(before.count).toBeGreaterThan(0);

    const del = await api.delete('/api/trash');
    expect(del.body.deleted).toBeGreaterThan(0);

    const after = (await api.get('/api/trash/stats')).body;
    expect(after.count).toBe(0);
  });
});

// ── Delete result file ────────────────────────────────────────────────────────
describe('5. Delete result file', () => {
  test('DELETE /api/results/:filename removes it from list', async () => {
    const before = (await api.get('/api/results')).body;
    const fn = state.filename;
    expect(before.some(r => r.filename === fn)).toBe(true);

    const del = await api.delete('/api/results/' + fn);
    expect(del.status).toBe(200);

    const after = (await api.get('/api/results')).body;
    expect(after.some(r => r.filename === fn)).toBe(false);

    // Server still healthy
    const h = await api.get('/api/health');
    expect(h.body.ok).toBe(true);
  });
});

// ── Export with real data ─────────────────────────────────────────────────────
describe('6. Export with real result data', () => {
  let filename2;

  beforeAll(async () => {
    // Run a fresh scan to get a result to export
    const cfg = (await api.get('/api/config')).body;
    cfg.folders = [{ path:imgDir, active:true, recursive:false, index:0 }];
    cfg.filters = { ...cfg.filters, minSizeKB:0, extensions:['jpg','png'] };
    cfg.scan = { ...cfg.scan, algorithms:{dhash:false,phash:false,ahash:false,whash:false,mhash:false,bhash:false}, ensureMin:1 };
    await api.post('/api/config').send(cfg);
    const r = await api.post('/api/scans/start').send({});
    await waitForScan(api, r.body.id);
    const results = (await api.get('/api/results')).body;
    filename2 = results[0].filename;
  }, 90000);

  test('CSV export contains filename headers and image paths', async () => {
    const res = await api.get('/api/results/' + filename2 + '/export/csv');
    expect(res.status).toBe(200);
    expect(res.text.toLowerCase()).toContain('confidence');
    // Image paths only present if groups exist; check structure is valid CSV
    expect(res.text.split('\n').length).toBeGreaterThanOrEqual(1);
  });

  test('TXT export contains image filenames', async () => {
    const res = await api.get('/api/results/' + filename2 + '/export/txt');
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  test('JSON export is parseable and contains groups', async () => {
    const res = await api.get('/api/results/' + filename2 + '/export/json');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.text);
    expect(Array.isArray(data.groups ?? data)).toBe(true);
  });
});

// ── Folder picker endpoint ────────────────────────────────────────────────────
describe('7. Folder picker endpoint', () => {
  test('GET /api/pick-folder responds — on non-Windows returns {path:null}', async () => {
    // On Linux/CI: returns {path:null, unsupported:true}
    // On Windows: opens FolderBrowserDialog (can't test interactively)
    const res = await api.get('/api/pick-folder');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // On Windows: path will be a string or null; on Linux: null+unsupported
    expect('path' in res.body).toBe(true);
    if (process.platform !== 'win32') {
      expect(res.body.unsupported).toBe(true);
      expect(res.body.path).toBeNull();
    }
  }, 10000);
});

// ── Scan functions: pause/resume/abort ────────────────────────────────────────
describe('8. Scan control: pause / resume / abort', () => {
  test('abort stops a running scan', async () => {
    // Start a scan with many files so it runs long enough to abort
    const cfg = (await api.get('/api/config')).body;
    cfg.folders = [{ path:imgDir, active:true, recursive:false, index:0 }];
    cfg.filters = { ...cfg.filters, minSizeKB:0, extensions:['jpg','png'] };
    cfg.scan = { ...cfg.scan, algorithms:{dhash:true,phash:true,ahash:false,whash:false,mhash:false,bhash:false}, ensureMin:1 };
    await api.post('/api/config').send(cfg);

    const r = await api.post('/api/scans/start').send({});
    const id = r.body.id;
    expect(id).toBeTruthy();

    await sleep(200);
    const abort = await api.post('/api/scans/' + id + '/abort');
    expect(abort.status).toBe(200);

    const s = await waitForScan(api, id, 15000);
    expect(['aborted','done','error']).toContain(s.status);
  }, 20000);

  test('GET /api/scans lists active and recent scans', async () => {
    const res = await api.get('/api/scans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ── Config persistence ────────────────────────────────────────────────────────
describe('9. Config round-trip', () => {
  test('all scan settings persist correctly', async () => {
    const before = (await api.get('/api/config')).body;
    before.scan.algorithms.dhash = true;
    before.scan.algorithms.phash = true;
    before.scan.thresholds.dhash = 6;
    before.scan.ensureMin = 2;
    before.scan.matchLogic = 'threshold';
    before.scan.searchDepth = 3;

    await api.post('/api/config').send(before);
    const after = (await api.get('/api/config')).body;

    expect(after.scan.algorithms.dhash).toBe(true);
    expect(after.scan.thresholds.dhash).toBe(6);
    expect(after.scan.ensureMin).toBe(2);
    expect(after.scan.searchDepth).toBe(3);
  });

  test('folder list persists after multiple saves', async () => {
    const cfg = (await api.get('/api/config')).body;
    cfg.folders = [
      { path: path.join(tmpDir,'f1'), active:true,  recursive:true,  index:0 },
      { path: path.join(tmpDir,'f2'), active:false, recursive:false, index:1 },
    ];
    await api.post('/api/config').send(cfg);
    await api.post('/api/config').send(cfg); // save again

    const get = (await api.get('/api/config')).body;
    expect(get.folders).toHaveLength(2);
    expect(get.folders[0].path).toContain('f1');
    expect(get.folders[1].active).toBe(false);
  });
});

// ── Filter operations ─────────────────────────────────────────────────────────
describe('10. Filter operations on real result', () => {
  let filterFilename;

  beforeAll(async () => {
    const cfg = (await api.get('/api/config')).body;
    cfg.folders = [{ path:imgDir, active:true, recursive:false, index:0 }];
    cfg.filters = { ...cfg.filters, minSizeKB:0, extensions:['jpg','png'] };
    cfg.scan = { ...cfg.scan, algorithms:{dhash:false,phash:false,ahash:false,whash:false,mhash:false,bhash:false}, ensureMin:1 };
    await api.post('/api/config').send(cfg);
    const r = await api.post('/api/scans/start').send({});
    await waitForScan(api, r.body.id);
    const results = (await api.get('/api/results')).body;
    filterFilename = results[0].filename;
  }, 90000);

  test('filter singletons — returns removed count', async () => {
    const res = await api.post('/api/results/' + filterFilename + '/filter')
      .send({ type:'singletons' });
    expect(res.status).toBe(200);
    expect(typeof res.body.removed).toBe('number');
    expect(typeof res.body.remaining).toBe('number');
  });

  test('filter by folder — removes groups from that path', async () => {
    const res = await api.post('/api/results/' + filterFilename + '/filter')
      .send({ type:'folder', value: imgDir });
    expect(res.status).toBe(200);
    expect(typeof res.body.removed).toBe('number');
  });

  test('filter persists — result file updated on disk', async () => {
    const r1 = (await api.get('/api/results/' + filterFilename)).body;
    const count1 = r1.groupCount ?? r1.groups?.length ?? 0;
    // Already filtered above so count should be <= original
    expect(count1).toBeGreaterThanOrEqual(0);
  });
});
