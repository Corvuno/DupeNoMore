/**
 * US-047: State export/import
 * Bundles config + hash cache + scan results into a ZIP for backup/migration.
 */
'use strict';
const fs      = require('fs');
const path    = require('path');
const archiver = require('archiver');
const configMgr = require('./config');

async function exportState(res) {
  const dataDir  = configMgr.getDataDir();
  const cfg      = configMgr.load();
  const scansDir = configMgr.getScansDir(cfg);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="dupenomore-state-${new Date().toISOString().slice(0,10)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  // Add data/ files (config, cache, profiles, trash contents)
  if (fs.existsSync(dataDir)) {
    archive.directory(dataDir, 'data');
  }

  // Add scan result files
  if (fs.existsSync(scansDir)) {
    archive.directory(scansDir, 'scans');
  }

  await archive.finalize();
}

async function importState(zipBuffer) {
  const AdmZip   = require('adm-zip');
  const dataDir  = configMgr.getDataDir();
  const cfg      = configMgr.load();
  const scansDir = configMgr.getScansDir(cfg);

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  let imported = { data: 0, scans: 0 };

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');

    if (name.startsWith('data/')) {
      const rel  = name.slice('data/'.length);
      const dest = path.join(dataDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
      imported.data++;
    } else if (name.startsWith('scans/')) {
      const rel  = name.slice('scans/'.length);
      const dest = path.join(scansDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
      imported.scans++;
    }
  }

  return imported;
}

module.exports = { exportState, importState };
