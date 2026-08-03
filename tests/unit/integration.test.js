/**
 * Integration tests — every critical path tested against a real server instance.
 * These catch the class of bugs that kept breaking the app.
 */
'use strict';
const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// ── Test setup ────────────────────────────────────────────────────────────────
let app, server, tmpDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-int-'));
  // Point config to temp dir so tests don't touch real data
  process.env.DNM_DATA_DIR = tmpDir;
  process.env.DNM_SCANS_DIR = path.join(tmpDir, 'scans');
  fs.mkdirSync(process.env.DNM_SCANS_DIR, { recursive: true });

  // Override config module DATA_DIR
  jest.resetModules();
  jest.doMock('../../src/core/config', () => {
    const real = jest.requireActual('../../src/core/config');
    const orig = real.getDataDir;
    real.getDataDir = () => tmpDir;
    real.getScansDir = () => process.env.DNM_SCANS_DIR;
    return real;
  });

  const { app: a, server: s } = require('../../src/server');
  app = a; server = s;
  // Give server a moment to bind
  await new Promise(r => setTimeout(r, 200));
});

afterAll(async () => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.resetModules();
});

// ── Health ────────────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  test('returns ok:true and version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBeTruthy();
  });
});

// ── Config ────────────────────────────────────────────────────────────────────
describe('Config API', () => {
  test('GET /api/config returns default config object', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('folders');
    expect(res.body).toHaveProperty('scan');
    expect(res.body).toHaveProperty('filters');
    expect(Array.isArray(res.body.folders)).toBe(true);
  });

  test('POST /api/config saves and GET returns updated value', async () => {
    const cfg = await request(app).get('/api/config').then(r => r.body);
    cfg.folders = [{ path: 'C:\\TestFolder', active: true, recursive: true }];

    const saveRes = await request(app)
      .post('/api/config')
      .send(cfg)
      .set('Content-Type', 'application/json');
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.ok).toBe(true);

    const getRes = await request(app).get('/api/config');
    expect(getRes.body.folders).toHaveLength(1);
    expect(getRes.body.folders[0].path).toBe('C:\\TestFolder');
  });

  test('POST /api/config with bad body returns 400', async () => {
    // Send JSON array instead of object — should be rejected
    const res = await request(app)
      .post('/api/config')
      .send([1,2,3])
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ── Profiles ──────────────────────────────────────────────────────────────────
describe('Profiles API', () => {
  test('GET /api/profiles returns array', async () => {
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Scans ─────────────────────────────────────────────────────────────────────
describe('Scans API', () => {
  test('POST /api/scans/start returns JSON with id (never HTML)', async () => {
    const res = await request(app)
      .post('/api/scans/start')
      .send({})
      .set('Content-Type', 'application/json');

    // The key regression: must always return JSON, never HTML
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.status).toBeLessThan(500);
    // Either succeeds with an id, or fails with a JSON error
    expect(typeof res.body).toBe('object');
    expect(res.body.id || res.body.error).toBeTruthy();
  });

  test('GET /api/scans returns array', async () => {
    const res = await request(app).get('/api/scans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('scan with no folders gives JSON error, not crash', async () => {
    // Clear folders from config
    const cfg = await request(app).get('/api/config').then(r => r.body);
    cfg.folders = [];
    await request(app).post('/api/config').send(cfg);

    const res = await request(app)
      .post('/api/scans/start')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.headers['content-type']).toMatch(/application\/json/);
    // Scan starts (returns id) and immediately errors — both are valid
    const body = res.body;
    expect(body.id || body.error).toBeTruthy();
  });

  test('GET /api/scans/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/scans/nonexistent-id');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ── Results ───────────────────────────────────────────────────────────────────
describe('Results API', () => {
  let testResultFile;

  beforeAll(() => {
    // Write a fake result file
    testResultFile = 'duplicates_2026-01-01T00-00-00.json';
    const content = {
      version: '1.0.0',
      scannedAt: '2026-01-01T00:00:00.000Z',
      totalFiles: 4,
      groupCount: 1,
      groups: [{
        id: 'g1',
        confidence: 3,
        confidenceLabel: 'certain',
        source: 'C:\\folder\\a.jpg',
        source_info: { size: 100000, size_fmt: '97.7 KB', width: 1000, height: 1000, megapixels: 1.0, mtime_fmt: '2024-01-01', exif_date: null },
        matches: [{ path: 'C:\\folder\\b.jpg', md5_match: true, confidence: 3, distances: {}, size: 100000, size_fmt: '97.7 KB', width: 1000, height: 1000, megapixels: 1.0, mtime_fmt: '2024-01-01', exif_date: null }]
      }]
    };
    fs.writeFileSync(path.join(process.env.DNM_SCANS_DIR, testResultFile), JSON.stringify(content));
  });

  test('GET /api/results returns array with our test file', async () => {
    const res = await request(app).get('/api/results');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(r => r.filename === testResultFile)).toBe(true);
  });

  test('GET /api/results/:filename returns result with groups', async () => {
    const res = await request(app).get(`/api/results/${testResultFile}`);
    expect(res.status).toBe(200);
    expect(res.body.groupCount).toBe(1);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].confidenceLabel).toBe('certain');
  });

  test('GET /api/results/:filename returns JSON not HTML for missing file', async () => {
    const res = await request(app).get('/api/results/nonexistent.json');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.status).toBe(404);
  });

  test('POST /api/results/:filename/overrides saves and loadable', async () => {
    const overrides = { 'C:\\folder\\a.jpg': 'keep', 'C:\\folder\\b.jpg': 'remove' };
    const saveRes = await request(app)
      .post(`/api/results/${testResultFile}/overrides`)
      .send({ overrides })
      .set('Content-Type', 'application/json');
    expect(saveRes.status).toBe(200);

    const loadRes = await request(app).get(`/api/results/${testResultFile}`);
    expect(loadRes.body.overrides).toEqual(overrides);
  });

  test('GET /api/results/:filename/export/csv returns CSV', async () => {
    const res = await request(app).get(`/api/results/${testResultFile}/export/csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('C:\\folder\\a.jpg');
  });

  test('GET /api/results/:filename/export/json returns JSON download', async () => {
    const res = await request(app).get(`/api/results/${testResultFile}/export/json`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('DELETE /api/results/:filename removes the file', async () => {
    const tmpFile = 'duplicates_del_test.json';
    fs.writeFileSync(
      path.join(process.env.DNM_SCANS_DIR, tmpFile),
      JSON.stringify({ version: '1.0.0', groupCount: 0, groups: [] })
    );
    const res = await request(app).delete(`/api/results/${tmpFile}`);
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(process.env.DNM_SCANS_DIR, tmpFile))).toBe(false);
  });
});

// ── Cache ─────────────────────────────────────────────────────────────────────
describe('Cache API', () => {
  test('GET /api/cache/stats returns count', async () => {
    const res = await request(app).get('/api/cache/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
  });
});

// ── All routes return JSON, never HTML ─────────────────────────────────────────
describe('No route returns HTML unexpectedly', () => {
  const apiRoutes = [
    ['GET',  '/api/health'],
    ['GET',  '/api/config'],
    ['GET',  '/api/profiles'],
    ['GET',  '/api/scans'],
    ['GET',  '/api/results'],
    ['GET',  '/api/cache/stats'],
    ['GET',  '/api/actions/undo-log'],
  ];

  test.each(apiRoutes)('%s %s returns JSON not HTML', async (method, route) => {
    const res = await request(app)[method.toLowerCase()](route);
    const ct = res.headers['content-type'] || '';
    expect(ct).toMatch(/application\/json/);
    expect(ct).not.toMatch(/text\/html/);
  });
});
