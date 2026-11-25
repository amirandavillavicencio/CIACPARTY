"""
Extractor de modelos 3D (FORM HBINMODE) y texturas paletizadas (BMP1/PAL1)
en modo ESTRICTAMENTE SOLO LECTURA desde 'Mario Party (USA)/Mario Party (USA).z64'.
Extrae:
- Los modelos y texturas del minijuego #32 IROIRO KINOKO (Mushroom Mix-Up, Dir 44)
- Los 6 personajes jugables low-poly de Nintendo 64 (Dir 1..6, archivo 159)
Genera 'public/assets/n64_assets.json' con geometría, jerarquía de nodos y texturas RGBA en base64.
"""

import os
import json
import struct
import base64
import zlib

ROM_PATH = os.path.join(r"C:\juego ciac", "Mario Party (USA)", "Mario Party (USA).z64")
OUT_DIR = os.path.join(r"C:\juego ciac", "public", "assets")
OUT_JSON = os.path.join(OUT_DIR, "n64_assets.json")

MAIN_DIR_OFFSET = 0x31C7E0


def decompress_lzss(src: bytes, decomp_size: int) -> bytes:
    out = bytearray()
    ring = bytearray(1024)
    r_pos = 0x3BE
    idx = 0
    flags = 0
    src_len = len(src)
    while len(out) < decomp_size and idx < src_len:
        flags >>= 1
        if (flags & 0x100) == 0:
            flags = src[idx] | 0xFF00
            idx += 1
        if flags & 1:
            if idx >= src_len:
                break
            b = src[idx]
            idx += 1
            out.append(b)
            ring[r_pos] = b
            r_pos = (r_pos + 1) & 0x3FF
        else:
            if idx + 1 >= src_len:
                break
            b1 = src[idx]
            b2 = src[idx + 1]
            idx += 2
            offset = b1 | ((b2 & 0xC0) << 2)
            length = (b2 & 0x3F) + 3
            for i in range(length):
                b = ring[(offset + i) & 0x3FF]
                out.append(b)
                ring[r_pos] = b
                r_pos = (r_pos + 1) & 0x3FF
                if len(out) >= decomp_size:
                    break
    return bytes(out)


