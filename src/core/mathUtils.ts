// 通用数学工具:全部纯函数,确定性,无随机源
export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** 经典 smoothstep,t∈[0,1],端点导数为 0 */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * 紧支撑光滑窗:中心 center、半宽 half。
 * 窗外严格返回 0(不是近似),窗内 C1 光滑,中心点为 1。
 * 这是晶格局部编辑“影响范围外位移严格为 0”的数学保证。
 */
export function bumpWindow(value: number, center: number, half: number): number {
  if (half <= 0) return 0;
  const u = Math.abs(value - center) / half;
  if (u >= 1) return 0;
  return 1 - smoothstep(u);
}

/** 单调排序列表上的 smoothstep 插值,越界钳到端点 */
export function interpKnots(knots: { t: number; v: number }[], t: number): number {
  if (knots.length === 0) return 0;
  if (t <= knots[0].t) return knots[0].v;
  const last = knots[knots.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      return lerp(a.v, b.v, smoothstep(u));
    }
  }
  return last.v;
}

/** 确定性伪随机(照片合成用),同一 seed 永远同一结果 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 解 8 元线性方程组(单应矩阵用),Gauss-Jordan 消元带主元选取 */
export function solveLinear8(A: number[][], b: number[]): number[] {
  const n = 8;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('奇异矩阵,无法求解单应变换');
    [m[col], m[piv]] = [m[piv], m[col]];
    const pivotVal = m[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / pivotVal;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  // Gauss-Jordan 消元后每行只有一个非零系数(主元),定位它再回除
  const result = new Array<number>(n);
  for (let r = 0; r < n; r++) {
    let pivotCol = -1;
    for (let c = 0; c < n; c++) {
      if (Math.abs(m[r][c]) > 1e-12) {
        pivotCol = c;
        break;
      }
    }
    if (pivotCol < 0) throw new Error('奇异矩阵,无法求解单应变换');
    result[pivotCol] = m[r][n] / m[r][pivotCol];
  }
  return result;
}
