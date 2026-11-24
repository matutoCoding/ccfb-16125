// 测试数据:4.7 / 5.8 / 7.8 三张帆 + 两根不同硬度的桅杆
import type {
  BattenSpec,
  ChordKnot,
  LatticePoint,
  LatticeState,
  MastSpec,
  PatchSpec,
  RigConfig,
  SailProfile,
} from './types';
import { uid } from './photoMeasure';

export interface SeedSailDef {
  name: string;
  category: SailProfile['category'];
  areaM2: number;
  luffCm: number;
  footCm: number;
  designLuffCurveCm: number;
  recommendedStiffness: [number, number];
  battenCount: number;
  baseCamber: number;
  baseTwist: number;
}

export const SEED_SAILS: SeedSailDef[] = [
  {
    name: '竞速 R-7.8',
    category: 'race',
    areaM2: 7.8,
    luffCm: 505,
    footCm: 226,
    designLuffCurveCm: 17.5,
    recommendedStiffness: [21, 25],
    battenCount: 7,
    baseCamber: 0.112,
    baseTwist: 11,
  },
  {
    name: '自由式 F-5.8',
    category: 'freestyle',
    areaM2: 5.8,
    luffCm: 442,
    footCm: 186,
    designLuffCurveCm: 14.5,
    recommendedStiffness: [17, 21],
    battenCount: 6,
    baseCamber: 0.105,
    baseTwist: 14,
  },
  {
    name: '波浪 W-4.7',
    category: 'wave',
    areaM2: 4.7,
    luffCm: 402,
    footCm: 162,
    designLuffCurveCm: 12.5,
    recommendedStiffness: [14, 18],
    battenCount: 5,
    baseCamber: 0.092,
    baseTwist: 18,
  },
];

export const SEED_MASTS: MastSpec[] = [
  { id: 'mast-rdm-hard', name: 'RDM 硬桅 25', stiffness: 25, curve: 'constant', lengthCm: 460 },
  { id: 'mast-sdm-soft', name: 'SDM 软桅 15', stiffness: 15, curve: 'flextop', lengthCm: 430 },
];

/** 撑条高度:避开最两端,等距分布 */
function battenHeights(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(0.12 + (0.78 * i) / (count - 1));
  }
  return out;
}

function makeBattens(def: SeedSailDef): BattenSpec[] {
  return battenHeights(def.battenCount).map((h, i) => {
    // 中段吃风最深,上下略浅;扭转随高度增大;最深点略偏前
    const mid = Math.sin(Math.PI * h);
    const camber = def.baseCamber * (0.82 + 0.24 * mid);
    const twist = def.baseTwist * h * h + 1.5;
    const draft = 0.42 - 0.06 * h;
    return {
      id: `batten-${i}`,
      heightRatio: Number(h.toFixed(4)),
      camber: Number(camber.toFixed(4)),
      maxDraftPos: Number(draft.toFixed(3)),
      twistDeg: Number(twist.toFixed(2)),
    };
  });
}

function makeChordKnots(def: SeedSailDef): ChordKnot[] {
  // 由面积反推中段最大弦长的近似系数,再给出上下收窄的轮廓
  const maxChord = (def.areaM2 * 10000 * 0.72) / def.luffCm;
  return [
    { h: 0, chordCm: def.footCm * 0.78 },
    { h: 0.18, chordCm: maxChord },
    { h: 0.55, chordCm: maxChord * 0.92 },
    { h: 0.85, chordCm: maxChord * 0.55 },
    { h: 1, chordCm: maxChord * 0.12 },
  ];
}

function makePatches(): PatchSpec[] {
  return [
    { id: 'patch-mono', fabric: 'monofilm', h0: 0.1, h1: 0.72 },
    { id: 'patch-xply', fabric: 'xply', h0: 0.72, h1: 1 },
    { id: 'patch-plain', fabric: 'plain', h0: 0, h1: 0.1 },
  ];
}

function makeLattice(battens: BattenSpec[], verticalDivs = 2, horizontalDivs = 4): LatticeState {
  const points: LatticePoint[] = [];
  for (let bay = 0; bay < battens.length - 1; bay++) {
    const h0 = battens[bay].heightRatio;
    const h1 = battens[bay + 1].heightRatio;
    for (let i = 0; i <= verticalDivs; i++) {
      const h = h0 + ((h1 - h0) * i) / verticalDivs;
      for (let j = 0; j <= horizontalDivs; j++) {
        points.push({
          id: uid('lat'),
          h: Number(h.toFixed(4)),
          s: j / horizontalDivs,
          dz: 0,
          dx: 0,
          bayIndex: bay,
        });
      }
    }
  }
  return { verticalDivs, horizontalDivs, points };
}

function defaultRig(): RigConfig {
  return { mastStiffness: 19, mastCurve: 'constant', downhaulCm: 6, outhaulCm: 3 };
}

export function buildSeedSail(def: SeedSailDef, index: number): SailProfile {
  const battens = makeBattens(def);
  return {
    id: uid('sail'),
    // 三张种子帆同属一个系列的不同尺寸,用于缩放关系对比
    modelId: 'seed-series-a',
    name: def.name,
    category: def.category,
    version: 1,
    areaM2: def.areaM2,
    luffCm: def.luffCm,
    footCm: def.footCm,
    chordKnots: makeChordKnots(def),
    designLuffCurveCm: def.designLuffCurveCm,
    recommendedStiffness: def.recommendedStiffness,
    battens,
    patches: makePatches(),
    lattice: makeLattice(battens),
    rig: defaultRig(),
    notes: `种子数据:${def.name},${def.battenCount} 根撑条,用于功能验收。`,
    createdAt: Date.now() + index,
  };
}

/** 复制帆型并生成新版次(保留同系列 id) */
export function cloneAsVersion(profile: SailProfile, version: number): SailProfile {
  return {
    ...structuredClone(profile),
    id: uid('sail'),
    version,
    notes: `${profile.name} v${version}`,
    createdAt: Date.now(),
  };
}

/** 重建晶格(密度调整时调用),保留能对齐的旧点位移 */
export function rebuildLattice(
  profile: SailProfile,
  verticalDivs: number,
  horizontalDivs: number,
): LatticeState {
  const next = makeLattice(profile.battens, verticalDivs, horizontalDivs);
  const old = profile.lattice.points;
  for (const p of next.points) {
    const match = old.find(
      (o) => o.bayIndex === p.bayIndex && Math.abs(o.h - p.h) < 1e-3 && Math.abs(o.s - p.s) < 1e-3,
    );
    if (match) {
      p.dz = match.dz;
      p.dx = match.dx;
    }
  }
  return next;
}

/** 供晶格编辑器使用:按区间过滤点 */
export function latticePointsInBay(lattice: LatticeState, bayIndex: number): LatticePoint[] {
  return lattice.points.filter((p) => p.bayIndex === bayIndex);
}
