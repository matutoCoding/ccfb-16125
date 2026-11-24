import { describe, expect, it } from 'vitest';
import {
  basePosition,
  battenBays,
  camberZ,
  effectiveCamber,
  latticeDisplacementLocal,
  measureSection,
  renderPosition,
} from '../sailModel';
import { buildSeedSail, SEED_SAILS } from '../seedData';
import type { SailProfile } from '../types';

function seedSail(index: number): SailProfile {
  return buildSeedSail(SEED_SAILS[index], index);
}

const RIG = { mastStiffness: 19, mastCurve: 'constant' as const, downhaulCm: 6, outhaulCm: 3 };

describe('验收1: 晶格局部编辑,影响范围外位移严格为 0', () => {
  for (let idx = 0; idx < 3; idx++) {
    it(`${SEED_SAILS[idx].name}: 单点拖动只影响所属撑条区间与弦向窗内`, () => {
      const sail = seedSail(idx);
      const bays = battenBays(sail);
      const targetBay = Math.min(1, bays.length - 1);
      const bay = bays[targetBay];
      const point = sail.lattice.points.find(
        (p) => p.bayIndex === targetBay && Math.abs(p.s - 0.5) < 1e-6,
      )!;
      point.dz = 8; // 拖 8cm
      point.dx = 2;

      // 区间外:所有采样点位移必须严格等于 0
      const outsideHs = [0, bay.h0 - 0.001, bay.h1 + 0.001, 0.5, 1].filter(
        (h) => h <= bay.h0 || h >= bay.h1,
      );
      for (const h of outsideHs) {
        for (let j = 0; j <= 20; j++) {
          const s = j / 20;
          const d = latticeDisplacementLocal(sail, Math.min(1, Math.max(0, h)), s);
          expect(d.dx).toBe(0);
          expect(d.dz).toBe(0);
        }
      }

      // 区间边界(撑条线)上也必须严格为 0,保证撑条光顺
      for (const h of [bay.h0, bay.h1]) {
        for (let j = 0; j <= 20; j++) {
          const d = latticeDisplacementLocal(sail, h, j / 20);
          expect(d.dx).toBe(0);
          expect(d.dz).toBe(0);
        }
      }

      // 弦向窗外严格为 0
      const midH = (bay.h0 + bay.h1) / 2;
      const farS = point.s > 0.5 ? 0.02 : 0.98;
      const dFar = latticeDisplacementLocal(sail, midH, farS);
      expect(dFar.dz).toBe(0);

      // 窗内确实产生了非零位移
      const dIn = latticeDisplacementLocal(sail, midH, point.s);
      expect(dIn.dz).toBeGreaterThan(0);

      // 实际帆面顶点:区间外与无晶格基准完全一致
      for (const h of [0, bay.h0, bay.h1, 1]) {
        for (let j = 0; j <= 10; j++) {
          const s = j / 10;
          const withLattice = basePosition(sail, RIG, h, s, { k: 0.5, includeLattice: true });
          const noLattice = basePosition(sail, RIG, h, s, { k: 0.5, includeLattice: false });
          expect(withLattice.x).toBe(noLattice.x);
          expect(withLattice.z).toBe(noLattice.z);
        }
      }
    });
  }

  it('所有晶格点位移为 0 时,整张帆与无晶格完全相同', () => {
    const sail = seedSail(0);
    for (const p of sail.lattice.points) {
      p.dz = 0;
      p.dx = 0;
    }
    for (let i = 0; i <= 12; i++) {
      const h = i / 12;
      for (let j = 0; j <= 12; j++) {
        const s = j / 12;
        const a = basePosition(sail, RIG, h, s, { k: 0.5, includeLattice: true });
        const b = basePosition(sail, RIG, h, s, { k: 0.5, includeLattice: false });
        expect(a).toEqual(b);
      }
    }
  });
});

describe('验收2: 风速 0→满→0 帆面逐点回到原样', () => {
  for (let idx = 0; idx < 3; idx++) {
    it(`${SEED_SAILS[idx].name}: 纯函数往返,基础形态与含抖动形态均复原`, () => {
      const sail = seedSail(idx);
      // 加一点晶格编辑,确保往返对编辑后的帆同样成立
      sail.lattice.points[5].dz = 5;
      const t0 = 0.37;
      const t1 = 8.91;
      for (let i = 0; i <= 15; i++) {
        const h = i / 15;
        for (let j = 0; j <= 15; j++) {
          const s = j / 15;
          const origin = basePosition(sail, RIG, h, s, { k: 0, includeLattice: true });
          basePosition(sail, RIG, h, s, { k: 1, includeLattice: true });
          basePosition(sail, RIG, h, s, { k: 0.5, includeLattice: true });
          const back = basePosition(sail, RIG, h, s, { k: 0, includeLattice: true });
          expect(back).toEqual(origin);

          // 抖动层:同一时刻同一参数结果确定,且 k=0 往返一致
          const r0 = renderPosition(sail, RIG, h, s, 0, t0, 1);
          renderPosition(sail, RIG, h, s, 1, t1, 1);
          const rBack = renderPosition(sail, RIG, h, s, 0, t0, 1);
          expect(rBack).toEqual(r0);
        }
      }
    });
  }
});

describe('验收3: 截面弦高比与手算值误差 ≤ 0.5 个百分点', () => {
  for (let idx = 0; idx < 3; idx++) {
    it(`${SEED_SAILS[idx].name}: 满帆姿态各撑条截面`, () => {
      const sail = seedSail(idx);
      for (const batten of sail.battens) {
        const h = batten.heightRatio;
        const measured = measureSection(sail, RIG, h, 0.5, true, 400);
        // 手算:满帆 k=0.5 时风缩放=1,索具修正是确定公式
        const hand = effectiveCamber(sail, RIG, h, 0.5);
        const errPctPoints = Math.abs(measured.camber - hand) * 100;
        expect(errPctPoints).toBeLessThanOrEqual(0.5);
        // 深度本身也要和鼓包曲线定义一致
        const expectDepth = camberZ(
          measured.maxDraftPos,
          batten.maxDraftPos,
          hand * measured.chordCm,
        );
        expect(Math.abs(measured.depthCm - expectDepth)).toBeLessThan(0.5);
        // 最深点位置应落在设计值附近(插值误差范围内)
        expect(Math.abs(measured.maxDraftPos - batten.maxDraftPos)).toBeLessThan(0.02);
      }
    });

    it(`${SEED_SAILS[idx].name}: 无风与阵风姿态同样满足精度`, () => {
      const sail = seedSail(idx);
      for (const k of [0, 0.25, 0.75, 1]) {
        for (const batten of sail.battens) {
          const measured = measureSection(sail, RIG, batten.heightRatio, k, true, 300);
          const hand = effectiveCamber(sail, RIG, batten.heightRatio, k);
          expect(Math.abs(measured.camber - hand) * 100).toBeLessThanOrEqual(0.5);
        }
      }
    });
  }
});
