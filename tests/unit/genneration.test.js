'use strict';
/**
 * Real-image matching tests on the "Genneration" set (215 AI-generated
 * drawings supplied by the project owner, see tests/fixtures/genneration).
 *
 * truth.exact — the same picture saved again (different file size / JPEG
 *               compression, same pixels to the eye). Every perceptual
 *               preset should put each of these in one group.
 * truth.near  — the same drawing with small visible differences (contrast,
 *               a few strokes). Looser presets should group them.
 * Everything else is a different picture, even when it is another drawing
 * of the same pose (the set has ~50 of the woman-at-the-railing drawing).
 *
 * hashes.json holds the hashes of all 215 files, so the preset table below
 * runs on the whole set; images/ holds a 31-file subset so the hasher itself
 * is also tested on real files.
 */

const path = require('path');
const fs   = require('fs');
const { computeHashes, hammingDistance } = require('../../src/core/hasher');
const { buildGroups } = require('../../src/core/comparator');
const { loadProfiles } = require('../../src/core/config');

const FIX     = path.join(__dirname, '../fixtures/genneration');
const DATA    = JSON.parse(fs.readFileSync(path.join(FIX, 'hashes.json'), 'utf8'));
const ALGOS   = ['dhash', 'phash', 'ahash', 'whash', 'mhash', 'bhash'];
const profile = id => loadProfiles().find(p => p.id === id).scan;

// Score buildGroups output against the truth.
function score(groups, names) {
  const inSet = new Set(names);
  const gid = new Map();
  groups.forEach((g, k) => [g.source, ...g.matches.map(m => m.path)].forEach(p => gid.set(p, k)));
  const same = (a, b) => gid.has(a) && gid.get(a) === gid.get(b);
  const together = c => c.every(n => same(n, c[0]));
  const exact = DATA.truth.exact.filter(c => c.every(n => inSet.has(n)));
  const near  = DATA.truth.near.filter(c => c.every(n => inSet.has(n)));

  const unit = new Map(); // file → its truth unit (near set, else exact group)
  exact.forEach((c, k) => c.forEach(n => unit.set(n, 'e' + k)));
  near.forEach((c, k)  => c.forEach(n => unit.set(n, 'n' + k)));
  const exactOf = new Map();
  exact.forEach((c, k) => c.forEach(n => exactOf.set(n, k)));

  let nearPairs = 0, nearFound = 0;
  for (const c of near) for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
    if (exactOf.has(c[i]) && exactOf.get(c[i]) === exactOf.get(c[j])) continue;
    nearPairs++;
    if (same(c[i], c[j])) nearFound++;
  }
  let wrongGroups = 0, largest = 0;
  for (const g of groups) {
    const members = [g.source, ...g.matches.map(m => m.path)];
    largest = Math.max(largest, members.length);
    if (new Set(members.map(n => unit.get(n) || n)).size > 1) wrongGroups++;
  }
  return {
    exactFound: exact.filter(together).length, exactTotal: exact.length,
    nearFound, nearPairs, wrongGroups, largest
  };
}

const hashedFiles = () => DATA.files.map(f => ({ ...f, path: f.name }));

