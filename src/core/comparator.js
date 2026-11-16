'use strict';
/**
 * Comparator — finds duplicate groups from hashed files.
 *
 * Exact all-pairs comparison: every perceptual hash is packed into 32-bit
 * words once, then every pair of files is compared with XOR + popcount.
 * There is no candidate pre-filter, so no pair within threshold can be missed.
 * 20k files ≈ 200M pairs ≈ ~1-2 s on a modern CPU.
 *
 * Grouping is transitive (union-find): if A~B and B~C, A, B and C end up in
 * one group even when A and C are just outside the threshold. Byte-identical
 * files (same MD5) are merged into the same groups as their perceptual
 * matches, so an exact copy plus a recompressed copy form ONE group.
 *
 * buildGroups is ASYNC and yields to the event loop periodically so
 * WebSocket progress events can fire during the compare.
 */

const { hammingDistance } = require('./hasher');

const CONFIDENCE  = { CERTAIN: 3, PROBABLE: 2, UNCERTAIN: 1 };

function confidenceLabel(c) {
  if (c >= CONFIDENCE.CERTAIN)  return 'certain';
  if (c >= CONFIDENCE.PROBABLE) return 'probable';
  return 'uncertain';
}

function areDuplicates(fileA, fileB, scanConfig) {
  const algos      = scanConfig.algorithms || {};
  const thresholds = scanConfig.thresholds || {};
  const ensureMin  = scanConfig.ensureMin  ?? 2;
  const matchLogic = scanConfig.matchLogic || 'threshold';
  const anchorHash = scanConfig.anchorHash;

  if (fileA.md5 && fileB.md5 && fileA.md5 === fileB.md5)
    return { match: true, confidence: CONFIDENCE.CERTAIN, md5Match: true, distances: {} };

  const activeAlgos = Object.entries(algos).filter(([k, v]) => v && k !== 'md5');
  if (!activeAlgos.length) return { match: false };

  const distances = {};
  const matches   = [];

  for (const [algo] of activeAlgos) {
    if (!fileA[algo] || !fileB[algo]) continue;
    const dist = hammingDistance(fileA[algo], fileB[algo]);
    distances[algo] = dist;
    if (dist <= (thresholds[algo] ?? 10)) matches.push(algo);
  }

  if (anchorHash && algos[anchorHash]) {
    if (distances[anchorHash] === undefined || distances[anchorHash] > (thresholds[anchorHash] ?? 10))
      return { match: false };
  }

  const isMatch = matchLogic === 'and'  ? matches.length === activeAlgos.length
                : matchLogic === 'or'   ? matches.length >= 1
                :                         matches.length >= ensureMin;
  if (!isMatch) return { match: false };

  const confidence = matches.length >= 3 ? CONFIDENCE.CERTAIN
                   : matches.length >= 2 ? CONFIDENCE.PROBABLE
                   :                       CONFIDENCE.UNCERTAIN;
  return { match: true, confidence, md5Match: false, distances, matchingAlgos: matches };
}

// ── Packed hashes ─────────────────────────────────────────────────────────────
function popcount32(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// Pack a hex string into 32-bit words. Returns null for missing/invalid hashes.
function packHex(h) {
  if (!h || typeof h !== 'string' || !/^[0-9a-fA-F]+$/.test(h)) return null;
  const words = new Uint32Array(Math.ceil(h.length / 8));
  for (let i = 0; i < words.length; i++)
    words[i] = parseInt(h.slice(i * 8, i * 8 + 8).padEnd(8, '0'), 16) >>> 0;
  return words;
}

// Near-solid images produce hashes with almost all bits equal; they would
// "match" every other near-solid image, so they are excluded from
// perceptual matching (MD5 matching still applies).
function isDegenerate(words, hexLen) {
  if (!words) return true;
  const bits = hexLen * 4;
  let set = 0;
  for (let i = 0; i < words.length; i++) set += popcount32(words[i]);
  return set < bits * 0.08 || set > bits * 0.92;
}

// ── Union-find ────────────────────────────────────────────────────────────────
function makeUnionFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) { if (ra < rb) parent[rb] = ra; else parent[ra] = rb; }
  };
  return { find, union };
}

