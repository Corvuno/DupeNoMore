'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-act-'));
  // Reset undo log by re-requiring module fresh each test
  jest.resetModules();
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function write(rel, content = 'data') {
  const p = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function makeResult(groups) {
  const p = path.join(tmpDir, 'result.json');
  fs.writeFileSync(p, JSON.stringify({
    version: '1.0.0', scannedAt: new Date().toISOString(),
    groupCount: groups.length, groups
  }));
  return p;
}

describe('moveFile', () => {
  test('moves file to target dir', () => {
    const { moveFile } = require('../../src/core/actions');
    const src  = write('src/a.jpg');
    const dest = path.join(tmpDir, 'dest');
    moveFile(src, dest, false);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(path.join(dest, 'a.jpg'))).toBe(true);
  });

  test('renames on collision', () => {
    const { moveFile } = require('../../src/core/actions');
    const src  = write('src/a.jpg');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'a.jpg'), 'existing');
    moveFile(src, dest, false);
    // src file moved, collision resolved
    expect(fs.existsSync(src)).toBe(false);
    const files = fs.readdirSync(dest).filter(f => f.startsWith('a'));
    expect(files.length).toBe(2); // original + renamed
  });

  test('adds to undo log', () => {
    const { moveFile, getUndoLog } = require('../../src/core/actions');
    const src = write('src/a.jpg');
    moveFile(src, path.join(tmpDir, 'dest'), false);
    const log = getUndoLog();
    expect(log.some(e => e.action === 'move' && e.from === src)).toBe(true);
  });
});

describe('deleteFile', () => {
  test('deletes file from disk', () => {
    const { deleteFile } = require('../../src/core/actions');
    const src = write('del.jpg');
    deleteFile(src);
    expect(fs.existsSync(src)).toBe(false);
  });

  test('adds to undo log as irreversible', () => {
    const { deleteFile, getUndoLog } = require('../../src/core/actions');
    const src = write('del.jpg');
    deleteFile(src);
    const log = getUndoLog();
    expect(log.some(e => e.action === 'delete')).toBe(true);
  });
});

describe('undo', () => {
  test('undoes a move', () => {
    const { moveFile, undo, getUndoLog } = require('../../src/core/actions');
    const src  = write('src/a.jpg');
    const dest = path.join(tmpDir, 'dest');
    moveFile(src, dest, false);
    expect(fs.existsSync(src)).toBe(false);
    const log = getUndoLog();
    undo(log.length - 1);
    expect(fs.existsSync(src)).toBe(true);
  });

  test('undo delete throws (irreversible)', () => {
    const { deleteFile, undo, getUndoLog } = require('../../src/core/actions');
    const src = write('del.jpg');
    deleteFile(src);
    const log = getUndoLog();
    expect(() => undo(log.length - 1)).toThrow('irreversible');
  });

  test('undo with invalid index throws', () => {
    const { undo } = require('../../src/core/actions');
    expect(() => undo(9999)).toThrow();
  });
});

describe('executeActions — dry run', () => {
  test('dry run does not modify files', async () => {
    const { executeActions } = require('../../src/core/actions');
    const a = write('a.jpg');
    const b = write('b.jpg');
    const resultFile = makeResult([{
      confidenceLabel: 'certain', source: a,
      source_info: { size: 4, mtime_fmt: '2024-01-01' },
      matches: [{ path: b, md5_match: true, size: 4, mtime_fmt: '2024-01-01' }]
    }]);
    const result = await executeActions(resultFile,
      { actions: { certain: 'recycle_removed' }, selections: { [a]:'keep', [b]:'remove' },
        locked: [], reproduceStructure: false },
      true // dryRun
    );
    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(a)).toBe(true); // untouched
    expect(fs.existsSync(b)).toBe(true); // untouched
  });

  test('dry run returns correct stats', async () => {
    const { executeActions } = require('../../src/core/actions');
    const a = write('a.jpg');
    const b = write('b.jpg');
    const resultFile = makeResult([{
      confidenceLabel: 'certain', source: a,
      source_info: { size: 4, mtime_fmt: '2024-01-01' },
      matches: [{ path: b, md5_match: false, size: 4, mtime_fmt: '2024-01-01' }]
    }]);
    const result = await executeActions(resultFile,
      { actions: { certain: 'execute_selected' }, selections: { [a]:'keep', [b]:'remove' },
        locked: [], removeTarget: null, reproduceStructure: false },
      true
    );
    expect(result.stats.kept + result.stats.recycled + result.stats.moved).toBeGreaterThan(0);
  });
});

describe('executeActions — keep_in_place', () => {
  test('keep_in_place never touches files', async () => {
    const { executeActions } = require('../../src/core/actions');
    const a = write('a.jpg');
    const b = write('b.jpg');
    const resultFile = makeResult([{
      confidenceLabel: 'certain', source: a,
      source_info: { size: 4, mtime_fmt: '2024-01-01' },
      matches: [{ path: b, md5_match: false, size: 4, mtime_fmt: '2024-01-01' }]
    }]);
    const result = await executeActions(resultFile,
      { actions: { certain: 'keep_in_place' }, selections: {}, locked: [], reproduceStructure: false },
      false
    );
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(result.stats.kept).toBe(2);
  });
});

