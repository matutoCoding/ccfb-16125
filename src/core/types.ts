// 领域模型:帆型档案、索具、晶格、测帆照片等全部持久化结构
export type SailCategory = 'race' | 'freestyle' | 'wave';
export type FabricType = 'monofilm' | 'xply' | 'plain';
export type MastCurveType = 'constant' | 'flextop';

export const CATEGORY_LABEL: Record<SailCategory, string> = {
  race: '竞速',
  freestyle: '自由式',
  wave: '波浪',
};

export const FABRIC_LABEL: Record<FabricType, string> = {
  monofilm: '单丝膜',
  xply: 'X-ply 网格布',
  plain: '平纹布',
};

/** 单根撑条的设计参数(撑条高度用占前缘高度的比例 0..1 表示) */
export interface BattenSpec {
  id: string;
  /** 撑条所在高度比例,0=下缘,1=帆顶 */
  heightRatio: number;
  /** 吃风深度占弦长比例(弦高比),0.08 即 8% */
  camber: number;
  /** 最深点在弦线上的位置比例,0=前缘,1=后缘 */
  maxDraftPos: number;
  /** 扭转角(度),截面绕前缘轴的转角 */
  twistDeg: number;
}

/** 面料拼块:按高度区间划分 */
export interface PatchSpec {
  id: string;
  fabric: FabricType;
  h0: number;
  h1: number;
}

/** 轮廓控制点:高度比例 → 该处弦长(cm) */
export interface ChordKnot {
  h: number;
  chordCm: number;
}

/** 晶格控制点位移 */
export interface LatticePoint {
  id: string;
  /** 高度比例 */
  h: number;
  /** 弦向位置比例 */
  s: number;
  /** 深度位移(cm,正=向背风面鼓) */
  dz: number;
  /** 弦向位移(cm) */
  dx: number;
  /** 所属撑条区间编号(-1 表示全帆通用点) */
  bayIndex: number;
}

export interface LatticeState {
  /** 纵向晶格密度(每个撑条区间内的格数) */
  verticalDivs: number;
  /** 弦向晶格格数 */
  horizontalDivs: number;
  points: LatticePoint[];
}

export interface RigConfig {
  /** 桅杆硬度指数(IMCS 风格,越大越硬) */
  mastStiffness: number;
  mastCurve: MastCurveType;
  /** 下拉收紧量 cm */
  downhaulCm: number;
  /** 外拉收紧量 cm */
  outhaulCm: number;
}

export interface MastSpec {
  id: string;
  name: string;
  stiffness: number;
  curve: MastCurveType;
  lengthCm: number;
}

export interface SailProfile {
  id: string;
  /** 同系列 id,用于尺寸缩放关系对比 */
  modelId: string;
  name: string;
  category: SailCategory;
  /** 版次,同型号迭代累加 */
  version: number;
  areaM2: number;
  /** 前缘(桅套)长度 cm */
  luffCm: number;
  /** 下缘长度 cm */
  footCm: number;
  chordKnots: ChordKnot[];
  /** 设计桅弧(帆期望的桅杆弯曲幅度 cm) */
  designLuffCurveCm: number;
  /** 推荐桅杆硬度范围 */
  recommendedStiffness: [number, number];
  battens: BattenSpec[];
  patches: PatchSpec[];
  lattice: LatticeState;
  rig: RigConfig;
  notes: string;
  createdAt: number;
}

export interface Point2 {
  x: number;
  y: number;
}

/** 测帆照片上一条测量条带的人工标记 */
export interface PhotoBand {
  id: string;
  /** 对应帆面高度比例 */
  heightRatio: number;
  /** 条带四角(图像像素):[前缘下, 后缘下, 后缘上, 前缘上] */
  quad: Point2[];
  /** 手点的前缘、最深点、后缘(图像像素) */
  leading: Point2;
  deepest: Point2;
  trailing: Point2;
  /** 反算结果,保存时回填 */
  measuredCamber?: number;
  measuredDraftPos?: number;
}

export interface PhotoRecord {
  id: string;
  sailId: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  bands: PhotoBand[];
  createdAt: number;
}

export interface AppSettings {
  /** 抖动总倍率 */
  flutterScale: number;
  /** 网格弦向分段 */
  chordSegments: number;
  /** 渲染线框 */
  wireframe: boolean;
  /** 逆光模式 */
  backlight: boolean;
}

export interface WindKeyPose {
  name: string;
  /** 风速滑块位置 0..1 */
  k: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  flutterScale: 1,
  chordSegments: 28,
  wireframe: false,
  backlight: false,
};
