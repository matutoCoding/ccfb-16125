import { CATEGORY_LABEL, FABRIC_LABEL, type SailProfile } from '../core/types';
import { achievedMastBendCm, evaluateRigMatch, measureSection } from '../core/sailModel';
import { store } from '../core/store';
import { h } from '../ui/dom';
import { mountViewer } from '../ui/viewerHook';
import { drawSectionChart } from '../ui/charts';

export function renderSheetPage(host: HTMLElement, sail: SailProfile): void {
  const wrap = h('div', { class: 'grid', style: 'max-width:1080px;margin:0 auto' });
  host.append(wrap);

  wrap.append(
    h('div', { class: 'panel' }, [
      h('div', { class: 'row', style: 'justify-content:space-between' }, [
        h('h3', { style: 'margin:0', textContent: `设计单 · ${sail.name} v${sail.version}` }),
        h('button', { class: 'primary', textContent: '打印 / 存 PDF', onclick: () => window.print() }),
      ]),
      h('div', { class: 'dim', style: 'margin-top:8px' }, [
        `${CATEGORY_LABEL[sail.category]} · 面积 ${sail.areaM2}㎡ · 前缘 ${sail.luffCm}cm · 下缘 ${sail.footCm}cm · 生成于 ${new Date(sail.createdAt).toLocaleDateString('zh-CN')}`,
      ]),
    ]),
  );

  // 效果图:正面 + 侧面
  const viewsPanel = h('div', { class: 'panel' });
  wrap.append(viewsPanel);
  viewsPanel.append(h('h3', { textContent: '正面 / 侧面效果图' }));
  const viewsHost = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;height:380px' });
  viewsPanel.append(viewsHost);

  const front = mountViewer(viewsHost, sail, sail.rig, 0.5, store.settings);
  front.viewer.setViewMode('chase');
  const side = mountViewer(viewsHost, sail, sail.rig, 0.5, store.settings);
  side.viewer.setViewMode('side');

  // 桅杆与推荐收紧量
  const match = evaluateRigMatch(sail, sail.rig);
  const rigPanel = h('div', { class: 'panel' });
  wrap.append(rigPanel);
  rigPanel.append(
    h('h3', { textContent: '推荐桅杆与收紧量' }),
    h('table', {}, [
      h('tbody', {}, [
        row('推荐桅杆硬度', `${sail.recommendedStiffness[0]}–${sail.recommendedStiffness[1]}`),
        row('当前配置硬度', String(sail.rig.mastStiffness)),
        row('弯曲曲线', sail.rig.mastCurve === 'flextop' ? '软顶弯曲' : '均匀弯曲'),
        row('设计桅弧', `${sail.designLuffCurveCm} cm`),
        row('当前实弯', `${achievedMastBendCm(sail.rig).toFixed(1)} cm`),
        row('推荐下拉', `${sail.rig.downhaulCm.toFixed(1)} cm(容差 ±1.5cm)`),
        row('推荐外拉', `${sail.rig.outhaulCm.toFixed(1)} cm(容差 ±1cm)`),
        row('匹配结论', match.messages.join(';')),
      ]),
    ]),
  );

  // 各撑条截面数据
  const metrics = sail.battens.map((b) =>
    measureSection(sail, sail.rig, b.heightRatio, 0.5, true, 240),
  );
  const secPanel = h('div', { class: 'panel' });
  wrap.append(secPanel);
  secPanel.append(h('h3', { textContent: '各撑条截面数据(满帆姿态)' }));
  secPanel.append(h('div', { class: 'scroll-x' }, [
    h('table', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { textContent: '撑条' }),
        h('th', { textContent: '高度' }),
        h('th', { textContent: '弦长 cm' }),
        h('th', { textContent: '弦高比' }),
        h('th', { textContent: '深度 cm' }),
        h('th', { textContent: '最深点' }),
        h('th', { textContent: '扭转角' }),
      ])]),
      h('tbody', {}, metrics.map((m, i) => h('tr', {}, [
        h('td', { textContent: `#${i + 1}` }),
        h('td', { class: 'mono', textContent: (m.heightRatio * 100).toFixed(1) + '%' }),
        h('td', { class: 'mono', textContent: m.chordCm.toFixed(1) }),
        h('td', { class: 'mono', textContent: (m.camber * 100).toFixed(2) + '%' }),
        h('td', { class: 'mono', textContent: m.depthCm.toFixed(2) }),
        h('td', { class: 'mono', textContent: (m.maxDraftPos * 100).toFixed(1) + '%' }),
        h('td', { class: 'mono', textContent: m.twistDeg.toFixed(1) + '°' }),
      ]))),
    ]),
  ]));

  // 截面叠加曲线图
  const chartPanel = h('div', { class: 'panel' });
  wrap.append(chartPanel);
  chartPanel.append(h('h3', { textContent: '截面曲线叠加(从下到上)' }));
  const chartCanvas = h('canvas', { width: 980, height: 360 });
  chartPanel.append(chartCanvas);
  drawSectionChart(chartCanvas, sail, sail.rig, { k: 0.5, showLabels: true });

  // 同型号版次叠加
  const versions = store.sails
    .filter((s) => s.modelId === sail.modelId)
    .sort((a, b) => a.version - b.version);
  if (versions.length > 1) {
    const vPanel = h('div', { class: 'panel' });
    wrap.append(vPanel);
    vPanel.append(h('h3', { textContent: `同型号版次截面叠加(${versions.length} 个版次)` }));
    const vCanvas = h('canvas', { width: 980, height: 360 });
    vPanel.append(vCanvas);
    const [base, ...rest] = versions;
    const compareMetrics = rest.map((v) =>
      v.battens.map((b) => measureSection(v, v.rig, b.heightRatio, 0.5, true, 160)),
    );
    drawSectionChart(vCanvas, base, base.rig, {
      k: 0.5,
      showLabels: false,
      compare: compareMetrics.length === 1
        ? { label: `v${rest[0].version}`, metrics: compareMetrics[0] }
        : undefined,
    });
    vPanel.append(h('div', { class: 'dim', style: 'font-size:12px;margin-top:6px' }, [
      `实线:v${base.version};虚线:其他版次。版次列表:${versions.map((v) => `v${v.version}`).join('、')}`,
    ]));
  }

  // 面料拼块
  const fabricPanel = h('div', { class: 'panel' });
  wrap.append(fabricPanel);
  fabricPanel.append(
    h('h3', { textContent: '面料拼块' }),
    h('table', {}, [h('tbody', {}, sail.patches.map((p) =>
      row(`${(p.h0 * 100).toFixed(0)}%–${(p.h1 * 100).toFixed(0)}% 高度区间`, FABRIC_LABEL[p.fabric]),
    ))]),
  );
}

function row(k: string, v: string): HTMLTableRowElement {
  return h('tr', {}, [
    h('td', { style: 'color:var(--fg-dim)', textContent: k }),
    h('td', { textContent: v }),
  ]);
}
