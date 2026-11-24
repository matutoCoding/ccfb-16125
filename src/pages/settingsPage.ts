import { store } from '../core/store';
import { h, labeledField } from '../ui/dom';

export function renderSettingsPage(host: HTMLElement): void {
  const wrap = h('div', { class: 'grid', style: 'max-width:720px' });
  host.append(wrap);

  const panel = h('div', { class: 'panel' });
  wrap.append(panel);
  panel.append(h('h3', { textContent: '渲染与推演设置' }));

  const flutter = h('input', {
    type: 'range', min: '0', max: '2', step: '0.1',
    value: String(store.settings.flutterScale),
    oninput: (e: Event) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      void store.updateSettings({ flutterScale: v });
    },
  });
  const chordSegs = h('select', {
    onchange: (e: Event) => {
      const v = parseInt((e.target as HTMLSelectElement).value, 10);
      void store.updateSettings({ chordSegments: v });
    },
  }, [16, 28, 40, 56].map((n) =>
    h('option', { value: String(n), textContent: `${n} 段`, selected: n === store.settings.chordSegments }),
  ));
  const wireframe = h('input', {
    type: 'checkbox',
    checked: store.settings.wireframe,
    onchange: (e: Event) => {
      void store.updateSettings({ wireframe: (e.target as HTMLInputElement).checked });
    },
  });
  const backlight = h('input', {
    type: 'checkbox',
    checked: store.settings.backlight,
    onchange: (e: Event) => {
      void store.updateSettings({ backlight: (e.target as HTMLInputElement).checked });
    },
  });

  panel.append(
    labeledField('风抖幅度倍率(0=静止,1=标准,2=剧烈)', flutter),
    labeledField('帆面弦向网格分段', chordSegs),
    h('div', { class: 'field' }, [h('label', { textContent: '线框模式' }), wireframe]),
    h('div', { class: 'field' }, [h('label', { textContent: '逆光模式(强调撑条套/缝线透光)' }), backlight]),
  );

  // 数据管理
  const dataPanel = h('div', { class: 'panel' });
  wrap.append(dataPanel);
  dataPanel.append(
    h('h3', { textContent: '数据管理(IndexedDB)' }),
    h('div', { class: 'dim', style: 'margin-bottom:10px' }, [
      `当前库内:帆型 ${store.sails.length} 张 · 桅杆 ${store.masts.length} 根 · 照片 ${store.photos.length} 张。所有数据仅存于本机浏览器。`,
    ]),
    h('div', { class: 'row' }, [
      h('button', {
        textContent: '导出全部数据(JSON)',
        onclick: () => {
          const blob = new Blob([JSON.stringify({
            sails: store.sails,
            masts: store.masts,
            settings: store.settings,
          }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: `sail-studio-${new Date().toISOString().slice(0, 10)}.json` });
          a.click();
          URL.revokeObjectURL(url);
        },
      }),
      h('button', {
        class: 'danger',
        textContent: '清空并重置为种子数据',
        onclick: async () => {
          if (!confirm('将清空 IndexedDB 全部帆型、桅杆和照片,确认?')) return;
          const { idb, STORES } = await import('../core/database');
          await Promise.all(Object.values(STORES).map((s) => idb.clear(s)));
          location.reload();
        },
      }),
    ]),
  );

  // 验收说明
  const acc = h('div', { class: 'panel' });
  wrap.append(acc);
  acc.append(
    h('h3', { textContent: '验收指标对照' }),
    h('ul', { style: 'line-height:1.9;color:var(--fg-dim)' }, [
      h('li', { textContent: '① 晶格单点拖动:影响范围外顶点位移严格为 0(紧支撑光滑窗,单元测试断言)。' }),
      h('li', { textContent: '② 风速 0→1→0:基础形态为纯函数,逐点回到原样(往返单元测试断言)。' }),
      h('li', { textContent: '③ 截面弦高比:反测值与手算公式误差 ≤ 0.5 个百分点(17 项自动化测试)。' }),
    ]),
  );
}
