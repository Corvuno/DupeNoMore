'use strict';
const { buildGroups, areDuplicates, CONFIDENCE, MAX_GROUP_SIZE } = require('../../src/core/comparator');

const CFG = {
  algorithms: { dhash: true, phash: true },
  thresholds:  { dhash: 8, phash: 12 },
  ensureMin:   2,
  matchLogic:  'threshold'
};

function mkFile(id, dhash, phash, opts = {}) {
  return { path: `/f/${id}.jpg`, md5: `md5_${id}`, dhash, phash,
    size: 100000, folderIndex: opts.fi || 0, mtime: Date.now(), width: 1000, height: 1000 };
}

const H0 = '0000000000000000';
const HF = 'ffffffffffffffff';
const H1 = '0000000000000001'; // 1 bit from H0

// ── areDuplicates ─────────────────────────────────────────────────────────────
describe('areDuplicates', () => {
  test('MD5 match → certain regardless of hashes', async () => {
    const a = mkFile('a', H0, H0); a.md5 = 'same';
    const b = mkFile('b', HF, HF); b.md5 = 'same';
    const r = areDuplicates(a, b, CFG);
    expect(r.match).toBe(true);
    expect(r.confidence).toBe(CONFIDENCE.CERTAIN);
    expect(r.md5Match).toBe(true);
  });

  test('identical hashes → match', async () => {
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H0,H0), CFG);
    expect(r.match).toBe(true);
    expect(r.md5Match).toBe(false);
  });

  test('completely different hashes → no match', async () => {
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',HF,HF), CFG);
    expect(r.match).toBe(false);
  });

  test('ensureMin=2 requires both algos to agree', async () => {
    // dhash matches, phash doesn't
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H1,HF), CFG);
    expect(r.match).toBe(false); // only 1 algo agreed, need 2
  });

  test('ensureMin=1 accepts single algo match', async () => {
    const cfg = { ...CFG, ensureMin: 1 };
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H1,HF), cfg);
    expect(r.match).toBe(true);
  });

  test('matchLogic=and requires all algos', async () => {
    const cfg = { ...CFG, matchLogic: 'and' };
    // dhash close, phash far
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H1,HF), cfg);
    expect(r.match).toBe(false);
  });

  test('matchLogic=or accepts any algo', async () => {
    const cfg = { ...CFG, matchLogic: 'or', ensureMin: 1 };
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H1,HF), cfg);
    expect(r.match).toBe(true);
  });

  test('anchor hash mismatch blocks match', async () => {
    const cfg = { ...CFG, anchorHash: 'phash' };
    // phash far apart → no match even if dhash is close
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H0,HF), cfg);
    expect(r.match).toBe(false);
  });

  test('missing hashes are skipped gracefully', async () => {
    const a = { path:'/a', md5:'a', size:100, folderIndex:0 };
    const b = { path:'/b', md5:'b', size:100, folderIndex:0 };
    const r = areDuplicates(a, b, CFG);
    expect(r.match).toBe(false);
  });

  test('no active algorithms → no match', async () => {
    const cfg = { ...CFG, algorithms: {} };
    const r = areDuplicates(mkFile('a',H0,H0), mkFile('b',H0,H0), cfg);
    expect(r.match).toBe(false);
  });

  test('confidence levels based on algo agreement', async () => {
    const cfg = { algorithms:{dhash:true,phash:true,ahash:true}, thresholds:{dhash:8,phash:12,ahash:10}, ensureMin:1, matchLogic:'or' };
    const a = mkFile('a',H0,H0); a.ahash=H0;
    const b = mkFile('b',H0,H0); b.ahash=H0;
    const r = areDuplicates(a, b, cfg);
    expect(r.match).toBe(true);
    expect(r.confidence).toBe(CONFIDENCE.CERTAIN); // 3 algos agree
  });
});

// ── buildGroups ───────────────────────────────────────────────────────────────
describe('buildGroups — MD5 exact', () => {
  test('exact MD5 pair forms certain group', async () => {
    const files = [
      { path:'/a/1.jpg', md5:'same', dhash:H0, phash:H0, size:100, folderIndex:0, mtime:1 },
      { path:'/b/2.jpg', md5:'same', dhash:H0, phash:H0, size:100, folderIndex:1, mtime:1 }
    ];
    const groups = await buildGroups(files, CFG);
    expect(groups.length).toBe(1);
    expect(groups[0].confidenceLabel).toBe('certain');
    expect(groups[0].matches[0].md5_match).toBe(true);
  });

  test('source is lowest-folderIndex file', async () => {
    const files = [
      { path:'/hi/2.jpg', md5:'same', dhash:H0, phash:H0, size:100, folderIndex:1, mtime:1 },
      { path:'/lo/1.jpg', md5:'same', dhash:H0, phash:H0, size:100, folderIndex:0, mtime:1 }
    ];
    const groups = await buildGroups(files, CFG);
    expect(groups[0].source).toBe('/lo/1.jpg');
    expect(groups[0].matches[0].path).toBe('/hi/2.jpg');
  });

  test('three-way MD5 match → one group with 2 matches', async () => {
    const files = [0,1,2].map(i => ({
      path:`/f/${i}.jpg`, md5:'same', dhash:H0, phash:H0,
      size:100, folderIndex:i, mtime:1
    }));
    const groups = await buildGroups(files, CFG);
    expect(groups.length).toBe(1);
    expect(groups[0].matches.length).toBe(2);
  });

  test('unique MD5s produce no groups', async () => {
    const files = [
      { path:'/a.jpg', md5:'aaa', dhash:H0, phash:H0, size:100, folderIndex:0, mtime:1 },
      { path:'/b.jpg', md5:'bbb', dhash:HF, phash:HF, size:100, folderIndex:0, mtime:1 }
    ];
    expect((await buildGroups(files, CFG)).length).toBe(0);
  });
});

