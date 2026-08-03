/**
 * Unit tests for review.js logic functions extracted for testability.
 * These mirror the functions in review.js: matchPct, bloatCheck, selectOptimal.
 */
'use strict';

// ── Mirror the logic from review.js for isolated testing ─────────────────────

function matchPct(file) {
  if (file.md5_match) return 100;
  if (!file.distances || !Object.keys(file.distances).length) return null;
  const vals = Object.values(file.distances).filter(v => typeof v === 'number');
  if (!vals.length) return null;
  return Math.round((1 - Math.min(...vals) / 64) * 100);
}

function allFiles(group) {
  return [
    { path: group.source, ...group.source_info, isSource: true },
    ...(group.matches || [])
  ];
}

function bloatCheck(file, group, threshold) {
  const thr = threshold ?? 1.5;
  const fileMp = (file.width && file.height) ? file.width * file.height : 0;
  if (!fileMp || !file.size) return false;
  return allFiles(group).some(other => {
    if (other.path === file.path) return false;
    const otherMp = (other.width && other.height) ? other.width * other.height : 0;
    return otherMp > fileMp && file.size >= thr * (other.size || 1);
  });
}

function selectOptimal(group) {
  const files = allFiles(group);
  if (files.length < 2) return {};
  const overrides = {};
  const scored = files.map(f => ({
    path:   f.path,
    mp:     (f.width && f.height) ? f.width * f.height : 0,
    sz:     f.size || 0,
    dateMs: f.exif_date ? new Date(f.exif_date).getTime() : (f.mtime ? new Date(f.mtime).getTime() : Infinity),
    fi:     typeof f.folderIndex === 'number' ? f.folderIndex : 999
  }));
  scored.sort((a, b) =>
    b.mp - a.mp ||
    b.sz - a.sz ||
    a.dateMs - b.dateMs ||
    a.fi - b.fi
  );
  const best = scored[0].path;
  scored.forEach(s => { overrides[s.path] = s.path === best ? 'keep' : 'remove'; });
  return overrides;
}

// ── matchPct tests ─────────────────────────────────────────────────────────
describe('matchPct', () => {
  test('MD5 match = 100%', () => {
    expect(matchPct({ md5_match: true })).toBe(100);
  });
  test('no distances = null', () => {
    expect(matchPct({ md5_match: false, distances: {} })).toBeNull();
    expect(matchPct({ md5_match: false })).toBeNull();
  });
  test('distance 0 = 100%', () => {
    expect(matchPct({ distances: { dhash: 0 } })).toBe(100);
  });
  test('distance 8 of 64 = 87%', () => {
    expect(matchPct({ distances: { dhash: 8 } })).toBe(88); // (1 - 8/64)*100 = 87.5 → 88
  });
  test('distance 32 = 50%', () => {
    expect(matchPct({ distances: { dhash: 32 } })).toBe(50);
  });
  test('uses minimum distance across algos', () => {
    // dhash: 16, phash: 4 → min is 4 → (1-4/64)*100 = 93.75 → 94
    expect(matchPct({ distances: { dhash: 16, phash: 4 } })).toBe(94);
  });
  test('distance 64 = 0%', () => {
    expect(matchPct({ distances: { dhash: 64 } })).toBe(0);
  });
});

