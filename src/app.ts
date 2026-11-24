import { store, PAGE_LABELS, type PageId } from './core/store';
import { renderArchivePage } from './pages/archivePage';
import { renderRigPage } from './pages/rigPage';
import { renderShapePage } from './pages/shapePage';
import { renderWindPage } from './pages/windPage';
import { renderMeasurePage } from './pages/measurePage';
import { renderSheetPage } from './pages/sheetPage';
import { renderSettingsPage } from './pages/settingsPage';
import { h, clear } from './ui/dom';

export function renderApp(root: HTMLElement): void {
  const pageHost = h('div', { class: 'page' });
  const topbar = h('div', { class: 'topbar' }, [
    h('span', { class: 'brand', textContent: '帆型设计工作室' }),
  ]);

  const navButtons = new Map<PageId, HTMLButtonElement>();
  (Object.keys(PAGE_LABELS) as PageId[]).forEach((id) => {
    const btn = h('button', {
      class: 'nav-btn',
      textContent: PAGE_LABELS[id],
      onclick: () => store.go(id),
    });
    navButtons.set(id, btn);
    topbar.append(btn);
  });

  const shell = h('div', { class: 'app-shell' }, [topbar, pageHost]);
  root.append(shell);

  function render(): void {
    navButtons.forEach((btn, id) => btn.classList.toggle('active', store.page === id));
    clear(pageHost);
    const sail = store.currentSail;
    if (!sail && store.page !== 'settings') {
      pageHost.append(h('div', { class: 'panel', textContent: '暂无帆型档案,请先在帆型档案页新建。' }));
      return;
    }
    switch (store.page) {
      case 'archive':
        renderArchivePage(pageHost);
        break;
      case 'rig':
        if (sail) renderRigPage(pageHost, sail);
        break;
      case 'shape':
        if (sail) renderShapePage(pageHost, sail);
        break;
      case 'wind':
        if (sail) renderWindPage(pageHost, sail);
        break;
      case 'measure':
        if (sail) renderMeasurePage(pageHost, sail);
        break;
      case 'sheet':
        if (sail) renderSheetPage(pageHost, sail);
        break;
      case 'settings':
        renderSettingsPage(pageHost);
        break;
    }
  }

  store.subscribe(render);
  render();
}
