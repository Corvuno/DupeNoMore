'use strict';
const path = require('path');
const fs = require('fs');
const { getDataDir } = require('./config');

// Resolve wasm path relative to this file — works regardless of cwd
const WASM_PATH = path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');

let db = null;
let dirty = false;
let saveTimer = null;
let _initPromise = null;

async function init() {
  try {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });

    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'hash_cache.db');

    if (fs.existsSync(dbPath)) {
      db = new SQL.Database(fs.readFileSync(dbPath));
    } else {
      db = new SQL.Database();
    }

    db.run(`CREATE TABLE IF NOT EXISTS file_hashes (
      path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL,
      md5 TEXT, dhash TEXT, phash TEXT, ahash TEXT, whash TEXT, mhash TEXT, bhash TEXT,
      width INTEGER, height INTEGER, exif_date TEXT, updated_at INTEGER NOT NULL
    )`);

    // Schema/hash versions. v1: wHash was broken before (same value for every
    // image), so drop cached wHash values; they are recomputed on next scan.
    const ver = db.exec('PRAGMA user_version')[0]?.values[0][0] || 0;
    if (ver < 1) {
      db.run('UPDATE file_hashes SET whash=NULL');
      db.run('PRAGMA user_version = 1');
      dirty = true;
    }

    // Save DB to disk every 3s when dirty
    setInterval(() => { if (dirty) _flush(dbPath); }, 3000);
    process.on('exit', () => _flush(dbPath));
    process.on('SIGINT', () => { _flush(dbPath); process.exit(0); });

    return db;
  } catch (e) {
    console.warn('[hash_cache] Init failed, running without cache:', e.message);
    return null;
  }
}

function _flush(dbPath) {
  if (!db || !dirty) return;
  try {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    dirty = false;
  } catch (e) {
    console.warn('[hash_cache] Save failed:', e.message);
  }
}

function ensureInit() {
  if (!_initPromise) _initPromise = init();
  return _initPromise;
}

function get(filePath, mtime, size) {
  if (!db) return null;
  try {
    const stmt = db.prepare('SELECT * FROM file_hashes WHERE path=? AND mtime=? AND size=?');
    stmt.bind([filePath, mtime, size]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  } catch { return null; }
}

function set(filePath, mtime, size, hashes) {
  if (!db) return;
  try {
    db.run(
      `INSERT OR REPLACE INTO file_hashes
        (path,mtime,size,md5,dhash,phash,ahash,whash,mhash,bhash,width,height,exif_date,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [filePath, mtime, size,
       hashes.md5||null, hashes.dhash||null, hashes.phash||null,
       hashes.ahash||null, hashes.whash||null, hashes.mhash||null, hashes.bhash||null,
       hashes.width||null, hashes.height||null, hashes.exif_date||null, Date.now()]
    );
    dirty = true;
  } catch (e) { console.warn('[hash_cache] set error:', e.message); }
}

function invalidate(filePath) {
  if (!db) return;
  try { db.run('DELETE FROM file_hashes WHERE path=?', [filePath]); dirty = true; } catch {}
}

function close() {
  const dbPath = path.join(getDataDir(), 'hash_cache.db');
  _flush(dbPath);
  if (db) { try { db.close(); } catch {} db = null; }
}

function stats() {
  if (!db) return { count: 0 };
  try {
    const res = db.exec('SELECT COUNT(*) FROM file_hashes');
    return { count: res[0]?.values[0][0] || 0 };
  } catch { return { count: 0 }; }
}

async function getAsync(filePath, mtime, size) {
  await ensureInit(); return get(filePath, mtime, size);
}
async function setAsync(filePath, mtime, size, hashes) {
  await ensureInit(); return set(filePath, mtime, size, hashes);
}

module.exports = { get, set, getAsync, setAsync, invalidate, close, stats, ensureInit };