def encode_png_rgba(width: int, height: int, rgba_bytes: bytes) -> str:
    """Codifica un buffer RGBA (width * height * 4) como PNG data URI sin dependencias externas."""
    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        chunk = struct.pack(">I", len(data)) + chunk_type + data
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return chunk + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # Filter type 0 (None)
        raw.extend(rgba_bytes[y * stride : (y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + make_chunk(b"IHDR", ihdr)
        + make_chunk(b"IDAT", idat)
        + make_chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def parse_hbinmode(dec: bytes, name_hint: str) -> dict:
    assert dec[:4] == b"FORM" and dec[8:16] == b"HBINMODE", f"Invalid HBINMODE in {name_hint}"
    pos = 12
    strg = []
    cols = []
    mats = []
    atrs = []
    verts = []
    faces = []
    bmps = {}
    pals = {}
    obj_raw = b""

    while pos + 8 <= len(dec):
        cid = dec[pos : pos + 4].decode("ascii", errors="replace")
        clen = struct.unpack(">I", dec[pos + 4 : pos + 8])[0]
        cdata = dec[pos + 8 : pos + 8 + clen]
        pos += 8 + clen + (clen & 1)

        if cid == "STRG":
            scnt = struct.unpack(">H", cdata[:2])[0]
            lens = list(cdata[2 : 2 + scnt])
            cur = 2 + scnt
            for l in lens:
                strg.append(cdata[cur : cur + l].decode("ascii", errors="replace"))
                cur += l

        elif cid == "COL1":
            ccnt = struct.unpack(">H", cdata[:2])[0]
            for i in range(ccnt):
                r, g, b, a = cdata[2 + i * 4 : 6 + i * 4]
                cols.append([r, g, b, a])

        elif cid == "MAT1":
            mcnt = struct.unpack(">H", cdata[:2])[0]
            for i in range(mcnt):
                rec = cdata[2 + i * 12 : 2 + (i + 1) * 12]
                c0, c1, c2 = struct.unpack(">HHH", rec[:6])
                mats.append({"c0": c0, "c1": c1, "c2": c2})

        elif cid == "ATR1":
            acnt = struct.unpack(">H", cdata[:2])[0]
            for i in range(acnt):
                rec = cdata[2 + i * 13 : 2 + (i + 1) * 13]
                bmp_sid = struct.unpack(">H", rec[10:12])[0]
                atrs.append({"bmpId": bmp_sid, "flags": rec[:10].hex()})

        elif cid == "VTX1":
            vcnt, _ = struct.unpack(">HH", cdata[:4])
            scale = struct.unpack(">f", cdata[4:8])[0]
            for i in range(vcnt):
                x, y, z, nx, ny, nz = struct.unpack(">hhhbbb", cdata[8 + i * 9 : 8 + (i + 1) * 9])
                verts.append({
                    "p": [round(x * scale, 3), round(y * scale, 3), round(z * scale, 3)],
                    "n": [round(nx / 127.0, 3), round(ny / 127.0, 3), round(nz / 127.0, 3)],
                })

        elif cid == "FAC1":
            fcnt, _, _ = struct.unpack(">HHI", cdata[:8])
            cur = 8
            for f in range(fcnt):
                vtype = cdata[cur]
                cur += 1
                nv = 3 if vtype == 0x16 else (4 if vtype == 0x35 else 0)
                f_verts = []
                for k in range(nv):
                    vi, ci, u, v = struct.unpack(">hhff", cdata[cur : cur + 12])
                    f_verts.append({"v": vi, "c": ci, "uv": [round(u, 4), round(v, 4)]})
                    cur += 12
                mat_idx, atr_idx, end_tag = struct.unpack(">hhB", cdata[cur : cur + 5])
                cur += 5
                faces.append({
                    "verts": f_verts,
                    "mat": mat_idx,
                    "atr": atr_idx,
                    "textured": (end_tag == 0x36),
                })

        elif cid == "BMP1":
            tid, fmt, pal_cnt_hi, w_hi, h_hi, pal_id_hi, dsize_kb = struct.unpack(">HHHHHHI", cdata[:16])
            w = w_hi >> 8
            h = h_hi >> 8
            raw_pixels = cdata[17:]
            bmps[tid] = {
                "id": tid,
                "w": w,
                "h": h,
                "pixels": raw_pixels,
            }

        elif cid == "PAL1":
            pid, pcnt = struct.unpack(">HH", cdata[:4])
            palette = []
            for i in range(pcnt):
                r, g, b, a = cdata[4 + i * 4 : 8 + i * 4]
                palette.append((r, g, b, a))
            pals[pid] = palette

        elif cid == "OBJ1":
            obj_raw = cdata

    # Combine BMP1 + PAL1 into PNG data URIs (supports CI4 4-bit nibble packing and CI8)
    textures = {}
    for tid, binfo in bmps.items():
        w, h = binfo["w"], binfo["h"]
        px = binfo["pixels"]
        pal = pals.get(tid, [(255, 255, 255, 255)] * 256)
        rgba = bytearray(w * h * 4)
        is_4bit = len(px) < (w * h)
        for idx_p in range(w * h):
            if is_4bit:
                bval = px[idx_p >> 1] if (idx_p >> 1) < len(px) else 0
                c_idx = (bval >> 4) & 0x0F if (idx_p & 1) == 0 else (bval & 0x0F)
            else:
                c_idx = px[idx_p] if idx_p < len(px) else 0
            r, g, b, a = pal[c_idx] if c_idx < len(pal) else (255, 0, 255, 255)
            rgba[idx_p * 4 : idx_p * 4 + 4] = bytes((r, g, b, a))
        tname = strg[tid] if tid < len(strg) else f"tex_{tid}"
        textures[str(tid)] = {
            "id": tid,
            "name": tname,
            "w": w,
            "h": h,
            "dataUri": encode_png_rgba(w, h, bytes(rgba)),
        }

    # Parse OBJ1 scene graph nodes
    nodes = {}
    if obj_raw:
        ncnt, _ = struct.unpack(">HH", obj_raw[:4])
        cur = 4
        for n in range(ncnt):
            rec_size = struct.unpack(">H", obj_raw[cur : cur + 2])[0]
            rec = obj_raw[cur + 2 : cur + 2 + rec_size]
            cur += 2 + rec_size
            tag = rec[0]
            if tag == 0x3D:
                sid, ccnt = struct.unpack(">HH", rec[1:5])
                children = [struct.unpack(">H", rec[5 + i * 2 : 7 + i * 2])[0] for i in range(ccnt)]
                tx, ty, tz, rx, ry, rz, sx, sy, sz = struct.unpack(">fffffffff", rec[5 + ccnt * 2 : 41 + ccnt * 2])
                nodes[str(sid)] = {
                    "sid": sid,
                    "name": strg[sid] if sid < len(strg) else f"node_{sid}",
                    "type": "group",
                    "children": children,
                    "t": [round(tx, 3), round(ty, 3), round(tz, 3)],
                    "r": [round(rx, 3), round(ry, 3), round(rz, 3)],
                    "s": [round(sx, 3), round(sy, 3), round(sz, 3)],
                }
            elif tag == 0x10:
                # Root container in simple stage objects
                children = [1, 2]
                nodes["0"] = {
                    "sid": 0,
                    "name": strg[0] if strg else "root",
                    "type": "group",
                    "children": children,
                    "t": [0, 0, 0],
                    "r": [0, 0, 0],
                    "s": [1, 1, 1],
                }
            elif tag == 0x3A:
                sid, sub, f_start, f_cnt = struct.unpack(">HBHH", rec[1:8])
                tx, ty, tz, rx, ry, rz, sx, sy, sz = struct.unpack(">fffffffff", rec[8:44])
                nodes[str(sid)] = {
                    "sid": sid,
                    "name": strg[sid] if sid < len(strg) else f"mesh_{sid}",
                    "type": "mesh",
                    "faceStart": f_start,
                    "faceCount": f_cnt,
                    "t": [round(tx, 3), round(ty, 3), round(tz, 3)],
                    "r": [round(rx, 3), round(ry, 3), round(rz, 3)],
                    "s": [round(sx, 3), round(sy, 3), round(sz, 3)],
                }

    return {
        "name": name_hint,
        "strings": strg,
        "colors": cols,
        "materials": mats,
        "attributes": atrs,
        "vertices": verts,
        "faces": faces,
        "textures": textures,
        "nodes": nodes,
    }


def get_dir_file(rom: bytes, dir_idx: int, file_idx: int) -> bytes:
    dir_rel = struct.unpack(">I", rom[MAIN_DIR_OFFSET + 4 + dir_idx * 4 : MAIN_DIR_OFFSET + 8 + dir_idx * 4])[0]
    dir_abs = MAIN_DIR_OFFSET + dir_rel
    cnt = struct.unpack(">I", rom[dir_abs : dir_abs + 4])[0]
    assert 0 <= file_idx < cnt, f"Invalid file {file_idx} in dir {dir_idx}"
    f_rel = struct.unpack(">I", rom[dir_abs + 4 + file_idx * 4 : dir_abs + 8 + file_idx * 4])[0]
    f_abs = dir_abs + f_rel
    decomp_size, ctype = struct.unpack(">II", rom[f_abs : f_abs + 8])
    if ctype == 0:
        return rom[f_abs + 8 : f_abs + 8 + decomp_size]
    else:
        return decompress_lzss(rom[f_abs + 8 : f_abs + 8 + decomp_size * 2], decomp_size)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(ROM_PATH, "rb") as f:
        rom = f.read()

    # 1. Extract Mushroom Mix-Up (Dir 44: IROIRO KINOKO) models & textures
    mushroom_stem_cap = parse_hbinmode(get_dir_file(rom, 44, 0), "kinokomap_32m_004")
    mushroom_7colors = parse_hbinmode(get_dir_file(rom, 44, 1), "all_kinoko_32m_005")
    mushroom_inner = parse_hbinmode(get_dir_file(rom, 44, 2), "all_kinoko_32m_007")
    sea_water = parse_hbinmode(get_dir_file(rom, 44, 3), "water_32m_008")

    # 2. Extract the 6 playable N64 low-poly character models (Dir 1..6, File 159)
    char_defs = [
        (1, "mario", "MARIO", "#E61919"),
        (2, "luigi", "LUIGI", "#2448D8"),
        (3, "yoshi", "YOSHI", "#38C82C"),
        (4, "wario", "WARIO", "#E8C618"),
        (5, "dk", "D. KONG", "#9A541C"),
        (6, "peach", "PEACH", "#E85888"),
    ]
    characters = {}
    for d_idx, cid, label, theme_hex in char_defs:
        c_model = parse_hbinmode(get_dir_file(rom, d_idx, 158), cid)
        c_model["id"] = cid
        c_model["label"] = label
        c_model["themeColor"] = theme_hex
        characters[cid] = c_model

    payload = {
        "romSource": "Mario Party (USA) [CLBE] - Read-Only Extracted Assets",
        "minigameId": 32,
        "minigameInternalName": "IROIRO KINOKO (Mushroom Mix-Up)",
        "stage": {
            "mushroomOuter": mushroom_stem_cap,
            "mushroomColors": mushroom_7colors,
            "mushroomStem": mushroom_inner,
            "water": sea_water,
        },
        "characters": characters,
    }

    with open(OUT_JSON, "w", encoding="utf-8") as out_f:
        json.dump(payload, out_f, separators=(",", ":"))

    print(f"Exported N64 assets to {OUT_JSON} ({os.path.getsize(OUT_JSON)} bytes)")
    print("Mushroom cap textures:", [t["name"] for t in mushroom_7colors["textures"].values()])
    print("Water texture:", [t["name"] for t in sea_water["textures"].values()])
    print("Characters extracted:", list(characters.keys()))


if __name__ == "__main__":
    main()