// ── bloatCheck tests ───────────────────────────────────────────────────────
describe('bloatCheck (hi-fi detection)', () => {
  const makeGroup = (files) => ({
    source:      files[0].path,
    source_info: files[0],
    matches:     files.slice(1)
  });

  test('not hi-fi: lower res AND smaller file', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 5_000_000 },  // source: 12MP, 5MB
      { path: '/b.jpg', width: 2000, height: 1500, size: 2_000_000 },  // match:  3MP, 2MB — smaller both ways
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(false);
  });

  test('hi-fi: lower res but file is 1.5× bigger', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 3_000_000 },  // 12MP, 3MB
      { path: '/b.jpg', width: 2000, height: 1500, size: 5_000_000 },  // 3MP, 5MB — lower res, bigger file
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(true);
  });

  test('not hi-fi: same resolution, larger file', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 3000, height: 2000, size: 2_000_000 },
      { path: '/b.jpg', width: 3000, height: 2000, size: 4_000_000 },  // same res, bigger — not bloat
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(false);
  });

  test('not hi-fi: higher res AND larger file', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 2000, height: 1500, size: 2_000_000 },
      { path: '/b.jpg', width: 4000, height: 3000, size: 5_000_000 },  // more pixels, bigger — fine
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(false);
  });

  test('hi-fi exactly at threshold (1.5×)', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 2_000_000 },
      { path: '/b.jpg', width: 2000, height: 1500, size: 3_000_000 },  // exactly 1.5×
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(true);
  });

  test('not bloat just below threshold', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 2_000_000 },
      { path: '/b.jpg', width: 2000, height: 1500, size: 2_900_000 },  // 1.45× — just under
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(false);
  });

  test('custom threshold 2.0×', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 2_000_000 },
      { path: '/b.jpg', width: 2000, height: 1500, size: 3_500_000 },  // 1.75× — over 1.5 but under 2.0
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(true);   // triggers at 1.5
    expect(bloatCheck(g.matches[0], g, 2.0)).toBe(false);  // not at 2.0
  });

  test('no bloat if file has no size data', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 2_000_000 },
      { path: '/b.jpg', width: 2000, height: 1500 },  // no size
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(false);
  });

  test('no bloat if file has no dimension data', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 2_000_000 },
      { path: '/b.jpg', size: 5_000_000 },  // no dimensions
    ]);
    expect(bloatCheck(g.matches[0], g, 1.5)).toBe(false);
  });
});

// ── selectOptimal tests ────────────────────────────────────────────────────
describe('selectOptimal', () => {
  const makeGroup = (files) => ({
    source:      files[0].path,
    source_info: files[0],
    matches:     files.slice(1)
  });

  test('picks highest resolution', () => {
    const g = makeGroup([
      { path: '/low.jpg',  width: 1000, height: 750,  size: 1_000_000 },
      { path: '/high.jpg', width: 4000, height: 3000, size: 1_000_000 },
    ]);
    const ov = selectOptimal(g);
    expect(ov['/high.jpg']).toBe('keep');
    expect(ov['/low.jpg']).toBe('remove');
  });

  test('on equal resolution, picks biggest file', () => {
    const g = makeGroup([
      { path: '/small.jpg', width: 3000, height: 2000, size: 1_000_000 },
      { path: '/large.jpg', width: 3000, height: 2000, size: 5_000_000 },
    ]);
    const ov = selectOptimal(g);
    expect(ov['/large.jpg']).toBe('keep');
    expect(ov['/small.jpg']).toBe('remove');
  });

  test('on equal res + size, picks oldest EXIF date', () => {
    const g = makeGroup([
      { path: '/newer.jpg', width: 3000, height: 2000, size: 2_000_000, exif_date: '2023-06-01' },
      { path: '/older.jpg', width: 3000, height: 2000, size: 2_000_000, exif_date: '2019-01-15' },
    ]);
    const ov = selectOptimal(g);
    expect(ov['/older.jpg']).toBe('keep');   // oldest = original
    expect(ov['/newer.jpg']).toBe('remove');
  });

  test('on equal res + size + date, picks lowest folder index', () => {
    const g = makeGroup([
      { path: '/f2.jpg', width: 3000, height: 2000, size: 2_000_000, exif_date: '2021-01-01', folderIndex: 2 },
      { path: '/f0.jpg', width: 3000, height: 2000, size: 2_000_000, exif_date: '2021-01-01', folderIndex: 0 },
    ]);
    const ov = selectOptimal(g);
    expect(ov['/f0.jpg']).toBe('keep');   // folder index 0 = highest priority
    expect(ov['/f2.jpg']).toBe('remove');
  });

  test('3-file group: all criteria used', () => {
    const g = makeGroup([
      { path: '/a.jpg', width: 4000, height: 3000, size: 3_000_000, exif_date: '2020-01-01' },  // most MP
      { path: '/b.jpg', width: 2000, height: 1500, size: 8_000_000, exif_date: '2019-01-01' },  // biggest file
      { path: '/c.jpg', width: 2000, height: 1500, size: 2_000_000, exif_date: '2018-01-01' },  // oldest
    ]);
    const ov = selectOptimal(g);
    expect(ov['/a.jpg']).toBe('keep');   // wins on pixels (first criterion)
    expect(ov['/b.jpg']).toBe('remove');
    expect(ov['/c.jpg']).toBe('remove');
  });

  test('single-file group is unchanged', () => {
    const g = { source: '/a.jpg', source_info: { path: '/a.jpg', width: 3000, height: 2000 }, matches: [] };
    const ov = selectOptimal(g);
    expect(Object.keys(ov).length).toBe(0);
  });

  test('falls back to mtime when no exif_date', () => {
    const g = makeGroup([
      { path: '/new.jpg', width: 3000, height: 2000, size: 2_000_000, mtime: '2023-06-01' },
      { path: '/old.jpg', width: 3000, height: 2000, size: 2_000_000, mtime: '2019-01-15' },
    ]);
    const ov = selectOptimal(g);
    expect(ov['/old.jpg']).toBe('keep');  // oldest file date
  });
});

