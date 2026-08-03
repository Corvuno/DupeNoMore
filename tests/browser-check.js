/**
 * Automated browser checks — runs against localhost:8888
 * Tests API endpoints, page loading, and element presence.
 */
const http = require('http');

const BASE = 'http://localhost:8888';
let passed = 0, failed = 0;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK: ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL: ' + name + ' — ' + e.message);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

(async () => {
  console.log('\n  Testing ' + BASE + '...\n');

  await test('Server responds', async () => {
    const r = await get('/api/health');
    assert(r.status === 200, 'status ' + r.status);
    const j = JSON.parse(r.body);
    assert(j.ok === true, 'health not ok');
  });

  await test('Version endpoint', async () => {
    const r = await get('/api/version');
    const j = JSON.parse(r.body);
    assert(j.version && j.version !== '1.0.0', 'version is ' + j.version);
  });

  await test('HTML loads with no-cache headers', async () => {
    const r = await get('/');
    assert(r.status === 200, 'status ' + r.status);
    assert(r.headers['cache-control']?.includes('no-cache'), 'no-cache header missing');
    assert(r.body.includes('app-version'), 'app-version element missing');
  });

  await test('HTML version matches package.json', async () => {
    const r = await get('/');
    const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
    assert(r.body.includes('v' + pkg.version), 'HTML has wrong version, expected v' + pkg.version);
  });

  await test('review.js loads without syntax comment', async () => {
    const r = await get('/js/review.js');
    assert(r.status === 200, 'status ' + r.status);
    assert(!r.body.includes('handleFilterEvent'), 'old handleFilterEvent still present');
    assert(r.body.includes('_simMinEl'), 'direct wiring missing');
    assert(r.body.includes('action-text'), 'action-text span missing');
  });

  await test('review.js has no file.path bug', async () => {
    const r = await get('/js/review.js');
    assert(!r.body.includes('encodeURIComponent(file.path)'), 'file.path bug still present');
  });

  await test('deselectFilters is module-level', async () => {
    const r = await get('/js/review.js');
    // Should be declared before wireBar, not inside it
    const declPos = r.body.indexOf('let deselectFilters');
    const wirePos = r.body.indexOf('function wireBar');
    assert(declPos < wirePos, 'deselectFilters (pos ' + declPos + ') should be before wireBar (pos ' + wirePos + ')');
  });

  await test('Scan page has search depth control', async () => {
    const r = await get('/js/scan.js');
    assert(r.body.includes('search-depth'), 'search-depth input missing from scan.js');
    assert(r.body.includes('searchDepth'), 'searchDepth config missing');
  });

  await test('Results API', async () => {
    const r = await get('/api/results');
    assert(r.status === 200, 'status ' + r.status);
  });

  await test('Config API', async () => {
    const r = await get('/api/config');
    assert(r.status === 200, 'status ' + r.status);
  });

  await test('Open-image endpoint exists', async () => {
    const r = await get('/api/open-image?path=test');
    assert(r.status === 200, 'status ' + r.status);
  });

  await test('Thumbnail endpoint exists', async () => {
    const r = await get('/api/thumbnail?path=nonexistent');
    assert(r.status === 404 || r.status === 400, 'expected 400/404, got ' + r.status);
  });

  await test('Restart endpoint exists', async () => {
    // Don't actually restart — just check it exists via OPTIONS or a harmless check
    // We'll verify the route is defined by checking review.js references it
    const r = await get('/js/settings.js');
    assert(r.body.includes('/restart'), 'restart endpoint not referenced in settings.js');
  });

  console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('  Test runner error:', e.message);
  process.exit(1);
});
