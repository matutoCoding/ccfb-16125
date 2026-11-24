import { CATEGORY_LABEL, type SailCategory, type SailProfile } from '../core/types';
import { cloneAsVersion, rebuildLattice } from '../core/seedData';
import { scaleFactorBetween } from '../core/sailModel';
import { store } from '../core/store';
import { h, clear, labeledField, numberInput } from '../ui/dom';
import { uid } from '../core/photoMeasure';

export function renderArchivePage(host: HTMLElement): void {
  const wrap = h('div', { class: 'two-col' });
  const sidebar = h('div', { class: 'sidebar' });
  const detail = h('div', { class: 'stage panel' });
  wrap.append(sidebar, detail);
  host.append(wrap);

  const categories: SailCategory[] = ['race', 'freestyle', 'wave'];
  const filterState: { cat: SailCategory | 'all' } = { cat: 'all' };

  function renderList(): void {
    clear(sidebar);
    sidebar.append(
      h('div', { class: 'row', style: 'margin-bottom:10px' }, [
        h('button', {
          class: 'primary',
          textContent: '+ 新建帆型',
          onclick: () => showCreateForm(),
        }),
      ]),
    );
    const chips = h('div', { class: 'chip-array', style: 'margin-bottom:12px' });
    (['all', ...categories] as const).forEach((cat) => {
      chips.append(
        h('span', {
          class: `chip${filterState.cat === cat ? ' active' : ''}`,
          textContent: cat === 'all' ? '全部' : CATEGORY_LABEL[cat],
          onclick: () => {
            filterState.cat = cat;
            renderList();
          },
        }),
      );
    });
    sidebar.append(chips);

    const list = store.sails.filter((s) => filterState.cat === 'all' || s.category === filterState.cat);
    for (const sail of list) {
      sidebar.append(
        h('div', {
          class: `sail-card${sail.id === store.currentSailId ? ' selected' : ''}`,
          onclick: () => store.selectSail(sail.id),
        }, [
          h('div', { class: 'title' }, [`${sail.name} v${sail.version}`]),
          h('div', { class: 'meta' }, [
            h('span', { class: 'tag', textContent: CATEGORY_LABEL[sail.category] }),
            `${sail.areaM2}㎡ · 前缘 ${sail.luffCm}cm · 下缘 ${sail.footCm}cm · ${sail.battens.length} 根撑条`,
          ]),
        ]),
      );
    }
  }

  function showCreateForm(): void {
    clear(detail);
    detail.append(h('h3', { textContent: '新建帆型档案' }));
    const nameInput = h('input', { value: '新帆型' });
    const areaInput = numberInput(6.0, 0.1, () => undefined);
    const luffInput = numberInput(450, 1, () => undefined);
    const footInput = numberInput(180, 1, () => undefined);
    const battenInput = numberInput(6, 1, () => undefined);
    const catSelect = h('select', {}, [
      h('option', { value: 'race', textContent: '竞速' }),
      h('option', { value: 'freestyle', textContent: '自由式' }),
      h('option', { value: 'wave', textContent: '波浪' }),
    ]);
    detail.append(
      labeledField('名称', nameInput),
      labeledField('分类', catSelect),
      h('div', { class: 'row' }, [
        h('div', { style: 'flex:1' }, [labeledField('面积 ㎡', areaInput)]),
        h('div', { style: 'flex:1' }, [labeledField('前缘长 cm', luffInput)]),
      ]),
      h('div', { class: 'row' }, [
        h('div', { style: 'flex:1' }, [labeledField('下缘长 cm', footInput)]),
        h('div', { style: 'flex:1' }, [labeledField('撑条根数', battenInput)]),
      ]),
      h('button', {
        class: 'primary',
        textContent: '创建',
        onclick: () => {
          const count = Math.max(3, Math.min(9, Math.round(parseFloat(battenInput.value) || 6)));
          const battens = Array.from({ length: count }, (_, i) => {
            const hr = 0.12 + (0.78 * i) / (count - 1);
            return {
              id: uid('batten'),
              heightRatio: Number(hr.toFixed(4)),
              camber: 0.1,
              maxDraftPos: 0.4,
              twistDeg: Number((12 * hr * hr + 1.5).toFixed(2)),
            };
          });
          const maxChord = (parseFloat(areaInput.value) * 10000 * 0.72) / parseFloat(luffInput.value);
          const sail: SailProfile = {
            id: uid('sail'),
            modelId: uid('model'),
            name: nameInput.value || '未命名',
            category: catSelect.value as SailCategory,
            version: 1,
            areaM2: parseFloat(areaInput.value),
            luffCm: parseFloat(luffInput.value),
            footCm: parseFloat(footInput.value),
            chordKnots: [
              { h: 0, chordCm: parseFloat(footInput.value) * 0.78 },
              { h: 0.18, chordCm: maxChord },
              { h: 0.55, chordCm: maxChord * 0.92 },
              { h: 0.85, chordCm: maxChord * 0.55 },
              { h: 1, chordCm: maxChord * 0.12 },
            ],
            designLuffCurveCm: 14,
            recommendedStiffness: [16, 22],
            battens,
            patches: [
              { id: uid('p'), fabric: 'monofilm', h0: 0.1, h1: 0.72 },
              { id: uid('p'), fabric: 'xply', h0: 0.72, h1: 1 },
              { id: uid('p'), fabric: 'plain', h0: 0, h1: 0.1 },
            ],
            lattice: { verticalDivs: 2, horizontalDivs: 4, points: [] },
            rig: { mastStiffness: 19, mastCurve: 'constant', downhaulCm: 6, outhaulCm: 3 },
            notes: '',
            createdAt: Date.now(),
          };
          // 补齐晶格点
          sail.lattice = rebuildLattice(sail, 2, 4);
          void store.upsertSail(sail).then(() => {
            renderList();
            renderDetail(sail);
          });
        },
      }),
    );
  }

  function renderDetail(sail: SailProfile): void {
    clear(detail);
    const sameSeries = store.sails.filter((s) => s.modelId === sail.modelId).sort((a, b) => a.areaM2 - b.areaM2);
    detail.append(
      h('h3', { textContent: `${sail.name} v${sail.version}` }),
      h('div', { class: 'metrics-grid', style: 'margin-bottom:14px' }, [
        metric('面积', `${sail.areaM2} ㎡`),
        metric('前缘长', `${sail.luffCm} cm`),
        metric('下缘长', `${sail.footCm} cm`),
        metric('设计桅弧', `${sail.designLuffCurveCm} cm`),
        metric('推荐硬度', `${sail.recommendedStiffness[0]}–${sail.recommendedStiffness[1]}`),
        metric('撑条', `${sail.battens.length} 根`),
      ]),
    );

    // 撑条表
    const table = h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { textContent: '撑条' }),
          h('th', { textContent: '高度比例' }),
          h('th', { textContent: '弦高比' }),
          h('th', { textContent: '最深点位置' }),
          h('th', { textContent: '扭转角' }),
        ]),
      ]),
      h('tbody', {}, sail.battens.map((b, i) => h('tr', {}, [
        h('td', { textContent: `#${i + 1}` }),
        h('td', { class: 'mono', textContent: (b.heightRatio * 100).toFixed(1) + '%' }),
        h('td', { class: 'mono', textContent: (b.camber * 100).toFixed(2) + '%' }),
        h('td', { class: 'mono', textContent: (b.maxDraftPos * 100).toFixed(1) + '%' }),
        h('td', { class: 'mono', textContent: b.twistDeg.toFixed(1) + '°' }),
      ]))),
    ]);
    detail.append(h('div', { class: 'scroll-x panel', style: 'padding:10px;margin-bottom:14px' }, [table]));

    // 同系列缩放关系
    if (sameSeries.length > 1) {
      const scaleTable = h('table', {}, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { textContent: '帆型' }),
            h('th', { textContent: '面积 ㎡' }),
            h('th', { textContent: '相对本帆线性缩放' }),
            h('th', { textContent: '前缘缩放(实测比)' }),
          ]),
        ]),
        h('tbody', {}, sameSeries.map((other) => h('tr', {}, [
          h('td', { textContent: `${other.name} v${other.version}` }),
          h('td', { class: 'mono', textContent: other.areaM2.toFixed(1) }),
          h('td', { class: 'mono', textContent: scaleFactorBetween(sail.areaM2, other.areaM2).toFixed(3) }),
          h('td', { class: 'mono', textContent: (other.luffCm / sail.luffCm).toFixed(3) }),
        ]))),
      ]);
      detail.append(h('h3', { textContent: '同系列尺寸缩放关系' }), scaleTable);
    }

    detail.append(
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          textContent: '复制为新版次',
          onclick: () => {
            const nextVersion = Math.max(...sameSeries.map((s) => s.version)) + 1;
            const copy = cloneAsVersion(sail, nextVersion);
            void store.upsertSail(copy).then(() => {
              renderList();
              renderDetail(copy);
            });
          },
        }),
        h('button', {
          class: 'danger',
          textContent: '删除该帆型',
          onclick: () => {
            if (confirm(`确认删除 ${sail.name} v${sail.version}?关联测帆照片会一并删除。`)) {
              void store.removeSail(sail.id).then(renderList);
            }
          },
        }),
      ]),
    );
  }

  function metric(label: string, value: string): HTMLElement {
    return h('div', { class: 'metric-box' }, [
      h('div', { class: 'metric-big', textContent: value }),
      h('div', { class: 'metric-label', textContent: label }),
    ]);
  }

  renderList();
  const cur = store.currentSail;
  if (cur) renderDetail(cur);
}
