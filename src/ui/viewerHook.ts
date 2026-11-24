// 各页面共用的 SailViewer 挂载/卸载辅助
import { SailViewer, type ViewMode } from './SailViewer';
import type { AppSettings, SailProfile } from '../core/types';
import type { RigConfig } from '../core/types';

export interface ViewerHandle {
  viewer: SailViewer;
  host: HTMLElement;
}

export function mountViewer(
  container: HTMLElement,
  profile: SailProfile,
  rig: RigConfig,
  k: number,
  settings: AppSettings,
): ViewerHandle {
  const host = document.createElement('div');
  host.className = 'viewer-wrap';
  container.append(host);
  const viewer = new SailViewer(host, settings);
  viewer.build(profile, rig, k);
  return { viewer, host };
}

export function viewModeButtons(current: ViewMode, onChange: (m: ViewMode) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'viewer-toolbar';
  (['rider', 'chase'] as ViewMode[]).forEach((mode) => {
    const btn = document.createElement('button');
    btn.textContent = mode === 'rider' ? '板手视角' : '侧后跟拍';
    if (mode === current) btn.classList.add('primary');
    btn.addEventListener('click', () => onChange(mode));
    wrap.append(btn);
  });
  return wrap;
}