// ── buildGroups ───────────────────────────────────────────────────────────────
// Signature kept for compatibility with scanManager: (files, config, onProgress, checkpoint).
// Checkpoints are no longer needed (the compare takes seconds); the argument is ignored.
async function buildGroups(hashedFiles, scanConfig, onProgress /*, checkpoint */) {
  if (typeof onProgress !== 'function') onProgress = null;
  const algos      = scanConfig.algorithms || {};
  const thresholds = scanConfig.thresholds || {};
  const ensureMin  = scanConfig.ensureMin  ?? 2;
  const matchLogic = scanConfig.matchLogic || 'threshold';
  const anchorHash = scanConfig.anchorHash && algos[scanConfig.anchorHash] ? scanConfig.anchorHash : null;
  const activeAlgos = Object.entries(algos).filter(([k, v]) => v && k !== 'md5').map(([k]) => k);
  const needed = matchLogic === 'and' ? activeAlgos.length
               : matchLogic === 'or'  ? 1
               :                        Math.max(1, ensureMin);

  // Stable priority order: lowest folderIndex first, then original order.
  const files = hashedFiles
    .map((f, i) => ({ f, i }))
    .sort((a, b) => ((a.f.folderIndex || 0) - (b.f.folderIndex || 0)) || (a.i - b.i))
    .map(x => x.f);
  const n = files.length;
  const uf = makeUnionFind(n);

  // ── Step 1: byte-identical files (MD5) ────────────────────────────────────
  const md5First = new Map();
  for (let i = 0; i < n; i++) {
    const m = files[i].md5;
    if (!m) continue;
    if (md5First.has(m)) uf.union(md5First.get(m), i);
    else md5First.set(m, i);
  }

  // ── Step 2: perceptual all-pairs ──────────────────────────────────────────
  // Only one representative per MD5 is compared (copies inherit its matches
  // through the union-find), which also saves time.
  const reps = [];
  for (let i = 0; i < n; i++) {
    const m = files[i].md5;
    if (!m || md5First.get(m) === i) reps.push(i);
  }

  if (activeAlgos.length && needed <= activeAlgos.length && reps.length > 1) {
    // Check the shortest (cheapest) hash first so most pairs are rejected early.
    const lenOf = algo => { for (const k of reps) if (files[k][algo]) return files[k][algo].length; return Infinity; };
    const cmpAlgos = activeAlgos.slice().sort((a, b) => lenOf(a) - lenOf(b));
    const A = cmpAlgos.length;
    const packed = cmpAlgos.map(algo => files.map(f => packHex(f[algo])));
    const hexLen = cmpAlgos.map(algo => files.map(f => (f[algo] || '').length));
    const thr    = cmpAlgos.map(algo => thresholds[algo] ?? 10);
    const anchorIdx = anchorHash ? cmpAlgos.indexOf(anchorHash) : -1;

    // Skip files whose every hash is degenerate (near-solid images).
    const usable = reps.filter(i => !cmpAlgos.every((_, a) => isDegenerate(packed[a][i], hexLen[a][i])));
    const R = usable.length;
    const YIELD_ROWS = Math.max(1, Math.floor(2e6 / Math.max(R, 1))); // ~2M pair checks per slice

    for (let x = 0; x < R; x++) {
      if (x > 0 && x % YIELD_ROWS === 0) {
        await new Promise(r => setImmediate(r));
        onProgress?.(x, R, 0, null, null);
      }
      const i = usable[x];
      for (let y = x + 1; y < R; y++) {
        const j = usable[y];
        let matched = 0;
        let ok = true;
        for (let a = 0; a < A; a++) {
          const hi = packed[a][i], hj = packed[a][j];
          let hit = false;
          if (hi && hj && hexLen[a][i] === hexLen[a][j]) {
            let d = 0;
            const lim = thr[a];
            for (let w = 0; w < hi.length && d <= lim; w++) d += popcount32(hi[w] ^ hj[w]);
            hit = d <= lim;
          }
          if (hit) matched++;
          else if (a === anchorIdx || matchLogic === 'and') { ok = false; break; }
          if (matched >= needed && anchorIdx < 0) break;                 // enough evidence
          if (matched + (A - a - 1) < needed) { ok = false; break; }     // can't reach it anymore
        }
        if (ok && matched >= needed) uf.union(i, j);
      }
    }
    onProgress?.(R, R, 0, null, null);
  }

  // ── Step 3: components → groups ───────────────────────────────────────────
  const comps = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(i);
  }

  const groups = [];
  for (const members of comps.values()) {
    if (members.length < 2) continue;
    // members are in priority order (union-find keeps the smallest index as root,
    // and we pushed in index order), so members[0] is the source.
    const source = files[members[0]];
    const matchFiles = [];
    const perMatch   = [];
    for (const k of members.slice(1)) {
      const f = files[k];
      const r = areDuplicates(source, f, scanConfig);
      const distances = r.distances || {};
      if (!r.distances) {
        for (const algo of activeAlgos) if (source[algo] && f[algo]) distances[algo] = hammingDistance(source[algo], f[algo]);
      }
      matchFiles.push(f);
      perMatch.push({
        md5:        !!(source.md5 && f.md5 && source.md5 === f.md5),
        // Members linked only through another file (A~B~C) get UNCERTAIN vs the source.
        confidence: r.match ? r.confidence : CONFIDENCE.UNCERTAIN,
        distances
      });
    }
    const groupConfidence = Math.min(...perMatch.map(m => m.md5 ? CONFIDENCE.CERTAIN : m.confidence));
    groups.push(makeGroup(source, matchFiles, groupConfidence, perMatch));
  }

  groups.sort((a, b) => b.confidence - a.confidence || (b.matches || []).length - (a.matches || []).length);
  return groups;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGroup(source, matchFiles, confidence, perMatch) {
  return {
    id:              'g_' + Math.random().toString(36).slice(2) + '_' + Date.now(),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    source:          source.path,
    source_info:     fileInfo(source),
    matches:         matchFiles.map((f, i) => ({
      path:       f.path,
      md5_match:  perMatch[i].md5,
      confidence: perMatch[i].md5 ? CONFIDENCE.CERTAIN : perMatch[i].confidence,
      distances:  perMatch[i].distances,
      size:       f.size,
      size_fmt:   fmtSize(f.size),
      width:      f.width  || 0,
      height:     f.height || 0,
      megapixels: calcMP(f.width, f.height),
      mtime_fmt:  fmtDate(f.mtime),
      exif_date:  f.exif_date || null
    }))
  };
}

function fileInfo(f) {
  return {
    size:       f.size,       size_fmt:   fmtSize(f.size),
    width:      f.width || 0, height:     f.height || 0,
    megapixels: calcMP(f.width, f.height),
    mtime_fmt:  fmtDate(f.mtime),
    exif_date:  f.exif_date || null
  };
}

function fmtSize(b) {
  if (!b) return '0 B';
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}

function fmtDate(mtime) {
  if (!mtime) return null;
  return new Date(mtime).toISOString().split('T')[0];
}

function calcMP(w, h) {
  if (!w || !h) return 0;
  return Math.round((w * h) / 100000) / 10;
}

const MAX_GROUP_SIZE = 999999; // kept for API compatibility; groups are not capped
module.exports = { buildGroups, areDuplicates, CONFIDENCE, confidenceLabel, MAX_GROUP_SIZE };
