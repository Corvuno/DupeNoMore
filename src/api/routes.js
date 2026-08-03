'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { exec, execSync } = require('child_process');
const archiver = require('archiver');

const configMgr  = require('../core/config');

// ── Path safety: only serve files inside configured scan folders (or already
// in a saved result). Prevents reading arbitrary disk paths via the file
// endpoints, even though those are GET requests. ──────────────────────────────
const pathMod = require('path');
function isPathAllowed(filePath) {
  if (!filePath) return false;
  let resolved;
  try { resolved = pathMod.resolve(filePath); } catch { return false; }
  const cfg = configMgr.load();
  const roots = (cfg.folders || []).map(f => {
    try { return pathMod.resolve(f.path); } catch { return null; }
  }).filter(Boolean);
  if (!roots.length) return false;
  return roots.some(root => {
    const rel = pathMod.relative(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !pathMod.isAbsolute(rel));
  });
}
const scanManager= require('../core/scanManager');
const { getResultFiles, loadResult, deleteResult, filterGroups, saveOverrides, loadOverrides } = require('../core/results');
const { executeActions, getUndoLog, undo, getTrashStats, emptyTrash } = require('../core/actions');
const hashCache  = require('../core/hashCache');
const ignoreList = require('../core/ignoreList');

const router = express.Router();

// ─── Health ──────────────────────────────────────────────────────────────────
// ─── US-083/035: Version and integrity check ──────────────────────────────────
router.get('/version', (req, res) => {
  const fs2  = require('fs');
  const pkg  = JSON.parse(fs2.readFileSync(path.join(__dirname,'../../package.json'), 'utf8'));
  const coreFiles = [
    'src/core/config.js','src/core/hasher.js','src/core/comparator.js',
    'src/core/collector.js','src/core/actions.js','src/core/scanManager.js'
  ];
  const missing = coreFiles.filter(f => !fs2.existsSync(path.join(__dirname,'../../',f)));
  res.json({
    version:  pkg.version,
    ok:       missing.length === 0,
    missing,
    nodeVersion: process.version,
    platform:   process.platform
  });
});

router.get('/health', (req, res) => {
  // Check ffmpeg availability
  const { execSync } = require('child_process');
  const candidates = [
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(require('../core/config').APP_DIR, 'ffmpeg.exe'),
    path.join(require('../core/config').APP_DIR, 'bin', 'ffmpeg.exe'),
  ];
  let ffmpegAvailable = false;
  for (const candidate of candidates) {
    try { execSync(`"${candidate}" -version`, { stdio: 'ignore', timeout: 2000 }); ffmpegAvailable = true; break; }
    catch {}
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  res.json({ ok: true, version: pkg.version, ts: Date.now(), ffmpegAvailable });
});

// ─── Config ──────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json(configMgr.load());
});

