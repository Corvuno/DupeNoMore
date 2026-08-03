'use strict';
const fs = require('fs');
const path = require('path');
const { getActiveExtensions } = require('./fileTypes');

const SYSTEM_DIRS = new Set([
  'windows', 'system32', 'syswow64', 'program files', 'program files (x86)',
  'programdata', 'appdata', '$recycle.bin', 'system volume information',
  'recovery', 'boot', 'efi'
]);

function matchesExcludePattern(dirPath, pattern) {
  // Wildcard matching: * matches any chars
  const regexStr = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*/g, '.*');
  try {
    const re = new RegExp(regexStr, 'i');
    return re.test(dirPath.replace(/\\/g, '/'));
  } catch { return false; }
}

function isSystemDir(dirPath, skipSystem) {
  if (!skipSystem) return false;
  const lower = path.basename(dirPath).toLowerCase();
  if (SYSTEM_DIRS.has(lower)) return true;
  try {
    // Check hidden/system attributes via stat (approximation on non-Windows)
    const stat = fs.statSync(dirPath);
    // On Windows, hidden dirs often start with $
    if (lower.startsWith('$')) return true;
  } catch {}
  return false;
}

function passesDateFilter(stat, filters) {
  if (!filters.dateFrom && !filters.dateTo) return true;
  const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
  const to = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59').getTime() : null;

  const fileTime = stat.mtimeMs;

  function inRange(t) {
    if (!t) return false;
    const ok = (!from || t >= from) && (!to || t <= to);
    return ok;
  }

  if (filters.dateType === 'file') return inRange(fileTime);
  if (filters.dateType === 'exif') return true; // EXIF checked later after hashing
  if (filters.dateType === 'both') return inRange(fileTime);
  return true;
}

async function collectFiles(folders, filters, onProgress) {
  const extensions = getActiveExtensions({ filters });
  const files = [];
  const seen = new Set();

  for (const folder of folders) {
    if (!folder.active) continue;
    if (!fs.existsSync(folder.path)) {
      onProgress?.({ type: 'warn', message: `Folder not found: ${folder.path}` });
      continue;
    }
    await walkDir(folder.path, folder.recursive !== false, folder, extensions, filters, files, seen, onProgress);
  }

  return files;
}

async function walkDir(dirPath, recursive, folder, extensions, filters, results, seen, onProgress) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (e) { onProgress?.({ type: 'warn', message: `Cannot read: ${dirPath}` }); return; }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!recursive) continue;
      if (isSystemDir(fullPath, filters.skipSystemFolders)) continue;
      if (filters.excludePatterns?.some(p => p && matchesExcludePattern(fullPath, p))) continue;
      await walkDir(fullPath, recursive, folder, extensions, filters, results, seen, onProgress);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase().replace('.', '');
      if (!extensions.has(ext)) continue;
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);

      let stat;
      try { stat = fs.statSync(fullPath); }
      catch { continue; }

      const sizeKB = stat.size / 1024;
      const sizeMB = stat.size / (1024 * 1024);

      if (filters.minSizeKB && sizeKB < filters.minSizeKB) continue;
      if (filters.maxSizeMB && filters.maxSizeMB > 0 && sizeMB > filters.maxSizeMB) continue;
      if (!passesDateFilter(stat, filters)) continue;

      results.push({
        path: fullPath,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
        folderIndex: folder.index ?? 0,
        folderPath: folder.path
      });
      if (results.length % 5000 === 0) {
        onProgress?.({ type: 'info', message: `Collecting... ${results.length} files found so far` });
      }
    }
  }
}

module.exports = { collectFiles };