describe('buildGroups — perceptual (bucket approach)', () => {
  test('near-identical hashes form a group', async () => {
    // Realistic hashes (enough bits set to not be flagged as degenerate/solid).
    // 1-bit difference in dhash, identical phash — within threshold, ensureMin=2.
    const a = { path:'/a.jpg', md5:'a1', dhash:'a5a5a5a5a5a5a5a5', phash:'c3c3c3c3c3c3c3c3', size:100, folderIndex:0, mtime:1 };
    const b = { path:'/b.jpg', md5:'b1', dhash:'a5a5a5a5a5a5a5a4', phash:'c3c3c3c3c3c3c3c3', size:100, folderIndex:0, mtime:1 };
    const groups = await buildGroups([a,b], CFG);
    expect(groups.length).toBe(1);
  });

  test('large hamming distance → no group', async () => {
    const a = { path:'/a.jpg', md5:'a1', dhash:'a5a5a5a5a5a5a5a5', phash:'a5a5a5a5a5a5a5a5', size:100, folderIndex:0, mtime:1 };
    const b = { path:'/b.jpg', md5:'b1', dhash:'5a5a5a5a5a5a5a5a', phash:'5a5a5a5a5a5a5a5a', size:100, folderIndex:0, mtime:1 };
    expect((await buildGroups([a,b], CFG)).length).toBe(0);
  });

  test('groups sorted certain first', async () => {
    const files = [
      { path:'/md5a.jpg', md5:'dup', dhash:'a5a5a5a5a5a5a5a5', phash:'c3c3c3c3c3c3c3c3', size:100, folderIndex:0, mtime:1 },
      { path:'/md5b.jpg', md5:'dup', dhash:'a5a5a5a5a5a5a5a5', phash:'c3c3c3c3c3c3c3c3', size:100, folderIndex:1, mtime:1 },
      { path:'/perc1.jpg', md5:'u1', dhash:'5a5a5a5a5a5a5a5a', phash:'3c3c3c3c3c3c3c3c', size:100, folderIndex:0, mtime:1 },
      { path:'/perc2.jpg', md5:'u2', dhash:'5a5a5a5a5a5a5a5b', phash:'3c3c3c3c3c3c3c3c', size:100, folderIndex:1, mtime:1 },
    ];
    const groups = await buildGroups(files, CFG);
    expect(groups[0].confidenceLabel).toBe('certain'); // MD5 first
  });

  test('ensureMin=1 finds single-algo matches', async () => {
    const cfg = { ...CFG, ensureMin: 1 };
    const a = { path:'/a.jpg', md5:'a1', dhash:'a5a5a5a5a5a5a5a5', phash:'5a5a5a5a5a5a5a5a', size:100, folderIndex:0, mtime:1 };
    const b = { path:'/b.jpg', md5:'b1', dhash:'a5a5a5a5a5a5a5a5', phash:'a5a5a5a5a5a5a5a5', size:100, folderIndex:1, mtime:1 };
    expect((await buildGroups([a,b], cfg)).length).toBe(1);
  });

  test('group size cap prevents runaway groups', async () => {
    // 55 files all with identical hashes — each source sees >50 candidates → capped
    // The cap means NO group has more than MAX_GROUP_SIZE matches
    const files = Array.from({length: 55}, (_, i) => ({
      path:`/f/${i}.jpg`, md5:`u${i}`, dhash:H0, phash:H0,
      size:100, folderIndex:0, mtime:1
    }));
    const groups = await buildGroups(files, { ...CFG, ensureMin: 1 });
    // No group should exceed the cap
    expect(groups.every(g => g.matches.length < MAX_GROUP_SIZE)).toBe(true);
  });
});

describe('buildGroups — performance', () => {
  test('1000 files complete without error (correctness over speed)', async () => {
    const N = 1000;
    const files = Array.from({length: N}, (_, i) => {
      const h = (i * 2654435761 % 0xFFFFFFFF).toString(16).padStart(8,'0').repeat(2);
      return { path:`/f/${i}.jpg`, md5:`u${i}`, dhash:h, phash:h, size:100, folderIndex:0, mtime:1 };
    });
    const groups = await buildGroups(files, CFG);
    expect(Array.isArray(groups)).toBe(true);
  }, 60000);
});
