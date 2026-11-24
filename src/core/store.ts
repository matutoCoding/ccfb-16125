// 全局应用状态:帆型/桅杆/照片/设置的加载、当前选择与变更通知
import {
  deletePhoto,
  loadAllMasts,
  loadAllSails,
  loadPhotosBySail,
  loadSettings,
  saveMast,
  savePhoto,
  saveSail,
  saveSettings,
  deleteSail as idbDeleteSail,
} from './database';
import { buildSeedSail, SEED_MASTS, SEED_SAILS } from './seedData';
import type {
  AppSettings,
  MastSpec,
  PhotoRecord,
  SailProfile,
} from './types';
import { DEFAULT_SETTINGS } from './types';

export type PageId = 'archive' | 'rig' | 'shape' | 'wind' | 'measure' | 'sheet' | 'settings';

export const PAGE_LABELS: Record<PageId, string> = {
  archive: '帆型档案',
  rig: '索具配置',
  shape: '形态编辑',
  wind: '受风推演',
  measure: '测帆比对',
  sheet: '设计单',
  settings: '设置',
};

type Listener = () => void;

class AppStore {
  sails: SailProfile[] = [];
  masts: MastSpec[] = [];
  photos: PhotoRecord[] = [];
  settings: AppSettings = { ...DEFAULT_SETTINGS };
  currentSailId: string | null = null;
  page: PageId = 'archive';
  /** 受风推演页风速滑块,跨页保留 */
  windK = 0.5;
  ready = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  async init(): Promise<void> {
    if (this.ready) return;
    this.sails = await loadAllSails();
    this.masts = await loadAllMasts();
    this.settings = await loadSettings();
    if (this.sails.length === 0) {
      // 首次启动写入种子数据
      this.sails = SEED_SAILS.map((def, i) => buildSeedSail(def, i));
      this.masts = SEED_MASTS.map((m) => ({ ...m }));
      await Promise.all([
        ...this.sails.map((s) => saveSail(s)),
        ...this.masts.map((m) => saveMast(m)),
      ]);
    }
    this.currentSailId = this.sails[0]?.id ?? null;
    if (this.currentSailId) await this.refreshPhotos();
    this.ready = true;
    this.emit();
  }

  get currentSail(): SailProfile | null {
    return this.sails.find((s) => s.id === this.currentSailId) ?? null;
  }

  go(page: PageId): void {
    this.page = page;
    this.emit();
  }

  selectSail(id: string): void {
    this.currentSailId = id;
    void this.refreshPhotos();
    this.emit();
  }

  async refreshPhotos(): Promise<void> {
    if (!this.currentSailId) {
      this.photos = [];
      return;
    }
    this.photos = await loadPhotosBySail(this.currentSailId);
    this.emit();
  }

  async upsertSail(sail: SailProfile): Promise<void> {
    await saveSail(sail);
    const idx = this.sails.findIndex((s) => s.id === sail.id);
    if (idx >= 0) this.sails[idx] = sail;
    else this.sails.push(sail);
    this.currentSailId = sail.id;
    this.emit();
  }

  async removeSail(id: string): Promise<void> {
    await idbDeleteSail(id);
    this.sails = this.sails.filter((s) => s.id !== id);
    if (this.currentSailId === id) {
      this.currentSailId = this.sails[0]?.id ?? null;
      await this.refreshPhotos();
    }
    this.emit();
  }

  async addMast(mast: MastSpec): Promise<void> {
    await saveMast(mast);
    this.masts.push(mast);
    this.emit();
  }

  async addPhoto(photo: PhotoRecord): Promise<void> {
    await savePhoto(photo);
    this.photos.push(photo);
    this.emit();
  }

  async removePhoto(id: string): Promise<void> {
    await deletePhoto(id);
    this.photos = this.photos.filter((p) => p.id !== id);
    this.emit();
  }

  setWindK(k: number): void {
    this.windK = k;
    // 高频更新,仅通知渲染器监听者;通过单独通道避免整页重绘
    this.windListeners.forEach((fn) => fn(k));
  }

  private windListeners = new Set<(k: number) => void>();
  onWind(fn: (k: number) => void): () => void {
    this.windListeners.add(fn);
    return () => this.windListeners.delete(fn);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await saveSettings(this.settings);
    this.emit();
  }

  /** 更新当前帆型的可变片段并持久化 */
  async mutateCurrent(mutator: (draft: SailProfile) => SailProfile): Promise<void> {
    const cur = this.currentSail;
    if (!cur) return;
    const next = mutator(structuredClone(cur));
    await this.upsertSail(next);
  }
}

export const store = new AppStore();
