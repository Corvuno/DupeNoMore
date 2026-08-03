'use strict';
const fs   = require('fs');
const path = require('path');

const IGNORE_FILE = 'ignore.json';

function getPath(dataDir) {
  return path.join(dataDir, IGNORE_FILE);
}

function load(dataDir) {
  const p = getPath(dataDir);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return []; }
}

function save(dataDir, entries) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getPath(dataDir), JSON.stringify(entries, null, 2));
}

function addGroup(dataDir, paths) {
  const entries = load(dataDir);
  // Don't add if already ignored
  const key = [...paths].sort().join('|');
  if (entries.some(e => [...e.paths].sort().join('|') === key)) return entries;
  entries.push({ paths, date: new Date().toISOString().slice(0, 10) });
  save(dataDir, entries);
  return entries;
}

function addMultipleGroups(dataDir, groupPaths) {
  const entries = load(dataDir);
  const existing = new Set(entries.map(e => [...e.paths].sort().join('|')));
  let added = 0;
  for (const paths of groupPaths) {
    const key = [...paths].sort().join('|');
    if (existing.has(key)) continue;
    entries.push({ paths, date: new Date().toISOString().slice(0, 10) });
    existing.add(key);
    added++;
  }
  save(dataDir, entries);
  return { added, total: entries.length };
}

function remove(dataDir, index) {
  const entries = load(dataDir);
  if (index < 0 || index >= entries.length) return entries;
  entries.splice(index, 1);
  save(dataDir, entries);
  return entries;
}

function clear(dataDir) {
  save(dataDir, []);
}

// Check if a group should be ignored
// A group is ignored if ALL its file paths appear in any single ignore entry
function isIgnored(entries, groupPaths) {
  const gpSet = new Set(groupPaths);
  return entries.some(entry => {
    const entrySet = new Set(entry.paths);
    return groupPaths.every(p => entrySet.has(p));
  });
}

// Check if a specific file path is individually ignored
function isFileIgnored(entries, filePath) {
  return entries.some(entry => entry.paths.length === 1 && entry.paths[0] === filePath);
}

// Get all individually ignored file paths as a Set (for fast lookup)
function getIgnoredFiles(entries) {
  const set = new Set();
  entries.forEach(entry => {
    if (entry.paths.length === 1) set.add(entry.paths[0]);
  });
  return set;
}

module.exports = { load, save, addGroup, addMultipleGroups, remove, clear, isIgnored, isFileIgnored, getIgnoredFiles };
