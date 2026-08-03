'use strict';
/**
 * Comparator — finds duplicate groups from hashed files.
 *
 * Uses nibble-level pigeonhole index: a 64-bit hash = 16 hex nibbles.
 * If hamming_distance(h1,h2) <= T, at least (16-T) nibbles must be identical.
 * Guaranteed to find ALL pairs within threshold <= 15.
 *
 * buildGroups is ASYNC and yields to the event loop every YIELD_EVERY source
 * files, so WebSocket progress events can fire during long compares.
 */

const { hammingDistance } = require('./hasher');

const CONFIDENCE  = { CERTAIN: 3, PROBABLE: 2, UNCERTAIN: 1 };
const YIELD_EVERY = 200; // yield event loop every N source files

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

// ── Nibble-level pigeonhole index ─────────────────────────────────────────────
// index[nibblePos][nibbleChar] = [fileIndices]
function buildNibbleIndex(files, algo) {
  const index = Array.from({ length: 16 }, () => new Map());
  for (let i = 0; i < files.length; i++) {
    const h = files[i][algo];
    if (!h || h.length < 16) continue;
    for (let pos = 0; pos < 16; pos++) {
      const nib = h[pos];
      if (!index[pos].has(nib)) index[pos].set(nib, []);
      index[pos].get(nib).push(i);
    }
  }
  return index;
}

function getCandidates(fileIdx, hash, index, searchDepth) {
  const cands = new Set();
  // searchDepth (1-5) controls how many nibble positions are checked
  // More positions = more strict = faster but may miss matches at high tolerances
  // Fewer positions checked = more candidates = deeper search
  // At depth 1 (fast): check all 16 positions (current behavior)
  // At depth 5 (thorough): also check near-miss nibbles (expand bucket search)
  const depth = Math.max(1, Math.min(5, searchDepth || 1));

  for (let pos = 0; pos < 16; pos++) {
    const bucket = index[pos].get(hash[pos]);
    if (bucket) for (const j of bucket) if (j !== fileIdx) cands.add(j);
  }

  // At depth >= 3: also check adjacent nibble values (±1 in hex) for each position
  // This finds more candidates that differ by exactly 1 nibble position
  if (depth >= 3) {
    const hexChars = '0123456789abcdef';
    for (let pos = 0; pos < 16; pos++) {
      const nibbleIdx = hexChars.indexOf(hash[pos].toLowerCase());
      if (nibbleIdx < 0) continue;
      // Check ±1 nibble values
      for (const delta of [-1, 1]) {
        const adj = nibbleIdx + delta;
        if (adj < 0 || adj > 15) continue;
        const bucket = index[pos].get(hexChars[adj]);
        if (bucket) for (const j of bucket) if (j !== fileIdx) cands.add(j);
      }
    }
  }

  // At depth >= 5: check ±2 nibble values too
  if (depth >= 5) {
    const hexChars = '0123456789abcdef';
    for (let pos = 0; pos < 16; pos++) {
      const nibbleIdx = hexChars.indexOf(hash[pos].toLowerCase());
      if (nibbleIdx < 0) continue;
      for (const delta of [-2, 2]) {
        const adj = nibbleIdx + delta;
        if (adj < 0 || adj > 15) continue;
        const bucket = index[pos].get(hexChars[adj]);
        if (bucket) for (const j of bucket) if (j !== fileIdx) cands.add(j);
      }
    }
  }

  return cands;
}

