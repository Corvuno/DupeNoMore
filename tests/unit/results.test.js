'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { getResultFiles, loadResult, deleteResult, filterGroups, saveOverrides, loadOverrides } = require('../../src/core/results');

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-res-')); });
afterEach(()  => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeResult(name, groups = [], extra = {}) {
  const data = { version:'1.0.0', scannedAt: new Date().toISOString(), groupCount: groups.length, groups, ...extra };
  fs.writeFileSync(path.join(tmpDir, name), JSON.stringify(data));
  return data;
}

describe('getResultFiles', () => {
  test('returns empty array for missing dir', () => {
    expect(getResultFiles('/nonexistent/path')).toEqual([]);
  });
  test('lists only duplicates_*.json files', () => {
    writeResult('duplicates_2024-01-01T00-00-00.json');
    writeResult('duplicates_2024-02-01T00-00-00.json');
    fs.writeFileSync(path.join(tmpDir, 'other.json'), '{}');
    const files = getResultFiles(tmpDir);
    expect(files.length).toBe(2);
    expect(files.every(f => f.filename.startsWith('duplicates_'))).toBe(true);
  });
  test('sorted newest first', () => {
    writeResult('duplicates_2024-01-01T00-00-00.json');
    writeResult('duplicates_2024-06-01T00-00-00.json');
    const files = getResultFiles(tmpDir);
    expect(files[0].filename).toBe('duplicates_2024-06-01T00-00-00.json');
  });
  test('includes groupCount and scannedAt in listing', () => {
    writeResult('duplicates_2024-01-01T00-00-00.json', [{id:'g1',source:'/a',matches:[]}]);
    const files = getResultFiles(tmpDir);
    expect(files[0].groupCount).toBe(1);
    expect(files[0].scannedAt).toBeTruthy();
  });
});

describe('loadResult', () => {
  test('parses JSON correctly', () => {
    writeResult('duplicates_test.json', [{id:'g1',source:'/a',matches:[]}]);
    const r = loadResult(path.join(tmpDir, 'duplicates_test.json'));
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].source).toBe('/a');
  });
  test('throws on missing file', () => {
    expect(() => loadResult(path.join(tmpDir, 'nonexistent.json'))).toThrow();
  });
});

describe('deleteResult', () => {
  test('removes file from disk', () => {
    writeResult('duplicates_del.json');
    const p = path.join(tmpDir, 'duplicates_del.json');
    deleteResult(p);
    expect(fs.existsSync(p)).toBe(false);
  });
  test('throws on missing file', () => {
    expect(() => deleteResult(path.join(tmpDir, 'missing.json'))).toThrow();
  });
});

describe('filterGroups', () => {
  test('filter by folder removes matching groups', () => {
    writeResult('duplicates_f.json', [
      { id:'g1', source:'/keep/a.jpg', confidenceLabel:'certain', matches:[] },
      { id:'g2', source:'/remove/b.jpg', confidenceLabel:'certain', matches:[] }
    ]);
    const { removed, remaining } = filterGroups(path.join(tmpDir,'duplicates_f.json'), 'folder', '/remove');
    expect(removed).toBe(1);
    expect(remaining).toBe(1);
  });
  test('filter singletons removes groups with no matches', () => {
    writeResult('duplicates_s.json', [
      { id:'g1', source:'/a.jpg', matches:[] },
      { id:'g2', source:'/b.jpg', matches:[{path:'/c.jpg'}] }
    ]);
    const { removed } = filterGroups(path.join(tmpDir,'duplicates_s.json'), 'singletons');
    expect(removed).toBe(1);
  });
  test('filter persists to disk', () => {
    writeResult('duplicates_p.json', [
      { id:'g1', source:'/a.jpg', matches:[] },
      { id:'g2', source:'/b.jpg', matches:[{path:'/c.jpg'}] }
    ]);
    filterGroups(path.join(tmpDir,'duplicates_p.json'), 'singletons');
    const reloaded = loadResult(path.join(tmpDir,'duplicates_p.json'));
    expect(reloaded.groups.length).toBe(1);
    expect(reloaded.groupCount).toBe(1);
  });
});

describe('saveOverrides / loadOverrides', () => {
  test('round-trips overrides', () => {
    const overrides = { '/a.jpg': 'keep', '/b.jpg': 'remove' };
    saveOverrides(tmpDir, 'test.json', overrides);
    expect(loadOverrides(tmpDir, 'test.json')).toEqual(overrides);
  });
  test('returns empty object for unknown result', () => {
    expect(loadOverrides(tmpDir, 'unknown.json')).toEqual({});
  });
  test('multiple result files stored separately', () => {
    saveOverrides(tmpDir, 'scan1.json', { '/a.jpg': 'keep' });
    saveOverrides(tmpDir, 'scan2.json', { '/b.jpg': 'remove' });
    expect(loadOverrides(tmpDir, 'scan1.json')).toEqual({ '/a.jpg': 'keep' });
    expect(loadOverrides(tmpDir, 'scan2.json')).toEqual({ '/b.jpg': 'remove' });
  });
});
