/**
 * fileScan.js — US-073/074: Non-image file scanner
 *
 * Match modes:
 *   md5           — byte-for-byte identical (exact copy)
 *   name_similar  — Levenshtein similarity on normalized names
 *   copy_pattern  — Windows/Mac copy patterns: "(1)", "- Copy", "Copy of", etc.
 *   wildcard      — user-defined glob patterns with AND/OR logic
 *   version_group — same app/file, different version numbers (for installer cleanup)
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { isExcluded } = require('./collector');

// ── Copy patterns ─────────────────────────────────────────────────────────────
// These are stripped before comparing basenames
const COPY_PATTERNS = [
  /\s*\(\d+\)$/,                  // "file (1)", "file (2)"
  /\s*-\s*Copy(\s*\(\d+\))?$/i,  // "file - Copy", "file - Copy (2)"
  /^Copy of\s+/i,                  // "Copy of file"
  /\s*_copy(\s*\d+)?$/i,          // "file_copy", "file_copy2"
  /\s*_backup(\s*\d+)?$/i,        // "file_backup"
  /\s*_bak(\s*\d+)?$/i,           // "file_bak"
  /\s*\(copy\)$/i,                 // "file (copy)"
  /\s*[-_]\d{4}-\d{2}-\d{2}$/,   // "file - 2024-01-15" (dated copies)
  /\s*\[\d+\]$/,                   // "file [1]"
  /\s*_old(\s*\d+)?$/i,            // "file_old", "file_old2"
  /\s*_orig$/i,                    // "file_orig"
  /\s*_v\d+$/i,                    // "file_v1", "file_v2" (not version numbers — those need version_group)
];

// ── Version extraction ─────────────────────────────────────────────────────────
// For installer/archive cleanup: strip version numbers to get "base name"
const VERSION_PATTERNS = [
  /[-_\s]v?(\d+\.\d+(?:\.\d+)*(?:[-_]\w+)?)/gi,  // v1.2.3, 1.2.3, _1.2.3
  /[-_\s](\d{4}[._]\d{2}[._]\d{2})/g,             // 2024.01.15 dates
  /[-_\s](alpha|beta|rc\d*|release|final|stable|latest)/gi,  // qualifiers
  /[-_\s](x64|x86|win64|win32|amd64|arm64|linux|darwin|macos|mac)/gi, // arch/platform
  /[-_\s](setup|install|installer|portable)/gi,    // install type
];

function extractVersion(name) {
  const versions = [];
  const clean = name.replace(/[-_\s]v?(\d+\.\d+(?:\.\d+)*)/gi, (m, v) => { versions.push(v); return ''; });
  return { versions, cleanName: clean.replace(/[-_\s]+$/, '').trim().toLowerCase() };
}

function compareVersions(a, b) {
  const partsA = a.split(/[._-]/).map(p => parseInt(p)||0);
  const partsB = b.split(/[._-]/).map(p => parseInt(p)||0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const d = (partsA[i]||0) - (partsB[i]||0);
    if (d !== 0) return d;
  }
  return 0;
}

// ── Normalize name for comparison ────────────────────────────────────────────
function normalizeName(fullPath) {
  const ext  = path.extname(fullPath);
  let   base = path.basename(fullPath, ext).trim();
  // Strip copy patterns
  for (const pattern of COPY_PATTERNS) {
    base = base.replace(pattern, '');
  }
  return base.trim().toLowerCase();
}

// ── Levenshtein ───────────────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const prev = Array.from({length:n+1},(_,i)=>i);
  const curr = new Array(n+1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i-1]===b[j-1] ? prev[j-1] : 1+Math.min(prev[j], curr[j-1], prev[j-1]);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[n];
}

// Returns 0–100 similarity after copy-pattern normalization
function nameSimilarity(pathA, pathB) {
  const na = normalizeName(pathA);
  const nb = normalizeName(pathB);
  if (na === nb) return 100; // perfect match after normalization
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(na, nb);
  return Math.round((1 - dist / maxLen) * 100);
}

// ── Wildcard matching ─────────────────────────────────────────────────────────
function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

function matchesWildcard(filePath, pattern) {
  const basename = path.basename(filePath).toLowerCase();
  const fullLower = filePath.toLowerCase();
  try {
    const re = wildcardToRegex(pattern.toLowerCase());
    return re.test(basename) || re.test(fullLower);
  } catch { return false; }
}

function matchesWildcardSet(filePath, patterns, logic = 'or') {
  if (!patterns || !patterns.length) return false;
  if (logic === 'and') return patterns.every(p => matchesWildcard(filePath, p));
  return patterns.some(p => matchesWildcard(filePath, p));  // 'or'
}

// ── File collection ───────────────────────────────────────────────────────────
async function collectFiles(folders, { extensions, minSizeKB, maxSizeMB, includeHidden = false, excludePatterns = [] }) {
  const files = [];
  for (const folder of folders.filter(f => f.active !== false)) {
    await walkDir(folder.path, folder.recursive !== false, files, extensions, minSizeKB, maxSizeMB, includeHidden, excludePatterns);
  }
  return files;
}

async function walkDir(dir, recursive, results, extensions, minSizeKB, maxSizeMB, includeHidden, excludePatterns) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!includeHidden && e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (isExcluded(full, excludePatterns, e.isDirectory())) continue;
      if (e.isDirectory()) {
        if (recursive) await walkDir(full, true, results, extensions, minSizeKB, maxSizeMB, includeHidden, excludePatterns);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (extensions && extensions.length && !extensions.includes(ext)) continue;
        try {
          const stat  = fs.statSync(full);
          const kb    = stat.size / 1024;
          if (minSizeKB && kb < minSizeKB) continue;
          if (maxSizeMB && stat.size > maxSizeMB * 1048576) continue;
          results.push({ path: full, size: stat.size, mtime: stat.mtimeMs });
        } catch {}
      }
    }
  } catch {}
}

// ── MD5 hashing ───────────────────────────────────────────────────────────────
function md5File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

// ── Main scanner ──────────────────────────────────────────────────────────────
async function scanFiles({
  folders,
  extensions       = [],
  minSizeKB        = 0,
  maxSizeMB        = 0,
  useMd5           = true,
  useNameSimilarity= false,
  nameSimilarityThreshold = 80,
  useCopyPatterns  = false,
  useWildcards     = false,
  wildcardPatterns = [],
  wildcardLogic    = 'or',
  useVersionGroups = false,
  excludePatterns  = [],
  onProgress,
}) {
  // 1. Collect
  onProgress?.('collect', 0, 0, 'Collecting files…');
  const files = await collectFiles(folders, { extensions, minSizeKB, maxSizeMB, excludePatterns });
  onProgress?.('collect', files.length, files.length, `Collected ${files.length} files`);

  if (!files.length) return { groups: [], totalFiles: 0 };

  // 2. Hash (MD5) if needed
  let hashed = files;
  if (useMd5 || useVersionGroups) {
    hashed = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const md5 = useMd5 ? md5File(f.path) : null;
        hashed.push({ ...f, md5 });
      } catch { hashed.push({ ...f, md5: null }); }
      if ((i+1) % 100 === 0) {
        onProgress?.('hash', i+1, files.length, `Hashing: ${i+1}/${files.length} (${Math.round((i+1)/files.length*100)}%)`);
        await new Promise(r => setImmediate(r));
      }
    }
    onProgress?.('hash', hashed.length, hashed.length, `Hashed ${hashed.length} files`);
  }

  const groups = [];
  const used   = new Set();

  // 3. MD5 exact groups
  if (useMd5) {
    const md5Map = new Map();
    for (const f of hashed) {
      if (!f.md5) continue;
      if (!md5Map.has(f.md5)) md5Map.set(f.md5, []);
      md5Map.get(f.md5).push(f);
    }
    for (const [, grp] of md5Map) {
      if (grp.length < 2) continue;
      const [src, ...matches] = grp;
      groups.push(makeGroup('md5', 3, 'certain', src, matches, m => ({ matchType: 'MD5 exact' })));
      grp.forEach(f => used.add(f.path));
    }
    onProgress?.('compare', 0, 0, `MD5: found ${groups.length} exact duplicate groups`);
  }

  // 4. Copy-pattern groups
  if (useCopyPatterns) {
    const remaining = hashed.filter(f => !used.has(f.path));
    const normalized = new Map();
    for (const f of remaining) {
      const key = normalizeName(f.path) + '|' + path.extname(f.path).toLowerCase();
      if (!normalized.has(key)) normalized.set(key, []);
      normalized.get(key).push(f);
    }
    for (const [, grp] of normalized) {
      if (grp.length < 2) continue;
      // Sort: original (shortest name = no copy suffix) first
      grp.sort((a, b) => path.basename(a.path).length - path.basename(b.path).length);
      const [src, ...matches] = grp;
      groups.push(makeGroup('copy_pattern', 2, 'probable', src, matches, m => ({
        matchType: 'Copy pattern',
        normalizedName: normalizeName(m.path)
      })));
      grp.forEach(f => used.add(f.path));
    }
    const cpGroups = groups.filter(g => g.matchType === 'copy_pattern').length;
    onProgress?.('compare', 0, 0, `Copy patterns: found ${cpGroups} copy groups`);
  }

  // 5. Name similarity groups
  if (useNameSimilarity) {
    const remaining = hashed.filter(f => !used.has(f.path));
    for (let i = 0; i < remaining.length; i++) {
      if (used.has(remaining[i].path)) continue;
      const matches = [];
      for (let j = i+1; j < remaining.length; j++) {
        if (used.has(remaining[j].path)) continue;
        const sim = nameSimilarity(remaining[i].path, remaining[j].path);
        if (sim >= nameSimilarityThreshold) matches.push({ ...remaining[j], similarity: sim });
      }
      if (matches.length > 0) {
        matches.sort((a, b) => b.similarity - a.similarity);
        groups.push(makeGroup('name_similar', 2, 'probable', remaining[i], matches, m => ({
          matchType: `Name ${m.similarity}% similar`
        })));
        used.add(remaining[i].path);
        matches.forEach(m => used.add(m.path));
      }
      if ((i+1) % 200 === 0) await new Promise(r => setImmediate(r));
    }
  }

  // 6. Wildcard pattern groups
  if (useWildcards && wildcardPatterns.length > 0) {
    const matching = hashed.filter(f =>
      !used.has(f.path) && matchesWildcardSet(f.path, wildcardPatterns, wildcardLogic)
    );
    if (matching.length > 0) {
      // Group matching files by normalized base name
      const byBase = new Map();
      for (const f of matching) {
        const base = normalizeName(f.path) + '|' + path.extname(f.path).toLowerCase();
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(f);
      }
      for (const [, grp] of byBase) {
        if (grp.length < 2) continue;
        grp.sort((a, b) => path.basename(a.path).length - path.basename(b.path).length);
        const [src, ...matches] = grp;
        groups.push(makeGroup('wildcard', 2, 'probable', src, matches, m => ({
          matchType: 'Wildcard match'
        })));
        grp.forEach(f => used.add(f.path));
      }
      // Also show singleton matches (1 file, flagged as candidate)
      const singletons = matching.filter(f => !used.has(f.path));
      if (singletons.length > 0) {
        // Emit as individual "flagged" entries
        singletons.forEach(f => {
          groups.push(makeGroup('wildcard_flag', 1, 'uncertain', f, [], () => ({
            matchType: 'Wildcard flagged'
          })));
          used.add(f.path);
        });
      }
    }
  }

  // 7. Version groups (installer cleanup)
  if (useVersionGroups) {
    const EXE_EXTS = new Set(['exe','msi','dmg','pkg','deb','rpm','appimage']);
    const ARC_EXTS = new Set(['zip','7z','rar','tar','gz','bz2','xz','iso','cab','tgz']);
    const remaining = hashed.filter(f => {
      if (used.has(f.path)) return false;
      const ext = path.extname(f.path).slice(1).toLowerCase();
      return EXE_EXTS.has(ext) || ARC_EXTS.has(ext);
    });

    const byBase = new Map();
    for (const f of remaining) {
      const ext  = path.extname(f.path).slice(1).toLowerCase();
      const stem = path.basename(f.path, '.' + ext);
      const { versions, cleanName } = extractVersion(stem);
      if (cleanName.length < 2) continue; // too short to be meaningful
      const key = cleanName + '|' + ext;
      if (!byBase.has(key)) byBase.set(key, []);
      byBase.get(key).push({ ...f, versions, cleanName });
    }

    for (const [, grp] of byBase) {
      if (grp.length < 2) continue;
      // Sort by version (newest last = newest is "keeper"), then by mtime
      grp.sort((a, b) => {
        const va = a.versions[0] || '0';
        const vb = b.versions[0] || '0';
        const cv = compareVersions(va, vb);
        return cv !== 0 ? cv : a.mtime - b.mtime;
      });
      const newest = grp[grp.length - 1];
      const older  = grp.slice(0, -1);
      groups.push(makeGroup('version', 2, 'probable', newest, older, m => ({
        matchType: `Older version (${m.versions?.[0] || 'unknown'})`,
        version: m.versions?.[0]
      })));
      grp.forEach(f => used.add(f.path));
    }
    const vGroups = groups.filter(g => g.matchType === 'version').length;
    onProgress?.('compare', 0, 0, `Versions: found ${vGroups} installer/archive groups`);
  }

  return { groups, totalFiles: files.length };
}

function makeGroup(type, confidence, confidenceLabel, src, matches, getExtra) {
  return {
    id:             type + '_' + Math.random().toString(36).slice(2),
    confidence,
    confidenceLabel,
    matchType:      type,
    source:         src.path,
    source_info:    { size: src.size, size_fmt: fmtSize(src.size), mtime: src.mtime },
    matches: matches.map(m => ({
      path:       m.path,
      md5_match:  type === 'md5',
      confidence,
      size:       m.size,
      size_fmt:   fmtSize(m.size),
      mtime:      m.mtime,
      ...getExtra(m)
    }))
  };
}

function fmtSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b/1048576).toFixed(2) + ' MB';
  return (b/1073741824).toFixed(2) + ' GB';
}

module.exports = { scanFiles, nameSimilarity, normalizeName, matchesWildcard, matchesWildcardSet, extractVersion, COPY_PATTERNS };
