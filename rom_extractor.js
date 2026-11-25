/**
 * Extractor en vivo y de SOLO LECTURA de la ROM Mario Party (USA).z64.
 * Descomprime los archivos LZSS (tipo 1) y raw (tipo 0) del contenedor Hudson,
 * decodifica la geometría 3D low-poly (VTX1, FAC1, OBJ1, COL1, MAT1, ATR1) y las
 * texturas paletizadas N64 (BMP1 + PAL1 -> PNG base64) para:
 *  - Escenario #32 IROIRO KINOKO (Mushroom Mix-Up, Directorio 44)
 *  - Los 6 personajes jugables de Mario Party N64 (Directorios 1..6, archivo 159)
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROM_PATH = path.join(__dirname, "Mario Party (USA)", "Mario Party (USA).z64");
const MAIN_DIR_OFFSET = 0x31c7e0;

let cachedAssets = null;

function decompressLzss(src, decompSize) {
  const out = Buffer.alloc(decompSize);
  const ring = new Uint8Array(1024);
  let rPos = 0x3be;
  let idx = 0;
  let outPos = 0;
  let flags = 0;
  const srcLen = src.length;

  while (outPos < decompSize && idx < srcLen) {
    flags >>= 1;
    if ((flags & 0x100) === 0) {
      flags = src[idx++] | 0xff00;
    }
    if (flags & 1) {
      if (idx >= srcLen) break;
      const b = src[idx++];
      out[outPos++] = b;
      ring[rPos] = b;
      rPos = (rPos + 1) & 0x3ff;
    } else {
      if (idx + 1 >= srcLen) break;
      const b1 = src[idx++];
      const b2 = src[idx++];
      const offset = b1 | ((b2 & 0xc0) << 2);
      const length = (b2 & 0x3f) + 3;
      for (let i = 0; i < length; i++) {
        const b = ring[(offset + i) & 0x3ff];
        out[outPos++] = b;
        ring[rPos] = b;
        rPos = (rPos + 1) & 0x3ff;
        if (outPos >= decompSize) break;
      }
    }
  }
  return out;
}

// Tabla CRC32 para generar PNGs en memoria sin librerías externas
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeStr, dataBuf) {
  const typeBuf = Buffer.from(typeStr, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);
  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
}

function encodePngRgba(width, height, rgbaBuf) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 (RGBA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter 0
    rgbaBuf.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}

function parseHbinmode(dec, nameHint) {
  const magic = dec.toString("ascii", 0, 4);
  const subType = dec.toString("ascii", 8, 16);
  if (magic !== "FORM" || subType !== "HBINMODE") {
    throw new Error(`Invalid FORM HBINMODE header in ${nameHint}`);
  }

  let pos = 12;
  const strg = [];
  const cols = [];
  const mats = [];
  const atrs = [];
  const verts = [];
  const faces = [];
  const bmps = {};
  const pals = {};
  let objRaw = null;

  while (pos + 8 <= dec.length) {
    const cid = dec.toString("ascii", pos, pos + 4);
    const clen = dec.readUInt32BE(pos + 4);
    const cdata = dec.subarray(pos + 8, pos + 8 + clen);
    pos += 8 + clen + (clen & 1);

    if (cid === "STRG") {
      const scnt = cdata.readUInt16BE(0);
      let cur = 2 + scnt;
      for (let i = 0; i < scnt; i++) {
        const slen = cdata[2 + i];
        strg.push(cdata.toString("ascii", cur, cur + slen));
        cur += slen;
      }
    } else if (cid === "COL1") {
      const ccnt = cdata.readUInt16BE(0);
      for (let i = 0; i < ccnt; i++) {
        const off = 2 + i * 4;
        cols.push([cdata[off], cdata[off + 1], cdata[off + 2], cdata[off + 3]]);
      }
    } else if (cid === "MAT1") {
      const mcnt = cdata.readUInt16BE(0);
      for (let i = 0; i < mcnt; i++) {
        const off = 2 + i * 12;
        mats.push({
          c0: cdata.readUInt16BE(off),
          c1: cdata.readUInt16BE(off + 2),
          c2: cdata.readUInt16BE(off + 4),
        });
      }
    } else if (cid === "ATR1") {
      const acnt = cdata.readUInt16BE(0);
      for (let i = 0; i < acnt; i++) {
        const off = 2 + i * 13;
        atrs.push({
          bmpId: cdata.readUInt16BE(off + 10),
        });
      }
    } else if (cid === "VTX1") {
      const vcnt = cdata.readUInt16BE(0);
      const scale = cdata.readFloatBE(4);
      for (let i = 0; i < vcnt; i++) {
        const off = 8 + i * 9;
        const x = cdata.readInt16BE(off) * scale;
        const y = cdata.readInt16BE(off + 2) * scale;
        const z = cdata.readInt16BE(off + 4) * scale;
        const nx = cdata.readInt8(off + 6) / 127.0;
        const ny = cdata.readInt8(off + 7) / 127.0;
        const nz = cdata.readInt8(off + 8) / 127.0;
        verts.push({
          p: [Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3))],
          n: [Number(nx.toFixed(3)), Number(ny.toFixed(3)), Number(nz.toFixed(3))],
        });
      }
    } else if (cid === "FAC1") {
      const fcnt = cdata.readUInt16BE(0);
      let cur = 8;
      for (let f = 0; f < fcnt; f++) {
        const vtype = cdata[cur++];
        const nv = vtype === 0x16 ? 3 : vtype === 0x35 ? 4 : 0;
        const fVerts = [];
        for (let k = 0; k < nv; k++) {
          const vi = cdata.readInt16BE(cur);
          const ci = cdata.readInt16BE(cur + 2);
          const u = cdata.readFloatBE(cur + 4);
          const v = cdata.readFloatBE(cur + 8);
          fVerts.push({
            v: vi,
            c: ci,
            uv: [Number(u.toFixed(4)), Number(v.toFixed(4))],
          });
          cur += 12;
        }
        const matIdx = cdata.readInt16BE(cur);
        const atrIdx = cdata.readInt16BE(cur + 2);
        const endTag = cdata[cur + 4];
        cur += 5;
        faces.push({
          verts: fVerts,
          mat: matIdx,
          atr: atrIdx,
          textured: endTag === 0x36,
        });
      }
    } else if (cid === "BMP1") {
      const tid = cdata.readUInt16BE(0);
      const fmt = cdata.readUInt16BE(2);
      const w = cdata.readUInt16BE(6) >> 8;
      const h = cdata.readUInt16BE(8) >> 8;
      const rawBytes = cdata.subarray(17);
      bmps[tid] = { id: tid, fmt, w, h, rawBytes };
    } else if (cid === "PAL1") {
      const pid = cdata.readUInt16BE(0);
      const pcnt = cdata.readUInt16BE(2);
      const palette = [];
      for (let i = 0; i < pcnt; i++) {
        const off = 4 + i * 4;
        palette.push([cdata[off], cdata[off + 1], cdata[off + 2], cdata[off + 3]]);
      }
      pals[pid] = palette;
    } else if (cid === "OBJ1") {
      objRaw = cdata;
    }
  }

  const textures = {};
  for (const tidStr of Object.keys(bmps)) {
    const tid = Number(tidStr);
    const binfo = bmps[tid];
    const { w, h, rawBytes } = binfo;
    const pal = pals[tid] || [];
    const rgba = Buffer.alloc(w * h * 4);
    const is4Bit = rawBytes.length < w * h;

    for (let i = 0; i < w * h; i++) {
      let cIdx = 0;
      if (is4Bit) {
        const byteVal = rawBytes[i >> 1] || 0;
        cIdx = (i & 1) === 0 ? (byteVal >> 4) & 0x0f : byteVal & 0x0f;
      } else {
        cIdx = rawBytes[i] || 0;
      }
      const col = cIdx < pal.length ? pal[cIdx] : [255, 255, 255, 255];
      rgba[i * 4] = col[0];
      rgba[i * 4 + 1] = col[1];
      rgba[i * 4 + 2] = col[2];
      rgba[i * 4 + 3] = col[3];
    }
    textures[tid] = {
      id: tid,
      name: strg[tid] || `tex_${tid}`,
      w,
      h,
      dataUri: encodePngRgba(w, h, rgba),
    };
  }

  const nodes = {};
  if (objRaw) {
    const ncnt = objRaw.readUInt16BE(0);
    let cur = 4;
    for (let n = 0; n < ncnt; n++) {
      const recSize = objRaw.readUInt16BE(cur);
      const rec = objRaw.subarray(cur + 2, cur + 2 + recSize);
      cur += 2 + recSize;
      const tag = rec[0];
      if (tag === 0x3d) {
        const sid = rec.readUInt16BE(1);
        const ccnt = rec.readUInt16BE(3);
        const children = [];
        for (let c = 0; c < ccnt; c++) {
          children.push(rec.readUInt16BE(5 + c * 2));
        }
        const tOff = 5 + ccnt * 2;
        nodes[sid] = {
          sid,
          name: strg[sid] || `group_${sid}`,
          type: "group",
          children,
          t: [
            Number(rec.readFloatBE(tOff).toFixed(3)),
            Number(rec.readFloatBE(tOff + 4).toFixed(3)),
            Number(rec.readFloatBE(tOff + 8).toFixed(3)),
          ],
          r: [
            Number(rec.readFloatBE(tOff + 12).toFixed(3)),
            Number(rec.readFloatBE(tOff + 16).toFixed(3)),
            Number(rec.readFloatBE(tOff + 20).toFixed(3)),
          ],
          s: [
            Number(rec.readFloatBE(tOff + 24).toFixed(3)),
            Number(rec.readFloatBE(tOff + 28).toFixed(3)),
            Number(rec.readFloatBE(tOff + 32).toFixed(3)),
          ],
        };
      } else if (tag === 0x3a) {
        const sid = rec.readUInt16BE(1);
        const faceStart = rec.readUInt16BE(4);
        const faceCount = rec.readUInt16BE(6);
        nodes[sid] = {
          sid,
          name: strg[sid] || `mesh_${sid}`,
          type: "mesh",
          faceStart,
          faceCount,
          t: [
            Number(rec.readFloatBE(8).toFixed(3)),
            Number(rec.readFloatBE(12).toFixed(3)),
            Number(rec.readFloatBE(16).toFixed(3)),
          ],
          r: [
            Number(rec.readFloatBE(20).toFixed(3)),
            Number(rec.readFloatBE(24).toFixed(3)),
            Number(rec.readFloatBE(28).toFixed(3)),
          ],
          s: [
            Number(rec.readFloatBE(32).toFixed(3)),
            Number(rec.readFloatBE(36).toFixed(3)),
            Number(rec.readFloatBE(40).toFixed(3)),
          ],
        };
      }
    }
  }

  return {
    name: nameHint,
    strings: strg,
    colors: cols,
    materials: mats,
    attributes: atrs,
    vertices: verts,
    faces,
    textures,
    nodes,
  };
}

function getDirFile(fd, dirIdx, fileIdx) {
  const ptrBuf = Buffer.alloc(8);
  fs.readSync(fd, ptrBuf, 0, 4, MAIN_DIR_OFFSET + 4 + dirIdx * 4);
  const dirRel = ptrBuf.readUInt32BE(0);
  const dirAbs = MAIN_DIR_OFFSET + dirRel;

  fs.readSync(fd, ptrBuf, 0, 4, dirAbs + 4 + fileIdx * 4);
  const fileRel = ptrBuf.readUInt32BE(0);
  const fileAbs = dirAbs + fileRel;

  fs.readSync(fd, ptrBuf, 0, 8, fileAbs);
  const decompSize = ptrBuf.readUInt32BE(0);
  const ctype = ptrBuf.readUInt32BE(4);

  if (ctype === 0) {
    const raw = Buffer.alloc(decompSize);
    fs.readSync(fd, raw, 0, decompSize, fileAbs + 8);
    return raw;
  } else {
    const compBuf = Buffer.alloc(decompSize * 2);
    fs.readSync(fd, compBuf, 0, compBuf.length, fileAbs + 8);
    return decompressLzss(compBuf, decompSize);
  }
}

function extractN64AssetsFromRom() {
  if (cachedAssets) return cachedAssets;

  const fd = fs.openSync(ROM_PATH, "r");
  try {
    // Escenario Mushroom Mix-Up (#32 IROIRO KINOKO, Directorio 44)
    const mushroomOuter = parseHbinmode(getDirFile(fd, 44, 0), "kinokomap_32m_004");
    const mushroomColors = parseHbinmode(getDirFile(fd, 44, 1), "all_kinoko_32m_005");
    const mushroomStem = parseHbinmode(getDirFile(fd, 44, 2), "all_kinoko_32m_007");
    const water = parseHbinmode(getDirFile(fd, 44, 3), "water_32m_008");

    // 6 personajes jugables low-poly de Mario Party N64 (Directorios 1..6, archivo 159)
    const charDefs = [
      { dir: 1, id: "mario", label: "MARIO", mushroomTex: "32mt001_DEF", capColor: "#D91C1C" },
      { dir: 2, id: "luigi", label: "LUIGI", mushroomTex: "32mt002_DEF", capColor: "#2838B8" },
      { dir: 3, id: "yoshi", label: "YOSHI", mushroomTex: "32mt004_DEF", capColor: "#50B820" },
      { dir: 4, id: "wario", label: "WARIO", mushroomTex: "32mt003_DEF", capColor: "#E2BD18" },
      { dir: 5, id: "dk", label: "D. KONG", mushroomTex: "32mt005_DEF", capColor: "#78B5E0" },
      { dir: 6, id: "peach", label: "PEACH", mushroomTex: "32mt006_DEF", capColor: "#DD5878" },
    ];

    const characters = {};
    for (const cdef of charDefs) {
      // Extraer el modelo principal N64 de alta fidelidad (archivo 158 de cada directorio 1..6)
      const parsed = parseHbinmode(getDirFile(fd, cdef.dir, 158), cdef.id);
      parsed.id = cdef.id;
      parsed.label = cdef.label;
      parsed.mushroomTex = cdef.mushroomTex;
      parsed.capColor = cdef.capColor;
      characters[cdef.id] = parsed;
    }

    cachedAssets = {
      romTitle: "Mario Party (USA) [CLBE] - Read-Only Extracted N64 Assets",
      minigame: "32: IROIRO KINOKO (Mushroom Mix-Up)",
      stage: {
        mushroomOuter,
        mushroomColors,
        mushroomStem,
        water,
      },
      characters,
    };
    return cachedAssets;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { extractN64AssetsFromRom };
