import { describe, expect, it } from 'vitest';
import { applyH, homographyFromQuad, invertH, measureBand } from '../photoMeasure';
import type { PhotoBand } from '../types';
import { uid } from '../photoMeasure';

function band(camber: number, draft: number): PhotoBand {
  // 条带取近似正方形像素框,局部坐标的 x、y 方向像素尺度一致,
  // 最深点法向偏移 camber(局部单位)= 弦长的 camber 倍,弦高比即 camber。
  const quad = [
    { x: 100, y: 500 },
    { x: 700, y: 490 },
    { x: 705, y: 1090 },
    { x: 95, y: 1100 },
  ];
  const H = homographyFromQuad(quad);
  const leading = applyH(H, { x: 0, y: 0.5 });
  const trailing = applyH(H, { x: 1, y: 0.5 });
  const deepest = applyH(H, { x: draft, y: 0.5 - camber });
  return { id: uid('b'), heightRatio: 0.5, quad, leading, deepest, trailing };
}

describe('照片单应与反算', () => {
  it('单应矩阵往返还原坐标', () => {
    const dst = [
      { x: 12, y: 34 },
      { x: 560, y: 20 },
      { x: 610, y: 700 },
      { x: 8, y: 760 },
    ];
    const H = homographyFromQuad(dst);
    const Hinv = invertH(H);
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.37, y: 0.62 }]) {
      const img = applyH(H, p);
      const back = applyH(Hinv, img);
      expect(Math.abs(back.x - p.x)).toBeLessThan(1e-9);
      expect(Math.abs(back.y - p.y)).toBeLessThan(1e-9);
    }
  });

  it.each([0.06, 0.09, 0.12])('弦高比 %s 反算误差 < 0.2 个百分点', (camber) => {
    const b = band(camber, 0.42);
    const m = measureBand(b);
    expect(Math.abs(m.camber - camber) * 100).toBeLessThan(0.2);
    expect(Math.abs(m.draftPos - 0.42)).toBeLessThan(0.01);
    expect(m.insideQuad).toBe(true);
  });
});
