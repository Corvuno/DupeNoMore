'use strict';
/**
 * Checkpoint system — saves scan progress to disk so scans survive restarts.
 * US-042: Stop & save checkpoint
 * US-046: Load interim results
 * US-047: State export/import
 *
 * Checkpoint file: data/checkpoints/{scanId}.json
 * Contains: config, collected files, hashed files so far, groups so far, phase
 */
const fs   = require('fs');
const path = require('path');

function getCheckpointDir(dataDir) {
  const dir = path.join(dataDir, 'checkpoints');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveCheckpoint(dataDir, scanId, data) {
  const dir  = getCheckpointDir(dataDir);
  const file = path.join(dir, `${scanId}.json`);
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

function loadCheckpoint(dataDir, scanId) {
  const file = path.join(getCheckpointDir(dataDir), `${scanId}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function deleteCheckpoint(dataDir, scanId) {
  const file = path.join(getCheckpointDir(dataDir), `${scanId}.json`);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
}

function listCheckpoints(dataDir) {
  const dir = getCheckpointDir(dataDir);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          scanId:    f.replace('.json', ''),
          phase:     data.phase,
          savedAt:   data.savedAt,
          fileCount: data.files?.length || 0,
          hashedCount: data.hashedFiles?.length || 0,
          groupCount:  data.groups?.length || 0,
          config:    data.config
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

module.exports = { saveCheckpoint, loadCheckpoint, deleteCheckpoint, listCheckpoints, getCheckpointDir };
