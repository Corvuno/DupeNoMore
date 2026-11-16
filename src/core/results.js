'use strict';
const fs = require('fs');
const path = require('path');

function getResultFiles(scansDir) {
  if (!fs.existsSync(scansDir)) return [];
  return fs.readdirSync(scansDir)
    .filter(f => f.endsWith('.json') && (f.startsWith('duplicates_') || f.startsWith('imported_') || f.startsWith('interim_') || f.startsWith('filescan_')))
    .map(f => {
      const full = path.join(scansDir, f);
      let groupCount = 0;
      let scannedAt = null;
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        groupCount = parsed.groupCount || parsed.groups?.length || 0;
        scannedAt = parsed.scannedAt || null;
        // Extract scan settings summary for display
        const sc = parsed.scanConfig?.scan || {};
        const algos = Object.entries(sc.algorithms||{}).filter(([,v])=>v).map(([k])=>k);
        const ths = sc.thresholds || {};
        var settingsSummary = algos.length
          ? algos.map(a => a + ':' + (ths[a]??10)).join(' ') + ' eMin=' + (sc.ensureMin??1) + ' d=' + (sc.searchDepth??1)
          : (parsed.scanType === 'files' ? 'file scan' : 'MD5 only');
        var scanType = parsed.scanType || 'images';
      } catch {}
      return { filename: f, path: full, groupCount, scannedAt, scanType: scanType || 'images', settingsSummary: settingsSummary || '' };
    })
    .sort((a, b) => (b.filename || '').localeCompare(a.filename || ''));
}

function loadResult(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function deleteResult(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  fs.unlinkSync(filePath);
}

// Filter groups from result file and save back
function filterGroups(filePath, filterType, filterValue) {
  const result = loadResult(filePath);
  const before = result.groups.length;
  let removed = 0;

  if (filterType === 'folder') {
    result.groups = result.groups.filter(g => {
      const inFolder = g.source.startsWith(filterValue) ||
        (g.matches || []).some(m => m.path.startsWith(filterValue));
      if (inFolder) removed++;
      return !inFolder;
    });
  } else if (filterType === 'singletons') {
    result.groups = result.groups.filter(g => {
      const isSingleton = !g.matches || g.matches.length === 0;
      if (isSingleton) removed++;
      return !isSingleton;
    });
  } else if (filterType === 'empty') {
    result.groups = result.groups.filter(g => {
      const isEmpty = !g.matches || g.matches.length === 0;
      if (isEmpty) removed++;
      return !isEmpty;
    });
  } else if (filterType === 'match_pct_below' || filterType === 'match_pct_above' || filterType === 'match_pct_range') {
    let thresholdLo, thresholdHi;
    if (filterType === 'match_pct_range') {
      const parts = String(filterValue).split(/[-–]/);
      thresholdLo = parseFloat(parts[0]) || 0;
      thresholdHi = parseFloat(parts[1]) || 100;
    } else {
      thresholdLo = thresholdHi = parseFloat(filterValue) || 0;
    }
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
      let shouldRemove;
      if (filterType === 'match_pct_below') shouldRemove = bestPct < thresholdLo;
      else if (filterType === 'match_pct_above') shouldRemove = bestPct > thresholdHi;
      else shouldRemove = bestPct >= thresholdLo && bestPct <= thresholdHi; // range: remove BETWEEN
      if (shouldRemove) removed++;
      return !shouldRemove;
    });
  }

  result.groupCount = result.groups.length;
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));

  return { removed, remaining: result.groups.length };
}

// Save/load selection overrides
function saveOverrides(dataDir, resultFile, overrides) {
  const overridesPath = path.join(dataDir, 'overrides.json');
  let all = {};
  try { all = JSON.parse(fs.readFileSync(overridesPath, 'utf8')); } catch {}
  all[resultFile] = overrides;
  fs.writeFileSync(overridesPath, JSON.stringify(all, null, 2));
}

function loadOverrides(dataDir, resultFile) {
  const overridesPath = path.join(dataDir, 'overrides.json');
  try {
    const all = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    return all[resultFile] || {};
  } catch { return {}; }
}

// Save/load the groups the user deselected in the review screen (by group source path)
function saveDeselectedGroups(dataDir, resultFile, sources) {
  const p = path.join(dataDir, 'deselected-groups.json');
  let all = {};
  try { all = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  const list = Array.isArray(sources) ? sources.filter(s => typeof s === 'string') : [];
  if (list.length) all[resultFile] = list; else delete all[resultFile];
  fs.writeFileSync(p, JSON.stringify(all, null, 2));
}

function loadDeselectedGroups(dataDir, resultFile) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(dataDir, 'deselected-groups.json'), 'utf8'));
    return Array.isArray(all[resultFile]) ? all[resultFile] : [];
  } catch { return []; }
}

module.exports = { getResultFiles, loadResult, deleteResult, filterGroups, saveOverrides, loadOverrides, saveDeselectedGroups, loadDeselectedGroups };
