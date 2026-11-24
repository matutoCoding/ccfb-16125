// 帆面几何内核:输入帆型档案 + 索具 + 风速 k,输出确定性的三维帆面。
// 设计原则:
//  1. 基础形态是 (profile, rig, k) 的纯函数,无内部状态、无随机数,
//     所以风速 0→1→0 必然逐点回到原样。
//  2. 晶格位移用紧支撑光滑窗,窗外严格为 0,撑条边界处位移与导数同时归零。
//  3. 抖动只在渲染层按时间叠加,不进基础形态,测量与验收全部基于基础形态。
import { bumpWindow, clamp, interpKnots, lerp, smoothstep } from './mathUtils';
import type {
  BattenSpec,
  LatticeState,
  MastCurveType,
  RigConfig,
  SailProfile,
} from './types';

const DEG = Math.PI / 180;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SectionMetrics {
  heightRatio: number;
  chordCm: number;
  /** 实测弦高比(0..1) */
  camber: number;
  depthCm: number;
  maxDraftPos: number;
  twistDeg: number;
}

/** 风姿态关键帧:k=0 无风挂帆,k=0.5 中风满帆,k=1 阵风卸力 */
export const WIND_CAMBER_SCALE = [
  { t: 0, v: 0.6 },
  { t: 0.5, v: 1 },
  { t: 1, v: 0.75 },
];
export const WIND_TOP_TWIST_ADD_DEG = [
  { t: 0, v: 0 },
  { t: 0.5, v: 0 },
  { t: 1, v: 8 },
];
export const POSE_FULL_K = 0.5;

// ---------------------------------------------------------------- 桅杆 / 索具

/** 桅杆纵向弯曲形状:h∈[0,1],返回无量纲形状,最大值约 1 */
export function mastShape(h: number, curve: MastCurveType): number {
  const x = clamp(h, 0, 1);
  // constant: 均匀弯(二次);flextop: 弯集中在上半截
  return curve === 'flextop' ? Math.pow(x, 2.6) : x * x;
}

/** 给定索具下桅杆实际弯幅 cm(下拉越大、桅杆越软,弯得越厉害) */
export function achievedMastBendCm(rig: RigConfig): number {
  const stiffnessFactor = 16 / rig.mastStiffness;
  return rig.downhaulCm * 2.4 * stiffnessFactor;
}

export interface RigMatch {
  achievedBendCm: number;
  designBendCm: number;
  bendGapCm: number;
  stiffnessInRange: boolean;
  level: 'ok' | 'info' | 'warn';
  messages: string[];
}

/** 桅杆硬度 / 收紧量与帆的匹配判定 */
export function evaluateRigMatch(profile: SailProfile, rig: RigConfig): RigMatch {
  const achieved = achievedMastBendCm(rig);
  const gap = achieved - profile.designLuffCurveCm;
  const messages: string[] = [];
  let level: RigMatch['level'] = 'ok';
  const stiffnessInRange =
    rig.mastStiffness >= profile.recommendedStiffness[0] &&
    rig.mastStiffness <= profile.recommendedStiffness[1];

  if (!stiffnessInRange) {
    level = 'warn';
    messages.push(
      `桅杆硬度 ${rig.mastStiffness} 超出推荐区间 ${profile.recommendedStiffness[0]}–${profile.recommendedStiffness[1]}`,
    );
  }
  if (gap > 5) {
    level = 'warn';
    messages.push(
      `下拉过量/桅杆偏软:实弯 ${achieved.toFixed(1)}cm 比设计桅弧大 ${gap.toFixed(1)}cm,帆顶会被压扁、后缘松甩`,
    );
  } else if (gap < -5) {
    level = 'warn';
    messages.push(
      `下拉不足/桅杆偏硬:实弯 ${achieved.toFixed(1)}cm 比设计桅弧小 ${Math.abs(gap).toFixed(1)}cm,桅套贴不住、前缘出死褶`,
    );
  } else if (Math.abs(gap) > 2.5) {
    if (level !== 'warn') level = 'info';
    messages.push(`桅弧偏差 ${gap.toFixed(1)}cm,在可用范围边缘,建议微调下拉`);
  }
  if (messages.length === 0) {
    messages.push(`匹配良好:实弯 ${achieved.toFixed(1)}cm,落在设计桅弧容差内`);
  }
  return {
    achievedBendCm: achieved,
    designBendCm: profile.designLuffCurveCm,
    bendGapCm: gap,
    stiffnessInRange,
    level,
    messages,
  };
}