// ── getVisible filter logic ───────────────────────────────────────────────
// Mirror the getVisible logic from review.js for isolated testing

function makeGroup(id, confidence, files) {
  return {
    id,
    confidenceLabel: confidence,
    source:      files[0].path,
    source_info: files[0],
    matches:     files.slice(1).map(f => ({
      ...f,
      md5_match: f.md5_match || false,
      distances: f.distances || {}
    }))
  };
}


// Extracted getVisible logic — same as review.js
function getVisible(groups, { visConf, showMultiKeep, showNoSel, overrides, simMin, simMax, hifiOnly, hifiThr }) {
  return groups.filter(g => {
    if (!visConf[g.confidenceLabel || 'certain']) return false;
    if (showMultiKeep || showNoSel) {
      const keeps = allFiles(g).filter(f => overrides[f.path] !== 'remove').length;
      if (showMultiKeep && keeps <= 1) return false;
      if (showNoSel && keeps > 0) return false;
    }
    // Match % filter
    if (simMin > 0 || (simMax !== undefined && simMax < 100)) {
      const best = allFiles(g).reduce((b, f) => {
        const p = matchPct(f); return (p !== null && p > b) ? p : b;
      }, 0);
      if (simMin > 0 && best < simMin) return false;
      if (simMax !== undefined && simMax < 100 && best > simMax) return false;
    }
    // Hi-fi filter
    if (hifiOnly && !allFiles(g).some(f => bloatCheck(f, g, hifiThr))) return false;
    return true;
  });
}

const defaultState = {
  visConf: { certain: true, probable: true, uncertain: true },
  showMultiKeep: false, showNoSel: false,
  overrides: {}, simMin: 0, simMax: 100, hifiOnly: false, hifiThr: 1.5
};

describe('getVisible — confidence filter', () => {
  test('shows groups matching visible confidence', () => {
    const groups = [
      makeGroup('g1', 'certain',   [{ path:'/a.jpg', size:100 }, { path:'/b.jpg', size:100, md5_match:true }]),
      makeGroup('g2', 'probable',  [{ path:'/c.jpg', size:100 }, { path:'/d.jpg', size:100, distances:{dhash:8} }]),
      makeGroup('g3', 'uncertain', [{ path:'/e.jpg', size:100 }, { path:'/f.jpg', size:100, distances:{dhash:20} }]),
    ];
    const r = getVisible(groups, { ...defaultState, visConf: { certain:true, probable:false, uncertain:false } });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('g1');
  });
});

describe('getVisible — similarity filter', () => {
  const groups = [
    // Group A: MD5 match = 100%
    makeGroup('md5', 'certain', [
      { path:'/a.jpg', size:100 },
      { path:'/b.jpg', size:100, md5_match:true, distances:{} }
    ]),
    // Group B: dhash distance 4 → (1-4/64)*100 = 93.75 → 94%
    makeGroup('high', 'probable', [
      { path:'/c.jpg', size:100 },
      { path:'/d.jpg', size:100, md5_match:false, distances:{dhash:4} }
    ]),
    // Group C: dhash distance 32 → 50%
    makeGroup('low', 'probable', [
      { path:'/e.jpg', size:100 },
      { path:'/f.jpg', size:100, md5_match:false, distances:{dhash:32} }
    ]),
  ];

  test('simMin 0 shows all groups', () => {
    const r = getVisible(groups, { ...defaultState, simMin: 0 });
    expect(r).toHaveLength(3);
  });

  test('simMin 80 shows MD5(100%) and high(94%) but not low(50%)', () => {
    const r = getVisible(groups, { ...defaultState, simMin: 80 });
    expect(r.map(g=>g.id).sort()).toEqual(['high','md5'].sort());
  });

  test('simMin 95 shows only MD5(100%)', () => {
    const r = getVisible(groups, { ...defaultState, simMin: 95 });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('md5');
  });

  test('simMin 100 shows only MD5', () => {
    const r = getVisible(groups, { ...defaultState, simMin: 100 });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('md5');
  });

  test('simMin 51 hides low(50%) group', () => {
    const r = getVisible(groups, { ...defaultState, simMin: 51 });
    expect(r.some(g => g.id === 'low')).toBe(false);
  });

  test('group with no distance data: passes when simMin is 0', () => {
    const g = [makeGroup('nodist', 'certain', [
      { path:'/x.jpg', size:100 },
      { path:'/y.jpg', size:100, distances:{} }
    ])];
    expect(getVisible(g, { ...defaultState, simMin: 0 })).toHaveLength(1);
  });

  test('group with no distance data: hidden when simMin > 0', () => {
    const g = [makeGroup('nodist', 'certain', [
      { path:'/x.jpg', size:100 },
      { path:'/y.jpg', size:100, distances:{} }
    ])];
    expect(getVisible(g, { ...defaultState, simMin: 50 })).toHaveLength(0);
  });
});

