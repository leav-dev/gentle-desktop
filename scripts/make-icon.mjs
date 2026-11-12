#!/usr/bin/env node
// Generates build/icon.ico — the Gentle Desktop petal mark (✿, five-petal
// florette, as in the prompt panel) in the app accent on the app background.
//
// No dependencies: the 256×256 PNG payload is encoded by hand (node:zlib for
// the IDAT stream, CRC32 implemented below) and wrapped in a hand-written ICO
// container that embeds the PNG (the Vista+ way to store a 256px icon).
//
// Re-runnable and deterministic: same input -> byte-identical output.

import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const SUB = 4; // 4x4 supersamples per pixel for antialiasing
const BG = [0x06, 0x04, 0x07]; // --bg
const PETAL = [0xf0, 0x95, 0xc8]; // --accent

// --- geometry: five ellipse petals around a core disc ----------------------
// Chosen so the shape still reads as a flower at 32px: broad petals, clear
// notches, no fine detail.
const PETAL_COUNT = 5;
const PETAL_DISTANCE = 56; // petal centre, px from flower centre
const PETAL_RADIUS_X = 60; // semi-axis along the petal direction
const PETAL_RADIUS_Y = 30; // semi-axis across it
const CORE_RADIUS = 20;

function insideFlower(x, y) {
  // x, y relative to the flower centre, y grows downward.
  if (x * x + y * y <= CORE_RADIUS * CORE_RADIUS) return true;
  for (let k = 0; k < PETAL_COUNT; k++) {
    const angle = -Math.PI / 2 + (k * 2 * Math.PI) / PETAL_COUNT; // one petal up
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Rotate into the petal frame: u along the petal axis, v across it.
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    const du = (u - PETAL_DISTANCE) / PETAL_RADIUS_X;
    const dv = v / PETAL_RADIUS_Y;
    if (du * du + dv * dv <= 1) return true;
  }
  return false;
}

// --- rasterize --------------------------------------------------------------
/**
 * Draws the mark at any square size. The geometry constants are expressed in 256px space,
 * so a larger canvas scales the sample point instead of the constants: one set of numbers,
 * and every size is the same drawing.
 */
function rasterize(size) {
  const scale = size / SIZE;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(size * 4);
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const x = (px + (sx + 0.5) / SUB - size / 2) / scale;
          const y = (py + (sy + 0.5) / SUB - size / 2) / scale;
          if (insideFlower(x, y)) hit++;
        }
      }
      const c = hit / (SUB * SUB);
      const o = px * 4;
      row[o] = Math.round(BG[0] + (PETAL[0] - BG[0]) * c);
      row[o + 1] = Math.round(BG[1] + (PETAL[1] - BG[1]) * c);
      row[o + 2] = Math.round(BG[2] + (PETAL[2] - BG[2]) * c);
      row[o + 3] = 0xff; // opaque square background
    }
    rows.push(row);
  }
  return rows;
}

// --- PNG --------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rows) {
  // The size comes from the pixel rows, not from the constant: the same encoder serves the
  // 256px icon inside the .ico and the 512px PNG Linux asks for.
  const size = rows.length;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression (0), filter (0), interlace (0) are already zero.

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 4);
    raw[o] = 0; // filter: none
    rows[y].copy(raw, o + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO container ----------------------------------------------------------
function encodeIco(png) {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = 6;
  header[entry] = 0; // width 256
  header[entry + 1] = 0; // height 256
  header[entry + 2] = 0; // palette colours
  header[entry + 3] = 0; // reserved
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(22, entry + 12); // PNG starts after directory + entry
  return Buffer.concat([header, png]);
}

// --- main -------------------------------------------------------------------
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build");
mkdirSync(outDir, { recursive: true });

// Windows takes an .ico; Linux takes a PNG and refuses anything else — app-builder fails with
// "unknown output format set" while converting an .ico for a Linux target, which is a confusing
// way to say "wrong file". macOS takes an .icns, which this script does not produce.
const icoPath = resolve(outDir, "icon.ico");
const pngPath = resolve(outDir, "icon.png");
const icoPng = encodePng(rasterize(SIZE));
const ico = encodeIco(icoPng);
writeFileSync(icoPath, ico);
const png512 = encodePng(rasterize(512));
writeFileSync(pngPath, png512);

console.log(`wrote ${icoPath}: ${ico.length} bytes, sha256 ${createHash("sha256").update(ico).digest("hex")}`);
console.log(`wrote ${pngPath}: ${png512.length} bytes, sha256 ${createHash("sha256").update(png512).digest("hex")}`);
