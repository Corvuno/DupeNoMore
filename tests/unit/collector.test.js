'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { collectFiles } = require('../../src/core/collector');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-col-'));
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function write(rel, sizeBytes = 20000) {
  const p = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(sizeBytes));
  return p;
}

const BASE_FILTERS = {
  minSizeKB: 0, maxSizeMB: 0,
  dateFrom: null, dateTo: null, dateType: 'file',
  excludePatterns: [], skipSystemFolders: false,
  extensions: ['jpg','png'], includeVideos: false
};

describe('collectFiles', () => {
  test('collects matching extension files', async () => {
    write('a.jpg'); write('b.png'); write('c.txt');
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      BASE_FILTERS
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('a.jpg');
    expect(names).toContain('b.png');
    expect(names).not.toContain('c.txt');
  });

  test('respects minSizeKB filter', async () => {
    write('big.jpg', 50000);  // 50KB
    write('small.jpg', 5000); // 5KB
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      { ...BASE_FILTERS, minSizeKB: 10 }
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('big.jpg');
    expect(names).not.toContain('small.jpg');
  });

  test('respects maxSizeMB filter', async () => {
    write('big.jpg', 2 * 1024 * 1024);  // 2MB
    write('small.jpg', 100 * 1024);      // 100KB
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      { ...BASE_FILTERS, maxSizeMB: 1 }
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).not.toContain('big.jpg');
    expect(names).toContain('small.jpg');
  });

  test('recursive includes subdirectories', async () => {
    write('sub/nested.jpg');
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: true, index: 0 }],
      BASE_FILTERS
    );
    expect(files.some(f => f.path.includes('nested.jpg'))).toBe(true);
  });

  test('non-recursive excludes subdirectories', async () => {
    write('top.jpg'); write('sub/nested.jpg');
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      BASE_FILTERS
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('top.jpg');
    expect(names).not.toContain('nested.jpg');
  });

  test('inactive folder is skipped', async () => {
    write('a.jpg');
    const files = await collectFiles(
      [{ path: tmpDir, active: false, recursive: true, index: 0 }],
      BASE_FILTERS
    );
    expect(files.length).toBe(0);
  });

  test('nonexistent folder is skipped with warning', async () => {
    const warnings = [];
    const files = await collectFiles(
      [{ path: '/nonexistent/path', active: true, recursive: true, index: 0 }],
      BASE_FILTERS,
      msg => { if (msg.type === 'warn') warnings.push(msg.message); }
    );
    expect(files.length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('excludePatterns filters out matching directories', async () => {
    write('keep/a.jpg'); write('skip/b.jpg');
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: true, index: 0 }],
      { ...BASE_FILTERS, excludePatterns: ['*skip*'] }
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('a.jpg');
    expect(names).not.toContain('b.jpg');
  });

  test('empty extensions means all image types', async () => {
    write('a.jpg'); write('b.webp'); write('c.heic'); write('d.txt');
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      { ...BASE_FILTERS, extensions: [] }
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('a.jpg');
    expect(names).toContain('b.webp');
    expect(names).not.toContain('d.txt');
  });

  test('includeVideos adds video extensions', async () => {
    write('a.jpg'); write('b.mp4');
    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      { ...BASE_FILTERS, extensions: [], includeVideos: true }
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('a.jpg');
    expect(names).toContain('b.mp4');
  });

  test('dateFrom filter excludes old files', async () => {
    write('recent.jpg');
    const oldPath = write('old.jpg');
    // Set mtime to 2020
    const oldTime = new Date('2020-01-01').getTime() / 1000;
    fs.utimesSync(oldPath, oldTime, oldTime);

    const files = await collectFiles(
      [{ path: tmpDir, active: true, recursive: false, index: 0 }],
      { ...BASE_FILTERS, dateFrom: '2024-01-01', dateType: 'file' }
    );
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('recent.jpg');
    expect(names).not.toContain('old.jpg');
  });

  test('deduplicates files appearing in overlapping folders', async () => {
    write('a.jpg');
    // Same folder twice
    const folders = [
      { path: tmpDir, active: true, recursive: false, index: 0 },
      { path: tmpDir, active: true, recursive: false, index: 1 }
    ];
    const files = await collectFiles(folders, BASE_FILTERS);
    // Should appear only once
    const paths = files.map(f => f.path);
    expect(paths.length).toBe(new Set(paths).size);
  });

  test('folderIndex is correctly assigned', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-col2-'));
    try {
      write('a.jpg');
      fs.writeFileSync(path.join(dir2, 'b.jpg'), Buffer.alloc(20000));
      const files = await collectFiles(
        [
          { path: tmpDir, active: true, recursive: false, index: 0 },
          { path: dir2,   active: true, recursive: false, index: 1 }
        ],
        BASE_FILTERS
      );
      const aFile = files.find(f => f.path.endsWith('a.jpg'));
      const bFile = files.find(f => f.path.endsWith('b.jpg'));
      expect(aFile?.folderIndex).toBe(0);
      expect(bFile?.folderIndex).toBe(1);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('collectFiles — exclude patterns on file names', () => {
  const root = () => [{ path: tmpDir, active: true, recursive: true, index: 0 }];
  const names = files => files.map(f => path.basename(f.path)).sort();

  test('exact file name is excluded (case-insensitive)', async () => {
    write('keep.jpg'); write('sub/Thumbs.JPG');
    const files = await collectFiles(root(), { ...BASE_FILTERS, excludePatterns: ['thumbs.jpg'] });
    expect(names(files)).toEqual(['keep.jpg']);
  });

  test('* and ? wildcards match file names', async () => {
    write('IMG_0012.jpg'); write('IMG_1012.jpg'); write('photo_thumb.png');
    const files = await collectFiles(root(), { ...BASE_FILTERS, excludePatterns: ['IMG_00??.jpg', '*_thumb*'] });
    expect(names(files)).toEqual(['IMG_1012.jpg']);
  });

  test('a file-name pattern does not exclude a whole folder with a similar name', async () => {
    write('thumbs/a.jpg');
    const files = await collectFiles(root(), { ...BASE_FILTERS, excludePatterns: ['*_thumb*'] });
    expect(names(files)).toEqual(['a.jpg']);
  });

  test('folder patterns still exclude folders', async () => {
    write('Backup/old/a.jpg'); write('b.jpg');
    const files = await collectFiles(root(), { ...BASE_FILTERS, excludePatterns: ['Backup'] });
    expect(names(files)).toEqual(['b.jpg']);
  });

  test('a pattern with a path separator matches files by full path', async () => {
    write('x/a.png'); write('y/a.png');
    const files = await collectFiles(root(), { ...BASE_FILTERS, excludePatterns: ['/x/*.png'] });
    expect(files.map(f => f.path)).toEqual([path.join(tmpDir, 'y', 'a.png')]);
  });
});
