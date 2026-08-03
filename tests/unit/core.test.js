'use strict';
/**
 * Unit tests for core modules.
 * Run: npm run test:unit
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Config ───────────────────────────────────────────────────────────────────
describe('config', () => {
  let tmpDir;
  let config;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-test-'));
    // Patch DATA_DIR at module load time is tricky, so we test the functions directly
    jest.resetModules();
    jest.doMock('../../src/core/config', () => {
      const real = jest.requireActual('../../src/core/config');
      return real;
    });
    config = require('../../src/core/config');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('DEFAULT_CONFIG has required keys', async () => {
    expect(config.DEFAULT_CONFIG).toHaveProperty('folders');
    expect(config.DEFAULT_CONFIG).toHaveProperty('scan');
    expect(config.DEFAULT_CONFIG).toHaveProperty('filters');
    expect(config.DEFAULT_CONFIG).toHaveProperty('settings');
  });

  test('DEFAULT_CONFIG scan has dhash and phash enabled', async () => {
    expect(config.DEFAULT_CONFIG.scan.algorithms.dhash).toBe(true);
    expect(config.DEFAULT_CONFIG.scan.algorithms.phash).toBe(true);
  });

  test('DEFAULT_CONFIG filter minSizeKB is 10', async () => {
    expect(config.DEFAULT_CONFIG.filters.minSizeKB).toBe(10);
  });
});

// ─── Hasher utilities ─────────────────────────────────────────────────────────
describe('hasher — hammingDistance', () => {
  const { hammingDistance } = require('../../src/core/hasher');

  test('identical hashes = 0', async () => {
    expect(hammingDistance('f0f0f0f0', 'f0f0f0f0')).toBe(0);
  });

  test('completely different = 16 bits for 4-char hex', async () => {
    expect(hammingDistance('0000', 'ffff')).toBe(16);
  });

  test('null hash returns Infinity', async () => {
    expect(hammingDistance(null, 'abc')).toBe(Infinity);
    expect(hammingDistance('abc', null)).toBe(Infinity);
  });

  test('single bit difference', async () => {
    expect(hammingDistance('0', '1')).toBe(1);
  });

  test('4-bit difference in one nibble', async () => {
    // 0x0 = 0000, 0xf = 1111 → 4 bits differ
    expect(hammingDistance('0', 'f')).toBe(4);
  });
});

// ─── Comparator ───────────────────────────────────────────────────────────────
describe('comparator — areDuplicates', () => {
  const { areDuplicates, CONFIDENCE } = require('../../src/core/comparator');

  const defaultConfig = {
    algorithms: { dhash: true, phash: true },
    thresholds: { dhash: 8, phash: 12 },
    ensureMin: 1,
    matchLogic: 'threshold',
    anchorHash: null
  };

  test('MD5 match = certain regardless of hashes', async () => {
    const a = { md5: 'abc123', dhash: '0000', phash: '0000' };
    const b = { md5: 'abc123', dhash: 'ffff', phash: 'ffff' };
    const result = areDuplicates(a, b, defaultConfig);
    expect(result.match).toBe(true);
    expect(result.confidence).toBe(CONFIDENCE.CERTAIN);
    expect(result.md5Match).toBe(true);
  });

  test('different MD5 + similar hashes = match based on hash', async () => {
    const a = { md5: 'aaa', dhash: 'f0f0f0f0', phash: 'aaaaaaaa' };
    const b = { md5: 'bbb', dhash: 'f0f0f0f0', phash: 'aaaaaaaa' };
    const result = areDuplicates(a, b, defaultConfig);
    expect(result.match).toBe(true);
    expect(result.md5Match).toBe(false);
  });

  test('completely different hashes = no match', async () => {
    const a = { md5: 'aaa', dhash: '00000000', phash: '00000000' };
    const b = { md5: 'bbb', dhash: 'ffffffff', phash: 'ffffffff' };
    const result = areDuplicates(a, b, defaultConfig);
    expect(result.match).toBe(false);
  });

  test('AND logic requires all hashes to match', async () => {
    const cfg = { ...defaultConfig, matchLogic: 'and' };
    const a = { md5: 'a', dhash: 'f0f0f0f0', phash: '00000000' };
    const b = { md5: 'b', dhash: 'f0f0f0f0', phash: 'ffffffff' }; // phash differs
    const result = areDuplicates(a, b, cfg);
    expect(result.match).toBe(false); // phash too different
  });

  test('OR logic matches on any single hash', async () => {
    const cfg = { ...defaultConfig, matchLogic: 'or', ensureMin: 2 };
    const a = { md5: 'a', dhash: 'f0f0f0f0', phash: '00000000' };
    const b = { md5: 'b', dhash: 'f0f0f0f0', phash: 'ffffffff' };
    const result = areDuplicates(a, b, cfg);
    expect(result.match).toBe(true); // dhash matches, OR means 1 is enough
  });

  test('anchor hash mismatch prevents match', async () => {
    const cfg = { ...defaultConfig, anchorHash: 'phash' };
    const a = { md5: 'a', dhash: 'f0f0f0f0', phash: '00000000' };
    const b = { md5: 'b', dhash: 'f0f0f0f0', phash: 'ffffffff' }; // phash too different
    const result = areDuplicates(a, b, cfg);
    expect(result.match).toBe(false);
  });

  test('no active algorithms = no match', async () => {
    const cfg = { ...defaultConfig, algorithms: {} };
    const a = { md5: 'a', dhash: 'abc' };
    const b = { md5: 'b', dhash: 'abc' };
    const result = areDuplicates(a, b, cfg);
    expect(result.match).toBe(false);
  });
});

describe('comparator — buildGroups', () => {
  const { buildGroups } = require('../../src/core/comparator');

  const config = {
    algorithms: { dhash: true },
    thresholds: { dhash: 8 },
    ensureMin: 1,
    matchLogic: 'threshold'
  };

  test('identical MD5 files form a group', async () => {
    const files = [
      { path: '/a/1.jpg', md5: 'same', dhash: 'abc', size: 100, mtime: 1000, folderIndex: 0 },
      { path: '/b/2.jpg', md5: 'same', dhash: 'abc', size: 100, mtime: 1000, folderIndex: 1 }
    ];
    const groups = await buildGroups(files, config, []);
    expect(groups.length).toBe(1);
    expect(groups[0].matches.length).toBe(1);
  });

  test('unique files produce no groups', async () => {
    const files = [
      { path: '/a/1.jpg', md5: 'aaa', dhash: '00000000', size: 100, mtime: 1000, folderIndex: 0 },
      { path: '/b/2.jpg', md5: 'bbb', dhash: 'ffffffff', size: 200, mtime: 2000, folderIndex: 1 }
    ];
    const groups = await buildGroups(files, config, []);
    expect(groups.length).toBe(0);
  });

  test('groups are sorted certain first', async () => {
    const files = [
      { path: '/a/1.jpg', md5: 'x1', dhash: 'aaaaaaaa', size: 100, mtime: 1, folderIndex: 0 },
      { path: '/a/2.jpg', md5: 'x1', dhash: 'aaaaaaaa', size: 100, mtime: 1, folderIndex: 0 },
      { path: '/b/3.jpg', md5: 'y1', dhash: '00000001', size: 200, mtime: 2, folderIndex: 1 },
      { path: '/b/4.jpg', md5: 'y2', dhash: '00000000', size: 200, mtime: 2, folderIndex: 1 },
    ];
    const groups = await buildGroups(files, config, []);
    if (groups.length > 1) {
      expect(groups[0].confidence).toBeGreaterThanOrEqual(groups[1].confidence);
    }
  });

  test('source is highest priority folder file', async () => {
    const files = [
      { path: '/low/2.jpg', md5: 'same', dhash: 'abc', size: 100, mtime: 1, folderIndex: 1 },
      { path: '/high/1.jpg', md5: 'same', dhash: 'abc', size: 100, mtime: 1, folderIndex: 0 }
    ];
    const groups = await buildGroups(files, config, []);
    expect(groups.length).toBe(1);
    // Source should be from folderIndex 0 (highest priority)
    expect(groups[0].source).toBe('/high/1.jpg');
  });
});

// ─── Collector ────────────────────────────────────────────────────────────────
describe('collector — collectFiles', () => {
  const { collectFiles } = require('../../src/core/collector');
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-collect-'));
    // Create test files
    fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), Buffer.alloc(20 * 1024)); // 20KB
    fs.writeFileSync(path.join(tmpDir, 'tiny.jpg'), Buffer.alloc(5 * 1024));   // 5KB (below min)
    fs.writeFileSync(path.join(tmpDir, 'doc.pdf'), Buffer.alloc(50 * 1024));   // not an image
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'nested.jpg'), Buffer.alloc(30 * 1024));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const defaultFilters = { minSizeKB: 10, maxSizeMB: 0, skipSystemFolders: false, extensions: [], excludePatterns: [] };

  test('collects jpg files above min size', async () => {
    const folders = [{ path: tmpDir, active: true, recursive: false, index: 0 }];
    const files = await collectFiles(folders, defaultFilters);
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('photo.jpg');
    expect(names).not.toContain('tiny.jpg'); // too small
    expect(names).not.toContain('doc.pdf');  // not image
  });

  test('recursive includes subfolders', async () => {
    const folders = [{ path: tmpDir, active: true, recursive: true, index: 0 }];
    const files = await collectFiles(folders, defaultFilters);
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('nested.jpg');
  });

  test('non-recursive excludes subfolders', async () => {
    const folders = [{ path: tmpDir, active: true, recursive: false, index: 0 }];
    const files = await collectFiles(folders, defaultFilters);
    const names = files.map(f => path.basename(f.path));
    expect(names).not.toContain('nested.jpg');
  });

  test('inactive folder is skipped', async () => {
    const folders = [{ path: tmpDir, active: false, recursive: true, index: 0 }];
    const files = await collectFiles(folders, defaultFilters);
    expect(files.length).toBe(0);
  });

  test('nonexistent folder is skipped gracefully', async () => {
    const folders = [{ path: '/nonexistent/path', active: true, recursive: true, index: 0 }];
    const files = await collectFiles(folders, defaultFilters);
    expect(files.length).toBe(0);
  });

  test('max size filter excludes large files', async () => {
    const filters = { ...defaultFilters, maxSizeMB: 0.025 }; // 25KB limit
    const folders = [{ path: tmpDir, active: true, recursive: true, index: 0 }];
    const files = await collectFiles(folders, filters);
    const names = files.map(f => path.basename(f.path));
    expect(names).not.toContain('nested.jpg'); // 30KB > 25KB
    expect(names).toContain('photo.jpg'); // 20KB < 25KB
  });
});

// ─── Results ──────────────────────────────────────────────────────────────────
describe('results', () => {
  const { getResultFiles, loadResult, deleteResult, filterGroups, saveOverrides, loadOverrides } = require('../../src/core/results');
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-results-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeResult(filename, groups = []) {
    const data = {
      version: '1.0.0',
      scannedAt: new Date().toISOString(),
      groupCount: groups.length,
      groups
    };
    fs.writeFileSync(path.join(tmpDir, filename), JSON.stringify(data));
    return data;
  }

  test('getResultFiles returns sorted list', async () => {
    makeResult('duplicates_2024-01-01T10-00-00.json');
    makeResult('duplicates_2024-02-01T10-00-00.json');
    const files = getResultFiles(tmpDir);
    expect(files.length).toBe(2);
    // Most recent first
    expect(files[0].filename).toBe('duplicates_2024-02-01T10-00-00.json');
  });

  test('getResultFiles returns [] for empty dir', async () => {
    expect(getResultFiles(path.join(tmpDir, 'nonexistent'))).toEqual([]);
  });

  test('loadResult parses JSON', async () => {
    makeResult('duplicates_test.json', [{ id: 'g1', source: '/a.jpg', matches: [] }]);
    const result = loadResult(path.join(tmpDir, 'duplicates_test.json'));
    expect(result.groups.length).toBe(1);
  });

  test('deleteResult removes file', async () => {
    makeResult('duplicates_del.json');
    const p = path.join(tmpDir, 'duplicates_del.json');
    deleteResult(p);
    expect(fs.existsSync(p)).toBe(false);
  });

  test('filterGroups removes singleton groups', async () => {
    makeResult('duplicates_filter.json', [
      { id: 'g1', source: '/a.jpg', confidenceLabel: 'certain', matches: [] },
      { id: 'g2', source: '/b.jpg', confidenceLabel: 'certain', matches: [{ path: '/c.jpg' }] }
    ]);
    const { removed, remaining } = filterGroups(path.join(tmpDir, 'duplicates_filter.json'), 'singletons');
    expect(removed).toBe(1);
    expect(remaining).toBe(1);
  });

  test('saveOverrides and loadOverrides round-trip', async () => {
    const dataDir = tmpDir;
    const overrides = { '/a.jpg': 'keep', '/b.jpg': 'remove' };
    saveOverrides(dataDir, 'test.json', overrides);
    const loaded = loadOverrides(dataDir, 'test.json');
    expect(loaded).toEqual(overrides);
  });
});
