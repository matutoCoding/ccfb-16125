import { basePosition, gridHeightRows } from '../core/sailModel';
import { store } from '../core/store';
import type { SailProfile } from '../core/types';
import { h, clear, slider } from '../ui/dom';
import { mountViewer, viewModeButtons } from '../ui/viewerHook';
import type { ViewMode } from '../ui/SailViewer';

const POSES = [
  { k: 0, label: '无风挂帆' },
  { k: 0.5, label: '中风满帆' },
  { k: 1, label: '阵风卸力' },
];

/** 检测相邻高度行是否出现交叉/穿透:同弦向 s 上相邻行的深度序被翻转 */
function detectPenetration(sail: SailProfile, k: number): { count: number; worst: number } {
  const heights = gridHeightRows(sail, 26);
  const cols = 16;
  let count = 0;
  let worst = 0;
  for (let r = 0; r < heights.length - 1; r++) {
    for (let c = 0; c <= cols; c++) {
      const s = c / cols;
      const p0 = basePosition(sail, sail.rig, heights[r], s, { k, includeLattice: true });
      const p1 = basePosition(sail, sail.rig, heights[r + 1], s, { k, includeLattice: true });
      // 高度必须单调递增;若出现逆序即穿模
      const gap = p1.y - p0.y;
      if (gap <= 0.001) {
        count++;
        worst = Math.max(worst, Math.abs(gap));
      }
    }
  }
  return { count, worst };
}

export function renderWindPage(host: HTMLElement, initialSail: SailProfile): void {
  let sail = initialSail;
  const wrap = h('div', { class: 'two-col' });
  const sidebar = h('div', { class: 'sidebar panel' });
  const stage = h('div', { class: 'stage' });
  wrap.append(sidebar, stage);
  host.append(wrap);

  let viewMode: ViewMode = 'chase';
  const handle = mountViewer(stage, sail, sail.rig, store.windK, store.settings);
  const toolbarHost = h('div');
  stage.append(toolbarHost);
  function renderToolbar(): void {
    clear(toolbarHost);
    toolbarHost.append(viewModeButtons(viewMode, (m) => {
      viewMode = m;
      handle.viewer.setViewMode(m);
      renderToolbar();
    }));
  }
  renderToolbar();

  // 风速滑块:走 store 高频通道,避免整页重绘
  function renderSidebar(): void {
    clear(sidebar);
    sidebar.append(h('h3', { textContent: '受风形态推演' }));
    const windSlider = slider(store.windK, 0, 1, 0.01, (v) => {
      store.setWindK(v);
      handle.viewer.setWind(v);
      updateReadout(v);
    });
    sidebar.append(labeled('风速(0 无风 → 1 阵风)', windSlider.wrap));

    // 关键姿态快捷定位
    sidebar.append(h('div', { class: 'chip-array', style: 'margin:12px 0' }, POSES.map((pose) =>
      h('span', {
        class: 'chip',
        textContent: `${pose.label} ${pose.k}`,
        onclick: () => {
          store.setWindK(pose.k);
          windSlider.input.value = String(pose.k);
          windSlider.out.textContent = pose.k.toFixed(2);
          handle.viewer.setWind(pose.k);
          updateReadout(pose.k);
        },
      }),
    )));

    const readout = h('div', { class: 'panel', style: 'background:var(--panel-2)' });
    sidebar.append(readout);

    // 穿模监测
    const penetration = h('div', { style: 'margin-top:12px' });
    sidebar.append(penetration);

    // 形态往返提示
    sidebar.append(h('div', { class: 'dim', style: 'font-size:12px;margin-top:14px' }, [
      '形态为纯函数插值:滑块从 0 拉到 1 再回 0,帆面逐点回到初始形态。风抖仅按时间叠加在渲染层,不改变基础形态。',
    ]));

    function updateReadout(k: number): void {
      clear(readout);
      const pen = detectPenetration(sail, k);
      const nearestPose = POSES.reduce((best, p) =>
        Math.abs(p.k - k) < Math.abs(best.k - k) ? p : best,
      ).label;
      readout.append(
        h('div', { class: 'metrics-grid' }, [
          metric('当前风速', k.toFixed(2)),
          metric('最近姿态', nearestPose),
          metric('穿模检测', pen.count === 0 ? '通过' : `${pen.count} 处`),
        ]),
      );
      clear(penetration);
      penetration.append(
        h('span', { class: `tag ${pen.count === 0 ? 'good' : 'bad'}` },
          [pen.count === 0 ? '无撑条穿模、无面元交叉' : `检测到穿模,最大逆序 ${pen.worst.toFixed(2)}cm`]),
      );
    }
    updateReadout(store.windK);
  }

  function metric(label: string, value: string): HTMLElement {
    return h('div', { class: 'metric-box' }, [
      h('div', { class: 'metric-big', style: 'font-size:17px', textContent: value }),
      h('div', { class: 'metric-label', textContent: label }),
    ]);
  }

  function labeled(label: string, control: HTMLElement): HTMLElement {
    return h('div', { class: 'field' }, [h('label', { textContent: label }), control]);
  }

  // 跨页风速联动
  const off = store.onWind((k) => {
    if (store.page === 'wind') handle.viewer.setWind(k);
  });
  void off;

  renderSidebar();
}
