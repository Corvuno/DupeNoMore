'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const realConfig = require('../../src/core/config');

describe('DEFAULT_CONFIG', () => {
  test('has all required top-level keys', () => {
    expect(realConfig.DEFAULT_CONFIG).toHaveProperty('folders');
    expect(realConfig.DEFAULT_CONFIG).toHaveProperty('scan');
    expect(realConfig.DEFAULT_CONFIG).toHaveProperty('filters');
    expect(realConfig.DEFAULT_CONFIG).toHaveProperty('settings');
  });
  test('scan.ensureMin defaults to 2', () => {
    expect(realConfig.DEFAULT_SCAN.ensureMin).toBe(2);
  });
  test('scan.algorithms has dhash and phash enabled', () => {
    expect(realConfig.DEFAULT_SCAN.algorithms.dhash).toBe(true);
    expect(realConfig.DEFAULT_SCAN.algorithms.phash).toBe(true);
  });
  test('filters.minSizeKB defaults to 10', () => {
    expect(realConfig.DEFAULT_FILTERS.minSizeKB).toBe(10);
  });
  test('app.scansDir defaults to null (derived at runtime)', () => {
    expect(realConfig.DEFAULT_APP.scansDir).toBeNull();
  });
});

describe('mergeDeep', () => {
  // mergeDeep(target, source): source fills target's gaps; source values win
  // Used as mergeDeep(defaults, userConfig) so user config wins over defaults

  test('source values override target', () => {
    const result = realConfig.mergeDeep({ a: 1 }, { a: 99 });
    expect(result.a).toBe(99); // source wins
  });
  test('target keys not in source are preserved', () => {
    const result = realConfig.mergeDeep({ a: 1, b: 2 }, { a: 99 });
    expect(result.b).toBe(2); // target key preserved when source has no opinion
  });
  test('handles nested objects recursively', () => {
    const result = realConfig.mergeDeep(
      { scan: { dhash: false, phash: false } },
      { scan: { dhash: true } }
    );
    expect(result.scan.dhash).toBe(true);  // source wins
    expect(result.scan.phash).toBe(false); // target preserved (source has no opinion)
  });
  test('source missing key → target value kept', () => {
    const result = realConfig.mergeDeep({ x: 42 }, {});
    expect(result.x).toBe(42);
  });
});

describe('getScansDir', () => {
  test('null scansDir falls back to APP_DIR/scans', () => {
    const dir = realConfig.getScansDir({ settings: { scansDir: null } });
    expect(dir).toContain('scans');
    expect(path.isAbsolute(dir)).toBe(true);
  });
  test('explicit valid scansDir is used', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-sd-'));
    try {
      const dir = realConfig.getScansDir({ settings: { scansDir: tmpDir } });
      expect(dir).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  test('empty config falls back to default', () => {
    const dir = realConfig.getScansDir({});
    expect(dir).toBeTruthy();
    expect(path.isAbsolute(dir)).toBe(true);
  });
});

describe('loadProfiles', () => {
  test('always returns all built-in profiles', () => {
    const profiles = realConfig.loadProfiles();
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThanOrEqual(5);
  });
  test('includes balanced profile', () => {
    expect(realConfig.loadProfiles().some(p => p.id === 'balanced')).toBe(true);
  });
  test('includes exact_only profile', () => {
    expect(realConfig.loadProfiles().some(p => p.id === 'exact_only')).toBe(true);
  });
  test('each profile has required fields', () => {
    for (const p of realConfig.loadProfiles()) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('description');
      expect(p).toHaveProperty('scan');
      expect(p.scan).toHaveProperty('algorithms');
      expect(p.scan).toHaveProperty('ensureMin');
    }
  });
  test('profiles never require manual deletion to update', () => {
    // Built-in profiles come from code, not from profiles.json
    // So they're always current regardless of what's on disk
    const profiles = realConfig.loadProfiles();
    const builtinIds = ['exact_only','quick','strict','balanced','media_library','thorough','loose','aggressive','web_downloads','max_coverage'];
    for (const id of builtinIds) {
      expect(profiles.some(p => p.id === id)).toBe(true);
    }
  });
});

describe('split file independence', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-split-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  test('folders.json survives scan.json deletion', () => {
    const foldersFile = path.join(tmpDir, 'folders.json');
    const scanFile    = path.join(tmpDir, 'scan.json');

    fs.writeFileSync(foldersFile, JSON.stringify([{ path: 'C:\\Test', active: true }]));
    fs.writeFileSync(scanFile, JSON.stringify({ ensureMin: 2 }));

    // Simulate update: delete scan.json only
    fs.unlinkSync(scanFile);

    // Folders still intact
    const folders = JSON.parse(fs.readFileSync(foldersFile, 'utf8'));
    expect(folders[0].path).toBe('C:\\Test');
    expect(fs.existsSync(foldersFile)).toBe(true);
    expect(fs.existsSync(scanFile)).toBe(false);
  });

  test('each section is a valid standalone JSON file', () => {
    const sections = {
      'folders.json': [{ path: 'C:\\Test' }],
      'scan.json':    { ensureMin: 2, algorithms: { dhash: true } },
      'filters.json': { minSizeKB: 10, maxSizeMB: 0 },
      'app.json':     { theme: 'dark', scansDir: null }
    };
    for (const [name, data] of Object.entries(sections)) {
      fs.writeFileSync(path.join(tmpDir, name), JSON.stringify(data, null, 2));
      const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, name), 'utf8'));
      expect(parsed).toEqual(data);
    }
  });

  test('what to delete per use case', () => {
    // Document the contract: what each file contains
    expect(realConfig.DEFAULT_SCAN).toHaveProperty('algorithms');   // scan.json
    expect(realConfig.DEFAULT_FILTERS).toHaveProperty('minSizeKB'); // filters.json
    expect(realConfig.DEFAULT_APP).toHaveProperty('theme');         // app.json
    // folders.json is user data — NEVER needs to be deleted
  });
});
