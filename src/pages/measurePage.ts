import { generateSyntheticPhoto } from '../core/syntheticPhoto';
import { measureBand } from '../core/photoMeasure';
import { measureSection } from '../core/sailModel';
import { store } from '../core/store';
import type { PhotoBand, PhotoRecord, Point2, SailProfile } from '../core/types';
import { h, clear } from '../ui/dom';
import { mountViewer } from '../ui/viewerHook';
import { uid } from '../core/photoMeasure';

type MarkerKind = 'leading' | 'deepest' | 'trailing';

export function renderMeasurePage(host: HTMLElement, initialSail: SailProfile): void {
  let sail = initialSail;
  const wrap = h('div', { class: 'two-col' });
  const sidebar = h('div', { class: 'sidebar panel' });
  const stage = h('div', { class: 'stage' });
  wrap.append(sidebar, stage);
  host.append(wrap);

  const handle = mountViewer(stage, sail, sail.rig, 0.5, store.settings);
  let activePhoto: PhotoRecord | null = store.photos[0] ?? null;
  let activeBandId: string | null = activePhoto?.bands[0]?.id ?? null;
  let markerKind: MarkerKind = 'deepest';

  function renderSidebar(): void {
    clear(sidebar);
    sidebar.append(h('h3', { textContent: '测帆照片' }));

    sidebar.append(
      h('div', { class: 'row', style: 'margin-bottom:10px' }, [
        h('button', {
          class: 'primary',
          textContent: '合成测帆照片',
          onclick: () => {
            const photo = generateSyntheticPhoto(sail, sail.rig, {
              seed: Date.now() % 100000,
              k: 0.5,
              perspectiveDeg: 14,
            });
            void store.addPhoto(photo).then(() => {
              activePhoto = photo;
              activeBandId = photo.bands[0]?.id ?? null;
              renderSidebar();
            });
          },
        }),
        uploadButton(),
      ]),
    );

    // 照片列表
    if (store.photos.length === 0) {
      sidebar.append(h('div', { class: 'dim', textContent: '暂无照片,可一键合成带透视和反光的测帆照片。' }));
    } else {
      for (const photo of store.photos) {
        sidebar.append(h('div', {
          class: `sail-card${activePhoto?.id === photo.id ? ' selected' : ''}`,
          onclick: () => {
            activePhoto = photo;
            activeBandId = photo.bands[0]?.id ?? null;
            renderSidebar();
          },
        }, [
          h('div', { class: 'title', style: 'font-size:13px', textContent: photo.name }),
          h('div', { class: 'meta', textContent: `${photo.bands.length} 条测量条带 · ${photo.width}×${photo.height}` }),
        ]));
      }
    }

    if (activePhoto) {
      sidebar.append(
        h('button', {
          class: 'danger',
          style: 'margin:8px 0',
          textContent: '删除该照片',
          onclick: () => {
            const id = activePhoto!.id;
            activePhoto = null;
            void store.removePhoto(id).then(renderSidebar);
          },
        }),
      );
      renderBandEditor();
      renderComparison();
    }
  }

  function uploadButton(): HTMLElement {
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const photo: PhotoRecord = {
            id: uid('photo'),
            sailId: sail.id,
            name: file.name,
            dataUrl: reader.result as string,
            width: img.width,
            height: img.height,
            bands: sail.battens.map((b) => {
              const cx = img.width * 0.5;
              const cy = img.height * (1 - b.heightRatio);
              const w = img.width * 0.6;
              const bandH = Math.max(18, img.height * 0.02);
              const quad: Point2[] = [
                { x: cx - w / 2, y: cy - bandH },
                { x: cx + w / 2, y: cy - bandH },
                { x: cx + w / 2, y: cy + bandH },
                { x: cx - w / 2, y: cy + bandH },
              ];
              return {
                id: uid('band'),
                heightRatio: b.heightRatio,
                quad,
                leading: quad[0],
                trailing: quad[1],
                deepest: { x: cx, y: cy },
              };
            }),
            createdAt: Date.now(),
          };
          void store.addPhoto(photo).then(() => {
            activePhoto = photo;
            activeBandId = photo.bands[0]?.id ?? null;
            renderSidebar();
          });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
    return h('div', {}, [
      h('button', { textContent: '导入海上照片', onclick: () => fileInput.click() }),
      fileInput,
    ]);
  }

  function renderBandEditor(): void {
    const photo = activePhoto!;
    const band = photo.bands.find((b) => b.id === activeBandId) ?? photo.bands[0];
    if (!band) return;
    activeBandId = band.id;

    sidebar.append(h('h3', { textContent: '条带标记', style: 'margin-top:14px' }));
    const bandChips = h('div', { class: 'chip-array', style: 'margin-bottom:8px' }, photo.bands.map((b, i) =>
      h('span', {
        class: `chip${b.id === band.id ? ' active' : ''}`,
        textContent: `#${i + 1} ${(b.heightRatio * 100).toFixed(0)}%`,
        onclick: () => {
          activeBandId = b.id;
          renderSidebar();
        },
      }),
    ));
    sidebar.append(bandChips);

    const markerChips = h('div', { class: 'chip-array' }, (
      [['leading', '前缘'], ['deepest', '最深点'], ['trailing', '后缘']] as [MarkerKind, string][]
    ).map(([kind, label]) =>
      h('span', {
        class: `chip${markerKind === kind ? ' active' : ''}`,
        textContent: label,
        onclick: () => {
          markerKind = kind;
          renderSidebar();
        },
      }),
    ));
    sidebar.append(markerChips);

    const canvas = h('canvas', {
      class: 'measure-canvas',
      width: 300,
      style: 'margin-top:10px;background:#0a111b',
    }) as HTMLCanvasElement;
    drawPhotoWithBands(canvas, photo, band);
    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = photo.width / rect.width;
      const scaleY = photo.height / rect.height;
      const point: Point2 = {
        x: (ev.clientX - rect.left) * scaleX,
        y: (ev.clientY - rect.top) * scaleY,
      };
      const target = photo.bands.find((b) => b.id === activeBandId)!;
      target[markerKind] = point;
      if (markerKind === 'leading') target.quad[0] = point;
      if (markerKind === 'trailing') target.quad[1] = point;
      target.measuredCamber = undefined;
      target.measuredDraftPos = undefined;
      void store.addPhoto({ ...photo }).then(() => {
        sail = store.currentSail!;
        drawPhotoWithBands(canvas, photo, target);
        renderComparison();
      });
    });
    sidebar.append(canvas);
  }

  function drawPhotoWithBands(canvas: HTMLCanvasElement, photo: PhotoRecord, active: PhotoBand): void {
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      const scale = canvas.width / photo.width;
      canvas.height = Math.round(photo.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const b of photo.bands) {
        const isActive = b.id === active.id;
        ctx.strokeStyle = isActive ? '#f59e0b' : 'rgba(56,189,248,0.7)';
        ctx.lineWidth = isActive ? 2.5 : 1.2;
        ctx.beginPath();
        b.quad.forEach((p, i) => {
          const x = p.x * scale;
          const y = p.y * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
        drawMarker(ctx, b.leading, '#4ade80', scale);
        drawMarker(ctx, b.deepest, '#f87171', scale);
        drawMarker(ctx, b.trailing, '#38bdf8', scale);
      }
    };
    img.src = photo.dataUrl;
  }

  function drawMarker(ctx: CanvasRenderingContext2D, p: Point2, color: string, scale: number): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderComparison(): void {
    const photo = activePhoto!;
    const rows = photo.bands.map((band) => {
      const measured = measureBand(band);
      band.measuredCamber = measured.camber;
      band.measuredDraftPos = measured.draftPos;
      const sim = measureSection(sail, sail.rig, band.heightRatio, 0.5, true, 200);
      const diffPct = Math.abs(measured.camber - sim.camber) * 100;
      return { band, measured, sim, diffPct };
    });
    // 偏差染色到 3D 帆面
    handle.viewer.setDeviations(rows.map((r) => ({ h: r.band.heightRatio, diffPct: r.diffPct })));

    const table = h('table', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { textContent: '高度' }),
        h('th', { textContent: '照片弦高比' }),
        h('th', { textContent: '推演弦高比' }),
        h('th', { textContent: '偏差(百分点)' }),
        h('th', { textContent: '最深点' }),
      ])]),
      h('tbody', {}, rows.map((r) => h('tr', {
        style: r.diffPct > 1.5 ? 'background:#3a2323' : '',
      }, [
        h('td', { class: 'mono', textContent: (r.band.heightRatio * 100).toFixed(1) + '%' }),
        h('td', { class: 'mono', textContent: (r.measured.camber * 100).toFixed(2) + '%' }),
        h('td', { class: 'mono', textContent: (r.sim.camber * 100).toFixed(2) + '%' }),
        h('td', {
          class: `mono ${r.diffPct > 1.5 ? 'bad-text' : r.diffPct > 0.5 ? 'warn-text' : 'good-text'}`,
          textContent: r.diffPct.toFixed(2),
        }),
        h('td', { class: 'mono', textContent: (r.measured.draftPos * 100).toFixed(1) + '%' }),
      ]))),
    ]);
    sidebar.append(h('h3', { textContent: '同高度偏差比对', style: 'margin-top:14px' }));
    sidebar.append(h('div', { class: 'scroll-x' }, [table]));
    sidebar.append(h('div', { class: 'dim', style: 'font-size:12px;margin-top:8px' }, [
      '偏差 >0.5 个百分点起在 3D 帆面染红,颜色越深偏差越大。',
    ]));
    // 持久化反算结果
    void store.addPhoto({ ...photo });
  }

  renderSidebar();
}