describe('executeActions — move_removed', () => {
  test('moves removed files to target folder', async () => {
    const { executeActions } = require('../../src/core/actions');
    const a = write('a.jpg');
    const b = write('b.jpg');
    const quarantine = path.join(tmpDir, 'quarantine');
    const resultFile = makeResult([{
      confidenceLabel: 'certain', source: a,
      source_info: { size: 4, mtime_fmt: '2024-01-01' },
      matches: [{ path: b, md5_match: false, size: 4, mtime_fmt: '2024-01-01' }]
    }]);
    await executeActions(resultFile,
      { actions: { certain: 'execute_selected' }, selections: { [a]:'keep', [b]:'remove' },
        locked: [], removeTarget: quarantine, reproduceStructure: false },
      false
    );
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(false); // moved
    expect(fs.readdirSync(quarantine).length).toBeGreaterThan(0);
  });
});

describe('executeActions — locked files', () => {
  test('locked files are never touched', async () => {
    const { executeActions } = require('../../src/core/actions');
    const a = write('a.jpg');
    const b = write('b.jpg');
    const resultFile = makeResult([{
      confidenceLabel: 'certain', source: a,
      source_info: { size: 4, mtime_fmt: '2024-01-01' },
      matches: [{ path: b, md5_match: false, size: 4, mtime_fmt: '2024-01-01' }]
    }]);
    await executeActions(resultFile,
      { actions: { certain: 'recycle_removed' }, selections: { [a]:'keep', [b]:'remove' },
        locked: [b], reproduceStructure: false },
      false
    );
    expect(fs.existsSync(b)).toBe(true); // locked, not recycled
  });
});

describe('executeActions — pickWinner strategies', () => {
  async function testStrategy(strategy, files, expectedWinner) {
    const { executeActions } = require('../../src/core/actions');
    const dest = path.join(tmpDir, 'quarantine');
    const resultFile = makeResult([{
      confidenceLabel: 'certain',
      source: files[0].path,
      source_info: files[0].info,
      matches: files.slice(1).map(f => ({ path: f.path, md5_match: false, size: f.info.size, mtime_fmt: f.info.mtime_fmt, width: f.info.width, height: f.info.height }))
    }]);
    await executeActions(resultFile,
      { actions: { certain: strategy }, selections: {}, locked: [], removeTarget: dest, reproduceStructure: false },
      false
    );
    expect(fs.existsSync(files.find(f => f.name === expectedWinner).path)).toBe(true);
    files.filter(f => f.name !== expectedWinner).forEach(f => {
      expect(fs.existsSync(f.path)).toBe(false);
    });
  }

  test('keep_largest keeps biggest file', async () => {
    const a = write('a.jpg', Buffer.alloc(1000));
    const b = write('b.jpg', Buffer.alloc(5000));
    const { executeActions } = require('../../src/core/actions');
    const dest = path.join(tmpDir, 'q');
    const resultFile = makeResult([{
      confidenceLabel:'certain', source:a,
      source_info:{size:1000, mtime_fmt:'2024-01-01', width:100, height:100},
      matches:[{path:b, md5_match:false, size:5000, mtime_fmt:'2024-01-01', width:100, height:100}]
    }]);
    await executeActions(resultFile,
      {actions:{certain:'keep_largest'},selections:{},locked:[],removeTarget:dest,reproduceStructure:false}, false);
    expect(fs.existsSync(b)).toBe(true);  // larger file kept
    expect(fs.existsSync(a)).toBe(false); // smaller moved
  });

  test('keep_highest_res keeps most pixels', async () => {
    const a = write('lo.jpg');
    const b = write('hi.jpg');
    const { executeActions } = require('../../src/core/actions');
    const dest = path.join(tmpDir, 'q');
    const resultFile = makeResult([{
      confidenceLabel:'certain', source:a,
      source_info:{size:100, mtime_fmt:'2024-01-01', width:100, height:100},
      matches:[{path:b, md5_match:false, size:100, mtime_fmt:'2024-01-01', width:1920, height:1080}]
    }]);
    await executeActions(resultFile,
      {actions:{certain:'keep_highest_res'},selections:{},locked:[],removeTarget:dest,reproduceStructure:false}, false);
    expect(fs.existsSync(b)).toBe(true);  // higher res kept
    expect(fs.existsSync(a)).toBe(false);
  });
});

describe('safeMoveSync — cross-device fallback', () => {
  const path = require('path');
  const fs   = require('fs');
  const os   = require('os');

  test('moves file correctly within same filesystem', () => {
    const { moveFile } = require('../../src/core/actions');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-xdev-'));
    const src  = path.join(tmp, 'src.jpg');
    const dest = path.join(tmp, 'subdir');
    fs.writeFileSync(src, 'test');

    moveFile(src, dest, false);

    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(path.join(dest, 'src.jpg'))).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('EXDEV error falls back to copy+delete', () => {
    // Simulate EXDEV by mocking renameSync to throw EXDEV once
    const fsMod = require('fs');
    const origRename = fsMod.renameSync.bind(fsMod);
    let called = false;
    fsMod.renameSync = (src, dest) => {
      if (!called) {
        called = true;
        const err = new Error('EXDEV');
        err.code = 'EXDEV';
        throw err;
      }
      origRename(src, dest);
    };

    try {
      jest.resetModules();
      const { moveFile } = require('../../src/core/actions');
      const tmp  = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'dnm-xdev2-'));
      const src  = require('path').join(tmp, 'src.jpg');
      const dest = require('path').join(tmp, 'out');
      require('fs').writeFileSync(src, 'xdev test');

      moveFile(src, dest, false);

      expect(require('fs').existsSync(src)).toBe(false);
      expect(require('fs').existsSync(require('path').join(dest, 'src.jpg'))).toBe(true);
      require('fs').rmSync(tmp, { recursive: true, force: true });
    } finally {
      fsMod.renameSync = origRename;
      jest.resetModules();
    }
  });
});
