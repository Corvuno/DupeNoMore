'use strict';
const crypto = require('crypto');
const fs = require('fs');

let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

// Compute MD5 of file bytes
async function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Resize image to NxN grayscale, return flat pixel array
async function getPixels(filePath, size) {
  if (!sharp) throw new Error('sharp not available');
  const { data } = await sharp(filePath)
    .resize(size, size, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Array.from(data);
}

// Get image dimensions and metadata
async function getImageInfo(filePath) {
  if (!sharp) throw new Error('sharp not available');
  try {
    const meta = await sharp(filePath).metadata();
    return {
      width: meta.width || 0,
      height: meta.height || 0,
      exif_date: extractExifDate(meta.exif)
    };
  } catch {
    return { width: 0, height: 0, exif_date: null };
  }
}

function extractExifDate(exifBuffer) {
  if (!exifBuffer) return null;
  try {
    const str = exifBuffer.toString('binary');
    const match = str.match(/(\d{4}):(\d{2}):(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  } catch {}
  return null;
}

// dHash: difference hash
function dhash(pixels, size) {
  const bits = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) {
      bits.push(pixels[y * size + x] > pixels[y * size + x + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

// aHash: average hash
function ahash(pixels) {
  const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  return bitsToHex(pixels.map(p => p >= avg ? 1 : 0));
}

// pHash: perceptual hash via DCT
function phash(pixels, size) {
  // Build 2D DCT
  const N = size;
  const dct = [];
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          sum += pixels[x * N + y] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct.push((2 / N) * cu * cv * sum);
    }
  }
  // Use top-left 8x8 (skip DC)
  const topLeft = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) continue;
      topLeft.push(dct[u * N + v]);
    }
  }
  const median = topLeft.slice().sort((a, b) => a - b)[Math.floor(topLeft.length / 2)];
  return bitsToHex(topLeft.map(v => v >= median ? 1 : 0));
}

// wHash: wavelet hash (simplified Haar)
function whash(pixels, size) {
  let data = [...pixels];
  const levels = Math.log2(size);
  for (let l = 0; l < levels; l++) {
    const half = size >> (l + 1);
    const newData = new Array(data.length).fill(0);
    for (let i = 0; i < half; i++) {
      for (let j = 0; j < half; j++) {
        const a = data[2 * i * (size >> l) + 2 * j] || 0;
        const b = data[2 * i * (size >> l) + 2 * j + 1] || 0;
        const c = data[(2 * i + 1) * (size >> l) + 2 * j] || 0;
        const d = data[(2 * i + 1) * (size >> l) + 2 * j + 1] || 0;
        newData[i * (size >> l) + j] = (a + b + c + d) / 4;
      }
    }
    data = newData;
  }
  const low = data.slice(0, 64);
  const avg = low.reduce((a, b) => a + b, 0) / low.length;
  return bitsToHex(low.map(v => v >= avg ? 1 : 0));
}

// mHash: pattern/marr hash
function mhash(pixels, size) {
  const kernel = [-1, -1, -1, -1, 8, -1, -1, -1, -1];
  const filtered = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += pixels[(y + ky) * size + (x + kx)] * kernel[(ky + 1) * 3 + (kx + 1)];
        }
      }
      filtered.push(sum);
    }
  }
  const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const bits = filtered.map(v => v >= avg ? 1 : 0).slice(0, 64);
  return bitsToHex(bits);
}

// bHash: block hash
function bhash(pixels, size, precise = false) {
  const blocks = precise ? 16 : 8;
  const blockSize = size / blocks;
  const avgs = [];
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      let sum = 0;
      let count = 0;
      for (let y = Math.floor(by * blockSize); y < Math.floor((by + 1) * blockSize); y++) {
        for (let x = Math.floor(bx * blockSize); x < Math.floor((bx + 1) * blockSize); x++) {
          if (y < size && x < size) { sum += pixels[y * size + x]; count++; }
        }
      }
      avgs.push(count > 0 ? sum / count : 0);
    }
  }
  const median = avgs.slice().sort((a, b) => a - b)[Math.floor(avgs.length / 2)];
  return bitsToHex(avgs.map(v => v >= median ? 1 : 0).slice(0, 64));
}

function bitsToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] || 0) * 8 + (bits[i + 1] || 0) * 4 +
                   (bits[i + 2] || 0) * 2 + (bits[i + 3] || 0);
    hex += nibble.toString(16);
  }
  return hex;
}

// Hamming distance between two hex hash strings
function hammingDistance(h1, h2) {
  if (!h1 || !h2) return Infinity;
  const len = Math.min(h1.length, h2.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    dist += xor.toString(2).split('1').length - 1;
  }
  return dist;
}

// Compute all requested hashes for a file
async function computeHashes(filePath, scanConfig) {
  const size = scanConfig.compareSize || 16;
  const algos = scanConfig.algorithms || {};

  const result = { md5: null };
  let pixels = null;
  let info = { width: 0, height: 0, exif_date: null };

  // Always get image info
  if (sharp) {
    try { info = await getImageInfo(filePath); } catch {}
  }

  // MD5
  try { result.md5 = await md5File(filePath); } catch {}

  // Perceptual hashes need pixels
  const needPixels = Object.entries(algos).some(([k, v]) => v && k !== 'md5');
  if (needPixels && sharp) {
    try { pixels = await getPixels(filePath, size); } catch (e) {
      // Not a valid image or unsupported format
      return { ...result, ...info, error: e.message };
    }
  }

  if (pixels) {
    if (algos.dhash) result.dhash = dhash(pixels, size);
    if (algos.ahash) result.ahash = ahash(pixels);
    if (algos.phash) result.phash = phash(pixels, size);
    if (algos.whash) result.whash = whash(pixels, size);
    if (algos.mhash) result.mhash = mhash(pixels, size);
    if (algos.bhash) result.bhash = bhash(pixels, size, scanConfig.bhashMode === 'precise');
  }

  return { ...result, ...info };
}

// Apply rotation/mirror variants and return min distance
function computeVariantDistance(h1, h2variants) {
  return Math.min(...h2variants.map(h => hammingDistance(h1, h)));
}

module.exports = { computeHashes, hammingDistance, computeVariantDistance, md5File, getImageInfo };