describe('Genneration set — whole set (stored hashes)', () => {
  test('truth covers the expected files', () => {
    expect(DATA.files).toHaveLength(215);
    expect(DATA.truth.exact).toHaveLength(53);
    expect(DATA.truth.near).toHaveLength(4);
  });

  test('re-saved copies stay within a few bits on every algorithm', () => {
    const byName = new Map(DATA.files.map(f => [f.name, f]));
    for (const c of DATA.truth.exact) {
      for (let i = 1; i < c.length; i++) {
        const a = byName.get(c[0]), b = byName.get(c[i]);
        expect(hammingDistance(a.dhash, b.dhash)).toBeLessThanOrEqual(8);
        expect(hammingDistance(a.phash, b.phash)).toBeLessThanOrEqual(2);
        expect(hammingDistance(a.whash, b.whash)).toBeLessThanOrEqual(4);
      }
    }
  });

  // Current behaviour of every built-in preset on this set. This is a
  // baseline, not a target: when a preset or the comparator changes, update
  // the numbers on purpose and say why in the commit.
  //   exactFound/53  re-saved copies grouped together
  //   nearFound/17   near-duplicate pairs grouped together
  //   wrongGroups    groups that mix different pictures
  //   largest        size of the largest group
  const BASELINE = {
    exact_only:    { exactFound:  0, nearFound:  0, wrongGroups:  0, largest:  0 },
    quick:         { exactFound: 48, nearFound:  4, wrongGroups:  0, largest:  3 },
    strict:        { exactFound: 46, nearFound:  4, wrongGroups:  0, largest:  3 },
    balanced:      { exactFound: 53, nearFound: 17, wrongGroups: 14, largest: 54 },
    media_library: { exactFound: 53, nearFound:  8, wrongGroups:  0, largest:  4 },
    thorough:      { exactFound: 53, nearFound: 17, wrongGroups: 14, largest: 56 },
    loose:         { exactFound: 53, nearFound: 17, wrongGroups: 16, largest: 63 },
    aggressive:    { exactFound: 53, nearFound: 17, wrongGroups: 16, largest: 63 },
    web_downloads: { exactFound: 53, nearFound: 17, wrongGroups: 16, largest: 63 },
    max_coverage:  { exactFound: 53, nearFound: 17, wrongGroups: 17, largest: 91 },
  };

  test.each(Object.keys(BASELINE))('preset %s matches its baseline', async (id) => {
    const groups = await buildGroups(hashedFiles(), profile(id));
    const s = score(groups, DATA.files.map(f => f.name));
    expect(s.exactTotal).toBe(53);
    expect(s.nearPairs).toBe(17);
    expect({ exactFound: s.exactFound, nearFound: s.nearFound, wrongGroups: s.wrongGroups, largest: s.largest })
      .toEqual(BASELINE[id]);
  });

  test('raising a threshold never splits a group (monotonic)', async () => {
    const pairsTogether = groups => {
      const set = new Set();
      for (const g of groups) {
        const m = [g.source, ...g.matches.map(x => x.path)].sort();
        for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) set.add(m[i] + '|' + m[j]);
      }
      return set;
    };
    let prev = null;
    for (const t of [4, 8, 12, 16, 20]) {
      const sc = { algorithms: { dhash: true, phash: true, ahash: true }, thresholds: { dhash: t, phash: t, ahash: t }, ensureMin: 1 };
      const cur = pairsTogether(await buildGroups(hashedFiles(), sc));
      if (prev) for (const p of prev) expect(cur.has(p)).toBe(true);
      prev = cur;
    }
  });
});

describe('Genneration set — real files', () => {
  const names = DATA.imagesInRepo;
  const stored = new Map(DATA.files.map(f => [f.name, f]));
  let hashed;

  beforeAll(async () => {
    const cfg = { compareSize: 16, algorithms: Object.fromEntries(ALGOS.map(a => [a, true])) };
    hashed = await Promise.all(names.map(async n => ({ name: n, path: n, ...(await computeHashes(path.join(FIX, 'images', n), cfg)) })));
  }, 60000);

  test('all subset images are present', () => {
    for (const n of names) expect(fs.existsSync(path.join(FIX, 'images', n))).toBe(true);
  });

  test('hashes of the real files match the stored hashes', () => {
    // A different libvips/libjpeg build may round a few pixels differently,
    // so allow a couple of bits; anything more means the hasher changed.
    for (const h of hashed) {
      const s = stored.get(h.name);
      expect(h.md5).toBe(s.md5);
      for (const a of ALGOS) expect(hammingDistance(h[a], s[a])).toBeLessThanOrEqual(a === 'dhash' || a === 'ahash' ? 4 : 2);
    }
  });

  test('wHash differs between different pictures', () => {
    expect(new Set(hashed.map(h => h.whash)).size).toBeGreaterThan(names.length / 2);
  });

  test('media_library groups every re-saved copy in the subset without mixing pictures', async () => {
    const groups = await buildGroups(hashed.map(h => ({ ...h })), profile('media_library'));
    const s = score(groups, names);
    expect(s.exactFound).toBe(s.exactTotal);
    expect(s.wrongGroups).toBe(0);
  });

  test('strict finds the re-saved copies in the subset that it can see', async () => {
    const groups = await buildGroups(hashed.map(h => ({ ...h })), profile('strict'));
    const s = score(groups, names);
    expect(s.wrongGroups).toBe(0);
    expect(s.exactFound).toBeGreaterThan(0);
  });
});
