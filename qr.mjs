/**
 * Generador QR en SVG puro (Byte mode, ECC Level L, Version 1..6)
 * Sin dependencias externas, 100% compatible con lectores de cámara iOS y Android.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

// Version 1..6 specs for ECC Level L (single block for V1..V5, 2 blocks for V6)
const VERSION_SPECS = [
  null,
  { size: 21, totalData: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { size: 25, totalData: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { size: 29, totalData: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { size: 33, totalData: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { size: 37, totalData: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { size: 41, totalData: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
];

function selectVersion(byteLen) {
  for (let v = 1; v <= 6; v++) {
    if (byteLen + 2 <= VERSION_SPECS[v].totalData) return v;
  }
  return 6;
}

function buildCodewords(text, spec) {
  const utf8 = Array.from(Buffer.from(text, "utf8"));
  const bits = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  }
  // Byte mode indicator (0100) + 8-bit length
  pushBits(0b0100, 4);
  pushBits(utf8.length, 8);
  for (const b of utf8) pushBits(b, 8);

  const maxBits = spec.totalData * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataBytes.push(b);
  }
  const pads = [0xec, 0x11];
  let pIdx = 0;
  while (dataBytes.length < spec.totalData) {
    dataBytes.push(pads[pIdx % 2]);
    pIdx++;
  }

  if (spec.blocks === 1) {
    const ec = rsEncode(dataBytes, spec.ecPerBlock);
    return dataBytes.concat(ec);
  } else {
    const bSize = spec.totalData / spec.blocks;
    const dataBlocks = [];
    const ecBlocks = [];
    for (let b = 0; b < spec.blocks; b++) {
      const slice = dataBytes.slice(b * bSize, (b + 1) * bSize);
      dataBlocks.push(slice);
      ecBlocks.push(rsEncode(slice, spec.ecPerBlock));
    }
    const out = [];
    for (let i = 0; i < bSize; i++) {
      for (let b = 0; b < spec.blocks; b++) out.push(dataBlocks[b][i]);
    }
    for (let i = 0; i < spec.ecPerBlock; i++) {
      for (let b = 0; b < spec.blocks; b++) out.push(ecBlocks[b][i]);
    }
    return out;
  }
}

function placeFinder(mat, reserved, r, c) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const y = r + dy;
      const x = c + dx;
      if (y < 0 || x < 0 || y >= mat.length || x >= mat.length) continue;
      const inOuter = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6;
      const inBorder = dy === 0 || dy === 6 || dx === 0 || dx === 6;
      const inInner = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      mat[y][x] = inOuter && (inBorder || inInner) ? 1 : 0;
      reserved[y][x] = true;
    }
  }
}

function placeAlignment(mat, reserved, r, c) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const y = r + dy;
      const x = c + dx;
      const dark = Math.max(Math.abs(dy), Math.abs(dx)) !== 1;
      mat[y][x] = dark ? 1 : 0;
      reserved[y][x] = true;
    }
  }
}

// Precomputed BCH format info bits for ECC Level L (01) and masks 0..7
const FORMAT_BITS_L = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

function placeFormatBits(mat, size, maskId) {
  const fmt = FORMAT_BITS_L[maskId];
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    // Top-left
    if (i < 6) mat[i][8] = bit;
    else if (i < 8) mat[i + 1][8] = bit;
    else if (i === 8) mat[8][7] = bit;
    else mat[8][14 - i] = bit;

    // Top-right and bottom-left
    if (i < 8) mat[8][size - 1 - i] = bit;
    else mat[size - 15 + i][8] = bit;
  }
}

function generateQrMatrix(text) {
  const bufLen = Buffer.byteLength(text, "utf8");
  const ver = selectVersion(bufLen);
  const spec = VERSION_SPECS[ver];
  const size = spec.size;

  const mat = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  placeFinder(mat, reserved, 0, 0);
  placeFinder(mat, reserved, 0, size - 7);
  placeFinder(mat, reserved, size - 7, 0);

  if (spec.align.length > 0) {
    for (const r of spec.align) {
      for (const c of spec.align) {
        if (reserved[r][c]) continue;
        placeAlignment(mat, reserved, r, c);
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) {
      mat[6][i] = i % 2 === 0 ? 1 : 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      mat[i][6] = i % 2 === 0 ? 1 : 0;
      reserved[i][6] = true;
    }
  }

  // Dark module and format reservation
  mat[size - 8][8] = 1;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  const codewords = buildCodewords(text, spec);
  const bits = [];
  for (const cw of codewords) {
    for (let b = 7; b >= 0; b--) bits.push((cw >> b) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!reserved[y][x]) {
          const bit = bitIdx < bits.length ? bits[bitIdx++] : 0;
          // Apply mask 0: (y + x) % 2 === 0
          const masked = (y + x) % 2 === 0 ? bit ^ 1 : bit;
          mat[y][x] = masked;
        }
      }
    }
    upward = !upward;
  }

  placeFormatBits(mat, size, 0);
  return mat;
}

function generateQrSvg(text, darkColor = "#000000", lightColor = "#FFFFFF") {
  const mat = generateQrMatrix(text);
  const size = mat.length;
  const margin = 2;
  const total = size + margin * 2;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mat[y][x]) {
        path += `M${x + margin},${y + margin}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${lightColor}"/><path d="${path}" fill="${darkColor}"/></svg>`;
}

export { generateQrSvg };