// ── buildGroups (async — yields every YIELD_EVERY source files) ───────────────
async function buildGroups(hashedFiles, scanConfig, onProgress, checkpoint) {
  const algos      = scanConfig.algorithms || {};
  const thresholds = scanConfig.thresholds || {};
  const ensureMin  = scanConfig.ensureMin  ?? 2;
  const matchLogic = scanConfig.matchLogic || 'threshold';

  // Resume from checkpoint if provided
  const groups  = checkpoint?.groups || [];
  const usedMd5 = new Set();
  const resumeAssigned = new Set(checkpoint?.assignedPaths || []);
  const resumeIndex    = checkpoint?.startIndex || 0;

  // ── Step 1: MD5 exact groups ─────────────────────────────────────────────
  const md5Map = new Map();
  for (const file of hashedFiles) {
    if (file.md5) {
      if (!md5Map.has(file.md5)) md5Map.set(file.md5, []);
      md5Map.get(file.md5).push(file);
    }
  }
  for (const [, files] of md5Map) {
    if (files.length < 2) continue;
    files.sort((a, b) => (a.folderIndex || 0) - (b.folderIndex || 0));
    const [source, ...matches] = files;
    usedMd5.add(source.path);
    matches.forEach(f => usedMd5.add(f.path));
    groups.push(makeGroup(source, matches, CONFIDENCE.CERTAIN, true));
  }

  // ── Step 2: Perceptual groups ─────────────────────────────────────────────
  const perceptual  = hashedFiles.filter(f => !usedMd5.has(f.path));
  const activeAlgos = Object.entries(algos).filter(([k, v]) => v && k !== 'md5').map(([k]) => k);

  if (!activeAlgos.length || !perceptual.length) {
    groups.sort((a, b) => b.confidence - a.confidence);
    return groups;
  }

  // Build nibble index per algorithm
  const indexes = {};
  for (const algo of activeAlgos) {
    indexes[algo] = buildNibbleIndex(perceptual, algo);
  }

  const assigned = new Set(resumeAssigned);
  const degenerate = new Set();
  const sorted = [...perceptual].sort((a, b) => (a.folderIndex || 0) - (b.folderIndex || 0));

  // Mark degenerate hashes (near-solid images — too few or too many bits set)
  for (const file of sorted) {
    if (activeAlgos.every(algo => {
      const h = file[algo];
      if (!h) return true;
      let bits = 0;
      for (const c of h) { let x = parseInt(c, 16); while (x) { x &= x - 1; bits++; } }
      return bits < 5 || bits > 59;
    })) degenerate.add(file.path);
  }

  for (let si = resumeIndex; si < sorted.length; si++) {
    // Yield event loop every YIELD_EVERY iterations so WS/HTTP can run
    if (si > 0 && si % YIELD_EVERY === 0) {
      await new Promise(r => setImmediate(r));
      // Pass resume state so checkpoint can be saved
      onProgress?.(si, sorted.length, groups.length, groups, {
        assignedPaths: [...assigned],
        startIndex: si
      });
    }

    const source = sorted[si];
    if (assigned.has(source.path) || degenerate.has(source.path)) continue;

    const candidateScore = new Map();

    for (const algo of activeAlgos) {
      const h = source[algo];
      if (!h || h.length < 16) continue;
      const thresh = thresholds[algo] ?? 10;
      const cands  = getCandidates(si, h, indexes[algo], scanConfig.searchDepth || 1);

      for (const ci of cands) {
        const candidate = sorted[ci];
        if (assigned.has(candidate.path)) continue;
        if (!candidate[algo]) continue;
        const dist = hammingDistance(h, candidate[algo]);
        if (dist > thresh) continue;
        if (!candidateScore.has(candidate.path))
          candidateScore.set(candidate.path, { file: candidate, matchCount: 0, distances: {} });
        const entry = candidateScore.get(candidate.path);
        entry.matchCount++;
        entry.distances[algo] = dist;
      }
    }

    const matches = [];
    for (const [, entry] of candidateScore) {
      const qualifies = matchLogic === 'and'  ? entry.matchCount === activeAlgos.length
                      : matchLogic === 'or'   ? entry.matchCount >= 1
                      :                         entry.matchCount >= ensureMin;
      if (qualifies) matches.push(entry);
    }

    if (!matches.length) continue;

    assigned.add(source.path);
    matches.forEach(m => assigned.add(m.file.path));

    const avgMatch   = matches.reduce((s, m) => s + m.matchCount, 0) / matches.length;
    const confidence = avgMatch >= 3 ? CONFIDENCE.CERTAIN
                     : avgMatch >= 2 ? CONFIDENCE.PROBABLE
                     :                 CONFIDENCE.UNCERTAIN;

    groups.push(makeGroup(source, matches.map(m => m.file), confidence, false, matches.map(m => m.distances)));
  }

  groups.sort((a, b) => b.confidence - a.confidence || (b.matches||[]).length - (a.matches||[]).length);
  return groups;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGroup(source, matchFiles, confidence, md5Match, distancesArr) {
  return {
    id:              'g_' + Math.random().toString(36).slice(2) + '_' + Date.now(),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    source:          source.path,
    source_info:     fileInfo(source),
    matches:         matchFiles.map((f, i) => ({
      path:       f.path,
      md5_match:  md5Match,
      confidence,
      distances:  distancesArr?.[i] || {},
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

const MAX_GROUP_SIZE = 999999;
module.exports = { buildGroups, areDuplicates, CONFIDENCE, confidenceLabel, MAX_GROUP_SIZE };
