'use strict';
const fs   = require('fs');
const path = require('path');
const configMgr = require('../core/config');

// ── Persistent undo log ──────────────────────────────────────────────────────
// The app auto-restarts on crash, so an in-memory undo log would be lost while
// files sit in trash — making recovery impossible. Persist it to disk (write-
// ahead: every operation is appended before/as it happens) and reload on start.
let undoLog = [];
function undoLogPath() { return path.join(configMgr.getDataDir(), 'undo_log.json'); }
function loadUndoLog() {
  try { undoLog = JSON.parse(fs.readFileSync(undoLogPath(), 'utf8')); }
  catch { undoLog = []; }
}
function persistUndoLog() {
  try {
    fs.mkdirSync(configMgr.getDataDir(), { recursive: true });
    fs.writeFileSync(undoLogPath(), JSON.stringify(undoLog, null, 2));
  } catch (e) { /* best effort — never block an action on log write */ }
}
function recordUndo(entry) { undoLog.push(entry); persistUndoLog(); }
loadUndoLog();

// fs.renameSync fails with EXDEV when src and dest are on different drives.
// Fall back to copy + delete in that case.
function safeMoveSync(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device: copy then delete
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

function recycleFile(filePath) {
  // Move to app trash folder — instant (rename), undoable, no PowerShell overhead.
  // User can empty the trash folder manually from Settings.
  const trashDir = getAppTrashDir();
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

  const base    = path.basename(filePath);
  const ext     = path.extname(base);
  const stem    = base.slice(0, base.length - ext.length);
  let dest      = path.join(trashDir, base);
  if (fs.existsSync(dest)) dest = path.join(trashDir, stem + '_' + Date.now() + ext);

  safeMoveSync(filePath, dest);
  recordUndo({ action: 'recycle', from: filePath, to: dest, ts: Date.now() });
  return dest;
}

function getAppTrashDir() {
  const configMgr = require('./config');
  return path.join(configMgr.getDataDir(), '.trash');
}

function getTrashStats() {
  const trashDir = getAppTrashDir();
  if (!fs.existsSync(trashDir)) return { count: 0, sizeBytes: 0 };
  const files = fs.readdirSync(trashDir);
  let sizeBytes = 0;
  for (const f of files) {
    try { sizeBytes += fs.statSync(path.join(trashDir, f)).size; } catch {}
  }
  return { count: files.length, sizeBytes };
}

function emptyTrash() {
  const trashDir = getAppTrashDir();
  if (!fs.existsSync(trashDir)) return { deleted: 0 };
  const files = fs.readdirSync(trashDir);
  let deleted = 0;
  for (const f of files) {
    try { fs.unlinkSync(path.join(trashDir, f)); deleted++; } catch {}
  }
  return { deleted };
}

function moveFile(filePath, targetDir, reproduceStructure) {
  let dest;
  if (reproduceStructure) {
    // Preserve folder structure relative to the drive root
    const root = path.parse(filePath).root || filePath[0] + ':\\';
    const rel  = path.relative(root, filePath);
    dest = path.join(targetDir, rel);
  } else {
    // Flat — just put the file directly in targetDir
    dest = path.join(targetDir, path.basename(filePath));
  }

  // Resolve collision
  if (fs.existsSync(dest)) {
    const ext  = path.extname(dest);
    const base = dest.slice(0, dest.length - ext.length);
    dest = base + '_' + Date.now() + ext;
  }

  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  safeMoveSync(filePath, dest);
  recordUndo({ action: 'move', from: filePath, to: dest, ts: Date.now() });
  return dest;
}

function deleteFile(filePath) {
  fs.unlinkSync(filePath);
  recordUndo({ action: 'delete', from: filePath, to: null, ts: Date.now() });
}

function undo(logIndex) {
  const entry = undoLog[logIndex];
  if (!entry) throw new Error('No undo entry at index ' + logIndex);
  if (entry.action === 'delete') throw new Error('Delete is irreversible');
  if (!entry.to) throw new Error('Cannot undo — file is in Recycle Bin (restore manually)');
  if (!fs.existsSync(entry.to)) throw new Error('File no longer at undo location: ' + entry.to);
  const destDir = path.dirname(entry.from);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  safeMoveSync(entry.to, entry.from);
  undoLog.splice(logIndex, 1);
  persistUndoLog();
  return entry.from;
}

function getUndoLog() { return [...undoLog]; }

// US-071: Check if a file matches deselect filters (should be skipped regardless of selection)
function isDeselectFiltered(filePath, deselectFilters) {
  if (!deselectFilters || !deselectFilters.length) return false;
  for (const filter of deselectFilters) {
    const { type, mode, value } = filter;
    if (type === 'folder') {
      const inFolder = filePath.startsWith(value) ||
        filePath.split('\\').join('/').startsWith(value.split('\\').join('/'));
      if (mode === 'in'     && inFolder)  return true;
      if (mode === 'not_in' && !inFolder) return true;
    }
    if (type === 'name') {
      const base = filePath.split(/[\/]/).pop() || '';
      try {
        const re = new RegExp(value.replace(/[.+^${}()|[\]]/g,'\$&').replace(/\*/g,'.*'), 'i');
        if (re.test(base)) return true;
      } catch {}
    }
    if (type === 'size' && typeof filter.sizeKB === 'number') {
      try {
        const stat = require('fs').statSync(filePath);
        const kb = stat.size / 1024;
        if (filter.sizeMode === 'above' && kb > filter.sizeKB) return true;
        if (filter.sizeMode === 'below' && kb < filter.sizeKB) return true;
      } catch {}
    }
  }
  return false;
}

function pickWinner(allFiles, strategy) {
  if (strategy === 'keep_largest')
    return allFiles.reduce((a,b) => (b.size||0) > (a.size||0) ? b : a);
  if (strategy === 'keep_highest_res')
    return allFiles.reduce((a,b) => ((b.width||0)*(b.height||0)) > ((a.width||0)*(a.height||0)) ? b : a);
  if (strategy === 'keep_newest_file' || strategy === 'keep_newest')
    return allFiles.reduce((a,b) => (b.mtime||0) > (a.mtime||0) ? b : a);
  if (strategy === 'keep_oldest_file' || strategy === 'keep_oldest')
    return allFiles.reduce((a,b) => (b.mtime||0) < (a.mtime||0) ? b : a);
  if (strategy === 'keep_newest_exif')
    return allFiles.reduce((a,b) => (b.exif_date||'') > (a.exif_date||'') ? b : a);
  if (strategy === 'keep_oldest_exif')
    return allFiles.reduce((a,b) => (b.exif_date||'') < (a.exif_date||'') ? b : a);
  if (strategy === 'keep_reference')
    return allFiles.find(f => f.isSource) || allFiles[0];
  if (strategy === 'keep_shortest_name') {
    const base = p => (p||'').split(/[\\/]/).pop();
    return allFiles.reduce((a,b) => base(b.path).length < base(a.path).length ? b : a);
  }
  return null;
}

async function executeActions(resultFile, actionSpec, dryRun = false) {
  const raw    = fs.readFileSync(resultFile, 'utf8');
  const result = JSON.parse(raw);
  const log    = [];
  const stats  = { recycled: 0, moved: 0, deleted: 0, kept: 0, skipped: 0, errors: 0 };

  const { actions, removeTarget, keepTarget, reproduceStructure, selections, locked, deselectFilters, deselectedGroups } = actionSpec;
  const lockedSet = new Set(locked || []);
  // Groups the user unticked in the review screen, identified by their source path.
  // Every file in such a group is left untouched (not removed, not moved).
  const deselectedSet = new Set(deselectedGroups || []);

  // Auto-populate selections for groups where none are set
  const effectiveSelections = { ...(selections || {}) };
  for (const group of result.groups) {
    const allF = [
      { path: group.source },
      ...(group.matches || []).map(m => ({ path: m.path }))
    ];
    if (!allF.some(f => effectiveSelections[f.path])) {
      effectiveSelections[group.source] = 'keep';
      (group.matches || []).forEach(m => { effectiveSelections[m.path] = 'remove'; });
    }
  }

  for (const group of result.groups) {
    if (deselectedSet.has(group.source)) {
      const paths = [group.source, ...(group.matches || []).map(m => m.path)];
      for (const p of paths) {
        log.push({ file: p, action: 'skipped', reason: 'group deselected', ts: Date.now() });
        stats.skipped++;
      }
      continue;
    }
    const conf     = group.confidenceLabel || 'certain';
    const strategy = actions[conf] || 'keep_in_place';

    const si       = group.source_info || {};
    const allFiles = [
      { path: group.source,   isSource: true,  size: si.size, width: si.width,  height: si.height,  mtime: parseMtime(si.mtime_fmt),    exif_date: si.exif_date },
      ...(group.matches||[]).map(m => ({
        path: m.path,         isSource: false, size: m.size,  width: m.width,   height: m.height,   mtime: parseMtime(m.mtime_fmt),     exif_date: m.exif_date
      }))
    ];

    let winner = null;
    if (!['keep_in_place','execute_selected','recycle_removed','delete_permanent'].includes(strategy)) {
      winner = pickWinner(allFiles, strategy);
    }

    for (const file of allFiles) {
      if (lockedSet.has(file.path)) {
        log.push({ file: file.path, action: 'skipped', reason: 'locked', ts: Date.now() });
        stats.skipped++;
        continue;
      }
      // US-071: deselect filters protect files from removal regardless of selection
      if (isDeselectFiltered(file.path, deselectFilters)) {
        log.push({ file: file.path, action: 'skipped', reason: 'deselect filter', ts: Date.now() });
        stats.skipped++;
        continue;
      }
      if (!fs.existsSync(file.path)) {
        log.push({ file: file.path, action: 'skipped', reason: 'not found on disk', ts: Date.now() });
        stats.skipped++;
        continue;
      }

      let isKeep;
      if (strategy === 'keep_in_place') {
        isKeep = true;
      } else if (['execute_selected','recycle_removed','delete_permanent'].includes(strategy)) {
        isKeep = (effectiveSelections[file.path] || 'keep') === 'keep';
      } else if (winner) {
        isKeep = file.path === winner.path;
      } else {
        isKeep = true;
      }

      try {
        if (isKeep) {
          if (keepTarget) {
            const dest = dryRun ? path.join(keepTarget, path.basename(file.path)) : moveFile(file.path, keepTarget, reproduceStructure);
            log.push({ file: file.path, action: 'move_keep', dest, ts: Date.now() });
            stats.moved++;
          } else {
            log.push({ file: file.path, action: 'kept', ts: Date.now() });
            stats.kept++;
          }
        } else {
          if (strategy === 'delete_permanent') {
            if (!dryRun) deleteFile(file.path);
            log.push({ file: file.path, action: 'delete', ts: Date.now() });
            stats.deleted++;
          } else if (removeTarget) {
            const dest = dryRun
              ? path.join(removeTarget, path.basename(file.path))
              : moveFile(file.path, removeTarget, !!reproduceStructure);
            log.push({ file: file.path, action: 'move_remove', dest, ts: Date.now() });
            stats.moved++;
          } else {
            if (!dryRun) await recycleFile(file.path);
            log.push({ file: file.path, action: 'recycle', ts: Date.now() });
            stats.recycled++;
          }
        }
      } catch (e) {
        log.push({ file: file.path, action: 'error', reason: e.message, ts: Date.now() });
        stats.errors++;
      }
    }
  }

  return { stats, log, dryRun };
}

function parseMtime(s) {
  try { return s ? new Date(s).getTime() : 0; } catch { return 0; }
}

module.exports = { executeActions, recycleFile, moveFile, deleteFile, undo, getUndoLog, getTrashStats, emptyTrash, getAppTrashDir };