// ---------------------------------------------------------------- 截面插值

function sortedBattens(profile: SailProfile): BattenSpec[] {
  return [...profile.battens].sort((a, b) => a.heightRatio - b.heightRatio);
}

function battenKnots(profile: SailProfile, pick: (b: BattenSpec) => number) {
  return sortedBattens(profile).map((b) => ({ t: b.heightRatio, v: pick(b) }));
}

export function chordAt(profile: SailProfile, h: number): number {
  return interpKnots(
    [...profile.chordKnots]
      .sort((a, b) => a.h - b.h)
      .map((c) => ({ t: c.h, v: c.chordCm })),
    h,
  );
}

function designCamberAt(profile: SailProfile, h: number): number {
  return interpKnots(battenKnots(profile, (b) => b.camber), h);
}

function designDraftAt(profile: SailProfile, h: number): number {
  return interpKnots(battenKnots(profile, (b) => b.maxDraftPos), h);
}

function designTwistAt(profile: SailProfile, h: number): number {
  return interpKnots(battenKnots(profile, (b) => b.twistDeg), h);
}

function windCamberScale(k: number): number {
  return interpKnots(WIND_CAMBER_SCALE, k);
}

function windTopTwist(k: number): number {
  return interpKnots(WIND_TOP_TWIST_ADD_DEG, k);
}

/** 索具 + 风姿态共同作用后的实际弦高比 */
export function effectiveCamber(
  profile: SailProfile,
  rig: RigConfig,
  h: number,
  k: number,
): number {
  const gap = achievedMastBendCm(rig) - profile.designLuffCurveCm;
  const x = clamp(h, 0, 1);
  // 外拉主要收平下缘
  const outhaulFlatten = rig.outhaulCm * 0.01 * (1 - x) * (1 - x);
  // 下拉过量收平帆顶
  const downhaulFlatten = Math.max(0, gap) * 0.015 * x * x;
  const rigFactor = clamp(1 - outhaulFlatten - downhaulFlatten, 0.35, 1.25);
  return designCamberAt(profile, h) * rigFactor * windCamberScale(k);
}

/** 实际扭转角(度) */
export function effectiveTwistDeg(
  profile: SailProfile,
  rig: RigConfig,
  h: number,
  k: number,
): number {
  const gap = achievedMastBendCm(rig) - profile.designLuffCurveCm;
  const x = clamp(h, 0, 1);
  const rigAdd = Math.max(0, gap) * 0.3 * x * x;
  const windAdd = windTopTwist(k) * x * x;
  return designTwistAt(profile, h) + rigAdd + windAdd;
}

/**
 * 截面鼓包曲线(两条抛物线在最深点 C1 拼接):
 * s∈[0,1],p=最深点位置,depthCm=最深点深度(cm)。
 * 两端严格为 0,最深点 s=p 处取 depthCm,两侧抛物线在拼接点导数一致。
 */
export function camberZ(s: number, draftPos: number, depthCm: number): number {
  const p = clamp(draftPos, 0.05, 0.95);
  if (s <= p) {
    const u = s / p;
    return depthCm * (2 * u - u * u);
  }
  const u = (s - p) / (1 - p);
  return depthCm * (1 - u * u);
}

// ---------------------------------------------------------------- 晶格局部编辑

interface Bay {
  index: number;
  h0: number;
  h1: number;
}

export function battenBays(profile: SailProfile): Bay[] {
  const bs = sortedBattens(profile);
  const bays: Bay[] = [];
  for (let i = 0; i < bs.length - 1; i++) {
    bays.push({ index: i, h0: bs[i].heightRatio, h1: bs[i + 1].heightRatio });
  }
  return bays;
}

/**
 * 晶格在截面局部坐标系(弦向 x、深度 z)产生的位移。
 * 每个晶格点只作用于它所属的撑条区间:
 *   高度窗在区间两条边界处严格归零(位移与导数同时为 0 → 撑条处光顺);
 *   弦向窗影响约一个晶格单元,窗外严格为 0。
 */