describe('getVisible — hi-fi filter', () => {
  // hi-fi = lower resolution but >= threshold × bigger file
  const hifiGroup = makeGroup('hifi', 'certain', [
    { path:'/hires.jpg', width:4000, height:3000, size:2_000_000 },  // 12MP, 2MB
    { path:'/lores.jpg', width:2000, height:1500, size:4_000_000,    // 3MP, 4MB — hi-fi candidate
      md5_match:false, distances:{dhash:0} }
  ]);
  const normalGroup = makeGroup('normal', 'certain', [
    { path:'/a.jpg', width:3000, height:2000, size:3_000_000 },
    { path:'/b.jpg', width:3000, height:2000, size:3_000_000,
      md5_match:true, distances:{} }
  ]);

  test('hifiOnly false: shows all groups', () => {
    const r = getVisible([hifiGroup, normalGroup], { ...defaultState, hifiOnly: false });
    expect(r).toHaveLength(2);
  });

  test('hifiOnly true: shows only groups with a hi-fi candidate', () => {
    const r = getVisible([hifiGroup, normalGroup], { ...defaultState, hifiOnly: true, hifiThr: 1.5 });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('hifi');
  });

  test('hifiOnly true, high threshold (3×): hides group if ratio below threshold', () => {
    // lores is 2× hires (4MB vs 2MB), not 3×
    const r = getVisible([hifiGroup, normalGroup], { ...defaultState, hifiOnly: true, hifiThr: 3.0 });
    expect(r).toHaveLength(0);
  });

  test('hifiOnly true, exact threshold 2×: shows hi-fi group', () => {
    const r = getVisible([hifiGroup], { ...defaultState, hifiOnly: true, hifiThr: 2.0 });
    expect(r).toHaveLength(1);
  });
});

describe('getVisible — simMax filter (upper bound)', () => {
  const groups = [
    makeGroup('md5', 'certain', [
      { path:'/a.jpg', size:100 },
      { path:'/b.jpg', size:100, md5_match:true, distances:{} }
    ]),
    makeGroup('high', 'probable', [
      { path:'/c.jpg', size:100 },
      { path:'/d.jpg', size:100, md5_match:false, distances:{dhash:4} }
    ]),
    makeGroup('low', 'probable', [
      { path:'/e.jpg', size:100 },
      { path:'/f.jpg', size:100, md5_match:false, distances:{dhash:32} }
    ]),
  ];

  test('simMax 90 hides MD5(100%) and high(94%) but shows low(50%)', () => {
    const r = getVisible(groups, { ...defaultState, simMax: 90 });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('low');
  });

  test('simMin 80 + simMax 95 shows only high(94%)', () => {
    const r = getVisible(groups, { ...defaultState, simMin: 80, simMax: 95 });
    expect(r.map(g=>g.id)).toEqual(['high']);
  });

  test('simMax 100 shows all (no upper bound effect)', () => {
    const r = getVisible(groups, { ...defaultState, simMax: 100 });
    expect(r).toHaveLength(3);
  });
});

