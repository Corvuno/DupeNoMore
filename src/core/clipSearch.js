/**
 * US-075/076: CLIP semantic image search
 * Uses ONNX Runtime to run CLIP locally — no Python, no cloud.
 *
 * Model: Xenova/clip-vit-base-patch32 (downloaded from HuggingFace ~350MB)
 * Stored in: data/clip_models/
 *
 * Provides:
 *   ensureModel()        — downloads model if needed
 *   embedImage(path)     — returns Float32Array embedding
 *   embedText(text)      — returns Float32Array embedding
 *   cosineSimilarity()   — compare two embeddings
 *   indexFolder()        — compute+cache embeddings for all images
 *   searchByText()       — find images matching text query
 *   searchSimilar()      — find images similar to a given image
 *   isAvailable()        — true if ONNX model is downloaded
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const configMgr = require('./config');

let ort;
try { ort = require('onnxruntime-node'); } catch {}

const MODEL_NAME  = 'Xenova/clip-vit-base-patch32';
const MODEL_FILES = {
  // Vision encoder
  'vision_model.onnx': 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx',
  // Text encoder
  'text_model.onnx':   'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx',
  // Tokenizer vocab
  'vocab.json':        'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/vocab.json',
  'merges.txt':        'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/merges.txt',
};

const IMAGE_SIZE   = 224; // CLIP input resolution
const EMBED_DIM    = 512; // CLIP ViT-B/32 embedding dimension
const SEQ_LEN      = 77;  // CLIP max token length
const BOS_TOKEN_ID = 49406;
const EOS_TOKEN_ID = 49407;
const PAD_TOKEN_ID = 0;

// ── Paths ─────────────────────────────────────────────────────────────────────
function modelDir() {
  return path.join(configMgr.getDataDir(), 'clip_models');
}
function modelPath(filename) { return path.join(modelDir(), filename); }
function indexPath()          { return path.join(configMgr.getDataDir(), 'clip_index.json'); }

// ── State ─────────────────────────────────────────────────────────────────────
let visionSession = null;
let textSession   = null;
let tokenizer     = null;

// ── Download helper ───────────────────────────────────────────────────────────
function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(dest + '.tmp');
    const client = url.startsWith('https') ? https : http;
    function request(url) {
      client.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return;
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let done = 0;
        res.on('data', chunk => { done += chunk.length; onProgress?.(done, total); });
        res.pipe(file);
        res.on('end', () => {
          file.close(() => { fs.renameSync(dest + '.tmp', dest); resolve(); });
        });
      }).on('error', reject);
    }
    request(url);
  });
}

// ── Model availability ────────────────────────────────────────────────────────
function isAvailable() {
  if (!ort) return false;
  return ['vision_model.onnx', 'text_model.onnx', 'vocab.json', 'merges.txt']
    .every(f => fs.existsSync(modelPath(f)));
}

async function ensureModel(onProgress, hfToken) {
  if (!ort) throw new Error('onnxruntime-node is not installed. Run: npm install onnxruntime-node');
  fs.mkdirSync(modelDir(), { recursive: true });

  const missing = Object.keys(MODEL_FILES).filter(f => !fs.existsSync(modelPath(f)));
  if (!missing.length) return { alreadyDownloaded: true };

  const headers = hfToken ? `?token=${hfToken}` : '';
  let totalBytes = 0;
  let doneBytes  = 0;

  for (const filename of missing) {
    const url  = MODEL_FILES[filename] + headers;
    const dest = modelPath(filename);
    onProgress?.(`Downloading ${filename}…`, doneBytes, totalBytes);
    await download(url, dest, (done, total) => {
      onProgress?.(`Downloading ${filename}: ${(done/1e6).toFixed(1)}MB${total?' / '+(total/1e6).toFixed(1)+'MB':''}`, done, total);
    });
    doneBytes += fs.statSync(dest).size;
    onProgress?.(`Downloaded ${filename}`, doneBytes, totalBytes);
  }
  return { downloaded: missing };
}

// ── Load ONNX sessions ────────────────────────────────────────────────────────
async function loadSessions() {
  if (visionSession && textSession) return;
  if (!isAvailable()) throw new Error('CLIP model not downloaded. Call ensureModel() first.');
  const opts = { executionProviders: ['cpu'] };
  visionSession = await ort.InferenceSession.create(modelPath('vision_model.onnx'), opts);
  textSession   = await ort.InferenceSession.create(modelPath('text_model.onnx'),   opts);
  tokenizer     = await loadTokenizer();
}

// ── Simple BPE tokenizer (CLIP uses OpenAI's BPE) ────────────────────────────
async function loadTokenizer() {
  const vocab  = JSON.parse(fs.readFileSync(modelPath('vocab.json'), 'utf8'));
  const merges = fs.readFileSync(modelPath('merges.txt'), 'utf8')
    .split('\n').slice(1).filter(l => l && !l.startsWith('#'))
    .map(l => l.split(' '));

  const mergeRanks = new Map(merges.map((pair, i) => [pair.join(' '), i]));

  function tokenize(text) {
    // Simple character-level BPE tokenizer for CLIP
    const lower = text.toLowerCase().trim();
    // Convert to byte-level tokens
    const encoded = new TextEncoder().encode(lower);
    let tokens = Array.from(encoded).map(b => String.fromCharCode(b + (b < 33 ? 9250 : b < 127 ? 0 : 9250)));

    // Apply BPE merges
    while (true) {
      let bestRank = Infinity, bestIdx = -1;
      for (let i = 0; i < tokens.length - 1; i++) {
        const pair = tokens[i] + ' ' + tokens[i+1];
        const rank = mergeRanks.get(pair) ?? Infinity;
        if (rank < bestRank) { bestRank = rank; bestIdx = i; }
      }
      if (bestIdx === -1) break;
      const newToken = tokens[bestIdx] + tokens[bestIdx+1];
      tokens = [...tokens.slice(0, bestIdx), newToken, ...tokens.slice(bestIdx+2)];
    }

    return tokens.map(t => vocab[t] ?? vocab['<|endoftext|>'] ?? EOS_TOKEN_ID);
  }

  return { tokenize };
}

// ── Preprocess image for CLIP ─────────────────────────────────────────────────
async function preprocessImage(imagePath) {
  const sharp = require('sharp');
  // Resize to 224×224, normalize to [-1, 1] with CLIP mean/std
  const { data } = await sharp(imagePath)
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'cover', position: 'centre' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // CLIP normalization: mean=[0.48145466,0.4578275,0.40821073], std=[0.26862954,0.26130258,0.27577711]
  const MEAN = [0.48145466, 0.4578275, 0.40821073];
  const STD  = [0.26862954, 0.26130258, 0.27577711];

  // Convert HWC uint8 to CHW float32 normalized
  const chw = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);
  for (let y = 0; y < IMAGE_SIZE; y++) {
    for (let x = 0; x < IMAGE_SIZE; x++) {
      for (let c = 0; c < 3; c++) {
        const srcIdx = (y * IMAGE_SIZE + x) * 3 + c; // assumes 3 channels (no alpha)
        const val    = data[srcIdx] / 255;
        chw[c * IMAGE_SIZE * IMAGE_SIZE + y * IMAGE_SIZE + x] = (val - MEAN[c]) / STD[c];
      }
    }
  }
  return chw;
}

// ── Embeddings ────────────────────────────────────────────────────────────────
async function embedImage(imagePath) {
  await loadSessions();
  const pixels = await preprocessImage(imagePath);
  const tensor = new ort.Tensor('float32', pixels, [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
  const result = await visionSession.run({ pixel_values: tensor });
  // Get the pooled/CLS embedding
  const embeds = result.image_embeds ?? result.last_hidden_state ?? Object.values(result)[0];
  const data   = embeds.data;
  // L2 normalize
  return normalize(data instanceof Float32Array ? data : new Float32Array(data));
}

async function embedText(text) {
  await loadSessions();
  const ids  = tokenizer.tokenize(text);
  const padded = new Array(SEQ_LEN).fill(PAD_TOKEN_ID);
  padded[0] = BOS_TOKEN_ID;
  const clipped = ids.slice(0, SEQ_LEN - 2);
  clipped.forEach((id, i) => { padded[i+1] = id; });
  padded[clipped.length + 1] = EOS_TOKEN_ID;

  const inputIds      = new ort.Tensor('int64', BigInt64Array.from(padded.map(BigInt)), [1, SEQ_LEN]);
  const attentionMask = new ort.Tensor('int64', BigInt64Array.from(
    padded.map((id, i) => BigInt(i <= clipped.length + 1 ? 1 : 0))
  ), [1, SEQ_LEN]);

  const result = await textSession.run({ input_ids: inputIds, attention_mask: attentionMask });
  const embeds = result.text_embeds ?? result.last_hidden_state ?? Object.values(result)[0];
  const data   = embeds.data;
  return normalize(data instanceof Float32Array ? data : new Float32Array(data));
}

function normalize(vec) {
  // Only use first EMBED_DIM values (in case model outputs pooled + sequence)
  const v   = Array.from(vec).slice(0, EMBED_DIM);
  const mag = Math.sqrt(v.reduce((s, x) => s + x*x, 0));
  return new Float32Array(v.map(x => x / (mag || 1)));
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
  return dot; // already normalized so dot = cosine similarity
}

// ── Index management ──────────────────────────────────────────────────────────
function loadIndex() {
  try {
    if (fs.existsSync(indexPath())) {
      const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
      return raw;
    }
  } catch {}
  return { version: 1, entries: {} };
}

function saveIndex(index) {
  fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2));
}

async function indexFolder(folderPath, { onProgress, recursive = true } = {}) {
  if (!isAvailable()) throw new Error('CLIP model not downloaded');
  await loadSessions();

  // Collect image files
  const { IMAGE_EXTENSIONS } = require('./fileTypes');
  const files = [];
  function walk(dir) {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && recursive) { walk(full); }
        else if (e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).slice(1).toLowerCase())) {
          files.push(full);
        }
      }
    } catch {}
  }
  walk(folderPath);

  const index = loadIndex();
  let processed = 0, skipped = 0, errors = 0;

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      const key  = filePath;
      // Skip if already indexed and mtime matches
      if (index.entries[key] && index.entries[key].mtime === stat.mtimeMs) {
        skipped++; processed++; continue;
      }
      onProgress?.(`Indexing: ${processed+1}/${files.length} — ${path.basename(filePath)}`, processed, files.length);
      const embedding = await embedImage(filePath);
      index.entries[key] = { path: filePath, mtime: stat.mtimeMs, embedding: Array.from(embedding) };
      processed++;
      // Save every 50 files
      if (processed % 50 === 0) saveIndex(index);
    } catch(e) {
      errors++;
      onProgress?.(`Error indexing ${path.basename(filePath)}: ${e.message}`, processed, files.length);
    }
  }
  saveIndex(index);
  return { total: files.length, processed, skipped, errors };
}

async function searchByText(query, { limit = 20, threshold = 0.2 } = {}) {
  if (!isAvailable()) throw new Error('CLIP model not downloaded');
  await loadSessions();
  const queryEmbed = await embedText(query);
  const index = loadIndex();

  const results = [];
  for (const [, entry] of Object.entries(index.entries)) {
    if (!entry.embedding || !fs.existsSync(entry.path)) continue;
    const sim = cosineSimilarity(queryEmbed, new Float32Array(entry.embedding));
    if (sim >= threshold) results.push({ path: entry.path, similarity: Math.round(sim * 100) / 100 });
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

async function searchSimilar(imagePath, { limit = 20, threshold = 0.8 } = {}) {
  if (!isAvailable()) throw new Error('CLIP model not downloaded');
  await loadSessions();
  const imgEmbed = await embedImage(imagePath);
  const index    = loadIndex();

  const results = [];
  for (const [, entry] of Object.entries(index.entries)) {
    if (entry.path === imagePath) continue;
    if (!entry.embedding || !fs.existsSync(entry.path)) continue;
    const sim = cosineSimilarity(imgEmbed, new Float32Array(entry.embedding));
    if (sim >= threshold) results.push({ path: entry.path, similarity: Math.round(sim * 100) / 100 });
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

function getIndexStats() {
  const index = loadIndex();
  const entries = Object.values(index.entries);
  const existing = entries.filter(e => fs.existsSync(e.path));
  return { total: entries.length, existing: existing.length, stale: entries.length - existing.length };
}

module.exports = {
  isAvailable, ensureModel, embedImage, embedText,
  cosineSimilarity, indexFolder, searchByText, searchSimilar,
  getIndexStats, modelDir
};
