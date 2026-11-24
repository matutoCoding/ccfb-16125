import { evaluateRigMatch, achievedMastBendCm, mastShape } from '../core/sailModel';
import { store } from '../core/store';
import type { MastCurveType, SailProfile } from '../core/types';
import { h, labeledField, numberInput, clear } from '../ui/dom';
import { mountViewer, viewModeButtons } from '../ui/viewerHook';
import type { ViewMode } from '../ui/SailViewer';
import { uid } from '../core/photoMeasure';

export function renderRigPage(host: HTMLElement, initialSail: SailProfile): void {
  let sail = initialSail;
  const wrap = h('div', { class: 'two-col' });
  const sidebar = h('div', { class: 'sidebar panel' });
  const stage = h('div', { class: 'stage' });
  wrap.append(sidebar, stage);
  host.append(wrap);

  let viewMode: ViewMode = 'chase';
  const handle = mountViewer(stage, sail, sail.rig, store.windK, store.settings);
  stage.append(viewModeButtons(viewMode, (m) => {
    viewMode = m;
    handle.viewer.setViewMode(m);
    // 重绘按钮高亮
    const toolbar = stage.querySelector('.viewer-toolbar');
    if (toolbar) {
      toolbar.replaceWith(viewModeButtons(m, (mm) => {
        viewMode = mm;
        handle.viewer.setViewMode(mm);
      }));
    }
  }));

  function renderSidebar(): void {
    clear(sidebar);
    const rig = sail.rig;
    const match = evaluateRigMatch(sail, rig);

    sidebar.append(h('h3', { textContent: '桅杆与收紧量' }));

    // 桅杆选择
    const mastSelect = h('select', {}, store.masts.map((m) =>
      h('option', {
        value: m.id,
        textContent: `${m.name}(${m.stiffness}/${m.curve === 'flextop' ? '软顶' : '均弯'})`,
        selected: m.stiffness === rig.mastStiffness && m.curve === rig.mastCurve,
      }),
    ));
    mastSelect.addEventListener('change', () => {
      const mast = store.masts.find((m) => m.id === mastSelect.value);
      if (!mast) return;
      void store.mutateCurrent((d) => {
        d.rig.mastStiffness = mast.stiffness;
        d.rig.mastCurve = mast.curve;
        return d;
      }).then(reload);
    });
    sidebar.append(labeledField('选用桅杆', mastSelect));

    const stiffnessInput = numberInput(rig.mastStiffness, 1, (v) =>
      persist((d) => void (d.rig.mastStiffness = v)));
    sidebar.append(labeledField('桅杆硬度指数(可调)', stiffnessInput));

    const curveSelect = h('select', {}, [
      h('option', { value: 'constant', textContent: '均匀弯曲', selected: rig.mastCurve === 'constant' }),
      h('option', { value: 'flextop', textContent: '软顶弯曲', selected: rig.mastCurve === 'flextop' }),
    ]);
    curveSelect.addEventListener('change', () =>
      persist((d) => void (d.rig.mastCurve = curveSelect.value as MastCurveType)));
    sidebar.append(labeledField('弯曲曲线', curveSelect));

    const downhaul = numberInput(rig.downhaulCm, 0.5, (v) =>
      persist((d) => void (d.rig.downhaulCm = Math.max(0, v))));
    sidebar.append(labeledField('下拉收紧量 cm', downhaul));
    const outhaul = numberInput(rig.outhaulCm, 0.5, (v) =>
      persist((d) => void (d.rig.outhaulCm = Math.max(0, v))));
    sidebar.append(labeledField('外拉收紧量 cm', outhaul));

    // 桅杆弯曲预览条(纯 CSS/SVG 示意)
    sidebar.append(h('h3', { textContent: '桅杆弯曲响应', style: 'margin-top:18px' }));
    sidebar.append(mastCurvePreview(sail));

    // 匹配判定
    const levelClass = match.level === 'warn' ? 'bad' : match.level === 'info' ? 'warn' : 'good';
    sidebar.append(
      h('div', { class: 'panel', style: 'margin-top:14px;background:var(--panel-2)' }, [
        h('div', { class: 'row', style: 'margin-bottom:8px' }, [
          h('span', { class: `tag ${levelClass}`, textContent: match.level === 'ok' ? '匹配' : match.level === 'warn' ? '不匹配' : '注意' }),
          `实弯 ${match.achievedBendCm.toFixed(1)}cm / 设计桅弧 ${match.designBendCm.toFixed(1)}cm / 偏差 ${match.bendGapCm.toFixed(1)}cm`,
        ]),
        ...match.messages.map((msg) => h('div', { class: `dim`, style: 'margin:4px 0;font-size:12.5px' }, [msg])),
      ]),
    );

    // 新增桅杆
    sidebar.append(h('h3', { textContent: '桅杆库', style: 'margin-top:18px' }));
    sidebar.append(
      h('div', {}, store.masts.map((m) =>
        h('div', { class: 'sail-card', style: 'padding:8px 10px' }, [
          h('div', { class: 'title', style: 'font-size:13px', textContent: m.name }),
          h('div', { class: 'meta', textContent: `硬度 ${m.stiffness} · ${m.curve === 'flextop' ? '软顶' : '均弯'} · ${m.lengthCm}cm` }),
        ]),
      )),
      h('button', {
        style: 'margin-top:8px',
        textContent: '+ 新增桅杆',
        onclick: () => {
          const name = prompt('桅杆名称');
          if (!name) return;
          const stiffness = parseFloat(prompt('硬度指数', '20') || '20');
          void store.addMast({
            id: uid('mast'),
            name,
            stiffness,
            curve: 'constant',
            lengthCm: 430,
          });
        },
      }),
    );
  }

  function mastCurvePreview(profile: SailProfile): HTMLElement {
    const canvas = h('canvas', { width: 260, height: 150 });
    const ctx = canvas.getContext('2d')!;
    const achieved = achievedMastBendCm(profile.rig);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const hh = i / 40;
      const x = 30 + mastShape(hh, profile.rig.mastCurve) * achieved * 6;
      const y = 135 - hh * 120;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 设计桅弧参考
    ctx.strokeStyle = '#f59e0b';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const hh = i / 40;
      const x = 30 + hh * hh * profile.designLuffCurveCm * 6;
      const y = 135 - hh * 120;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#93a5bb';
    ctx.font = '11px sans-serif';
    ctx.fillText('蓝:实际弯曲  橙虚线:设计桅弧', 12, 146);
    return canvas;
  }

  function persist(mutator: (d: SailProfile) => void): void {
    void store.mutateCurrent((d) => {
      mutator(d);
      return d;
    }).then(reload);
  }

  function reload(): void {
    const cur = store.currentSail;
    if (!cur) return;
    sail = cur;
    handle.viewer.build(cur, cur.rig, store.windK);
    renderSidebar();
  }

  renderSidebar();
}
