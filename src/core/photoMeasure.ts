// 测帆照片几何:条带单应变换 + 手点标记反算弦高比
import { solveLinear8 } from './mathUtils';
import type { PhotoBand, Point2 } from './types';

export interface Mat3 {
  m: number[]; // 行优先 9 个数
}

/** 由 4 对点求单应矩阵:src 单位方点 → dst 图像像素点 */
export function homographyFromQuad(dst: Point2[]): Mat3 {
  const src = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    // X = (h1 x + h2 y + h3 - h7 X x - h8 X y),隐式齐次分母常数项为 1
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinear8(A, b);
  return { m: [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] };
}

export function applyH(H: Mat3, p: Point2): Point2 {
  const m = H.m;
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / w,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / w,
  };
}

export function invertH(H: Mat3): Mat3 {
  const m = H.m;
  const minor = (r: number, c: number): number => {
    const xs = [0, 1, 2].filter((v) => v !== r);
    const ys = [0, 1, 2].filter((v) => v !== c);
    return (
      m[xs[0] * 3 + ys[0]] * m[xs[1] * 3 + ys[1]] -
      m[xs[0] * 3 + ys[1]] * m[xs[1] * 3 + ys[0]]
    );
  };
  const adj = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      // 伴随矩阵 = 余子式矩阵的转置,带符号 (-1)^(r+c)
      adj[c * 3 + r] = ((r + c) % 2 === 0 ? 1 : -1) * minor(r, c);
    }
  }
  let det = 0;
  for (let c = 0; c < 3; c++) det += m[c] * adj[c * 3];
  return { m: adj.map((v) => v / det) };
}

export interface BandMeasurement {
  camber: number;
  draftPos: number;
  chordPx: number;
  depthPx: number;
  insideQuad: boolean;
}

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 由手点的前缘/最深点/后缘反算:
 * 弦高比 = 最深点到弦线的垂距 / 弦长;最深点位置 = 垂足到前缘距离 / 弦长。
 * 纯像素几何,与拍摄距离无关。
 */
export function measureBand(band: PhotoBand): BandMeasurement {
  const { leading: L, deepest: D, trailing: T } = band;
  const chord = dist(L, T);
  const vx = (T.x - L.x) / chord;
  const vy = (T.y - L.y) / chord;
  const along = (D.x - L.x) * vx + (D.y - L.y) * vy;
  const perp = Math.abs((D.x - L.x) * vy - (D.y - L.y) * vx);
  const draftPos = Math.min(1, Math.max(0, along / chord));
  const camber = chord > 1e-6 ? perp / chord : 0;

  const Hinv = invertH(homographyFromQuad(band.quad));
  const n = applyH(Hinv, D);
  const insideQuad = n.x >= -0.05 && n.x <= 1.05 && n.y >= -0.05 && n.y <= 1.05;

  return { camber, draftPos, chordPx: chord, depthPx: perp, insideQuad };
}

/** 把归一化截面曲线(s∈[0,1], 深度按 camber 归一)映射到条带像素坐标,供叠加显示 */
export function sectionToBandPixels(
  band: PhotoBand,
  curve: { s: number; z: number }[],
  camber: number,
): Point2[] {
  const H = homographyFromQuad(band.quad);
  return curve.map((c) => applyH(H, { x: c.s, y: 0.5 - c.z * camber }));
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