router.post('/config', (req, res) => {
  try {
    const cfg = req.body;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return res.status(400).json({ error: 'Invalid config: expected JSON object' });
    }
    if (!Array.isArray(cfg.folders)) {
      return res.status(400).json({ error: 'Invalid config: folders must be array' });
    }
    configMgr.save(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Profiles ────────────────────────────────────────────────────────────────
router.get('/profiles', (req, res) => {
  res.json(configMgr.loadProfiles());
});

router.post('/profiles', (req, res) => {
  try { configMgr.saveProfiles(req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Folder picker (PowerShell — no compilation required) ───────────────────
router.get('/pick-folder', (req, res) => {
  if (process.platform !== 'win32') {
    return res.json({ path: null, unsupported: true });
  }
  // Use PowerShell FolderBrowserDialog — works on every Windows, no compilation
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
    '$f.Description = "Select folder to scan";',
    '$f.RootFolder = [System.Environment+SpecialFolder]::MyComputer;',
    '$f.ShowNewFolderButton = $true;',
    '$result = $f.ShowDialog();',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  Write-Output $f.SelectedPath',
    '}'
  ].join(' ');

  exec(
    'powershell -NoProfile -STA -Command "' + ps + '"',
    { timeout: 120000 },
    (err, stdout, stderr) => {
      const picked = stdout.trim();
      if (err || !picked) {
        res.json({ path: null });
      } else {
        res.json({ path: picked });
      }
    }
  );
});

// ─── Scans ───────────────────────────────────────────────────────────────────
router.post('/scans/start', async (req, res) => {
  try {
    const config = configMgr.load(); // always fresh from disk
    const id = await scanManager.start(config);
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/scans', (req, res) => {
  res.json(scanManager.getAll());
});

router.get('/scans/:id', (req, res) => {
  const s = scanManager.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Scan not found' });
  res.json(s);
});

router.post('/scans/:id/pause',  (req, res) => { scanManager.pause(req.params.id);   res.json({ ok: true }); });
router.post('/scans/:id/resume', (req, res) => { scanManager.resume(req.params.id);  res.json({ ok: true }); });
router.post('/scans/:id/abort',  (req, res) => { scanManager.abort(req.params.id);   res.json({ ok: true }); });
router.delete('/scans/:id',      (req, res) => { scanManager.dismiss(req.params.id); res.json({ ok: true }); });

// ─── Thumbnail ───────────────────────────────────────────────────────────────
const VIDEO_EXTS = new Set(['mp4','mov','avi','mkv','wmv','flv','webm','m4v','mpg','mpeg','3gp','ts','mts','m2ts']);

function isVideoPath(p) {
  return VIDEO_EXTS.has(path.extname(p).toLowerCase().replace('.',''));
}

// Thumbnail cache in memory (path → jpeg buffer) — avoids re-extracting on every page load
const _thumbCache = new Map();
const MAX_THUMB_CACHE = 2000;

router.get('/thumbnail', async (req, res) => {
  const filePath = req.query.path;
  if (!isPathAllowed(filePath)) return res.status(403).end();
  if (!filePath) return res.status(400).end();
  if (!fs.existsSync(filePath)) return res.status(404).end();

  // Serve from memory cache if available
  if (_thumbCache.has(filePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(_thumbCache.get(filePath));
  }

  try {
    let buf;

    if (isVideoPath(filePath)) {
      // Find ffmpeg — check PATH and common Windows install locations
      const { execSync } = require('child_process');
      let ffmpegPath = null;
      const candidates = [
        'ffmpeg', // on PATH
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
        path.join(require('../core/config').APP_DIR, 'ffmpeg.exe'), // bundled next to app
        path.join(require('../core/config').APP_DIR, 'bin', 'ffmpeg.exe'),
      ];
      for (const candidate of candidates) {
        try {
          execSync(`"${candidate}" -version`, { stdio: 'ignore', timeout: 3000 });
          ffmpegPath = candidate;
          break;
        } catch {}
      }

      if (!ffmpegPath) {
        // No ffmpeg found — return placeholder signal
        return res.status(204).end();
      }

      // Direct ffmpeg call — simpler and more reliable than fluent-ffmpeg
      const tmpOut = path.join(os.tmpdir(), 'dnm_thumb_' + Date.now() + '.jpg');
      try {
        execSync(
          '"' + ffmpegPath + '" -i "' + filePath.replace(/"/g, '') + '" -vframes 1 -an -vf "scale=300:-1" -y "' + tmpOut + '"',
          { timeout: 15000, stdio: 'pipe' }
        );
        buf = fs.readFileSync(tmpOut);
        try { fs.unlinkSync(tmpOut); } catch {}
      } catch (ffErr) {
        console.error('[thumbnail] ffmpeg failed for', path.basename(filePath), ':', (ffErr.stderr||ffErr.message||'').toString().slice(0, 200));
        try { fs.unlinkSync(tmpOut); } catch {}
        return res.status(204).end();
      }
    } else {
      const sharp = require('sharp');
      const full  = req.query.full === '1';
      if (full) {
        // Full resolution for zoom overlay — resize to max 1600px, higher quality
        buf = await sharp(filePath)
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
      } else {
        buf = await sharp(filePath)
          .resize(300, 300, { fit: 'cover' })
          .jpeg({ quality: 75 })
          .toBuffer();
      }
    }

    // Cache it
    if (_thumbCache.size >= MAX_THUMB_CACHE) {
      const firstKey = _thumbCache.keys().next().value;
      _thumbCache.delete(firstKey);
    }
    _thumbCache.set(filePath, buf);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e) {
    console.error('[thumbnail] Error for', filePath, ':', e.message);
    res.status(204).end();
  }
});

// ─── Results ─────────────────────────────────────────────────────────────────
router.get('/results', (req, res) => {
  const cfg = configMgr.load();
  res.json(getResultFiles(configMgr.getScansDir(cfg)));
});

function resultPath(filename, cfg) {
  return path.join(configMgr.getScansDir(cfg), path.basename(filename));
}

router.get('/results/:filename', (req, res) => {
  const cfg = configMgr.load();
  try {
    const data = loadResult(resultPath(req.params.filename, cfg));
    const overrides = loadOverrides(configMgr.getDataDir(), req.params.filename);
    res.json({ ...data, overrides });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

router.delete('/results/:filename', (req, res) => {
  const cfg = configMgr.load();
  try { deleteResult(resultPath(req.params.filename, cfg)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/results/:filename/filter', (req, res) => {
  const cfg = configMgr.load();
  try {
    const r = filterGroups(resultPath(req.params.filename, cfg), req.body.type, req.body.value);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/results/:filename/overrides', (req, res) => {
  try { saveOverrides(configMgr.getDataDir(), req.params.filename, req.body.overrides); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Export ──────────────────────────────────────────────────────────────────
router.get('/results/:filename/export/:format', (req, res) => {
  const cfg = configMgr.load();
  try {
    const result = loadResult(resultPath(req.params.filename, cfg));
    const fmt = req.params.format;

    if (fmt === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
      return res.json(result);
    }
    if (fmt === 'csv') {
      const rows = [['Group','File','Role','Confidence','Size','Width','Height','MP','FileDate','EXIFDate']];
      result.groups.forEach((g, i) => {
        const si = g.source_info || {};
        rows.push([i+1,g.source,'source',g.confidenceLabel,si.size_fmt||'',si.width||'',si.height||'',si.megapixels||'',si.mtime_fmt||'',si.exif_date||'']);
        (g.matches||[]).forEach(m => rows.push([i+1,m.path,'match',m.md5_match?'certain(md5)':g.confidenceLabel,m.size_fmt||'',m.width||'',m.height||'',m.megapixels||'',m.mtime_fmt||'',m.exif_date||'']));
      });
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace('.json','.csv')}"`);
      res.setHeader('Content-Type', 'text/csv');
      return res.send(rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n'));
    }
    if (fmt === 'txt') {
      const lines = [`DupeNoMore Export — ${result.scannedAt}`, `Groups: ${result.groupCount}`, ''];
      result.groups.forEach((g, i) => {
        lines.push(`--- Group ${i+1} [${g.confidenceLabel}] ---`);
        lines.push(`  KEEP: ${g.source}`);
        (g.matches||[]).forEach(m => lines.push(`  DUPE: ${m.path}`));
        lines.push('');
      });
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace('.json','.txt')}"`);
      res.setHeader('Content-Type', 'text/plain');
      return res.send(lines.join('\n'));
    }
    if (fmt === 'zip') {
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace('.json','.zip')}"`);
      res.setHeader('Content-Type', 'application/zip');
      const archive = archiver('zip');
      archive.pipe(res);
      archive.append(JSON.stringify(result, null, 2), { name: req.params.filename });
      return archive.finalize();
    }
    if (fmt === 'html') {
      const scannedAt = new Date(result.scannedAt).toLocaleString('en-GB');
      const rows = result.groups.flatMap((g, i) => {
        const si = g.source_info || {};
        const matchBadge = g.matches?.some(m=>m.md5_match) ? '<span style="background:#22c55e;color:#fff;padding:1px 5px;border-radius:3px;font-size:11px">MD5✓</span>' : '';
        return [
          `<tr style="background:#1e293b"><td colspan="6" style="padding:6px 10px;color:#94a3b8;font-size:12px">
            Group ${i+1} &nbsp;·&nbsp; <b style="color:#${g.confidenceLabel==='certain'?'22c55e':g.confidenceLabel==='probable'?'f59e0b':'ef4444'}">${g.confidenceLabel}</b>
            &nbsp;·&nbsp; ${(g.matches||[]).length+1} files &nbsp;${matchBadge}</td></tr>`,
          `<tr class="src"><td>★</td><td title="${g.source}">${g.source.split(/[\/]/).pop()}</td><td>${g.source.split(/[\/]/).slice(0,-1).join('/')}</td><td>${si.size_fmt||''}</td><td>${(si.width&&si.height)?si.width+'×'+si.height:''}</td><td>${si.mtime_fmt||''}</td></tr>`,
          ...(g.matches||[]).map(m => `<tr><td></td><td title="${m.path}">${m.path.split(/[\/]/).pop()}</td><td>${m.path.split(/[\/]/).slice(0,-1).join('/')}</td><td>${m.size_fmt||''}</td><td>${(m.width&&m.height)?m.width+'×'+m.height:''}</td><td>${m.mtime_fmt||''}</td></tr>`)
        ];
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DupeNoMore Report</title>
        <style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
        h1{color:#a78bfa;margin-bottom:4px}p{color:#94a3b8;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{background:#1e293b;color:#94a3b8;padding:8px 10px;text-align:left;border-bottom:1px solid #334155}
        td{padding:5px 10px;border-bottom:1px solid #1e293b;word-break:break-all}
        tr.src td{color:#a78bfa}</style></head><body>
        <h1>DupeNoMore Report</h1>
        <p>Scanned: ${scannedAt} &nbsp;·&nbsp; ${result.groupCount} groups found</p>
        <table><thead><tr><th>Role</th><th>Filename</th><th>Folder</th><th>Size</th><th>Resolution</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody></table></body></html>`;
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace('.json','.html')}"`);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }
    res.status(400).json({ error: 'Unknown format' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Actions ─────────────────────────────────────────────────────────────────
router.post('/results/:filename/actions', async (req, res) => {
  const cfg = configMgr.load();
  try {
    const result = await executeActions(resultPath(req.params.filename, cfg), req.body.actionSpec, req.body.dryRun === true);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/actions/undo-log', (req, res) => res.json(getUndoLog()));
// US-070: Download action log as TXT
router.get('/actions/undo-log/download', (req, res) => {
  const log = getUndoLog();
  const lines = ['DupeNoMore Action Log', '=' .repeat(40), ''];
  log.forEach((e,i) => {
    lines.push(`[${new Date(e.ts).toISOString()}] ${e.action.toUpperCase()}`);
    lines.push(`  From: ${e.from}`);
    if (e.to) lines.push(`  To:   ${e.to}`);
    lines.push('');
  });
  if (!lines.length) lines.push('No actions in log.');
  res.setHeader('Content-Disposition', 'attachment; filename="action-log.txt"');
  res.setHeader('Content-Type', 'text/plain');
  res.send(lines.join('\n'));
});
router.post('/actions/undo/:index', (req, res) => {
  try { res.json({ ok: true, restored: undo(parseInt(req.params.index, 10)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── App trash ───────────────────────────────────────────────────────────────
router.get('/trash/stats', (req, res) => res.json(getTrashStats()));
router.delete('/trash', (req, res) => res.json(emptyTrash()));

// ─── Cache & system ───────────────────────────────────────────────────────────
router.get('/cache/stats', (req, res) => res.json(hashCache.stats()));
router.delete('/cache', async (req, res) => {
  try {
    hashCache.close();
    const dbPath = path.join(configMgr.getDataDir(), 'hash_cache.db');
    try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
    // Reinitialize so cache works immediately without restart
    await hashCache.ensureInit();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Checkpoints (US-042, US-046, US-047) ────────────────────────────────────
router.get('/checkpoints', (req, res) => {
  const { listCheckpoints } = require('../core/checkpoint');
  res.json(listCheckpoints(configMgr.getDataDir()));
});

router.post('/scans/resume/:checkpointId', async (req, res) => {
  try {
    const { loadCheckpoint } = require('../core/checkpoint');
    const cp = loadCheckpoint(configMgr.getDataDir(), req.params.checkpointId);
    if (!cp) return res.status(404).json({ error: 'Checkpoint not found' });
    const config = cp.config || configMgr.load();
    const id = await scanManager.start(config, req.params.checkpointId);
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/checkpoints/:checkpointId', (req, res) => {
  const { deleteCheckpoint } = require('../core/checkpoint');
  deleteCheckpoint(configMgr.getDataDir(), req.params.checkpointId);
  res.json({ ok: true });
});

// Save interim data as a result file (US-046)
router.post('/results/save-interim', (req, res) => {
  try {
    const data   = req.body;
    if (!data || !Array.isArray(data.groups)) return res.status(400).json({ error: 'Invalid interim data' });
    const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fn     = `interim_${ts}.json`;
    const scansD = configMgr.getScansDir(configMgr.load());
    if (!fs.existsSync(scansD)) fs.mkdirSync(scansD, { recursive: true });
    fs.writeFileSync(path.join(scansD, fn), JSON.stringify(data, null, 2));
    res.json({ filename: fn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Interim results for a running scan (US-046)
router.get('/scans/:id/interim', (req, res) => {
  const scan = scanManager.get(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  if (!scan.interimFile || !fs.existsSync(scan.interimFile))
    return res.status(404).json({ error: 'No interim results yet' });
  try {
    const data = JSON.parse(fs.readFileSync(scan.interimFile, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/restart', (req, res) => {
  res.json({ ok: true, message: 'Restarting…' });
  // Exit after response is sent — start.bat restart loop will relaunch
  setTimeout(() => { console.log('\n  Restarting…\n'); process.exit(0); }, 1000);
});

// ─── Ignore list ──────────────────────────────────────────────────────────────
router.get('/ignore', (req, res) => {
  res.json(ignoreList.load(configMgr.getDataDir()));
});

router.post('/ignore', (req, res) => {
  const { paths, groups } = req.body;
  if (groups && Array.isArray(groups)) {
    // Bulk ignore multiple groups
    const result = ignoreList.addMultipleGroups(configMgr.getDataDir(), groups);
    return res.json({ ok: true, ...result });
  }
  if (paths && Array.isArray(paths)) {
    const entries = ignoreList.addGroup(configMgr.getDataDir(), paths);
    return res.json({ ok: true, total: entries.length });
  }
  res.status(400).json({ error: 'Provide paths array or groups array' });
});

router.delete('/ignore', (req, res) => {
  ignoreList.clear(configMgr.getDataDir());
  res.json({ ok: true });
});

router.delete('/ignore/:index', (req, res) => {
  const entries = ignoreList.remove(configMgr.getDataDir(), parseInt(req.params.index));
  res.json({ ok: true, total: entries.length });
});

// ─── Stream video file (for browser <video> thumbnail) ───────────────────────
router.get('/stream', (req, res) => {
  const filePath = req.query.path;
  if (!isPathAllowed(filePath)) return res.status(403).end();
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  const ext  = path.extname(filePath).toLowerCase();
  const mime = { '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime',
                 '.avi':'video/x-msvideo', '.mkv':'video/x-matroska', '.gif':'image/gif' }[ext] || 'application/octet-stream';

  // Support range requests so browser can seek to first frame
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end   = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 2 * 1024 * 1024, stat.size - 1); // max 2MB chunk
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    // Send first 2MB only (enough for first frame) to keep it fast
    const end = Math.min(2 * 1024 * 1024, stat.size) - 1;
    res.writeHead(200, {
      'Content-Length': end + 1,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath, { start: 0, end }).pipe(res);
  }
});

// ─── Rename file (keep same directory, change filename) ──────────────────────
router.post('/rename', (req, res) => {
  const { filePath, newName } = req.body;
  if (!filePath || !newName) return res.status(400).json({ error: 'filePath and newName required' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  // Sanitize newName: no path separators, no dangerous chars
  const safeName = newName.replace(/[/\\:*?"<>|]/g, '_');
  const dir      = path.dirname(filePath);
  const newPath  = path.join(dir, safeName);

  if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file with that name already exists in the folder' });

  try {
    fs.renameSync(filePath, newPath);
    console.log('[rename]', path.basename(filePath), '→', safeName);
    res.json({ ok: true, oldPath: filePath, newPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Open file in Explorer ────────────────────────────────────────────────────
router.get('/open-file', (req, res) => {
  const filePath = req.query.path;
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  if (filePath && process.platform === 'win32') {
    exec(`explorer /select,"${filePath.replace(/"/g, '')}"`, () => {});
  }
  res.json({ ok: true });
});

// Open image in default viewer (double-click equivalent)
router.get('/open-image', (req, res) => {
  const filePath = req.query.path;
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  if (filePath && process.platform === 'win32') {
    exec(`start "" "${filePath.replace(/"/g, '')}"`, () => {});
  } else if (filePath && process.platform === 'linux') {
    exec(`xdg-open "${filePath.replace(/"/g, '')}"`, () => {});
  } else if (filePath && process.platform === 'darwin') {
    exec(`open "${filePath.replace(/"/g, '')}"`, () => {});
  }
  res.json({ ok: true });
});

// ─── US-047: State export/import ─────────────────────────────────────────────
router.get('/state/export', async (req, res) => {
  try {
    const { exportState } = require('../core/state');
    await exportState(res);
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message }); }
});

router.post('/state/import', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!buf.length) return res.status(400).json({ error: 'No ZIP data received' });
    const { importState } = require('../core/state');
    const result = await importState(buf);
    res.json({ ok: true, imported: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── US-054: Import result file ───────────────────────────────────────────────
router.post('/results/import', express.text({ type: 'application/json', limit: '100mb' }), (req, res) => {
  try {
    const data = JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (!Array.isArray(data.groups)) return res.status(400).json({ error: 'Invalid result file: missing groups array' });
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fn   = `imported_${ts}.json`;
    const dest = path.join(configMgr.getScansDir(configMgr.load()), fn);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(data, null, 2));
    res.json({ ok: true, filename: fn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── US-049: Incremental scan — add folder and scan only new files ─────────────
router.post('/scans/incremental', async (req, res) => {
  try {
    const { folderPath } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'folderPath required' });

    // Add folder to config if not already present
    const cfg = configMgr.load();
    if (!cfg.folders.some(f => f.path === folderPath)) {
      cfg.folders.push({ path: folderPath, active: true, recursive: true, index: cfg.folders.length });
      configMgr.save(cfg);
    }

    // Start scan with new_files_only=true so cached files are skipped
    const id = await scanManager.start({ ...cfg, scan: { ...cfg.scan, new_files_only: true } });
    res.json({ ok: true, id, message: 'Incremental scan started — existing hashes will be reused' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── US-073/074: Non-image file scan ─────────────────────────────────────────
const fileScanJobs = new Map();

router.post('/file-scan/start', async (req, res) => {
  try {
    const cfg = configMgr.load();
    const spec = {
      folders: cfg.folders,
      extensions: req.body.extensions || [],
      minSizeKB: req.body.minSizeKB || 0,
      maxSizeMB: req.body.maxSizeMB || 0,
      useMd5: req.body.useMd5 !== false,
      useNameSimilarity: req.body.useNameSimilarity === true,
      nameSimilarityThreshold: req.body.nameSimilarityThreshold || 80
    };
    const id = 'fs_' + Date.now();
    const job = { id, status:'running', log:[], groupCount:0, result:null };
    fileScanJobs.set(id, job);

    const { scanFiles } = require('../core/fileScan');
    scanFiles({ ...spec, onProgress:(phase,done,total,msg) => {
      job.log.push({ ts: Date.now(), message: msg });
    }}).then(r => {
      job.status = 'done';
      job.result = r;
      job.groupCount = r.groups.length;
      job.log.push({ ts: Date.now(), message: `Done: ${r.groups.length} groups found in ${r.totalFiles} files` });
      // Save result
      const scansDir = configMgr.getScansDir(cfg);
      if (!fs.existsSync(scansDir)) fs.mkdirSync(scansDir, { recursive: true });
      const fn = `filescan_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`;
      fs.writeFileSync(path.join(scansDir, fn), JSON.stringify({
        version:'1.0.0', scannedAt: new Date().toISOString(), isFileScan:true,
        groupCount: r.groups.length, groups: r.groups
      }, null, 2));
      job.filename = fn;
    }).catch(e => {
      job.status = 'error'; job.error = e.message;
      job.log.push({ ts: Date.now(), message: 'Error: ' + e.message });
    });

    res.json({ ok:true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/file-scan/:id', (req, res) => {
  const job = fileScanJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Job not found' });
  res.json(job);
});


// ─── US-075/076: CLIP semantic search ────────────────────────────────────────
const clipSearch = require('../core/clipSearch');

router.get('/clip/status', (req, res) => {
  const available = clipSearch.isAvailable();
  const stats     = available ? clipSearch.getIndexStats() : null;
  res.json({ available, stats, modelDir: clipSearch.modelDir() });
});

// Download CLIP model files
const clipDownloadJobs = new Map();
router.post('/clip/download', async (req, res) => {
  const jobId = 'clip_dl_' + Date.now();
  const job   = { id: jobId, status:'running', log:[], progress:0 };
  clipDownloadJobs.set(jobId, job);

  const cfg    = configMgr.load();
  const hfToken = cfg.settings?.huggingfaceToken || req.body?.token || '';

  clipSearch.ensureModel((msg, done, total) => {
    job.log.push({ ts: Date.now(), message: msg });
    if (total > 0) job.progress = Math.round((done/total)*100);
    job.lastMsg = msg;
  }, hfToken).then(r => {
    job.status = 'done';
    job.log.push({ ts: Date.now(), message: 'Model ready — ' + JSON.stringify(r) });
  }).catch(e => {
    job.status = 'error'; job.error = e.message;
    job.log.push({ ts: Date.now(), message: 'Error: ' + e.message });
  });

  res.json({ ok: true, jobId });
});

router.get('/clip/download/:jobId', (req, res) => {
  const job = clipDownloadJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Index a folder
const clipIndexJobs = new Map();
router.post('/clip/index', async (req, res) => {
  if (!clipSearch.isAvailable())
    return res.status(400).json({ error: 'CLIP model not downloaded. Use POST /clip/download first.' });
  const { folderPath, recursive } = req.body || {};
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });

  const jobId = 'clip_idx_' + Date.now();
  const job   = { id: jobId, status:'running', log:[], progress:0, total:0 };
  clipIndexJobs.set(jobId, job);

  clipSearch.indexFolder(folderPath, {
    recursive: recursive !== false,
    onProgress: (msg, done, total) => {
      job.log.push({ ts: Date.now(), message: msg });
      job.progress = total > 0 ? Math.round((done/total)*100) : 0;
      job.total = total;
    }
  }).then(r => {
    job.status = 'done'; job.result = r;
    job.log.push({ ts: Date.now(), message: `Indexed ${r.processed} files (${r.skipped} cached, ${r.errors} errors)` });
  }).catch(e => {
    job.status = 'error'; job.error = e.message;
  });

  res.json({ ok: true, jobId });
});

router.get('/clip/index/:jobId', (req, res) => {
  const job = clipIndexJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Text search
router.get('/clip/search', async (req, res) => {
  if (!clipSearch.isAvailable())
    return res.status(400).json({ error: 'CLIP not available' });
  try {
    const { q, limit, threshold } = req.query;
    if (!q) return res.status(400).json({ error: 'q (query) required' });
    const results = await clipSearch.searchByText(q, {
      limit:     parseInt(limit)     || 20,
      threshold: parseFloat(threshold) || 0.2
    });
    res.json({ query: q, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Similar image search
router.get('/clip/search-similar', async (req, res) => {
  if (!clipSearch.isAvailable())
    return res.status(400).json({ error: 'CLIP not available' });
  try {
    const { path: imgPath, limit, threshold } = req.query;
    if (!imgPath) return res.status(400).json({ error: 'path required' });
    const results = await clipSearch.searchSimilar(imgPath, {
      limit:     parseInt(limit)     || 20,
      threshold: parseFloat(threshold) || 0.8
    });
    res.json({ imagePath: imgPath, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