export function latticeDisplacementLocal(
  profile: SailProfile,
  h: number,
  s: number,
): { dx: number; dz: number } {
  const lattice: LatticeState = profile.lattice;
  const bays = battenBays(profile);
  let dx = 0;
  let dz = 0;
  const chordHalf = Math.max(1 / lattice.horizontalDivs, 0.12);
  for (const p of lattice.points) {
    if (p.dz === 0 && p.dx === 0) continue;
    const bay = bays[p.bayIndex];
    if (!bay) continue;
    // 区间外直接短路,保证影响范围外严格无贡献
    if (h <= bay.h0 || h >= bay.h1) continue;
    const halfH = Math.max(p.h - bay.h0, bay.h1 - p.h);
    const wh = bumpWindow(h, p.h, halfH);
    if (wh === 0) continue;
    const ws = bumpWindow(s, p.s, chordHalf);
    if (ws === 0) continue;
    const w = wh * ws;
    dz += p.dz * w;
    dx += p.dx * w;
  }
  return { dx, dz };
}

// ---------------------------------------------------------------- 帆面采样

export interface SurfaceOptions {
  /** 风速滑块 0..1 */
  k: number;
  /** 是否叠加晶格编辑(测量原始设计时可关) */
  includeLattice: boolean;
}

/** 桅杆(前缘)位置:y 高度 + 弯向弦向的 x */
export function leadingEdgePoint(profile: SailProfile, rig: RigConfig, h: number): Vec3 {
  const bend = achievedMastBendCm(rig);
  return {
    x: bend * mastShape(h, rig.mastCurve),
    y: clamp(h, 0, 1) * profile.luffCm,
    z: 0,
  };
}

/**
 * 基础帆面位置(不含时间抖动)。
 * 坐标系:y 沿桅杆向上,x 弦向朝后缘,z 背风面鼓出方向。
 * 每个高度的截面落在由扭转角定义的截面平面内:弦线方向 e_c 与法向 e_n 正交,
 * 因此空间弦长恒等于名义弦长,弦高比定义自洽、测量可直接还原手算值。
 */
export function basePosition(
  profile: SailProfile,
  rig: RigConfig,
  h: number,
  s: number,
  opts: SurfaceOptions,
): Vec3 {
  const lead = leadingEdgePoint(profile, rig, h);
  const chord = chordAt(profile, h);
  const camber = effectiveCamber(profile, rig, h, opts.k);
  const draft = designDraftAt(profile, h);
  const twistRad = effectiveTwistDeg(profile, rig, h, opts.k) * DEG;
  const cos = Math.cos(twistRad);
  const sin = Math.sin(twistRad);

  // 截面局部系:弦向 (cos,sin),法向 (-sin,cos)
  let along = s * chord;
  let normal = camberZ(s, draft, camber * chord);

  if (opts.includeLattice) {
    // 晶格位移同样在截面局部系内给出,随截面一起转
    const d = latticeDisplacementLocal(profile, h, s);
    along += d.dx;
    normal += d.dz;
  }

  return {
    x: lead.x + along * cos - normal * sin,
    y: lead.y,
    z: along * sin + normal * cos,
  };
}

/**
 * 风抖偏移:布面跨度越大的撑条区间抖得越厉害,撑条线上(区间边界)为 0。
 * 纯时间函数,不写入任何状态;验收取 time 无关的 basePosition。
 */
export function flutterOffset(
  profile: SailProfile,
  h: number,
  s: number,
  k: number,
  timeSec: number,
  flutterScale: number,
): { dx: number; dz: number } {
  const bays = battenBays(profile);
  const bay = bays.find((b) => h > b.h0 && h < b.h1);
  if (!bay) return { dx: 0, dz: 0 };
  const span = (bay.h1 - bay.h0) * profile.luffCm;
  const bayT = (h - bay.h0) / (bay.h1 - bay.h0);
  const edgeFade = Math.sin(Math.PI * bayT); // 撑条处归零
  const chordFade = Math.sin(Math.PI * clamp(s, 0, 1)); // 前后缘归零
  const windFactor = 0.25 + 0.75 * smoothstep(k);
  const ampCm = (span / 90) * 0.9 * flutterScale * windFactor * edgeFade * chordFade;
  // 两段确定性正弦,模拟阵风湍流的小幅拍动
  const phase1 = timeSec * (7.3 + bay.index * 0.7) + s * 9.1 + bay.index * 1.7;
  const phase2 = timeSec * (11.7 + bay.index * 0.5) + h * 13.3;
  return {
    dx: ampCm * 0.35 * Math.sin(phase2),
    dz: ampCm * (Math.sin(phase1) + 0.4 * Math.sin(phase2 * 1.3)),
  };
}

