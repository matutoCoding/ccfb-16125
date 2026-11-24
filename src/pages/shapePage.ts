import { battenBays, measureSection } from '../core/sailModel';
import { rebuildLattice } from '../core/seedData';
import { store } from '../core/store';
import type { LatticePoint, SailProfile } from '../core/types';
import { h, clear, labeledField, numberInput, slider } from '../ui/dom';
import { mountViewer } from '../ui/viewerHook';
import { drawSectionChart, drawTwistChart } from '../ui/charts';

export function renderShapePage(host: HTMLElement, initialSail: SailProfile): void {
  let sail = initialSail;
  const wrap = h('div', { class: 'two-col' });
  const sidebar = h('div', { class: 'sidebar panel' });
  const stage = h('div', { class: 'stage' });
  wrap.append(sidebar, stage);
  host.append(wrap);

  const handle = mountViewer(stage, sail, sail.rig, store.windK, store.settings);
  handle.viewer.setLatticeVisible(true);

  let selectedBay = 0;
  let selectedPointId: string | null = null;
  let dragMode: 'dz' | 'dx' = 'dz';

  // ---------------- 晶格点拾取与拖拽 ----------------
  const canvas = handle.host.querySelector('canvas')!;
  canvas.addEventListener('pointerdown', (ev) => {
    const ndc = handle.viewer.screenToNdc(ev);
    const id = handle.viewer.pickLatticePoint(ndc.x, ndc.y);
    if (!id) return;
    const point = sail.lattice.points.find((p) => p.id === id);
    if (!point) return;
    selectedBay = point.bayIndex;
    selectedPointId = id;
    dragMode = ev.shiftKey ? 'dx' : 'dz';
    renderSidebar();
    const startY = ev.clientY;
    const startDz = point.dz;
    const startDx = point.dx;
    const move = (e: PointerEvent): void => {
      const delta = (startY - e.clientY) * 0.4; // 向上拖=加深
      void store.mutateCurrent((d) => {
        const target = d.lattice.points.find((p) => p.id === id);
        if (!target) return d;
        if (dragMode === 'dz') target.dz = Number(clampNum(startDz + delta, -25, 25).toFixed(2));
        else target.dx = Number(clampNum(startDx + delta, -20, 20).toFixed(2));
        return d;
      }).then(() => {
        const cur = store.currentSail;
        if (!cur) return;
        sail = cur;
        handle.viewer.build(cur, cur.rig, store.windK);
        handle.viewer.setLatticeVisible(true);
        renderSidebar();
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function clampNum(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }

  function renderSidebar(): void {
    clear(sidebar);
    const bays = battenBays(sail);
    sidebar.append(h('h3', { textContent: '控制晶格' }));
    sidebar.append(
      h('div', { class: 'dim', style: 'font-size:12px;margin-bottom:10px' },
        [ '左键拖球改吃风深度,Shift+拖改弦向位置。改动只落在选中的撑条区间,撑条线位移严格为 0。' ]),
    );

    // 区间选择
    const bayChips = h('div', { class: 'chip-array', style: 'margin-bottom:12px' });
    bays.forEach((bay, i) => {
      bayChips.append(h('span', {
        class: `chip${selectedBay === i ? ' active' : ''}`,
        textContent: `区间 ${i + 1}(${(bay.h0 * 100).toFixed(0)}–${(bay.h1 * 100).toFixed(0)}%)`,
        onclick: () => {
          selectedBay = i;
          selectedPointId = null;
          renderSidebar();
        },
      }));
    });
    sidebar.append(bayChips);

    // 密度
    const vDivs = numberInput(sail.lattice.verticalDivs, 1, () => undefined);
    const hDivs = numberInput(sail.lattice.horizontalDivs, 2, () => undefined);
    sidebar.append(
      h('div', { class: 'row' }, [
        h('div', { style: 'flex:1' }, [labeledField('纵向格数/区间', vDivs)]),
        h('div', { style: 'flex:1' }, [labeledField('弦向格数', hDivs)]),
      ]),
      h('button', {
        textContent: '调整晶格密度',
        onclick: () => {
          const v = clampNum(Math.round(parseFloat(vDivs.value) || 2), 1, 5);
          const hh = clampNum(Math.round(parseFloat(hDivs.value) || 4), 2, 8);
          void store.mutateCurrent((d) => {
            d.lattice = rebuildLattice(d, v, hh);
            return d;
          }).then(() => {
            const cur = store.currentSail!;
            sail = cur;
            handle.viewer.build(cur, cur.rig, store.windK);
            handle.viewer.setLatticeVisible(true);
            renderSidebar();
          });
        },
      }),
    );

    // 选中点的精确输入
    const points = sail.lattice.points.filter((p) => p.bayIndex === selectedBay);
    sidebar.append(h('h3', { textContent: '控制点位移(cm)', style: 'margin-top:16px' }));
    const pointTable = h('table', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { textContent: '点' }),
        h('th', { textContent: 'h' }),
        h('th', { textContent: 's' }),
        h('th', { textContent: '深度 dz' }),
        h('th', { textContent: '弦向 dx' }),
      ])]),
      h('tbody', {}, points.map((p) => {
        const row = h('tr', {
          style: p.id === selectedPointId ? 'background:#153047' : '',
          onclick: () => {
            selectedPointId = p.id;
            renderSidebar();
          },
        }, [
          h('td', { textContent: p.id.slice(-4) }),
          h('td', { class: 'mono', textContent: p.h.toFixed(2) }),
          h('td', { class: 'mono', textContent: p.s.toFixed(2) }),
          h('td', { class: 'mono', textContent: p.dz.toFixed(1) }),
          h('td', { class: 'mono', textContent: p.dx.toFixed(1) }),
        ]);
        return row;
      })),
    ]);
    sidebar.append(h('div', { class: 'scroll-x' }, [pointTable]));

    const selected: LatticePoint | undefined = points.find((p) => p.id === selectedPointId);
    if (selected) {
      const dzSlider = slider(selected.dz, -25, 25, 0.1, (v) => updatePoint(selected.id, 'dz', v));
      const dxSlider = slider(selected.dx, -20, 20, 0.1, (v) => updatePoint(selected.id, 'dx', v));
      sidebar.append(
        h('div', { style: 'margin-top:12px' }, [
          labeledField(`深度位移 dz(点 h=${selected.h.toFixed(2)} s=${selected.s.toFixed(2)})`, dzSlider.wrap),
          labeledField('弦向位移 dx', dxSlider.wrap),
          h('button', {
            textContent: '该点归零',
            onclick: () => updatePoint(selected.id, 'both', 0),
          }),
        ]),
      );
    }

    sidebar.append(
      h('button', {
        class: 'danger',
        style: 'margin-top:14px',
        textContent: '全部晶格位移归零',
        onclick: () => {
          void store.mutateCurrent((d) => {
            d.lattice.points.forEach((p) => {
              p.dz = 0;
              p.dx = 0;
            });
            return d;
          }).then(() => {
            sail = store.currentSail!;
            handle.viewer.build(sail, sail.rig, store.windK);
            handle.viewer.setLatticeVisible(true);
            renderSidebar();
          });
        },
      }),
    );

    // 截面曲线 + 扭转
    const sectionCanvas = h('canvas', { width: 280, height: 200, style: 'margin-top:14px' });
    drawSectionChart(sectionCanvas, sail, sail.rig, { k: store.windK, showLabels: true });
    const twistCanvas = h('canvas', { width: 280, height: 170, style: 'margin-top:10px' });
    const metrics = sail.battens.map((b) => measureSection(sail, sail.rig, b.heightRatio, store.windK, true, 160));
    drawTwistChart(twistCanvas, metrics);
    sidebar.append(h('h3', { textContent: '实时截面与扭转', style: 'margin-top:16px' }), sectionCanvas, twistCanvas);
  }

  function updatePoint(id: string, field: 'dz' | 'dx' | 'both', value: number): void {
    void store.mutateCurrent((d) => {
      const p = d.lattice.points.find((pp) => pp.id === id);
      if (!p) return d;
      if (field === 'both') {
        p.dz = 0;
        p.dx = 0;
      } else {
        p[field] = value;
      }
      return d;
    }).then(() => {
      sail = store.currentSail!;
      handle.viewer.build(sail, sail.rig, store.windK);
      handle.viewer.setLatticeVisible(true);
      renderSidebar();
    });
  }

  renderSidebar();
}
