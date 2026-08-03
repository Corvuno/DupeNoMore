'use strict';
/**
 * Config module — split storage so user data is never lost on updates.
 *
 * Files:
 *   data/folders.json  — folder list + per-folder settings. NEVER deleted by updates.
 *   data/filters.json  — file filters (size, date, extension). User data.
 *   data/app.json      — app settings (theme, scansDir, HF token). User data.
 *   data/scan.json     — algorithm settings. Can be reset without losing folders.
 *   data/profiles.json — scan profiles. Auto-regenerated from code on every update.
 *
 * The public API presents a single unified config object for compatibility.
 * POST /api/config saves the relevant fields to the correct files automatically.
 */

const fs   = require('fs');
const path = require('path');

const APP_DIR  = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(APP_DIR, 'data');

const FILES = {
  folders:  path.join(DATA_DIR, 'folders.json'),
  filters:  path.join(DATA_DIR, 'filters.json'),
  app:      path.join(DATA_DIR, 'app.json'),
  scan:     path.join(DATA_DIR, 'scan.json'),
  profiles: path.join(DATA_DIR, 'profiles.json'),
  // Legacy — read-only migration source
  legacy:   path.join(DATA_DIR, 'config.json'),
};

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_FOLDERS = [];

const DEFAULT_FILTERS = {
  minSizeKB:          10,
  maxSizeMB:          0,
  dateFrom:           null,
  dateTo:             null,
  dateType:           'file',
  excludePatterns:    [],
  skipSystemFolders:  true,
  extensions:         [],
  includeVideos:      false
};

const DEFAULT_SCAN = {
  algorithms:  { dhash: true, phash: true, ahash: false, whash: false, mhash: false, bhash: false },
  thresholds:  { dhash: 8, phash: 12, ahash: 10, whash: 10, mhash: 10, bhash: 10 },
  ensureMin:   2,
  bhashMode:   'fast',
  compareSize: 16,
  rotation:    false,
  mirror:      false,
  colorChange: false,
  matchLogic:  'threshold',
  anchorHash:  null
};

const DEFAULT_APP = {
  scansDir:         null,   // null = derive from APP_DIR at runtime
  huggingfaceToken: '',
  clipTimeout:      30,
  theme:            'dark'
};

const DEFAULT_CONFIG = {
  version: '1.0.0',
  folders: DEFAULT_FOLDERS,
  filters: DEFAULT_FILTERS,
  scan:    DEFAULT_SCAN,
  settings: DEFAULT_APP
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`[config] Could not read ${path.basename(file)}: ${e.message}`);
  }
  return fallback;
}

