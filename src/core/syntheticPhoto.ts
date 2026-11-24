// 合成海上测帆照片:Canvas 2D 渲染带透视、反光、面料纹理的帆面,
// 并在撑条高度预置测量条带与前缘/最深点/后缘标记,直接可用于比对流程。
import { camberZ, measureSection } from './sailModel';
import { mulberry32 } from './mathUtils';
import type { PhotoBand, PhotoRecord, Point2, SailProfile } from './types';
import type { RigConfig } from './types';
import { uid } from './photoMeasure';

export interface SyntheticPhotoOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** 拍摄风速 0..1,决定用哪个形态作画 */
  k?: number;
  /** 透视倾角(度) */
  perspectiveDeg?: number;
}

interface Project {
  project: (s: number, h: number, zNorm: number) => Point2;
  bands: PhotoBand[];
}

/**
 * 透视投影:帆的归一化 (s,h) 坐标 + 归一化鼓包深度 → 图像像素。
 * 同时返回每条撑条高度的条带四角与三个标记点(用同一套投影,保证反算可还原)。
 */
function buildProjection(
  profile: SailProfile,
  rig: RigConfig,
  width: number,
  height: number,
  perspectiveDeg: number,
  k: number,
): Project {
  const tilt = Math.tan((perspectiveDeg * Math.PI) / 180);
  const marginX = width * 0.16;
  const marginY = height * 0.09;
  const sailH = height - marginY * 2;
  const topW = width * 0.26;
  const botW = width - marginX * 2;

  // 四角:帆顶窄、下缘宽,整体带水平透视偏移
  const corners = {
    lb: { x: marginX, y: height - marginY },
    rb: { x: marginX + botW, y: height - marginY - sailH * tilt * 0.15 },
    lt: { x: marginX + (botW - topW) * 0.32, y: marginY },
    rt: { x: marginX + (botW - topW) * 0.32 + topW, y: marginY + sailH * tilt * 0.1 },
  };

  function project(s: number, h: number, zNorm: number): Point2 {
    // 双线性插值出该高度的前后缘
    const lx = corners.lb.x + (corners.lt.x - corners.lb.x) * h;
    const leadY = corners.lb.y + (corners.lt.y - corners.lb.y) * h;
    const rx = corners.rb.x + (corners.rt.x - corners.rb.x) * h;
    const ry = corners.rb.y + (corners.rt.y - corners.rb.y) * h;
    let x = lx + (rx - lx) * s;
    let y = leadY + (ry - leadY) * s;
    // 鼓包法向(图像中近似沿 y 轴负方向):像素深度 = 归一深度 × 该高度弦像素长,
    // 与 measureBand 的弦高比定义严格同量纲,保证反算可还原。
    // 不做高度方向衰减,使每个高度的测量标记都能还原真实弦高比。
    const chordPx = Math.hypot(rx - lx, ry - leadY);
    // 深度严格沿弦线法向(图像 y 方向),不含弦向分量,保证垂直距离即弦高比×弦长
    y -= zNorm * chordPx;
    // 透视让后缘轻微上抬
    y -= tilt * s * sailH * 0.06 * (1 - h);
    return { x, y };
  }

  const bands: PhotoBand[] = profile.battens.map((batten, idx) => {
    const h = batten.heightRatio;
    const hUp = Math.min(0.985, h + 0.018);
    const hDn = Math.max(0.015, h - 0.018);
    const quad = [
      project(0, hDn, 0),
      project(1, hDn, 0),
      project(1, hUp, 0),
      project(0, hUp, 0),
    ];
    const m = measureSection(profile, rig, h, k, true, 160);
    const leading = project(0, h, 0);
    const trailing = project(1, h, 0);
    // 手点最深点:投影第三参是归一化鼓包深度,最深点处即弦高比本身;
    // 叠一个像素的人工点选误差
    const jitter = (idx % 3) - 1;
    const deepest = project(m.maxDraftPos, h, m.camber);
    deepest.y += jitter * 1.2;
    return {
      id: uid('band'),
      heightRatio: h,
      quad,
      leading,
      deepest,
      trailing,
    };
  });

  return { project, bands };
}