/** 含抖动的最终采样(渲染用) */
export function renderPosition(
  profile: SailProfile,
  rig: RigConfig,
  h: number,
  s: number,
  k: number,
  timeSec: number,
  flutterScale: number,
): Vec3 {
  const p = basePosition(profile, rig, h, s, { k, includeLattice: true });
  const f = flutterOffset(profile, h, s, k, timeSec, flutterScale);
  const twistRad = effectiveTwistDeg(profile, rig, h, k) * DEG;
  const cos = Math.cos(twistRad);
  const sin = Math.sin(twistRad);
  return {
    x: p.x + f.dx * cos - f.dz * sin,
    y: p.y,
    z: p.z + f.dx * sin + f.dz * cos,
  };
}

// ---------------------------------------------------------------- 截面测量

/**
 * 在指定高度反测截面。
 * 截面轴向由该高度的扭转角定义(与构造时完全一致),桅杆弯曲只造成整体平移,
 * 不参与弦方向,因此桅弯不会污染深度测量。
 * 返回的 camber 即弦高比,用于和手算值、照片反算值比对。
 */
export function measureSection(
  profile: SailProfile,
  rig: RigConfig,
  h: number,
  k: number,
  includeLattice = true,
  samples = 240,
): SectionMetrics {
  // 原点取 s=0 的实际前缘点(含桅弯平移),与每个采样点共享同一参照,
  // 这样桅弯只表现为整体平移,不出现在深度里。
  const lead = basePosition(profile, rig, h, 0, { k, includeLattice });
  const twistRad = effectiveTwistDeg(profile, rig, h, k) * DEG;
  const cos = Math.cos(twistRad);
  const sin = Math.sin(twistRad);
  // 截面局部系与 basePosition 严格互逆:
  //   构造 [world] = R(θ)·[along, normal],测量即 R(-θ)·[world]
  let maxDepth = 0;
  let maxAlong = 0;
  let chord = 0;
  let maxIdx = 0;
  const depths: number[] = [];
  const alongs: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const p = basePosition(profile, rig, h, s, { k, includeLattice });
    const dx = p.x - lead.x;
    const dz = p.z - lead.z;
    // R(-θ) 逆旋转:
    //   along  = dx·cos + dz·sin
    //   normal = dz·cos − dx·sin
    const along = dx * cos + dz * sin;
    const depth = dz * cos - dx * sin;
    depths.push(depth);
    alongs.push(along);
    if (depth > maxDepth) {
      maxDepth = depth;
      maxAlong = along;
      maxIdx = i;
    }
    if (i === samples) chord = along;
  }
  // 峰点三点二次插值:把最深点位置从采样网格精度提升到亚采样级
  if (maxIdx > 0 && maxIdx < samples) {
    const d0 = depths[maxIdx - 1];
    const d1 = depths[maxIdx];
    const d2 = depths[maxIdx + 1];
    const denom = d0 - 2 * d1 + d2;
    if (Math.abs(denom) > 1e-12) {
      // 二次抛物线顶点相对中间采样点的偏移(单位:采样间隔),钳在一个间隔内
      const offset = clamp(0.5 * (d0 - d2) / denom, -1, 1);
      const spacing = alongs[1] - alongs[0];
      const refinedAlong = alongs[maxIdx] + offset * spacing;
      if (Number.isFinite(refinedAlong)) {
        maxAlong = refinedAlong;
        maxDepth = d1 - (d0 - d2) * 0.25 * offset;
      }
    }
  }
  return {
    heightRatio: h,
    chordCm: chord,
    camber: chord > 1e-9 ? maxDepth / chord : 0,
    depthCm: maxDepth,
    maxDraftPos: clamp(maxAlong / chord, 0, 1),
    twistDeg: effectiveTwistDeg(profile, rig, h, k),
  };
}

/** 生成渲染网格的高度行:均匀分段 + 全部撑条高度(保证撑条线精确落格) */
export function gridHeightRows(profile: SailProfile, verticalDivs: number): number[] {
  const set = new Set<number>();
  for (let i = 0; i <= verticalDivs; i++) set.add(i / verticalDivs);
  for (const b of profile.battens) set.add(clamp(b.heightRatio, 0, 1));
  return [...set].sort((a, b) => a - b);
}

/** 同系列不同尺寸的缩放因子(以面积平方根为基准) */
export function scaleFactorBetween(areaM2A: number, areaM2B: number): number {
  return Math.sqrt(areaM2B / areaM2A);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}