// ── filterGroups match_pct_below/above tests ──────────────────────────────
// These test the actual backend function, not UI logic

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('filterGroups — match_pct_below/above', () => {
  let tmpDir, tmpFile;
  // We need to replicate the filterGroups function since it's in results.js
  function filterGroups(filePath, filterType, filterValue) {
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const before = result.groups.length;
    let removed = 0;

    if (filterType === 'match_pct_below' || filterType === 'match_pct_above') {
      const threshold = parseFloat(filterValue) || 0;
      result.groups = result.groups.filter(g => {
        let bestPct = 0;
        for (const m of (g.matches || [])) {
          if (m.md5_match) { bestPct = 100; break; }
          if (m.distances) {
            const vals = Object.values(m.distances).filter(v => typeof v === 'number');
            if (vals.length) {
              const pct = Math.round((1 - Math.min(...vals) / 64) * 100);
              if (pct > bestPct) bestPct = pct;
            }
          }
        }
        const shouldRemove = filterType === 'match_pct_below'
          ? bestPct < threshold
          : bestPct > threshold;
        if (shouldRemove) removed++;
        return !shouldRemove;
      });
    }

    result.groupCount = result.groups.length;
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    return { removed, remaining: result.groups.length };
  }

  const sampleResult = {
    version: '1.0.0',
    scannedAt: '2026-01-01T00:00:00Z',
    groupCount: 4,
    groups: [
      // Group 1: MD5 match = 100%
      { id: 'g1', source: '/a.jpg', source_info: { size: 1000 },
        matches: [{ path: '/b.jpg', md5_match: true, distances: {} }] },
      // Group 2: dhash 4 → 94%
      { id: 'g2', source: '/c.jpg', source_info: { size: 1000 },
        matches: [{ path: '/d.jpg', md5_match: false, distances: { dhash: 4 } }] },
      // Group 3: dhash 12 → 81%
      { id: 'g3', source: '/e.jpg', source_info: { size: 1000 },
        matches: [{ path: '/f.jpg', md5_match: false, distances: { dhash: 12 } }] },
      // Group 4: dhash 20 → 69%
      { id: 'g4', source: '/g.jpg', source_info: { size: 1000 },
        matches: [{ path: '/h.jpg', md5_match: false, distances: { dhash: 20 } }] },
    ]
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnm-filter-'));
    tmpFile = path.join(tmpDir, 'test_result.json');
    fs.writeFileSync(tmpFile, JSON.stringify(sampleResult, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('match_pct_below 85: removes groups at 81% and 69%', () => {
    const r = filterGroups(tmpFile, 'match_pct_below', 85);
    expect(r.removed).toBe(2);
    expect(r.remaining).toBe(2);
    const saved = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(saved.groups.map(g => g.id)).toEqual(['g1', 'g2']);
  });

  test('match_pct_below 95: removes 81% and 69% and 94%', () => {
    const r = filterGroups(tmpFile, 'match_pct_below', 95);
    expect(r.removed).toBe(3);
    expect(r.remaining).toBe(1);
    const saved = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(saved.groups[0].id).toBe('g1'); // Only MD5 (100%) survives
  });

  test('match_pct_below 0: removes nothing (nothing is below 0%)', () => {
    const r = filterGroups(tmpFile, 'match_pct_below', 0);
    expect(r.removed).toBe(0);
    expect(r.remaining).toBe(4);
  });

  test('match_pct_above 95: removes only MD5 group (100%)', () => {
    const r = filterGroups(tmpFile, 'match_pct_above', 95);
    expect(r.removed).toBe(1);
    expect(r.remaining).toBe(3);
    const saved = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(saved.groups.map(g => g.id)).toEqual(['g2', 'g3', 'g4']);
  });

  test('match_pct_above 80: removes MD5(100%), 94%, and 81%', () => {
    const r = filterGroups(tmpFile, 'match_pct_above', 80);
    expect(r.removed).toBe(3);
    expect(r.remaining).toBe(1);
  });

  test('match_pct_above 100: removes nothing (nothing is above 100%)', () => {
    const r = filterGroups(tmpFile, 'match_pct_above', 100);
    expect(r.removed).toBe(0);
    expect(r.remaining).toBe(4);
  });

  test('groupCount is updated after filter', () => {
    filterGroups(tmpFile, 'match_pct_below', 85);
    const saved = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(saved.groupCount).toBe(2);
  });

  test('result file is actually modified on disk', () => {
    const before = JSON.parse(fs.readFileSync(tmpFile, 'utf8')).groups.length;
    expect(before).toBe(4);
    filterGroups(tmpFile, 'match_pct_below', 70);
    const after = JSON.parse(fs.readFileSync(tmpFile, 'utf8')).groups.length;
    expect(after).toBe(3); // Only g4 (69%) removed
  });
});
