/**
 * generateTestImages.js
 * Creates synthetic test images with known duplicate relationships.
 * Call once before running tests: node tests/fixtures/generateTestImages.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const FIXTURES_DIR = path.join(__dirname);
const IMAGES_DIR = path.join(FIXTURES_DIR, 'images');

// Try to use sharp to generate real PNG files
let sharp;
try { sharp = require('sharp'); } catch {}

async function generateImages() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const groups = [];

  if (sharp) {
    // Group 1: Exact duplicates (same bytes)
    const img1 = await createSolidImage(100, 100, { r: 255, g: 0, b: 0 });
    await sharp(img1).toFile(path.join(IMAGES_DIR, 'g1_original.png'));
    await sharp(img1).toFile(path.join(IMAGES_DIR, 'g1_exact_copy.png'));
    groups.push({ name: 'exact-md5', files: ['g1_original.png', 'g1_exact_copy.png'], type: 'md5' });

    // Group 2: Perceptual duplicates (slightly different size)
    const img2 = await createSolidImage(200, 200, { r: 0, g: 128, b: 255 });
    await sharp(img2).toFile(path.join(IMAGES_DIR, 'g2_large.png'));
    await sharp(img2).resize(180, 180).toFile(path.join(IMAGES_DIR, 'g2_resized.png'));
    groups.push({ name: 'perceptual-resize', files: ['g2_large.png', 'g2_resized.png'], type: 'perceptual' });

    // Group 3: Unique images (should NOT match)
    const img3a = await createGradientImage(100, 100, { r: 255, g: 200, b: 0 });
    const img3b = await createGradientImage(100, 100, { r: 0, g: 200, b: 100 });
    await sharp(img3a).toFile(path.join(IMAGES_DIR, 'unique_a.png'));
    await sharp(img3b).toFile(path.join(IMAGES_DIR, 'unique_b.png'));

    // Group 4: Three-way duplicate set
    const img4 = await createSolidImage(150, 150, { r: 100, g: 100, b: 100 });
    await sharp(img4).toFile(path.join(IMAGES_DIR, 'g4_v1.png'));
    await sharp(img4).resize(148, 148).toFile(path.join(IMAGES_DIR, 'g4_v2.png'));
    await sharp(img4).resize(152, 152).toFile(path.join(IMAGES_DIR, 'g4_v3.png'));
    groups.push({ name: 'three-way', files: ['g4_v1.png', 'g4_v2.png', 'g4_v3.png'], type: 'perceptual' });

    // Small file (should be filtered by min size)
    const small = await createSolidImage(10, 10, { r: 50, g: 50, b: 50 });
    await sharp(small).toFile(path.join(IMAGES_DIR, 'small_filtered.png'));

    console.log('[fixtures] Generated PNG test images using sharp');
  } else {
    // Fallback: generate minimal valid PNG files using raw bytes
    generateMinimalPNG(path.join(IMAGES_DIR, 'g1_original.png'), 100, 100, [255, 0, 0]);
    // Exact copy — same bytes
    fs.copyFileSync(
      path.join(IMAGES_DIR, 'g1_original.png'),
      path.join(IMAGES_DIR, 'g1_exact_copy.png')
    );
    generateMinimalPNG(path.join(IMAGES_DIR, 'unique_a.png'), 100, 100, [0, 128, 255]);
    generateMinimalPNG(path.join(IMAGES_DIR, 'unique_b.png'), 100, 100, [0, 255, 128]);
    groups.push({ name: 'exact-md5', files: ['g1_original.png', 'g1_exact_copy.png'], type: 'md5' });
    console.log('[fixtures] Generated minimal PNG test images (no sharp)');
  }

  // Write manifest
  fs.writeFileSync(
    path.join(FIXTURES_DIR, 'image_manifest.json'),
    JSON.stringify({ dir: IMAGES_DIR, groups, generated: new Date().toISOString() }, null, 2)
  );

  console.log('[fixtures] Manifest written.');
  return { dir: IMAGES_DIR, groups };
}

async function createSolidImage(w, h, color) {
  const { data } = await sharp({
    create: { width: w, height: h, channels: 3, background: color }
  }).png().toBuffer({ resolveWithObject: true });
  return data;
}

async function createGradientImage(w, h, color) {
  const pixels = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const t = i / (w * h);
    pixels[i * 3] = Math.floor(color.r * t);
    pixels[i * 3 + 1] = Math.floor(color.g * (1 - t));
    pixels[i * 3 + 2] = color.b;
  }
  const { data } = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .png().toBuffer({ resolveWithObject: true });
  return data;
}

// Minimal valid 1×1 PNG (for fallback without sharp)
function generateMinimalPNG(filePath, width, height, rgb) {
  // Write a proper minimal PNG
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcData);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeBuffer, data, crcBuffer]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width=1
  ihdr.writeUInt32BE(1, 4); // height=1
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type = RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: single pixel
  const scanline = Buffer.from([0, rgb[0], rgb[1], rgb[2]]); // filter byte + RGB
  const { deflateSync } = require('zlib');
  const compressed = deflateSync(scanline);
  const idat = compressed;

  const result = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(filePath, result);
}

// CRC32 for PNG
function crc32(buf) {
  const table = makeCrcTable();
  let c = 0xFFFFFFFF;
  for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

let _crcTable;
function makeCrcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    _crcTable[n] = c;
  }
  return _crcTable;
}

// Run if called directly
if (require.main === module) {
  generateImages().then(() => console.log('Done.')).catch(console.error);
}

module.exports = { generateImages, IMAGES_DIR, FIXTURES_DIR };
