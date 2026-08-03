'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-sm-')); jest.resetModules(); });
afterEach(()  => { fs.rmSync(tmpDir, {recursive:true,force:true}); jest.resetModules(); });

function getManager() {
  // Fresh manager per test
  jest.doMock('../../src/core/config', () => ({
    ...jest.requireActual('../../src/core/config'),
    getScansDir: () => path.join(tmpDir, 'scans'),
    getDataDir:  () => tmpDir
  }));
  return require('../../src/core/scanManager');
}

const EMPTY_CONFIG = {
  folders: [], filters: { minSizeKB: 0, extensions: ['jpg'], includeVideos: false, excludePatterns: [], skipSystemFolders: false },
  scan: { algorithms: { dhash: true }, thresholds: { dhash: 8 }, ensureMin: 1, matchLogic: 'threshold' },
  settings: { scansDir: null }
};

describe('ScanManager', () => {
  test('start() returns a UUID string', async () => {
    const manager = getManager();
    const id = await manager.start({ ...EMPTY_CONFIG });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(8);
    manager.abort(id);
  });

  test('start() adds scan to getAll()', async () => {
    const manager = getManager();
    const id = await manager.start({ ...EMPTY_CONFIG });
    const scans = manager.getAll();
    expect(scans.some(s => s.id === id)).toBe(true);
    manager.abort(id);
  });

  test('scan with no active folders → status error with message', async () => {
    const manager = getManager();
    const id = await manager.start({ ...EMPTY_CONFIG, folders: [] });
    await new Promise(r => setTimeout(r, 500));
    const scan = manager.get(id);
    expect(scan.status).toBe('error');
    expect(scan.error).toMatch(/folder/i);
  });

  test('dismiss() removes scan from list', async () => {
    const manager = getManager();
    const id = await manager.start({ ...EMPTY_CONFIG });
    await new Promise(r => setTimeout(r, 200));
    manager.dismiss(id);
    expect(manager.getAll().some(s => s.id === id)).toBe(false);
  });

  test('pause() and resume() change status', async () => {
    const manager = getManager();
    const id = await manager.start({
      ...EMPTY_CONFIG,
      folders: [{ path: tmpDir, active: true, recursive: true, index: 0 }]
    });
    await new Promise(r => setTimeout(r, 50));
    manager.pause(id);
    await new Promise(r => setTimeout(r, 50));
    const paused = manager.get(id);
    if (paused && paused.status !== 'done' && paused.status !== 'error') {
      expect(paused.status).toBe('paused');
      manager.resume(id);
      await new Promise(r => setTimeout(r, 50));
      const resumed = manager.get(id);
      expect(['running','done','error']).toContain(resumed?.status);
    }
    manager.abort(id);
  });

  test('abort() sets status to aborted', async () => {
    const manager = getManager();
    const id = await manager.start({
      ...EMPTY_CONFIG,
      folders: [{ path: tmpDir, active: true, recursive: true, index: 0 }]
    });
    await new Promise(r => setTimeout(r, 50));
    manager.abort(id);
    await new Promise(r => setTimeout(r, 100));
    const scan = manager.get(id);
    expect(['aborted','done','error']).toContain(scan?.status);
  });

  test('get() returns null for unknown id', () => {
    const manager = getManager();
    expect(manager.get('nonexistent')).toBeNull();
  });

  test('publicState has required fields', async () => {
    const manager = getManager();
    const id = await manager.start({ ...EMPTY_CONFIG });
    const scan = manager.get(id);
    expect(scan).toHaveProperty('id');
    expect(scan).toHaveProperty('status');
    expect(scan).toHaveProperty('phase');
    expect(scan).toHaveProperty('progress');
    expect(scan).toHaveProperty('log');
    expect(scan).toHaveProperty('startedAt');
    manager.abort(id);
  });

  test('log is populated on error', async () => {
    const manager = getManager();
    const id = await manager.start({ ...EMPTY_CONFIG, folders: [] });
    await new Promise(r => setTimeout(r, 300));
    const scan = manager.get(id);
    expect(scan.log.length).toBeGreaterThan(0);
  });

  test('scan emits started event', async () => {
    const manager = getManager();
    const events = [];
    manager.on('scan:any', ({ event }) => events.push(event));
    const id = await manager.start({ ...EMPTY_CONFIG });
    await new Promise(r => setTimeout(r, 100));
    expect(events).toContain('started');
    manager.abort(id);
  });

  test('scan with real folder finds no files (jpg only, empty dir)', async () => {
    const manager = getManager();
    const scanDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(scanDir);
    const id = await manager.start({
      ...EMPTY_CONFIG,
      folders: [{ path: scanDir, active: true, recursive: false, index: 0 }]
    });
    await new Promise(r => setTimeout(r, 500));
    const scan = manager.get(id);
    expect(['done','error']).toContain(scan?.status);
    if (scan?.status === 'done') expect(scan.groupCount).toBe(0);
    manager.dismiss(id);
  });
});
