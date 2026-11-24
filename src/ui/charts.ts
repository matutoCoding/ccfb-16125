// 2D Canvas 截面曲线:多撑条截面叠加、扭转分布、设计单同款出图
import { measureSection, type SectionMetrics } from '../core/sailModel';
import type { RigConfig, SailProfile } from '../core/types';

export interface SectionChartOptions {
  width?: number;
  height?: number;
  /** 只显示指定高度比例的撑条;缺省显示全部 */
  heights?: number[];
  k?: number;
  showLabels?: boolean;
  /** 另一组对比截面(旧版次),虚线绘制 */
  compare?: { label: string; metrics: SectionMetrics[] };
}

const PALETTE = ['#38bdf8', '#22d3ee', '#4ade80', '#f59e0b', '#f472b6', '#a78bfa', '#fb923c'];

export function drawSectionChart(
  canvas: HTMLCanvasElement,
  profile: SailProfile,
  rig: RigConfig,
  opts: SectionChartOptions = {},
): SectionMetrics[] {
  const width = opts.width ?? canvas.width;
  const height = opts.height ?? canvas.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a111b';
  ctx.fillRect(0, 0, width, height);

  const padL = 46;
  const padR = 16;
  const padT = 24;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const heights = opts.heights ?? profile.battens.map((b) => b.heightRatio);
  const k = opts.k ?? 0.5;
  const metrics = heights.map((h) => measureSection(profile, rig, h, k, true, 200));
  const maxCamber = Math.max(...metrics.map((m) => m.camber), 0.02);
  const depthScale = maxCamber * 1.25; // 纵轴最大深度(占弦长比例)

  // 网格 + 轴
  ctx.strokeStyle = '#1e2c3f';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#93a5bb';
  ctx.font = '11px Consolas, monospace';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
    const val = (depthScale * (1 - i / 4) * 100).toFixed(1);
    ctx.fillText(`${val}%`, 6, y + 4);
  }
  for (let i = 0; i <= 5; i++) {
    const x = padL + (plotW * i) / 5;
    ctx.fillText(`${i * 20}%`, x - 8, height - 12);
  }
  ctx.strokeStyle = '#3b5068';
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // 弦线
  ctx.strokeStyle = '#4b6178';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  metrics.forEach((m, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      // 用测量指标重建归一鼓包曲线
      const depth = sectionDepthNorm(s, m);
      const x = padL + s * plotW;
      const y = padT + plotH - (depth / depthScale) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 最深点标记
    const dx = padL + m.maxDraftPos * plotW;
    const dy = padT + plotH - (m.camber / depthScale) * plotH;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (opts.showLabels !== false) {
      ctx.fillStyle = color;
      ctx.font = '11px sans-serif';
      ctx.fillText(
        `h${(m.heightRatio * 100).toFixed(0)} 深${(m.camber * 100).toFixed(1)}% 扭${m.twistDeg.toFixed(1)}°`,
        padL + 6,
        padT + 14 + idx * 15,
      );
    }
  });

  if (opts.compare) {
    ctx.setLineDash([5, 4]);
    opts.compare.metrics.forEach((m, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const N = 120;
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const depth = sectionDepthNorm(s, m);
        const x = padL + s * plotW;
        const y = padT + plotH - (depth / depthScale) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#e3ecf6';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('弦向位置 →', padL + plotW - 70, height - 18);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('吃风深度(弦高比)', -58, 0);
  ctx.restore();

  return metrics;
}

/** 由测量指标按双抛物线重建归一深度 */
function sectionDepthNorm(s: number, m: SectionMetrics): number {
  const p = m.maxDraftPos;
  if (s <= p) {
    const u = s / Math.max(p, 1e-6);
    return m.camber * (2 * u - u * u);
  }
  const u = (s - p) / Math.max(1 - p, 1e-6);
  return m.camber * (1 - u * u);
}

/** 扭转分布图:横轴扭转角、纵轴高度 */
export function drawTwistChart(
  canvas: HTMLCanvasElement,
  metrics: SectionMetrics[],
): void {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a111b';
  ctx.fillRect(0, 0, width, height);
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxTwist = Math.max(...metrics.map((m) => m.twistDeg), 5) * 1.15;

  ctx.strokeStyle = '#1e2c3f';
  for (let i = 0; i <= 4; i++) {
    const x = padL + (plotW * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = '#93a5bb';
    ctx.font = '11px Consolas';
    ctx.fillText(`${((maxTwist * i) / 4).toFixed(0)}°`, x - 6, height - 12);
  }

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  metrics.forEach((m, i) => {
    const x = padL + (m.twistDeg / maxTwist) * plotW;
    const y = padT + plotH - m.heightRatio * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  metrics.forEach((m, i) => {
    const x = padL + (m.twistDeg / maxTwist) * plotW;
    const y = padT + plotH - m.heightRatio * plotH;
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#e3ecf6';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('扭转角 →', width - 70, height - 18);
  ctx.save();
  ctx.translate(12, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('帆面高度(下→上)', -52, 0);
  ctx.restore();
}