function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function mergeDeep(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source || {})) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeDeep(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ── Migration from legacy config.json ────────────────────────────────────────
function migrateIfNeeded() {
  if (!fs.existsSync(FILES.legacy)) return;
  // Only migrate if new split files don't exist yet
  if (fs.existsSync(FILES.folders) || fs.existsSync(FILES.scan)) return;

  console.log('[config] Migrating config.json → split files...');
  try {
    const legacy = JSON.parse(fs.readFileSync(FILES.legacy, 'utf8'));
    if (legacy.folders)  writeJSON(FILES.folders, legacy.folders);
    if (legacy.filters)  writeJSON(FILES.filters, legacy.filters);
    if (legacy.scan)     writeJSON(FILES.scan,    legacy.scan);
    if (legacy.settings) writeJSON(FILES.app,     legacy.settings);
    // Rename legacy file so we don't migrate again
    fs.renameSync(FILES.legacy, FILES.legacy + '.migrated');
    console.log('[config] Migration complete. Legacy config.json renamed to config.json.migrated');
  } catch (e) {
    console.warn('[config] Migration failed:', e.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function load() {
  ensureDataDir();
  migrateIfNeeded();

  const folders = readJSON(FILES.folders, DEFAULT_FOLDERS);
  const filters = mergeDeep(DEFAULT_FILTERS, readJSON(FILES.filters, {}));
  const app     = mergeDeep(DEFAULT_APP,     readJSON(FILES.app, {}));
  let   scan    = mergeDeep(DEFAULT_SCAN,    readJSON(FILES.scan, {}));

  // Migrations for scan settings
  if (process.platform === 'win32' && app.scansDir && app.scansDir.startsWith('/')) {
    app.scansDir = null; // stale Linux path from dev environment
    writeJSON(FILES.app, app);
  }
  // ensureMin=1 caused giant groups — silently fix unless user explicitly chose it
  if (scan.ensureMin === 1 && !readJSON(FILES.scan, {})._userChosen) {
    scan.ensureMin = 2;
  }

  return {
    version:  '1.0.0',
    folders:  Array.isArray(folders) ? folders : DEFAULT_FOLDERS,
    filters,
    scan,
    settings: app
  };
}

function save(cfg) {
  ensureDataDir();
  // Each section goes to its own file — user's folders are always safe
  if (Array.isArray(cfg.folders))  writeJSON(FILES.folders, cfg.folders);
  if (cfg.filters && typeof cfg.filters === 'object') writeJSON(FILES.filters, cfg.filters);
  if (cfg.scan    && typeof cfg.scan    === 'object') {
    // Mark that ensureMin was explicitly set by user
    const scanToSave = { ...cfg.scan, _userChosen: true };
    writeJSON(FILES.scan, scanToSave);
  }
  if (cfg.settings && typeof cfg.settings === 'object') {
    // Guard against stale Linux paths
    const appToSave = { ...cfg.settings };
    if (process.platform === 'win32' && appToSave.scansDir && appToSave.scansDir.startsWith('/')) {
      appToSave.scansDir = null;
    }
    writeJSON(FILES.app, appToSave);
  }
}

// Partial save — update only specific sections without touching others
function saveFolders(folders) { ensureDataDir(); writeJSON(FILES.folders, folders); }
function saveScan(scan)       { ensureDataDir(); writeJSON(FILES.scan, { ...scan, _userChosen: true }); }
function saveFilters(filters) { ensureDataDir(); writeJSON(FILES.filters, filters); }
function saveApp(app)         { ensureDataDir(); writeJSON(FILES.app, app); }

// ── Profiles ──────────────────────────────────────────────────────────────────
// Profiles are always regenerated from code — never user data, always up to date.
const BUILTIN_PROFILES = [
  {
    id:   'exact_only',
    name: 'Exact duplicates only (MD5)',
    description: 'Only finds byte-for-byte identical files. Zero false positives. Fast.',
    scan: { ...DEFAULT_SCAN, algorithms: { dhash:false, phash:false, ahash:false, whash:false, mhash:false, bhash:false }, ensureMin:1, searchDepth:1 }
  },
  {
    id:   'quick',
    name: 'Quick — obvious copies',
    description: 'Fast. Finds exact + near-identical images. Very few false positives.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true}, thresholds:{dhash:6,phash:8,ahash:10,whash:10,mhash:10,bhash:10}, ensureMin:2, searchDepth:1 }
  },
  {
    id:   'strict',
    name: 'Strict — high confidence',
    description: 'Both dhash+phash must agree. Only near-exact copies.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true}, thresholds:{dhash:4,phash:6,ahash:10,whash:10,mhash:10,bhash:10}, ensureMin:2, searchDepth:1 }
  },
  {
    id:   'balanced',
    name: 'Balanced — recommended',
    description: 'Finds recompressed JPEGs, light edits. Any single algorithm match is enough.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true}, thresholds:{dhash:10,phash:12,ahash:10,whash:10,mhash:10,bhash:10}, ensureMin:1, searchDepth:2 }
  },
  {
    id:   'media_library',
    name: 'Large media library',
    description: 'For large personal libraries with downloads from multiple sources. Both algos must agree.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true}, thresholds:{dhash:8,phash:10,ahash:10,whash:10,mhash:10,bhash:10}, ensureMin:2, searchDepth:2 }
  },
  {
    id:   'thorough',
    name: 'Thorough — deep clean',
    description: 'Finds resized, recompressed, lightly edited. Three algorithms. Recommended for first-time cleaning.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true,ahash:true}, thresholds:{dhash:12,phash:14,ahash:12,whash:10,mhash:10,bhash:10}, ensureMin:1, searchDepth:3 }
  },
  {
    id:   'loose',
    name: 'Loose — similar images',
    description: 'Also finds cropped, watermarked, color-adjusted versions. Any single match is enough.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true,ahash:true}, thresholds:{dhash:12,phash:16,ahash:12,whash:10,mhash:10,bhash:10}, ensureMin:1, searchDepth:3 }
  },
  {
    id:   'aggressive',
    name: 'Aggressive — maximum recall',
    description: 'Finds heavily recompressed, cropped, watermarked, color-shifted versions. More false positives.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true,ahash:true}, thresholds:{dhash:14,phash:16,ahash:14,whash:10,mhash:10,bhash:10}, ensureMin:1, searchDepth:4 }
  },
  {
    id:   'web_downloads',
    name: 'Web downloads — scattered copies',
    description: 'For images downloaded from the internet multiple times. Catches recompression and resizing.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true}, thresholds:{dhash:14,phash:16,ahash:10,whash:10,mhash:10,bhash:10}, ensureMin:1, searchDepth:3 }
  },
  {
    id:   'max_coverage',
    name: 'Maximum coverage',
    description: 'All algorithms, highest thresholds, deepest search. Will find everything — at the cost of many false positives.',
    scan: { ...DEFAULT_SCAN, algorithms:{dhash:true,phash:true,ahash:true}, thresholds:{dhash:16,phash:18,ahash:16,whash:10,mhash:10,bhash:10}, ensureMin:1, searchDepth:5 }
  }
];

function loadProfiles() {
  // Built-in profiles always come from code — always current.
  // User-saved custom profiles are appended from profiles.json.
  const custom = readJSON(FILES.profiles, []).filter(p =>
    !BUILTIN_PROFILES.some(b => b.id === p.id) // don't duplicate builtins
  );
  return [...BUILTIN_PROFILES, ...custom];
}

function saveProfiles(profiles) {
  // Only save non-builtin profiles (user custom ones)
  const custom = profiles.filter(p => !BUILTIN_PROFILES.some(b => b.id === p.id));
  writeJSON(FILES.profiles, custom);
}

function getDataDir()   { return DATA_DIR; }
function getScansDir(cfg) {
  const stored = cfg?.settings?.scansDir;
  if (stored && stored !== 'null' && fs.existsSync(path.dirname(stored))) return stored;
  return path.join(APP_DIR, 'scans');
}

module.exports = {
  load, save, saveFolders, saveScan, saveFilters, saveApp,
  loadProfiles, saveProfiles,
  getDataDir, getScansDir,
  DEFAULT_CONFIG, DEFAULT_SCAN, DEFAULT_FILTERS, DEFAULT_APP,
  APP_DIR, DATA_DIR,
  mergeDeep  // exported for tests
};
