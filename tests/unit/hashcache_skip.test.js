'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

// Detect if SQLite native bindings actually work at runtime
let sqliteAvailable = false;
try {
  const Database = require('better-sqlite3');
  const tmpDb = path.join(os.tmpdir(), '_dnm_probe.db');
  const db = new Database(tmpDb);
  db.exec('CREATE TABLE IF NOT EXISTS t (x TEXT)');
  db.close();
  fs.rmSync(tmpDb, { force: true });
  sqliteAvailable = true;
} catch {}

const maybeDescribe = sqliteAvailable ? describe : describe.skip;

maybeDescribe('hashCache (requires compiled SQLite)', () => {
  let cache;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-cache2-'));
    jest.resetModules();
    jest.doMock('../../src/core/config', () => ({
      ...jest.requireActual('../../src/core/config'),
      getDataDir: () => tmpDir
    }));
    cache = require('../../src/core/hashCache');
  });

  afterEach(() => {
    if (cache) cache.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('set then get returns stored hashes', () => {
    cache.set('/test.jpg', 1000, 500, { md5: 'abc123', dhash: 'f0f0f0f0' });
    const result = cache.get('/test.jpg', 1000, 500);
    expect(result).not.toBeNull();
    expect(result.md5).toBe('abc123');
    expect(result.dhash).toBe('f0f0f0f0');
  });

  test('stale entry (different mtime) not returned', () => {
    cache.set('/test.jpg', 1000, 500, { md5: 'abc' });
    expect(cache.get('/test.jpg', 9999, 500)).toBeNull();
  });

  test('invalidate removes entry', () => {
    cache.set('/test.jpg', 1000, 500, { md5: 'abc' });
    cache.invalidate('/test.jpg');
    expect(cache.get('/test.jpg', 1000, 500)).toBeNull();
  });

  test('stats returns count', () => {
    cache.set('/a.jpg', 1, 100, { md5: 'a' });
    cache.set('/b.jpg', 2, 200, { md5: 'b' });
    expect(cache.stats().count).toBeGreaterThanOrEqual(2);
  });
});

test(`hashCache: SQLite native bindings ${sqliteAvailable ? 'available' : 'not compiled — cache disabled (runs without it, will compile on Windows)'}`, () => {
  expect(typeof sqliteAvailable).toBe('boolean');
});