export function generateSyntheticPhoto(
  profile: SailProfile,
  rig: RigConfig,
  opts: SyntheticPhotoOptions = {},
): PhotoRecord {
  const width = opts.width ?? 900;
  const height = opts.height ?? 1200;
  const seed = opts.seed ?? 42;
  const k = opts.k ?? 0.5;
  const perspectiveDeg = opts.perspectiveDeg ?? 14;
  const rand = mulberry32(seed);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const { project, bands } = buildProjection(profile, rig, width, height, perspectiveDeg, k);

  // 背景:海面渐变 + 天光
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#9fc4dd');
  sky.addColorStop(0.55, '#dfe9ee');
  sky.addColorStop(0.56, '#5d8fa6');
  sky.addColorStop(1, '#27505f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  // 海面波光
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 60; i++) {
    const y = height * 0.56 + rand() * height * 0.42;
    const x = rand() * width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 + rand() * 60, y + rand() * 2);
    ctx.stroke();
  }

  // 帆面逐列填色,按鼓包深度做明暗
  const cols = 46;
  const rows = 60;
  for (let c = 0; c < cols; c++) {
    const s0 = c / cols;
    const s1 = (c + 1) / cols;
    ctx.beginPath();
    for (let r = 0; r <= rows; r++) {
      const h = r / rows;
      const m = measureSection(profile, rig, h, k, true, 60);
      const z = camberZ(s0, m.maxDraftPos, m.camber);
      const p = project(s0, h, z);
      if (r === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let r = rows; r >= 0; r--) {
      const h = r / rows;
      const m = measureSection(profile, rig, h, k, true, 60);
      const z = camberZ(s1, m.maxDraftPos, m.camber);
      ctx.lineTo(project(s1, h, z).x, project(s1, h, z).y);
    }
    ctx.closePath();
    const light = 150 + 70 * Math.sin(Math.PI * (s0 + s1) / 2) + rand() * 10;
    // 按该列中段所在拼块面料给基调:X-ply 偏冷暗、平纹布偏暖、单丝膜最亮
    const midH = 0.5;
    const patch = profile.patches.find((pp) => midH >= pp.h0 && midH <= pp.h1);
    const fabricTint: Record<string, [number, number, number]> = {
      monofilm: [0.82, 0.9, 215],
      xply: [0.7, 0.78, 195],
      plain: [0.85, 0.82, 178],
    };
    const [fr, fg, fb] = fabricTint[patch?.fabric ?? 'monofilm'];
    const tint = fb + Math.floor(rand() * 14);
    ctx.fillStyle = `rgb(${Math.floor(light * fr)},${Math.floor(light * fg)},${tint})`;
    ctx.fill();
  }

  // 面料纹理:单丝膜高光、X-ply 交叉网格、平纹布经纬线
  ctx.lineWidth = 1;
  for (let c = 1; c < cols; c++) {
    const s = c / cols;
    ctx.strokeStyle =
      s < 0.72 ? 'rgba(255,255,255,0.10)' : 'rgba(40,60,80,0.28)';
    ctx.beginPath();
    for (let r = 0; r <= rows; r += 2) {
      const h = r / rows;
      const m = measureSection(profile, rig, h, k, true, 40);
      const p = project(s, h, camberZ(s, m.maxDraftPos, m.camber));
      if (r === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  // X-ply 斜纹(帆顶区域)
  ctx.strokeStyle = 'rgba(35,55,75,0.35)';
  for (let d = -8; d <= 8; d++) {
    ctx.beginPath();
    let started = false;
    for (let r = 0; r <= rows; r++) {
      const h = 0.72 + (0.28 * r) / rows;
      const s = 0.12 + d * 0.1 + (h - 0.72) * 1.4;
      if (s <= 0 || s >= 1) {
        started = false;
        continue;
      }
      const m = measureSection(profile, rig, h, k, true, 30);
      const p = project(s, h, camberZ(s, m.maxDraftPos, m.camber));
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // 撑条套:半透明深色横带,逆光下透出
  for (const b of profile.battens) {
    const h = b.heightRatio;
    const p0 = project(0, h, 0);
    const p1 = project(1, h, 0);
    ctx.strokeStyle = 'rgba(25,40,55,0.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y - 3);
    ctx.lineTo(p1.x, p1.y - 3);
    ctx.stroke();
  }

  // 缝线:沿拼块边界
  for (const patch of profile.patches) {
    const h = patch.h1;
    if (h >= 1) continue;
    ctx.strokeStyle = 'rgba(30,45,60,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let c = 0; c <= 30; c++) {
      const s = c / 30;
      const m = measureSection(profile, rig, h, k, true, 30);
      const p = project(s, h, camberZ(s, m.maxDraftPos, m.camber));
      if (c === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 桅杆与桅套
  const mastTop = project(0, 1, 0);
  const mastBot = project(0, 0, 0);
  ctx.strokeStyle = '#2c3e50';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(mastBot.x, mastBot.y);
  ctx.lineTo(mastTop.x, mastTop.y);
  ctx.stroke();

  // 反光斑与暗角
  const glare = ctx.createRadialGradient(
    width * (0.62 + rand() * 0.1),
    height * 0.35,
    10,
    width * 0.62,
    height * 0.35,
    width * 0.55,
  );
  glare.addColorStop(0, 'rgba(255,255,255,0.28)');
  glare.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, width, height);
  const vig = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);

  // 颗粒噪声
  const img = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  return {
    id: uid('photo'),
    sailId: profile.id,
    name: `合成测帆照片 k=${k.toFixed(2)}`,
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    width,
    height,
    bands,
    createdAt: Date.now(),
  };
}
