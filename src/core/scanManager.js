'use strict';
const { EventEmitter } = require('events');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { collectFiles }   = require('./collector');
const { computeHashes, expectedHashLength } = require('./hasher');
const os                 = require('os');
const { buildGroups }    = require('./comparator');
const hashCache          = require('./hashCache');
const configMgr          = require('./config');
const { saveCheckpoint, loadCheckpoint, deleteCheckpoint } = require('./checkpoint');

const MAX_CONCURRENT_SCANS = 3;
const CHECKPOINT_EVERY = 1000; // save checkpoint every N files hashed

class ScanManager extends EventEmitter {
  constructor() {
    super();
    this.scans = new Map();
  }

  getAll() { return Array.from(this.scans.values()).map(s => this.publicState(s)); }
  get(id)  { const s = this.scans.get(id); return s ? this.publicState(s) : null; }

  publicState(s) {
    return {
      id:           s.id,
      status:       s.status,
      phase:        s.phase,
      progress:     s.progress,
      log:          s.log,
      resultFile:   s.resultFile,
      interimFile:  s.interimFile,
      startedAt:    s.startedAt,
      finishedAt:   s.finishedAt,
      groupCount:   s.groupCount,
      error:        s.error,
      checkpointId: s.checkpointId || null
    };
  }

