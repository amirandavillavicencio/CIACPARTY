/**
 * Motor Tridimensional Retro Nintendo 64 — MUSHROOM PARTY CIAC
 * - Renderiza las mallas low-poly originales (VTX1, FAC1, OBJ1) y las texturas CI4 (BMP1/PAL1)
 *   extraídas de Mario Party (USA).z64:
 *     • Escenario #32 IROIRO KINOKO (Mushroom Mix-Up, Dir 44 Files 0..3)
 *     • Los 6 personajes jugables N64 (Dir 1..6 File 158: Mario, Luigi, Yoshi, Wario, DK, Peach)
 * - Compatible tanto con servidor Node.js (/api/n64-assets + SSE) como con alojamiento estático
 *   en Cloudflare Pages / Workers (/assets/n64_assets.json + BroadcastChannel).
 * - Incluye sintetizador de efectos de sonido N64 por WebAudio API, cámara con modos dinámicos,
 *   distribución clásica de hongos sobre el mar, sombras proyectadas, anillos de espuma en el agua,
 *   expresiones y poses esqueléticas de celebración/caída y podio final.
 */

(function () {
  const canvas = document.getElementById("n64-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  // Resolución interna auténtica de consola Nintendo 64 escalada con píxeles nítidos
  const INTERNAL_HEIGHT = 360;
  let internalWidth = 640;

  function resizeCanvas() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    internalWidth = Math.max(480, Math.round(INTERNAL_HEIGHT * aspect));
    canvas.width = internalWidth;
    canvas.height = INTERNAL_HEIGHT;
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // =========================================================================
  // SINTETIZADOR DE AUDIO RETRO N64 (WebAudio API — Cero archivos externos)
  // =========================================================================
  let audioCtx = null;
  let sfxEnabled = true;
  let lastPlayedSfxSeq = -1;
  let lastCountdownBeepSec = -1;

  function ensureAudio() {
    if (!sfxEnabled) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, type, duration, delay = 0, vol = 0.14, slideFreq = null) {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function playN64Sfx(cue) {
    if (!sfxEnabled) return;
    if (cue === "START") {
      // Silbato + acorde arcade "START!" de Mario Party N64
      playTone(523.25, "square", 0.11, 0.0, 0.15);
      playTone(659.25, "square", 0.11, 0.11, 0.15);
      playTone(783.99, "square", 0.11, 0.22, 0.15);
      playTone(1046.5, "square", 0.28, 0.33, 0.18);
    } else if (cue === "TICK") {
      playTone(880, "triangle", 0.07, 0.0, 0.12);
    } else if (cue === "ANSWER") {
      // Bloqueo de respuesta en mando
      playTone(587.33, "square", 0.06, 0.0, 0.11);
      playTone(880.0, "square", 0.09, 0.06, 0.13);
    } else if (cue === "UP") {
      // Resorte de subida de hongo (+1m)
      playTone(330, "square", 0.12, 0.0, 0.16, 660);
      playTone(440, "square", 0.14, 0.1, 0.16, 880);
      playTone(587.33, "square", 0.22, 0.2, 0.18, 1174.66);
    } else if (cue === "DOWN") {
      // Descenso de plataforma (-1m)
      playTone(440, "sawtooth", 0.14, 0.0, 0.14, 260);
      playTone(310, "sawtooth", 0.22, 0.14, 0.14, 155);
    } else if (cue === "FANFARE") {
      // Fanfarria de victoria N64
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      const times = [0.0, 0.13, 0.26, 0.39, 0.56, 0.7];
      const durs = [0.11, 0.11, 0.11, 0.15, 0.12, 0.42];
      notes.forEach((n, i) => playTone(n, "square", durs[i], times[i], 0.17));
    }
  }

  // Cartel de transición arcade N64
  let bannerTimeout = null;
  function showArcadeBanner(title, subtitle, durationMs = 1900) {
    const overlay = document.getElementById("arcade-banner-overlay");
    const tEl = document.getElementById("arcade-banner-title");
    const sEl = document.getElementById("arcade-banner-sub");
    if (!overlay || !tEl || !sEl) return;
    tEl.textContent = title;
    sEl.textContent = subtitle || "";
    overlay.classList.add("visible");
    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
      overlay.classList.remove("visible");
    }, durationMs);
  }

  // =========================================================================
  // CARGA DE MODELOS Y TEXTURAS N64 (VTX1, FAC1, OBJ1, BMP1/PAL1 CI4)
  // =========================================================================
  let n64Assets = null;
  const loadedImages = {}; // texName -> HTMLImageElement
  const textureAvgColors = {}; // texName -> [r,g,b]
  let gameState = null;

  // Estado de animación continua por plataforma de hongo
  const platformAnim = {};

  function preloadAssetImages(assets) {
    if (!assets || !assets.stage) return;
    const allModels = [
      assets.stage.mushroomOuter,
      assets.stage.mushroomColors,
      assets.stage.mushroomStem,
      assets.stage.water,
      ...Object.values(assets.characters || {}),
    ];

    for (const mdl of allModels) {
      if (!mdl || !mdl.textures) continue;
      for (const tex of Object.values(mdl.textures)) {
        if (tex.dataUri && !loadedImages[tex.name]) {
          const img = new Image();
          img.onload = () => {
            const off = document.createElement("canvas");
            off.width = tex.w || 32;
            off.height = tex.h || 32;
            const octx = off.getContext("2d");
            octx.drawImage(img, 0, 0);
            const imgData = octx.getImageData(0, 0, off.width, off.height).data;
            let r = 0, g = 0, b = 0, cnt = 0;
            for (let i = 0; i < imgData.length; i += 4) {
              if (imgData[i + 3] > 32) {
                r += imgData[i];
                g += imgData[i + 1];
                b += imgData[i + 2];
                cnt++;
              }
            }
            if (cnt > 0) {
              textureAvgColors[tex.name] = [
                Math.round(r / cnt),
                Math.round(g / cnt),
                Math.round(b / cnt),
              ];
            }
            img._pixelData = imgData;
            img._w = off.width;
            img._h = off.height;
          };
          img.src = tex.dataUri;
          loadedImages[tex.name] = img;
        }
      }
    }
  }

  // =========================================================================
  // MATEMÁTICA 3D Y TRANSFORMACIONES JERÁRQUICAS N64
  // =========================================================================
  function degToRad(d) {
    return (d * Math.PI) / 180;
  }

  function mat4Mul(a, b) {
    const out = new Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        out[r * 4 + c] =
          a[r * 4 + 0] * b[0 * 4 + c] +
          a[r * 4 + 1] * b[1 * 4 + c] +
          a[r * 4 + 2] * b[2 * 4 + c] +
          a[r * 4 + 3] * b[3 * 4 + c];
      }
    }
    return out;
  }

  function mat4FromTRS(t, rDeg, s) {
    const rx = degToRad(rDeg[0]);
    const ry = degToRad(rDeg[1]);
    const rz = degToRad(rDeg[2]);
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    const m00 = cy * cz * s[0];
    const m01 = (sx * sy * cz - cx * sz) * s[1];
    const m02 = (cx * sy * cz + sx * sz) * s[2];

    const m10 = cy * sz * s[0];
    const m11 = (sx * sy * sz + cx * cz) * s[1];
    const m12 = (cx * sy * sz - sx * cz) * s[2];

    const m20 = -sy * s[0];
    const m21 = sx * cy * s[1];
    const m22 = cx * cy * s[2];

    return [
      m00, m01, m02, t[0],
      m10, m11, m12, t[1],
      m20, m21, m22, t[2],
      0,   0,   0,   1,
    ];
  }

  function transformVec3(m, p) {
    return [
      m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
      m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
      m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ];
  }

  function transformNormal(m, n) {
    const nx = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
    const ny = m[4] * n[0] + m[5] * n[1] + m[6] * n[2];
    const nz = m[8] * n[0] + m[9] * n[1] + m[10] * n[2];
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function rgbToHex(r, g, b) {
    const cr = Math.max(0, Math.min(255, Math.round(r)));
    const cg = Math.max(0, Math.min(255, Math.round(g)));
    const cb = Math.max(0, Math.min(255, Math.round(b)));
    return `rgb(${cr},${cg},${cb})`;
  }

  // Rasterizador de triángulos texturizados estilo Nintendo 64 con sombreado Lambertiano
  function drawTexturedTriangle(
    ctx,
    img,
    x0, y0, u0, v0,
    x1, y1, u1, v1,
    x2, y2, u2, v2,
    shadeHex,
    shadeAlpha
  ) {
    if (!img || !img.complete || !img.naturalWidth) {
      ctx.fillStyle = shadeHex;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
      return;
    }

    const tw = img.naturalWidth;
    const th = img.naturalHeight;
    const wrapUv = (val) => {
      if (val >= 0 && val <= 1) return Math.max(0.01, Math.min(0.99, val));
      const f = val - Math.floor(val);
      return Math.max(0.01, Math.min(0.99, f));
    };
    const su0 = wrapUv(u0) * tw;
    const sv0 = wrapUv(v0) * th;
    const su1 = wrapUv(u1) * tw;
    const sv1 = wrapUv(v1) * th;
    const su2 = wrapUv(u2) * tw;
    const sv2 = wrapUv(v2) * th;

    const denom = su0 * (sv2 - sv1) - su1 * sv2 + su2 * sv1 + (su1 - su2) * sv0;
    if (Math.abs(denom) < 1e-4) {
      ctx.fillStyle = shadeHex;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    const m11 = -(sv0 * (x2 - x1) - sv1 * x2 + sv2 * x1 + (sv1 - sv2) * x0) / denom;
    const m12 = (sv1 * y2 + sv0 * (y1 - y2) - sv2 * y1 + (sv2 - sv1) * y0) / denom;
    const m21 = (su0 * (x2 - x1) - su1 * x2 + su2 * x1 + (su1 - su2) * x0) / denom;
    const m22 = -(su1 * y2 + su0 * (y1 - y2) - su2 * y1 + (su2 - su1) * y0) / denom;
    const dx =
      (su0 * (sv2 * x1 - sv1 * x2) +
        sv0 * (su1 * x2 - su2 * x1) +
        (su2 * sv1 - su1 * sv2) * x0) /
      denom;
    const dy =
      (su0 * (sv2 * y1 - sv1 * y2) +
        sv0 * (su1 * y2 - su2 * y1) +
        (su2 * sv1 - su1 * sv2) * y0) /
      denom;

    ctx.transform(m11, m12, m21, m22, dx, dy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    // Aplicar sombreado direccional N64 sobre la textura
    if (shadeAlpha > 0.02) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 20, ${shadeAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Emite los polígonos 3D de un modelo HBINMODE con animación esquelética completa para los 6 personajes
  function emitHbinmodePolys(polyList, model, rootMatrix, options = {}) {
    if (!model || !model.vertices || !model.faces) return;
    const verts = model.vertices;
    const faces = model.faces;
    const cols = model.colors || [];
    const mats = model.materials || [];
    const atrs = model.attributes || [];
    const textures = model.textures || {};
    const nodes = model.nodes || {};

    const overrideCapImage = options.overrideCapImage || null;
    const fallbackCapRgb = options.fallbackCapRgb || [220, 40, 40];
    const animTime = options.animTime || 0;
    const animPose = options.animPose || "idle"; // idle | ready | jump_up | drop_down | victory

    function emitFaceRange(fStart, fCount, worldMat) {
      const end = Math.min(faces.length, fStart + fCount);
      for (let fIdx = fStart; fIdx < end; fIdx++) {
        const face = faces[fIdx];
        const fv = face.verts;
        if (!fv || fv.length < 3) continue;

        let baseRgb = [225, 215, 200];
        if (fv[0].c >= 0 && fv[0].c < cols.length) {
          baseRgb = cols[fv[0].c].slice(0, 3);
        } else if (face.mat >= 0 && face.mat < mats.length) {
          const cIdx = mats[face.mat].c1;
          if (cIdx >= 0 && cIdx < cols.length) {
            baseRgb = cols[cIdx].slice(0, 3);
          }
        }

        let texImg = null;
        if (face.textured) {
          if (overrideCapImage) {
            texImg = overrideCapImage;
            baseRgb = fallbackCapRgb;
          } else if (face.atr >= 0 && face.atr < atrs.length) {
            const bmpId = atrs[face.atr].bmpId;
            const texObj = textures[bmpId];
            if (texObj && loadedImages[texObj.name]) {
              texImg = loadedImages[texObj.name];
              if (textureAvgColors[texObj.name]) {
                baseRgb = textureAvgColors[texObj.name];
              }
            }
          }
        }

        const worldVerts = [];
        for (let k = 0; k < fv.length; k++) {
          const vObj = verts[fv[k].v];
          if (!vObj) continue;
          worldVerts.push({
            p: transformVec3(worldMat, vObj.p),
            n: transformNormal(worldMat, vObj.n),
            uv: fv[k].uv,
          });
        }
        if (worldVerts.length < 3) continue;

        const tris =
          worldVerts.length === 4
            ? [
                [worldVerts[0], worldVerts[1], worldVerts[2]],
                [worldVerts[0], worldVerts[2], worldVerts[3]],
              ]
            : [[worldVerts[0], worldVerts[1], worldVerts[2]]];

        for (const tri of tris) {
          polyList.push({
            v0: tri[0],
            v1: tri[1],
            v2: tri[2],
            rgb: baseRgb,
            texImg,
            stroke: options.stroke || false,
          });
        }
      }
    }

    // Recorrido del esqueleto OBJ1 con articulaciones específicas para Mario, Luigi, Yoshi, Wario, DK y Peach
    if (nodes["0"] && Object.keys(nodes).length > 1) {
      function traverse(nodeSid, parentMat) {
        const node = nodes[String(nodeSid)];
        if (!node) return;
        const t = [...node.t];
        const r = [...node.r];
        const s = [...node.s];
        const nName = (node.name || "").toLowerCase();

        // Identificar extremidades en la nomenclatura Hudson Soft de los 6 personajes
        const isArm =
          nName.includes("ude") ||
          nName.includes("lh1") ||
          nName.includes("cyl2_") ||
          nName.includes("bmerge13") ||
          nName.includes("bmerge15");
        const isForearm =
          nName.includes("migi-te") ||
          nName.includes("bmerge14") ||
          nName.includes("bmerge16");
        const isLeg =
          nName.includes("asi") ||
          nName.includes("ll1") ||
          nName.includes("cyl6") ||
          nName.includes("cyl8") ||
          nName.includes("cyl1_1") ||
          nName.includes("cyl1_2");
        const isHead =
          nName.includes("atama") ||
          nName.includes("head") ||
          nName.includes("bmerge5") ||
          nName.includes("bmerge10");

        if (isArm) {
          if (animPose === "jump_up" || animPose === "victory") {
            // Brazos arriba celebrando
            r[0] -= 65 + 25 * Math.sin(animTime * 11 + nodeSid);
            r[2] += (nodeSid % 2 === 0 ? 1 : -1) * 18 * Math.cos(animTime * 9);
          } else if (animPose === "ready") {
            // Pose de respuesta lista (brazo levantado con confianza)
            r[0] -= 38 * Math.abs(Math.sin(animTime * 5 + nodeSid));
          } else if (animPose === "drop_down") {
            // Agitando los brazos al perder equilibrio
            r[0] += 48 * Math.sin(animTime * 16 + nodeSid);
            r[2] += 25 * Math.cos(animTime * 16);
          } else {
            // Balanceo natural de espera en el hongo
            r[0] += 15 * Math.sin(animTime * 3.4 + nodeSid);
          }
        } else if (isForearm) {
          if (animPose === "jump_up" || animPose === "victory") {
            r[0] += 25 * Math.sin(animTime * 10);
          }
        } else if (isLeg) {
          if (animPose === "jump_up" || animPose === "victory") {
            r[0] += 34 * Math.sin(animTime * 12 + nodeSid);
          } else if (animPose === "drop_down") {
            r[0] += 28 * Math.sin(animTime * 15 + nodeSid);
          } else {
            r[0] += 9 * Math.sin(animTime * 3.4 + nodeSid);
          }
        } else if (isHead) {
          if (animPose === "jump_up" || animPose === "victory") {
            r[1] += 18 * Math.sin(animTime * 8);
            r[0] -= 10 * Math.abs(Math.cos(animTime * 8));
          } else if (animPose === "drop_down") {
            r[0] += 22; // Mirando hacia abajo al bajar el hongo
            r[1] += 24 * Math.sin(animTime * 14);
          } else {
            r[1] += 12 * Math.sin(animTime * 2.2);
          }
        }

        const localMat = mat4FromTRS(t, r, s);
        const worldMat = mat4Mul(parentMat, localMat);

        if (node.type === "mesh") {
          emitFaceRange(node.faceStart, node.faceCount, worldMat);
        } else if (node.children) {
          for (const childSid of node.children) {
            traverse(childSid, worldMat);
          }
        }
      }
      traverse(0, rootMatrix);
    } else {
      emitFaceRange(0, faces.length, rootMatrix);
    }
  }

  // =========================================================================
  // CÁMARA 3D Y ESCENARIO DE MUSHROOM MIX-UP (IROIRO KINOKO)
  // =========================================================================
  const CAMERA_MODES = ["PANORÁMICA N64", "ENFOQUE LÍDER", "ÓRBITA ARCADE"];
  let cameraModeIdx = 0;

  const camera = {
    pos: [0, 395, 950],
    target: [0, 180, 0],
    fovScale: 525,
  };

  function worldToCamera(p, camPos, camRight, camUp, camForward) {
    const dx = p[0] - camPos[0];
    const dy = p[1] - camPos[1];
    const dz = p[2] - camPos[2];
    return [
      dx * camRight[0] + dy * camRight[1] + dz * camRight[2],
      dx * camUp[0] + dy * camUp[1] + dz * camUp[2],
      dx * camForward[0] + dy * camForward[1] + dz * camForward[2],
    ];
  }

  function buildCameraBasis(pos, target) {
    let fx = target[0] - pos[0];
    let fy = target[1] - pos[1];
    let fz = target[2] - pos[2];
    const flen = Math.hypot(fx, fy, fz) || 1;
    fx /= flen; fy /= flen; fz /= flen;

    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; rz /= rlen;

    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    return {
      forward: [fx, fy, fz],
      right: [rx, ry, rz],
      up: [ux, uy, uz],
    };
  }

  // Renderiza el cielo N64 y el mar con la textura original 05mt001_DEF extraída de Dir 44 File 3
  function drawSkyAndWater(nowSec) {
    const w = canvas.width;
    const h = canvas.height;
    const horizonY = Math.floor(h * 0.43);

    // Bandas de cielo estilo Nintendo 64 (colores sólidos escalonados sin gradientes CSS)
    ctx.fillStyle = "#2068D8";
    ctx.fillRect(0, 0, w, Math.floor(horizonY * 0.45));
    ctx.fillStyle = "#3888F0";
    ctx.fillRect(0, Math.floor(horizonY * 0.45), w, Math.floor(horizonY * 0.35));
    ctx.fillStyle = "#68B0FF";
    ctx.fillRect(0, Math.floor(horizonY * 0.8), w, horizonY - Math.floor(horizonY * 0.8));

    // Línea de horizonte marino N64
    ctx.fillStyle = "#98D8FF";
    ctx.fillRect(0, horizonY - 2, w, 3);

    // Mar con mosaico en perspectiva de la textura 05mt001_DEF de la ROM
    ctx.fillStyle = "#176EC0";
    ctx.fillRect(0, horizonY, w, h - horizonY);

    const waterImg = loadedImages["05mt001_DEF"];
    if (waterImg && waterImg.complete && waterImg.naturalWidth) {
      // Mosaico con escala progresiva en profundidad para dar sensación 3D sobre el plano del mar
      const rows = 7;
      let curY = horizonY;
      for (let r = 0; r < rows; r++) {
        const frac = (r + 1) / rows;
        const rowH = Math.ceil(((h - horizonY) / rows) * (0.65 + frac * 0.7));
        const tileW = Math.round(36 + frac * 54);
        const shiftX = Math.floor(Math.sin(nowSec * 1.5 + r * 0.6) * (10 + frac * 14));
        for (let x = -tileW * 2; x < w + tileW * 2; x += tileW) {
          ctx.drawImage(waterImg, x + shiftX, curY, tileW, rowH + 1);
        }
        curY += rowH;
        if (curY >= h) break;
      }
    }
  }

  // Dibuja un anillo de espuma en la superficie del agua alrededor de cada tallo de hongo
  function drawWaterRipple3D(posX, waterY, posZ, nowSec, idx, basis) {
    const w = canvas.width;
    const h = canvas.height;
    const camPt = worldToCamera([posX, waterY, posZ], camera.pos, basis.right, basis.up, basis.forward);
    if (camPt[2] < 60) return;

    const sx = w * 0.5 + (camPt[0] / camPt[2]) * camera.fovScale;
    const sy = h * 0.52 - (camPt[1] / camPt[2]) * camera.fovScale;
    const pulse = 1 + 0.14 * Math.sin(nowSec * 3.5 + idx);
    const rx = Math.max(10, (115 / camPt[2]) * camera.fovScale * pulse);
    const ry = rx * 0.34;

    ctx.save();
    ctx.strokeStyle = "#B8ECFF";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * 1.32, ry * 1.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Dibuja la sombra circular N64 del personaje sobre la copa de su hongo
  function drawCharacterShadow3D(posX, capTopY, posZ, jumpOffset, basis) {
    const w = canvas.width;
    const h = canvas.height;
    const camPt = worldToCamera([posX, capTopY, posZ], camera.pos, basis.right, basis.up, basis.forward);
    if (camPt[2] < 60) return;

    const sx = w * 0.5 + (camPt[0] / camPt[2]) * camera.fovScale;
    const sy = h * 0.52 - (camPt[1] / camPt[2]) * camera.fovScale;
    const shrink = Math.max(0.45, 1 - jumpOffset / 95);
    const rx = Math.max(6, (44 / camPt[2]) * camera.fovScale * shrink);
    const ry = rx * 0.38;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 12, 0.45)";
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // =========================================================================
  // BUCLE PRINCIPAL DE RENDERIZADO 3D (60 FPS)
  // =========================================================================
  function renderLoop(timestamp) {
    const nowSec = timestamp * 0.001;
    const w = canvas.width;
    const h = canvas.height;

    const roster = (gameState && gameState.roster) || [
      { id: "mario", label: "MARIO", mushroomTex: "32mt001_DEF", color: "#D91C1C" },
      { id: "luigi", label: "LUIGI", mushroomTex: "32mt002_DEF", color: "#2838B8" },
      { id: "yoshi", label: "YOSHI", mushroomTex: "32mt004_DEF", color: "#50B820" },
      { id: "wario", label: "WARIO", mushroomTex: "32mt003_DEF", color: "#E2BD18" },
      { id: "dk", label: "D. KONG", mushroomTex: "32mt005_DEF", color: "#78B5E0" },
      { id: "peach", label: "PEACH", mushroomTex: "32mt006_DEF", color: "#DD5878" },
    ];

    const activeTeams =
      gameState && gameState.teams && gameState.teams.length > 0
        ? gameState.teams
        : roster.map((c, idx) => ({
            id: "slot_" + c.id,
            name: c.label,
            characterId: c.id,
            characterLabel: c.label,
            color: c.color,
            mushroomTex: c.mushroomTex,
            height: 0,
            answered: false,
            lastDelta: 0,
            isSlotPreview: true,
          }));

    // Distribución espacial en racimo / hexágono 3D inspirada en Mushroom Mix-Up de Mario Party
    const total = activeTeams.length;
    const slotCoords = [];
    for (let idx = 0; idx < total; idx++) {
      const centered = idx - (total - 1) / 2;
      const spreadX = Math.min(205, Math.max(135, 880 / Math.max(1, total)));
      const posX = centered * spreadX;
      // Alternar filas delantera y trasera en arco como los hongos de Mushroom Mix-Up
      const rowOffsetZ = idx % 2 === 0 ? 55 : -45;
      const archZ = Math.abs(centered) * 24;
      const posZ = rowOffsetZ + archZ;
      slotCoords.push([posX, posZ]);
    }

    // Calcular encuadre de cámara según el modo elegido
    let avgHeightUnits = 0;
    let maxHeightUnits = 0;
    let leaderIdx = 0;
    let maxTeamH = -999;

    activeTeams.forEach((t, idx) => {
      const hVal = Number(t.height || 0);
      avgHeightUnits += hVal;
      if (Math.abs(hVal) > maxHeightUnits) maxHeightUnits = Math.abs(hVal);
      if (hVal > maxTeamH) {
        maxTeamH = hVal;
        leaderIdx = idx;
      }
    });
    avgHeightUnits /= Math.max(1, total);

    let targetCamX = Math.sin(nowSec * 0.28) * 42;
    let targetCamY = 395 + avgHeightUnits * 34;
    let targetCamZ = 955 + Math.max(0, total - 5) * 85 + maxHeightUnits * 16;
    let targetLookX = 0;
    let targetLookY = 185 + avgHeightUnits * 34;

    if (cameraModeIdx === 1 && slotCoords[leaderIdx]) {
      // Enfoque al líder a mayor altura
      targetLookX = slotCoords[leaderIdx][0] * 0.65;
      targetLookY = 195 + maxTeamH * 38;
      targetCamX = slotCoords[leaderIdx][0] * 0.45 + Math.sin(nowSec * 0.5) * 30;
      targetCamY = 365 + maxTeamH * 38;
      targetCamZ = 760;
    } else if (cameraModeIdx === 2) {
      // Órbita Arcade N64
      targetCamX = Math.sin(nowSec * 0.55) * 260;
      targetCamZ = 890 + Math.cos(nowSec * 0.55) * 110;
    }

    camera.pos[0] += (targetCamX - camera.pos[0]) * 0.07;
    camera.pos[1] += (targetCamY - camera.pos[1]) * 0.07;
    camera.pos[2] += (targetCamZ - camera.pos[2]) * 0.07;
    camera.target[0] += (targetLookX - camera.target[0]) * 0.07;
    camera.target[1] += (targetLookY - camera.target[1]) * 0.07;

    const basis = buildCameraBasis(camera.pos, camera.target);
    drawSkyAndWater(nowSec);

    const worldPolys = [];
    const screenMarkers = [];

    if (n64Assets && n64Assets.stage) {
      // 1. Dibujar ondas/espuma en el nivel del mar alrededor de cada tallo de hongo
      activeTeams.forEach((_, idx) => {
        const [posX, posZ] = slotCoords[idx];
        drawWaterRipple3D(posX, 55, posZ, nowSec, idx, basis);
      });

      // 2. Construir geometría 3D de cada plataforma de hongo y su personaje
      activeTeams.forEach((team, idx) => {
        if (!platformAnim[team.id]) {
          platformAnim[team.id] = {
            currentHeight: team.height || 0,
            lastKnownHeight: team.height || 0,
            poseTimer: 0,
            pose: "idle",
          };
        }
        const anim = platformAnim[team.id];
        if (team.height !== anim.lastKnownHeight) {
          anim.pose = team.height > anim.lastKnownHeight ? "jump_up" : "drop_down";
          anim.poseTimer = 2.0;
          anim.lastKnownHeight = team.height;
        }
        anim.currentHeight += (team.height - anim.currentHeight) * 0.085;
        if (anim.poseTimer > 0) {
          anim.poseTimer = Math.max(0, anim.poseTimer - 0.016);
          if (anim.poseTimer === 0) anim.pose = "idle";
        }

        // Pose activa según fase de la partida
        let activePose = anim.pose;
        if (activePose === "idle") {
          if (gameState && gameState.phase === "FINISHED" && team.height === maxTeamH) {
            activePose = "victory";
          } else if (gameState && gameState.phase === "QUESTION_OPEN" && team.answered) {
            activePose = "ready";
          }
        }

        const [posX, posZ] = slotCoords[idx];
        const bobbing = Math.sin(nowSec * 2.3 + idx * 1.15) * 4.5;
        // Cada metro de altura (+1m / -1m) desplaza verticalmente el hongo 38 unidades N64
        const baseOffsetY = -250 + anim.currentHeight * 38 + bobbing;

        // Oscilación de impacto cuando el hongo baja o sube
        const tiltZ =
          activePose === "drop_down"
            ? Math.sin(nowSec * 20) * 7 * (anim.poseTimer / 2.0)
            : Math.sin(nowSec * 1.8 + idx) * 1.5;

        const capImg = loadedImages[team.mushroomTex] || loadedImages["32mt001_DEF"] || null;
        const capRgb = textureAvgColors[team.mushroomTex] || [215, 35, 35];

        const mushMatrix = mat4FromTRS(
          [posX, baseOffsetY, posZ],
          [0, nowSec * 10 + idx * 35, tiltZ],
          [0.62, 0.72, 0.62]
        );

        emitHbinmodePolys(worldPolys, n64Assets.stage.mushroomStem, mushMatrix, {
          stroke: true,
        });
        emitHbinmodePolys(worldPolys, n64Assets.stage.mushroomOuter, mushMatrix, {
          overrideCapImage: capImg,
          fallbackCapRgb: capRgb,
          stroke: true,
        });

        // Segmentos adicionales de tallo cuando la plataforma sube a gran altura
        if (anim.currentHeight > 0.4) {
          const extCount = Math.min(4, Math.ceil(anim.currentHeight / 3));
          for (let e = 1; e <= extCount; e++) {
            const extMatrix = mat4FromTRS(
              [posX, baseOffsetY - e * 185, posZ],
              [0, 0, 0],
              [0.46, 0.52, 0.46]
            );
            emitHbinmodePolys(worldPolys, n64Assets.stage.mushroomStem, extMatrix, {
              stroke: true,
            });
          }
        }

        // Personaje 3D N64 sobre la copa del hongo
        const charModel =
          n64Assets.characters[team.characterId] || n64Assets.characters["mario"];
        if (charModel) {
          const jumpHop =
            activePose === "jump_up" || activePose === "victory"
              ? Math.abs(Math.sin(nowSec * 9.5)) * 42
              : activePose === "ready"
              ? Math.abs(Math.sin(nowSec * 6)) * 12
              : activePose === "drop_down"
              ? -Math.abs(Math.sin(nowSec * 10)) * 8
              : Math.abs(Math.sin(nowSec * 2.8 + idx)) * 5;

          const capTopY = baseOffsetY + 356;
          const charY = capTopY + jumpHop;
          const spinY =
            activePose === "jump_up" || activePose === "victory"
              ? nowSec * 320
              : Math.sin(nowSec * 1.5 + idx) * 20;

          const charMatrix = mat4FromTRS(
            [posX, charY, posZ],
            [0, spinY, tiltZ * 1.4],
            [0.96, 0.96, 0.96]
          );

          emitHbinmodePolys(worldPolys, charModel, charMatrix, {
            animTime: nowSec,
            animPose: activePose,
            stroke: false,
          });

          screenMarkers.push({
            worldPos: [posX, charY + 115, posZ],
            shadowPos: [posX, capTopY + 2, posZ],
            jumpHop,
            team,
            pose: activePose,
            isLeader: !team.isSlotPreview && team.height === maxTeamH && total > 0,
          });
        }
      });
    }

    // Proyectar y ordenar todos los triángulos 3D por profundidad (Painter's Algorithm)
    const projectedTris = [];
    const lightDir = [0.34, 0.84, 0.42];

    for (const poly of worldPolys) {
      const c0 = worldToCamera(poly.v0.p, camera.pos, basis.right, basis.up, basis.forward);
      const c1 = worldToCamera(poly.v1.p, camera.pos, basis.right, basis.up, basis.forward);
      const c2 = worldToCamera(poly.v2.p, camera.pos, basis.right, basis.up, basis.forward);

      if (c0[2] < 40 || c1[2] < 40 || c2[2] < 40) continue;

      const s0x = w * 0.5 + (c0[0] / c0[2]) * camera.fovScale;
      const s0y = h * 0.52 - (c0[1] / c0[2]) * camera.fovScale;
      const s1x = w * 0.5 + (c1[0] / c1[2]) * camera.fovScale;
      const s1y = h * 0.52 - (c1[1] / c1[2]) * camera.fovScale;
      const s2x = w * 0.5 + (c2[0] / c2[2]) * camera.fovScale;
      const s2y = h * 0.52 - (c2[1] / c2[2]) * camera.fovScale;

      const nx = (poly.v0.n[0] + poly.v1.n[0] + poly.v2.n[0]) / 3;
      const ny = (poly.v0.n[1] + poly.v1.n[1] + poly.v2.n[1]) / 3;
      const nz = (poly.v0.n[2] + poly.v1.n[2] + poly.v2.n[2]) / 3;
      const ndotl = Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
      const intensity = 0.56 + 0.48 * ndotl;
      const shadeAlpha = Math.max(0, Math.min(0.42, (1 - intensity) * 0.75));

      const shadeHex = rgbToHex(
        poly.rgb[0] * intensity,
        poly.rgb[1] * intensity,
        poly.rgb[2] * intensity
      );

      projectedTris.push({
        depth: (c0[2] + c1[2] + c2[2]) / 3,
        x0: s0x, y0: s0y, u0: poly.v0.uv[0], v0: poly.v0.uv[1],
        x1: s1x, y1: s1y, u1: poly.v1.uv[0], v1: poly.v1.uv[1],
        x2: s2x, y2: s2y, u2: poly.v2.uv[0], v2: poly.v2.uv[1],
        shadeHex,
        shadeAlpha,
        texImg: poly.texImg,
        stroke: poly.stroke,
      });
    }

    projectedTris.sort((a, b) => b.depth - a.depth);

    for (const t of projectedTris) {
      if (t.texImg) {
        drawTexturedTriangle(
          ctx,
          t.texImg,
          t.x0, t.y0, t.u0, t.v0,
          t.x1, t.y1, t.u1, t.v1,
          t.x2, t.y2, t.u2, t.v2,
          t.shadeHex,
          t.shadeAlpha
        );
      } else {
        ctx.fillStyle = t.shadeHex;
        ctx.beginPath();
        ctx.moveTo(t.x0, t.y0);
        ctx.lineTo(t.x1, t.y1);
        ctx.lineTo(t.x2, t.y2);
        ctx.closePath();
        ctx.fill();
        if (t.stroke) {
          ctx.strokeStyle = "rgba(0,0,0,0.28)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Sombra circular bajo los pies de cada personaje sobre el hongo
    for (const m of screenMarkers) {
      drawCharacterShadow3D(m.shadowPos[0], m.shadowPos[1], m.shadowPos[2], m.jumpHop, basis);
    }

    // Carteles N64 flotantes sobre cada equipo (nombre, altura en metros y expresión/estado)
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textAlign = "center";

    for (const m of screenMarkers) {
      const camPt = worldToCamera(m.worldPos, camera.pos, basis.right, basis.up, basis.forward);
      if (camPt[2] < 50) continue;
      const sx = Math.round(w * 0.5 + (camPt[0] / camPt[2]) * camera.fovScale);
      const sy = Math.round(h * 0.52 - (camPt[1] / camPt[2]) * camera.fovScale);

      const crown = m.isLeader && m.team.height > 0 ? "★ " : "";
      const label = `${crown}${m.team.name}`;
      const heightStr = `${m.team.height >= 0 ? "+" : ""}${m.team.height}m`;
      const boxW = Math.max(82, label.length * 7 + 18);

      // Marco negro N64
      ctx.fillStyle = "#000000";
      ctx.fillRect(sx - boxW / 2 - 2, sy - 27, boxW + 4, 29);
      ctx.fillStyle = m.team.color || "#D82020";
      ctx.fillRect(sx - boxW / 2, sy - 25, boxW, 13);
      ctx.fillStyle = "#081238";
      ctx.fillRect(sx - boxW / 2, sy - 12, boxW, 12);

      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, sx, sy - 15);

      let statusTag = `ALT: ${heightStr}`;
      if (gameState && gameState.phase === "QUESTION_OPEN") {
        statusTag += m.team.answered ? " [LISTO!]" : " [...]";
      } else if (gameState && gameState.phase === "QUESTION_REVEALED") {
        if (m.team.lastDelta > 0) statusTag += " [↑+1m]";
        else if (m.team.lastDelta < 0) statusTag += " [↓-1m]";
      }
      ctx.fillStyle =
        m.team.lastDelta > 0
          ? "#50F850"
          : m.team.lastDelta < 0
          ? "#FF7878"
          : "#F8E020";
      ctx.fillText(statusTag, sx, sy - 2);
    }

    // Actualizar reloj de cuenta regresiva en cliente a 60fps
    updateClientCountdown();

    requestAnimationFrame(renderLoop);
  }

  // =========================================================================
  // SINCRONIZACIÓN DE HUD, CUENTA REGRESIVA Y PODIO FINAL
  // =========================================================================
  let clientTimerEndsAt = null;
  let lastSeenPhase = null;
  let lastSeenRoundSeq = -1;

  function updateClientCountdown() {
    const timerBox = document.getElementById("timer-box");
    const timerSecEl = document.getElementById("timer-seconds");
    if (!timerBox || !timerSecEl) return;

    if (!gameState || gameState.phase !== "QUESTION_OPEN" || !clientTimerEndsAt) {
      timerSecEl.textContent = "--s";
      timerBox.classList.remove("urgent");
      return;
    }

    const rem = Math.max(0, Math.ceil((clientTimerEndsAt - Date.now()) / 1000));
    timerSecEl.textContent = `${String(rem).padStart(2, "0")}s`;

    if (rem <= 5 && rem > 0) {
      timerBox.classList.add("urgent");
      if (lastCountdownBeepSec !== rem) {
        lastCountdownBeepSec = rem;
        playN64Sfx("TICK");
      }
    } else {
      timerBox.classList.remove("urgent");
    }
  }

  function renderProgressBlocks(currentIdx, total, phase) {
    const container = document.getElementById("progress-blocks");
    if (!container) return;
    let html = "";
    for (let i = 0; i < total; i++) {
      let cls = "q-dot";
      if (i < currentIdx || phase === "FINISHED") cls += " done";
      else if (i === currentIdx && phase !== "LOBBY") cls += " current";
      html += `<div class="${cls}" title="Pregunta ${i + 1}"></div>`;
    }
    container.innerHTML = html;
  }

  function renderPodium(state) {
    const overlay = document.getElementById("podium-overlay");
    const winnerText = document.getElementById("podium-winner-text");
    const barsEl = document.getElementById("podium-bars");
    if (!overlay || !winnerText || !barsEl) return;

    if (state.phase !== "FINISHED") {
      overlay.classList.remove("visible");
      return;
    }

    const winners = state.winners || [];
    winnerText.textContent =
      winners.length > 0
        ? `★ MAYOR ALTURA: ${winners.map((w) => `${w.name} (${w.height >= 0 ? "+" : ""}${w.height}m)`).join(" & ")} ★`
        : "PARTIDA COMPLETADA";

    const top3 = (state.leaderboard || []).slice(0, 3);
    const heightsPx = [138, 104, 82];
    const medals = ["1° LUGAR", "2° LUGAR", "3° LUGAR"];

    if (top3.length === 0) {
      barsEl.innerHTML = `<div style="color:#FFF8DC; font-size:14px;">SIN EQUIPOS REGISTRADOS</div>`;
    } else {
      barsEl.innerHTML = top3
        .map((t, i) => {
          const sign = t.height >= 0 ? "+" : "";
          return `
            <div class="podium-col">
              <div class="n64-text-outline" style="font-size:14px; color:#F8E020; margin-bottom:4px;">
                ${escapeHtml(t.name)}
              </div>
              <div style="font-size:11px; color:#A8C8FF; margin-bottom:6px;">
                ${t.characterLabel} (${t.correctCount}/10 ACIERTOS)
              </div>
              <div class="podium-block" style="height:${heightsPx[i] || 80}px; background-color:${t.color};">
                <div class="n64-text-outline" style="font-size:16px; color:#FFFFFF;">${medals[i]}</div>
                <div class="n64-text-outline" style="font-size:20px; color:#F8E020; margin-top:4px;">${sign}${t.height}m</div>
              </div>
            </div>
          `;
        })
        .join("");
    }

    overlay.classList.add("visible");
  }

  let podiumRendered = false;
  function escapeHtml(s) {return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function updateHud(state) {
    if (!state) return;
    gameState = state;

    // Sincronizar temporizador con reloj local del navegador
    if (state.timerEndsAt && state.serverNow) {
      const skew = Date.now() - state.serverNow;
      clientTimerEndsAt = state.timerEndsAt + skew;
    } else {
      clientTimerEndsAt = null;
    }

    // Reproducir SFX sincronizados del servidor
    if (typeof state.sfxSeq === "number" && state.sfxSeq !== lastPlayedSfxSeq) {
      if (lastPlayedSfxSeq !== -1 && state.sfxCue && state.sfxCue !== "NONE") {
        playN64Sfx(state.sfxCue);
      }
      lastPlayedSfxSeq = state.sfxSeq;
    }

    // Disparar cartel de transición arcade N64 en cambios de ronda o fase
    if (state.phase !== lastSeenPhase || state.roundSeq !== lastSeenRoundSeq) {
      if (state.phase === "QUESTION_OPEN") {
        showArcadeBanner(
          state.questionNumber === 1 ? "START!" : `PREGUNTA ${state.questionNumber}`,
          `RONDA ${state.questionNumber} DE ${state.totalQuestions} — ¡RESPONDAN!`,
          1650
        );
      } else if (state.phase === "QUESTION_REVEALED" && state.currentQuestion) {
        showArcadeBanner(
          `CLAVE: [${state.currentQuestion.correctOption}]`,
          state.lastEventBanner,
          1750
        );
      } else if (state.phase === "FINISHED") {
        showArcadeBanner("FINISH!", "¡FIN DE LAS 10 PREGUNTAS!", 2100);
      }
      lastSeenPhase = state.phase;
      lastSeenRoundSeq = state.roundSeq;
    }

    const qCounter = document.getElementById("question-counter");
    const phasePill = document.getElementById("phase-pill");
    const qPrompt = document.getElementById("question-prompt");
    const banner = document.getElementById("event-banner");
    const joinUrlText = document.getElementById("join-url-text");
    const answeredCounter = document.getElementById("answered-counter");

    if (joinUrlText && state.joinUrl) {
      joinUrlText.textContent = state.joinUrl;
    }
    if (banner && state.lastEventBanner) {
      banner.textContent = state.lastEventBanner;
    }

    renderProgressBlocks(state.currentQuestionIndex || 0, state.totalQuestions || 10, state.phase);

    const totalTeams = (state.teams || []).length;
    const readyTeams = (state.teams || []).filter((t) => t.answered).length;
    if (answeredCounter) {
      answeredCounter.textContent = `${readyTeams}/${totalTeams} LISTOS`;
    }

    const q = state.currentQuestion;
    if (!q) {
      qPrompt.textContent = state.bankReady ? "ESPERANDO QUE EL ANFITRIÓN INICIE LA PARTIDA..." : "BANCO DE PREGUNTAS PENDIENTE";
      for (const key of ["A","B","C","D"]) { document.getElementById(`opt-text-${key}`).textContent="";document.getElementById(`hud-opt-${key}`).classList.remove("correct-highlight","wrong-dim"); }
    }
    if (q) {
      qCounter.textContent = q.code || `PREGUNTA ${state.questionNumber} / ${state.totalQuestions}`;
      qPrompt.textContent = q.prompt;

      for (const opt of q.options || []) {
        const elText = document.getElementById(`opt-text-${opt.key}`);
        const elBox = document.getElementById(`hud-opt-${opt.key}`);
        if (elText) elText.textContent = opt.label;
        if (elBox) {
          const isRevealed =
            state.phase === "QUESTION_REVEALED" || state.phase === "FINISHED";
          if (isRevealed && q.correctOption === opt.key) {
            elBox.classList.add("correct-highlight");
            elBox.classList.remove("wrong-dim");
          } else if (isRevealed) {
            elBox.classList.remove("correct-highlight");
            elBox.classList.add("wrong-dim");
          } else {
            elBox.classList.remove("correct-highlight", "wrong-dim");
          }
        }
      }
    }

    if (state.phase === "LOBBY") {
      phasePill.textContent = "SALA DE ESPERA";
      phasePill.style.backgroundColor = "#2050D8";
    } else if (state.phase === "QUESTION_OPEN") {
      phasePill.textContent = "RESPONDIENDO";
      phasePill.style.backgroundColor = "#20A828";
    } else if (state.phase === "QUESTION_REVEALED") {
      phasePill.textContent = `CLAVE: [${q ? q.correctOption : "A"}]`;
      phasePill.style.backgroundColor = "#E8B810";
    } else if (state.phase === "FINISHED") {
      phasePill.textContent = "PARTIDA FINALIZADA";
      phasePill.style.backgroundColor = "#D82020";
    }

    // Actualizar Leaderboard de Alturas
    const lbList = document.getElementById("leaderboard-list");
    if (lbList) {
      if (!state.leaderboard || state.leaderboard.length === 0) {
        lbList.innerHTML = `
          <li class="team-row">
            <span>ESPERANDO EQUIPOS...</span>
            <span class="team-height-tag">0m</span>
          </li>`;
      } else {
        lbList.innerHTML = state.leaderboard
          .map((t, idx) => {
            const sign = t.height >= 0 ? "+" : "";
            let statusHtml = "";
            if (state.phase === "QUESTION_OPEN") {
              statusHtml = t.answered
                ? `<span class="delta-up">[LISTO]</span>`
                : `<span style="color:#A8C8FF;">[...]</span>`;
            } else if (state.phase === "QUESTION_REVEALED") {
              if (t.lastDelta > 0) statusHtml = `<span class="delta-up">↑+1m</span>`;
              else if (t.lastDelta < 0) statusHtml = `<span class="delta-down">↓-1m</span>`;
            }
            return `
              <li class="team-row ${idx === 0 && t.height > 0 ? "leader-row" : ""}">
                <span>
                  <span class="team-swatch" style="background-color:${t.color};"></span>
                  #${t.rank} ${escapeHtml(t.name)} <small style="color:#A8C8FF;">(${t.characterLabel})</small> ${statusHtml}
                </span>
                <span class="team-height-tag">${sign}${t.height}m</span>
              </li>`;
          })
          .join("");
      }
    }

    if (state.phase !== "FINISHED" || !podiumRendered) renderPodium(state);
    podiumRendered = state.phase === "FINISHED";
  }

  const roomKey = "ciacparty-room-v2";
  let room = localStorage.getItem(roomKey) || crypto.randomUUID();
  let hostKey = localStorage.getItem(roomKey+"-host") || crypto.randomUUID()+crypto.randomUUID();
  localStorage.setItem(roomKey,room);
  localStorage.setItem(roomKey+"-host",hostKey);
  const roomApi = path => path + "?room=" + encodeURIComponent(room);
  let sessionReady;
  function authenticate() {
    if (!sessionReady) sessionReady = fetch(roomApi("/api/host/session"), {method:"POST",headers:{"Content-Type":"application/json","X-Host-Key":hostKey},body:"{}"}).then(r=>{if(!r.ok)throw Error("No se pudo abrir la sala.");return true;}).catch(err=>{sessionReady=null;throw err;});
    return sessionReady;
  }
  document.getElementById("qr-img").src=roomApi("/api/qr.svg");
  document.querySelector('a[href="/play"]').href=roomApi("/play");
  async function hostAction(payload) {
    ensureAudio();
    try {
      if (!await authenticate()) return false;
      const res = await fetch(roomApi("/api/host/action"), {method:"POST",headers:{"Content-Type":"application/json","X-Host-Key":hostKey},body:JSON.stringify(payload)});
      const st = await res.json();
      if (!res.ok) {alert(st.error || "Acción rechazada");return false;}
      updateHud(st);return true;
    } catch (err) {alert("Error de conexión.");return false;}
  }
  document.getElementById("btn-start").addEventListener("click",()=>hostAction({action:"START_GAME"}));
  document.getElementById("btn-reveal").addEventListener("click",()=>hostAction({action:"REVEAL_AND_MOVE"}));
  document.getElementById("btn-next").addEventListener("click",()=>hostAction({action:"NEXT_QUESTION"}));

  document.getElementById("btn-reset").addEventListener("click", () => {
    hostAction({ action: "RESET_HEIGHTS" });
  });

  document.getElementById("btn-audio").addEventListener("click", (e) => {
    sfxEnabled = !sfxEnabled;
    if (sfxEnabled) ensureAudio();
    e.target.textContent = sfxEnabled ? "SFX: ON" : "SFX: OFF";
  });

  document.getElementById("btn-cam-mode").addEventListener("click", (e) => {
    cameraModeIdx = (cameraModeIdx + 1) % CAMERA_MODES.length;
    e.target.textContent = `CÁMARA: ${CAMERA_MODES[cameraModeIdx]}`;
  });

  document.getElementById("btn-close-podium").addEventListener("click", () => {
    document.getElementById("podium-overlay").classList.remove("visible");
  });

  document.getElementById("btn-toggle-qr").addEventListener("click", (e) => {
    const qrBox = document.getElementById("qr-box");
    const hidden = qrBox.style.display === "none";
    qrBox.style.display = hidden ? "block" : "none";
    e.target.textContent = hidden ? "OCULTAR" : "MOSTRAR QR";
  });

  // Inicialización con soporte dual: API de servidor Node.js o bundle estático para Cloudflare Pages
  async function init() {
    try {
      await authenticate();
      const assetsRes = await fetch("/assets/n64_assets.json");
      n64Assets = await assetsRes.json();
      preloadAssetImages(n64Assets);

      const stateRes = await fetch(roomApi("/api/state")).catch(() => null);
      if (stateRes && stateRes.ok) {
        updateHud(await stateRes.json());
      }
    } catch (err) {
      console.error("Error inicializando assets N64:", err);
    }

    async function poll() {
      try {const r=await fetch(roomApi("/api/state"),{cache:"no-store"});if(r.ok)updateHud(await r.json());} catch(_){}
      setTimeout(poll,1000);
    }
    poll();

    requestAnimationFrame(renderLoop);
  }

  init();
})();