  async start(config, resumeCheckpointId = null) {
    const running = Array.from(this.scans.values()).filter(s => s.status === 'running').length;
    if (running >= MAX_CONCURRENT_SCANS)
      throw new Error(`Maximum ${MAX_CONCURRENT_SCANS} concurrent scans reached`);

    // Resuming a checkpoint reuses the scan's id. If that scan is still live in this
    // session (running or paused), starting it again would replace its state and leave
    // the first run orphaned, so refuse; a paused scan is continued with resume(id).
    const existing = resumeCheckpointId && this.scans.get(resumeCheckpointId);
    if (existing && (existing.status === 'running' || existing.status === 'paused'))
      throw new Error('This scan is already running or paused; resume it instead of restarting it');

    const id = resumeCheckpointId || uuidv4();
    const state = {
      id,
      status:      'running',
      phase:       'collect',
      progress:    { phase: 'collect', percent: 0, current: 0, total: 0 },
      log:         [],
      resultFile:  null,
      interimFile: null,
      startedAt:   Date.now(),
      finishedAt:  null,
      groupCount:  0,
      error:       null,
      config,
      paused:      false,
      aborted:     false,
      pauseResolve: null,
      checkpointId: id
    };

    this.scans.set(id, state);
    const startTs = new Date().toISOString().slice(11, 23);
    process.stdout.write(`\n[${startTs}] ━━ Scan started: ${id.slice(0,8)} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    this._emit(state, 'started');

    this._runScan(state, resumeCheckpointId).catch(err => {
      state.status    = 'error';
      state.error     = err.message;
      state.finishedAt = Date.now();
      this._log(state, `ERROR: ${err.message}`);
      this._emit(state, 'error');
    });

    return id;
  }

  pause(id)   {
    const s = this.scans.get(id);
    if (s && s.status === 'running') {
      s.paused = true; s.status = 'paused';
      this._emit(s, 'paused');
    }
  }
  resume(id)  {
    const s = this.scans.get(id);
    if (s && s.status === 'paused') {
      s.paused = false; s.status = 'running';
      if (s.pauseResolve) { s.pauseResolve(); s.pauseResolve = null; }
      this._emit(s, 'resumed');
    }
  }
  abort(id)   {
    const s = this.scans.get(id);
    if (s) {
      s.aborted = true; s.status = 'aborted'; s.finishedAt = Date.now();
      if (s.pauseResolve) { s.pauseResolve(); s.pauseResolve = null; }
      this._emit(s, 'aborted');
    }
  }
  dismiss(id) { this.scans.delete(id); }

  // ── Core scan logic ──────────────────────────────────────────────────────────
  async _runScan(state, resumeCheckpointId) {
    const { config } = state;
    const dataDir  = configMgr.getDataDir();
    const scansDir = configMgr.getScansDir(config);

    // ── Route to file scanner if scanType = 'files' ───────────────────────────
    const scanType = (config.scan || {}).scanType || 'images';
    if (scanType === 'files') {
      return this._runFileScan(state);
    }
    if (scanType === 'both') {
      // Run image scan first, then file scan, merge results
      await this._runImageScan(state, resumeCheckpointId);
      if (!state.aborted && state.status !== 'error') {
        const imageScanFile = state.resultFile;
        await this._runFileScan(state, imageScanFile);
      }
      return;
    }
    return this._runImageScan(state, resumeCheckpointId);
  }

  async _runImageScan(state, resumeCheckpointId) {
    const { config } = state;
    const dataDir  = configMgr.getDataDir();
    const scansDir = configMgr.getScansDir(config);
    if (!fs.existsSync(scansDir)) fs.mkdirSync(scansDir, { recursive: true });

    await hashCache.ensureInit();

    // Log settings for easy debugging
    const sc = config.scan || {};
    const fi = config.filters || {};
    const activeAlgos = Object.entries(sc.algorithms || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none';
    const folders = (config.folders || []).filter(f => f.active !== false);
    this._log(state, `Settings: algorithms=[${activeAlgos}] ensureMin=${sc.ensureMin ?? 2} matchLogic=${sc.matchLogic || 'threshold'}`);
    this._log(state, `Thresholds: ${Object.entries(sc.thresholds || {}).filter(([k]) => (sc.algorithms||{})[k]).map(([k,v]) => `${k}:${v}`).join(' ')}`);
    this._log(state, `Filters: minSize=${fi.minSizeKB || 10}KB maxSize=${fi.maxSizeMB || 0}MB extensions=${(fi.extensions||[]).join(',') || 'all images'}`);
    this._log(state, `Folders: ${folders.map(f => f.path).join(' | ')}`);

    // ── Check for resumable checkpoint ────────────────────────────────────────
    let checkpoint = null;
    if (resumeCheckpointId) {
      checkpoint = loadCheckpoint(dataDir, resumeCheckpointId);
      if (checkpoint) {
        this._log(state, `Resuming from checkpoint: phase=${checkpoint.phase} files=${checkpoint.files?.length || 0} hashed=${checkpoint.hashedFiles?.length || 0}`);
      }
    }

    // ── Phase 1: Collect ──────────────────────────────────────────────────────
    let files;
    if (checkpoint?.phase !== 'collect' && checkpoint?.files?.length > 0) {
      // Resume: skip collect, use saved file list
      files = checkpoint.files;
      this._log(state, `Resumed collect: ${files.length} files from checkpoint`);
    } else {
      this._setPhase(state, 'collect', 'Collecting files...');
      if (folders.length === 0) throw new Error('No active folders configured');

      files = await collectFiles(folders.map((f,i) => ({ ...f, index: i })), fi, msg => {
        this._log(state, `[collect] ${msg.message}`);
      });
      this._log(state, `Collected ${files.length} files`);
      if (state.aborted) return;

      if (files.length === 0) {
        state.status = 'done'; state.finishedAt = Date.now(); state.groupCount = 0;
        this._log(state, 'No files found matching filters');
        this._emit(state, 'done');
        return;
      }

      // Save checkpoint after collect
      saveCheckpoint(dataDir, state.id, { phase: 'hash', files, hashedFiles: [], groups: [], config, savedAt: new Date().toISOString() });
    }

    // ── Phase 2: Hash ─────────────────────────────────────────────────────────
    // Build list of what we're computing
    const activeAlgoList = Object.entries(sc.algorithms||{}).filter(([,v])=>v).map(([k])=>k);
    const algoLabel = activeAlgoList.length ? activeAlgoList.join(' + ') : 'MD5 only';
    this._setPhase(state, 'hash', `Hashing ${files.length} files — computing: ${algoLabel}`);
    let hashedFiles = checkpoint?.hashedFiles || [];
    const alreadyHashed = new Set(hashedFiles.map(f => f.path));
    const toHash = files.filter(f => !alreadyHashed.has(f.path));
    const cacheHits = { count: 0 };
    const skipped = { count: 0, reasons: {} };
    const hashStart = Date.now();

    if (hashedFiles.length > 0) {
      this._log(state, `Resuming: ${hashedFiles.length}/${files.length} already hashed, ${toHash.length} remaining`);
    } else {
      this._log(state, `Step 1/2: Computing ${algoLabel} for ${files.length} files...`);
    }

    // Read several photos at once so every CPU core is busy (decoding is done
    // by sharp/libvips on the libuv thread pool, sized in server.js).
    const CONCURRENCY = Math.max(2, Math.min(32, os.cpus().length));
    const neededAlgos = activeAlgoList.filter(a => a !== 'md5');
    const compareSize = sc.compareSize || 16;
    // A cache entry is only usable when it has every hash this scan needs,
    // computed at the same compareSize. Otherwise those files could never match.
    const cacheUsable = c => neededAlgos.every(a => c[a] && c[a].length === expectedHashLength(a, compareSize));
    let processed = 0;
    let nextIdx = 0;

    const hashOne = async (file) => {
      const cached = await hashCache.getAsync(file.path, file.mtime, file.size);
      if (cached && cacheUsable(cached)) {
        cacheHits.count++;
        hashedFiles.push({ ...file, ...cached });
        return;
      }
      try {
        const hashes = await computeHashes(file.path, sc);
        hashedFiles.push({ ...file, ...hashes });
        if (hashes.error) {
          // Pixels could not be decoded: keep the file for MD5 matching, but
          // don't cache the incomplete result so it is retried next scan.
          skipped.perceptual = (skipped.perceptual || 0) + 1;
          this._log(state, `[warn] No image fingerprint for ${path.basename(file.path)} (MD5 only): ${hashes.error}`);
        } else {
          await hashCache.setAsync(file.path, file.mtime, file.size, hashes);
        }
      } catch (e) {
        skipped.count++;
        const reason = /permission|EACCES|EPERM/i.test(e.message) ? 'permission'
                     : /ENOENT|no such/i.test(e.message) ? 'missing'
                     : 'unreadable';
        skipped.reasons[reason] = (skipped.reasons[reason] || 0) + 1;
        this._log(state, `[warn] Cannot hash ${path.basename(file.path)}: ${e.message}`);
      }
    };

    const worker = async () => {
      while (true) {
        await this._checkPause(state);
        if (state.aborted) return;
        // Claim the next file only after the await above: other workers may
        // have taken the last files while this one was suspended.
        if (nextIdx >= toHash.length) return;
        const file = toHash[nextIdx++];
        await hashOne(file);
        processed++;

        const total = files.length;
        const pct   = Math.round((hashedFiles.length / total) * 100);
        this._setProgress(state, 'hash', pct, hashedFiles.length, total);

        if (processed % 100 === 0) {
          const elapsedMs = Date.now() - hashStart;
          const rate      = processed / (elapsedMs / 1000);
          const remaining = toHash.length - processed;
          const etaSec    = rate > 0 ? Math.round(remaining / rate) : 0;
          this._log(state, `Hashing: ${hashedFiles.length}/${total} (${pct}%) — ${Math.round(rate)} files/s — ETA ${fmtDur(etaSec * 1000)} — cache: ${cacheHits.count}`);
          this._emit(state, 'progress');
        } else if (processed % 50 === 0) {
          this._emit(state, 'progress');
        }

        if (processed % CHECKPOINT_EVERY === 0) {
          saveCheckpoint(dataDir, state.id, { phase: 'hash', files, hashedFiles, groups: [], config, savedAt: new Date().toISOString() });
        }
      }
    };

    this._log(state, `Reading ${CONCURRENCY} files in parallel`);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toHash.length) }, worker));
    if (state.aborted) return;
    // Parallel workers finish in random order; restore the collect order so
    // results (e.g. which file becomes a group's source) are deterministic.
    const order = new Map(files.map((f, i) => [f.path, i]));
    hashedFiles.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));

    const totalMs   = Date.now() - hashStart;
    const totalRate = toHash.length / Math.max(totalMs / 1000, 0.001);
    this._log(state, `Hashed ${hashedFiles.length} files in ${fmtDur(totalMs)} (${Math.round(totalRate)} files/s, ${cacheHits.count} from cache)`);
    if (skipped.count > 0) {
      const detail = Object.entries(skipped.reasons).map(([r, n]) => `${n} ${r}`).join(', ');
      this._log(state, `⚠ Skipped ${skipped.count} file${skipped.count > 1 ? 's' : ''} (${detail}) — these could not be read and were left untouched`);
      state.skippedCount = skipped.count;
      state.skippedReasons = skipped.reasons;
    }
    if (skipped.perceptual) {
      this._log(state, `⚠ ${skipped.perceptual} file${skipped.perceptual > 1 ? 's' : ''} could not be decoded as images — they are only matched as exact (byte-identical) copies`);
    }
    if (state.aborted) return;

    // Final checkpoint after hashing complete
    saveCheckpoint(dataDir, state.id, { phase: 'compare', files, hashedFiles, groups: [], config, savedAt: new Date().toISOString() });

    // ── Phase 3: Compare ──────────────────────────────────────────────────────
    this._setPhase(state, 'compare', `Comparing ${hashedFiles.length} files...`);
    this._log(state, `Step 2/2: Comparing ${hashedFiles.length} files using ${algoLabel} — ensureMin=${sc.ensureMin??2}, thresholds: ${activeAlgoList.map(a=>`${a}:${(sc.thresholds||{})[a]??10}`).join(' ')}`);

    // Check for existing checkpoint to resume from
    let compareCP = null;
    const compareCPFile = path.join(scansDir, `checkpoint_compare.json`);
    if (fs.existsSync(compareCPFile)) {
      try {
        const cp = JSON.parse(fs.readFileSync(compareCPFile, 'utf8'));
        // Only resume if same file count and same config (otherwise stale checkpoint)
        if (cp.totalFiles === hashedFiles.length && JSON.stringify(cp.scanConfigHash) === JSON.stringify({
          algos: sc.algorithms, thresholds: sc.thresholds, ensureMin: sc.ensureMin,
          matchLogic: sc.matchLogic, searchDepth: sc.searchDepth
        })) {
          compareCP = cp;
          this._log(state, `[resume] Found checkpoint at ${cp.startIndex}/${cp.totalFiles} with ${cp.groups.length} groups — resuming...`);
        } else {
          this._log(state, `[resume] Checkpoint found but settings changed — starting fresh`);
          fs.unlinkSync(compareCPFile);
        }
      } catch (e) {
        this._log(state, `[resume] Could not load checkpoint: ${e.message}`);
      }
    }

    const groups = await buildGroups(hashedFiles, sc, (current, total, groupCount, groupsSoFar, resumeState) => {
      // Update progress
      state.progress = { phase: 'compare', current, total, groups: groupCount };
      this._setPhase(state, 'compare', `Comparing ${current}/${total} files…`);
      this._emit(state, 'progress');

      // Save checkpoint every 500 groups or every 2000 files compared
      if (resumeState && (groupCount % 500 === 0 || current % 2000 === 0)) {
        try {
          fs.writeFileSync(compareCPFile, JSON.stringify({
            totalFiles: hashedFiles.length,
            scanConfigHash: {
              algos: sc.algorithms, thresholds: sc.thresholds, ensureMin: sc.ensureMin,
              matchLogic: sc.matchLogic, searchDepth: sc.searchDepth
            },
            groups: groupsSoFar,
            assignedPaths: resumeState.assignedPaths,
            startIndex: resumeState.startIndex
          }));
          this._log(state, `[checkpoint] ${groupCount} groups, ${current}/${total} files`);
        } catch (e) { this._log(state, `[checkpoint] Save failed: ${e.message}`); }
      }
    }, compareCP);
    this._log(state, `Found ${groups.length} duplicate groups`);

    // Warn about threshold looseness
    const algEntries = Object.entries(sc.algorithms || {}).filter(([,v]) => v && arguments[0] !== 'md5');
    const maxThresh  = Math.max(...Object.entries(sc.thresholds || {}).filter(([k]) => (sc.algorithms||{})[k]).map(([,v]) => v), 0);
    if (maxThresh > 15)
      this._log(state, `[warn] Thresholds are very loose (max ${maxThresh} bits). Consider lowering if you see too many false positives.`);

    if (state.aborted) return;

    // ── Phase 4: Save ─────────────────────────────────────────────────────────
    this._setPhase(state, 'save', 'Saving results...');
    const ts         = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const resultFile = path.join(scansDir, `duplicates_${ts}.json`);

    // Clean up checkpoint file on successful completion
    try {
      if (fs.existsSync(compareCPFile)) fs.unlinkSync(compareCPFile);
      const interimFile = path.join(scansDir, `interim_${state.scanId}.json`);
      if (fs.existsSync(interimFile)) fs.unlinkSync(interimFile);
    } catch {}

    fs.writeFileSync(resultFile, JSON.stringify({
      version:    '1.0.0',
      scannedAt:  new Date().toISOString(),
      scanConfig: config,
      totalFiles: files.length,
      groupCount: groups.length,
      groups
    }, null, 2));
    this._log(state, `Results saved to ${path.basename(resultFile)}`);

    // Clean up checkpoint — scan complete
    deleteCheckpoint(dataDir, state.id);

    // Clean up interim files for this scan
    try {
      fs.readdirSync(scansDir)
        .filter(f => f.startsWith(`interim_${state.id.slice(0,8)}_`))
        .forEach(f => { try { fs.unlinkSync(path.join(scansDir, f)); } catch {} });
    } catch {}

    state.status     = 'done';
    state.finishedAt = Date.now();
    state.resultFile  = resultFile;
    state.groupCount  = groups.length;
    this._setProgress(state, 'done', 100, files.length, files.length);
    this._emit(state, 'done');
  }

  async _runFileScan(state, existingResultFile = null) {
    const { config } = state;
    const scansDir = configMgr.getScansDir(config);
    if (!fs.existsSync(scansDir)) fs.mkdirSync(scansDir, { recursive: true });

    const sc  = config.scan || {};
    const fso = sc.fileScanOptions || {};
    const folders = (config.folders || []).filter(f => f.active !== false);

    if (!folders.length) {
      state.status = 'error';
      state.error  = 'No active folders configured';
      this._log(state, 'ERROR: No active folders configured');
      this._emit(state, 'error');
      return;
    }

    this._log(state, '── File scan ──');
    this._log(state, `Folders: ${folders.map(f => f.path).join(' | ')}`);
    const methods = [
      fso.useMd5 !== false && 'MD5',
      fso.useCopyPatterns && 'copy patterns',
      fso.useNameSimilarity && `name similarity (${fso.nameSimilarityThreshold || 80}%)`,
      fso.useWildcards && fso.wildcardPatterns?.length && `wildcards [${(fso.wildcardPatterns||[]).join(', ')}] (${fso.wildcardLogic || 'or'})`,
      fso.useVersionGroups && 'version groups'
    ].filter(Boolean);
    this._log(state, `Methods: ${methods.join(', ')}`);

    const { scanFiles } = require('./fileScan');
    this._setPhase(state, 'collect', 'Collecting files…');

    try {
      const result = await scanFiles({
        folders,
        extensions:              fso.extensions || [],
        minSizeKB:               fso.minSizeKB || 0,
        maxSizeMB:               fso.maxSizeMB || 0,
        useMd5:                  fso.useMd5 !== false,
        useCopyPatterns:         fso.useCopyPatterns || false,
        useNameSimilarity:       fso.useNameSimilarity || false,
        nameSimilarityThreshold: fso.nameSimilarityThreshold || 80,
        useWildcards:            fso.useWildcards || false,
        wildcardPatterns:        fso.wildcardPatterns || [],
        wildcardLogic:           fso.wildcardLogic || 'or',
        useVersionGroups:        fso.useVersionGroups || false,
        excludePatterns:         config.filters?.excludePatterns || [],
        onProgress: (phase, done, total, msg) => {
          if (state.aborted) return;
          if (phase === 'collect') this._setPhase(state, 'collect', msg);
          if (phase === 'hash')    this._setProgress(state, 'hash', total ? Math.round(done/total*100) : 0, done, total);
          if (phase === 'compare') this._setProgress(state, 'compare', 0, done, total);
          // Skip duplicate consecutive identical messages
          const lastLog = state.log[state.log.length - 1];
          if (!lastLog || lastLog.message !== msg) this._log(state, msg);
          this._emit(state, 'progress');
        }
      });

      if (state.aborted) { state.status = 'aborted'; this._emit(state, 'aborted'); return; }

      // Merge with existing image scan result if 'both' mode
      let groups = result.groups;
      if (existingResultFile && fs.existsSync(existingResultFile)) {
        const existing = JSON.parse(fs.readFileSync(existingResultFile, 'utf8'));
        groups = [...(existing.groups || []), ...groups];
      }

      // Save result in same format as image scan
      const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fn  = `duplicates_${ts}.json`;
      const out = path.join(scansDir, fn);
      fs.writeFileSync(out, JSON.stringify({
        version:    '1.0.0',
        scannedAt:  new Date().toISOString(),
        scanType:   'files',
        scanConfig: config,
        totalFiles: result.totalFiles,
        groupCount: groups.length,
        groups
      }, null, 2));

      state.resultFile  = fn;
      state.groupCount  = groups.length;
      state.status      = 'done';
      state.finishedAt  = Date.now();
      const elapsed = fmtDur(Date.now() - state.startedAt);
      this._setPhase(state, 'save', `File scan complete: ${groups.length} groups in ${result.totalFiles} files — ${elapsed}`);
      this._log(state, `Found ${groups.length} groups. Results saved to ${fn}`);

      this._emit(state, 'done');
    } catch(e) {
      state.status  = 'error';
      state.error   = e.message;
      state.finishedAt = Date.now();
      this._log(state, `ERROR: ${e.message}`);
      this._emit(state, 'error');
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  // Several hashing workers can wait here at once, so they share one promise;
  // resume()/abort() call pauseResolve() which releases all of them.
  async _checkPause(state) {
    if (!state.paused) return;
    if (!state.pausePromise) {
      state.pausePromise = new Promise(resolve => {
        state.pauseResolve = () => { state.pausePromise = null; resolve(); };
      });
    }
    await state.pausePromise;
  }

  _setPhase(state, phase, message) {
    state.phase = phase;
    state.progress.phase = phase;
    this._log(state, message);
    this._emit(state, 'progress');
  }

  _setProgress(state, phase, percent, current, total) {
    state.progress = { phase, percent, current, total };
  }

  _log(state, message) {
    const entry = { ts: Date.now(), message };
    state.log.push(entry);
    if (state.log.length > 2000) state.log.shift();
    // Mirror to server console — always visible in the cmd window
    const ts = new Date().toISOString().slice(11, 23);
    process.stdout.write(`[${ts}] [${state.id.slice(0,8)}] ${message}\n`);
    this._emit(state, 'log');
  }

  _emit(state, event) {
    this.emit('scan:' + event, { id: state.id, state: this.publicState(state) });
    this.emit('scan:any',      { id: state.id, event, state: this.publicState(state) });
  }
}

function fmtDur(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const manager = new ScanManager();
module.exports = manager;
