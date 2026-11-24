// Three.js 帆面渲染器:参数化网格 + 材质拼块 + 撑条/桅杆 + 晶格 + 风抖 + 偏差染色
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  basePosition,
  gridHeightRows,
  leadingEdgePoint,
  renderPosition,
  type Vec3,
} from '../core/sailModel';
import type { AppSettings, SailProfile } from '../core/types';
import type { RigConfig } from '../core/types';

export type ViewMode = 'rider' | 'chase' | 'side';

interface DeviationColor {
  h: number;
  /** 偏差百分点(绝对值),用于染色 */
  diffPct: number;
}

export class SailViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sailMesh: THREE.Mesh | null = null;
  private sailGroup = new THREE.Group();
  private latticeGroup = new THREE.Group();
  private battenGroup = new THREE.Group();
  private mastMesh: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial;
  private profile: SailProfile | null = null;
  private rig: RigConfig | null = null;
  private k = 0.5;
  private time = 0;
  private settings: AppSettings;
  private deviations: DeviationColor[] = [];
  private viewMode: ViewMode = 'chase';
  private raf = 0;
  private resizeObs: ResizeObserver;
  private heights: number[] = [];
  private chordSegs = 28;
  showLattice = false;

  constructor(container: HTMLElement, settings: AppSettings) {
    this.settings = settings;
    this.chordSegs = settings.chordSegments;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // 帆高可达 5 米量级,缩放范围按厘米给足
    this.controls.minDistance = 60;
    this.controls.maxDistance = 2600;

    this.setupLights();
    this.scene.add(this.sailGroup);
    this.sailGroup.add(this.latticeGroup, this.battenGroup);

    this.material = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      vertexColors: true,
      transparent: true,
      opacity: 0.97,
      roughness: 0.42,
      metalness: 0.04,
    });

    this.resizeObs = new ResizeObserver(() => this.resize(container));
    this.resizeObs.observe(container);
    this.applyViewMode();
    this.animate();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xd6ecff, 0x2a3d52, 1.25);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(220, 380, 360);
    key.castShadow = true;
    this.scene.add(key);
    // 逆光:从帆背打光,撑条套与缝线会透出影子
    const back = new THREE.DirectionalLight(0xffe6c0, 1.2);
    back.position.set(-260, 200, -320);
    this.scene.add(back);
    const fill = new THREE.DirectionalLight(0x9cc8ff, 0.7);
    fill.position.set(-140, -60, 240);
    this.scene.add(fill);
    this.scene.background = new THREE.Color(0x0a111b);
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
    this.chordSegs = settings.chordSegments;
    this.material.wireframe = settings.wireframe;
    if (this.profile && this.rig) this.build(this.profile, this.rig, this.k);
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.applyViewMode();
  }

  private applyViewMode(): void {
    if (!this.profile) {
      this.camera.position.set(420, 360, 320);
      this.controls.target.set(0, 220, 0);
      this.controls.update();
      return;
    }
    const L = this.profile.luffCm;
    const maxChord = Math.max(...this.profile.chordKnots.map((c) => c.chordCm));
    // 帆面在 x-y 平面展开(法向 z),目标点取包围盒几何中心
    const target = new THREE.Vector3(maxChord * 0.5, L * 0.5, 8);
    const dist = Math.max(L * 1.35, maxChord * 2.4);
    const dir =
      this.viewMode === 'rider'
        ? new THREE.Vector3(0.06, 0.03, 1).normalize()
        : this.viewMode === 'side'
          ? // 侧面:沿弦向 x 正侧看鼓包
            new THREE.Vector3(1, 0.04, 0.12).normalize()
          : // 跟拍:沿法向 z 正视,目标居中,极小幅 x/y 倾角保留立体感
            new THREE.Vector3(0.03, 0.06, 1).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.update();
  }

  setDeviations(devs: DeviationColor[]): void {
    this.deviations = devs;
    if (this.profile && this.rig) this.applyColors();
  }

  setWind(k: number): void {
    this.k = k;
    if (this.profile && this.rig) this.build(this.profile, this.rig, k);
  }

  setLatticeVisible(v: boolean): void {
    this.showLattice = v;
    this.latticeGroup.visible = v;
  }

  /** 帆面网格重建:高度行包含全部撑条高度,保证撑条精确落格 */
  build(profile: SailProfile, rig: RigConfig, k: number): void {
    this.profile = profile;
    this.rig = rig;
    this.k = k;
    this.heights = gridHeightRows(profile, 26);
    const rows = this.heights.length;
    const cols = this.chordSegs + 1;
    const positions = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    const indices: number[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        uvs[idx * 2] = c / (cols - 1);
        uvs[idx * 2 + 1] = this.heights[r];
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    this.updatePositions();
    this.applyColors();
    geo.computeVertexNormals();

    if (this.sailMesh) {
      this.sailMesh.geometry.dispose();
      this.sailMesh.geometry = geo;
    } else {
      this.sailMesh = new THREE.Mesh(geo, this.material);
      this.sailMesh.castShadow = true;
      this.sailMesh.receiveShadow = true;
      this.sailGroup.add(this.sailMesh);
    }
    this.buildBattens();
    this.buildMast();
    this.buildLattice();
    this.latticeGroup.visible = this.showLattice;
    this.applyViewMode();
  }

  private toVec3(p: Vec3): THREE.Vector3 {
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** 每帧更新:基础形态 + 确定性风抖,顶点顺序/数量不变,杜绝忽胀忽缩 */
  private updatePositions(): void {
    if (!this.sailMesh || !this.profile || !this.rig) return;
    const geo = this.sailMesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const cols = this.chordSegs + 1;
    for (let r = 0; r < this.heights.length; r++) {
      const h = this.heights[r];
      for (let c = 0; c < cols; c++) {
        const s = c / (cols - 1);
        const p = renderPosition(
          this.profile,
          this.rig,
          h,
          s,
          this.k,
          this.time,
          this.settings.flutterScale,
        );
        pos.setXYZ(r * cols + c, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    this.battenGroup.children.forEach((child) => {
      if (!(child instanceof THREE.Line)) return;
      const h = (child.userData.h as number) ?? 0;
      const attr = child.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let c = 0; c < attr.count; c++) {
        const s = c / (attr.count - 1);
        const p = basePosition(this.profile!, this.rig!, h, s, { k: this.k, includeLattice: true });
        attr.setXYZ(c, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
    });
    this.updateMast();
  }

  // ---------------------------------------------------------------- 染色

  private applyColors(): void {
    if (!this.sailMesh || !this.profile) return;
    const attr = this.sailMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const cols = this.chordSegs + 1;
    for (let r = 0; r < this.heights.length; r++) {
      const h = this.heights[r];
      const base = this.fabricColor(h);
      const dev = this.deviationAt(h);
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        let { r: rr, g, b } = base;
        if (dev > 0.5) {
          // 偏差越大越向红色染,0.5 个百分点起染,3 个百分点满红
          const t = Math.min(1, (dev - 0.5) / 2.5);
          rr = lerpC(rr, 0.95, t);
          g = lerpC(g, 0.25, t);
          b = lerpC(b, 0.2, t);
        }
        attr.setXYZ(idx, rr, g, b);
      }
    }
    attr.needsUpdate = true;
  }

  private deviationAt(h: number): number {
    if (this.deviations.length === 0) return 0;
    let best = this.deviations[0];
    let bestDist = Infinity;
    for (const d of this.deviations) {
      const dist = Math.abs(d.h - h);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best.diffPct;
  }

  /** 按拼块面料给基础色:单丝膜偏亮透明、X-ply 偏冷、平纹布偏暖暗 */
  private fabricColor(h: number): THREE.Color {
    const patch = this.profile?.patches.find((p) => h >= p.h0 && h <= p.h1);
    switch (patch?.fabric) {
      case 'xply':
        return new THREE.Color(0.68, 0.78, 0.88);
      case 'plain':
        return new THREE.Color(0.76, 0.71, 0.62);
      case 'monofilm':
      default:
        return new THREE.Color(0.82, 0.9, 0.97);
    }
  }

  // ---------------------------------------------------------------- 结构件

  private buildBattens(): void {
    if (!this.profile || !this.rig) return;
    this.battenGroup.clear();
    for (const batten of this.profile.battens) {
      const pts: THREE.Vector3[] = [];
      const N = this.chordSegs;
      for (let c = 0; c <= N; c++) {
        const s = c / N;
        const p = basePosition(this.profile, this.rig, batten.heightRatio, s, {
          k: this.k,
          includeLattice: true,
        });
        pts.push(this.toVec3(p));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xf0b429, linewidth: 2 }),
      );
      line.userData.h = batten.heightRatio;
      this.battenGroup.add(line);
    }
  }

  private buildMast(): void {
    if (!this.profile || !this.rig) return;
    const N = 40;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const h = i / N;
      const lead = leadingEdgePoint(this.profile, this.rig, h);
      pts.push(new THREE.Vector3(lead.x - 2.2, lead.y, lead.z - 1.5));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 48, 3.2, 10, false);
    if (this.mastMesh) {
      this.mastMesh.geometry.dispose();
      this.mastMesh.geometry = geo;
    } else {
      this.mastMesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.4, metalness: 0.5 }),
      );
      this.sailGroup.add(this.mastMesh);
    }
  }

  private updateMast(): void {
    // 桅杆弯曲只由索具决定,不随风速变;重建代价低,这里复用 buildMast
    if (this.profile && this.rig) this.buildMast();
  }

  private buildLattice(): void {
    if (!this.profile || !this.rig) return;
    this.latticeGroup.clear();
    const lattice = this.profile.lattice;
    const bayHeights = [...new Set(lattice.points.map((p) => p.h))].sort((a, b) => a - b);
    const sValues = [...new Set(lattice.points.map((p) => p.s))].sort((a, b) => a - b);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 });
    // 纵向线
    for (const s of sValues) {
      const pts = bayHeights.map((h) =>
        this.toVec3(basePosition(this.profile!, this.rig!, h, s, { k: this.k, includeLattice: true })),
      );
      this.latticeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    // 横向线
    for (const h of bayHeights) {
      const pts = sValues.map((s) =>
        this.toVec3(basePosition(this.profile!, this.rig!, h, s, { k: this.k, includeLattice: true })),
      );
      this.latticeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    // 控制点小球,带位移的点高亮
    const sphereGeo = new THREE.SphereGeometry(2.2, 10, 10);
    for (const p of lattice.points) {
      const moved = p.dz !== 0 || p.dx !== 0;
      const m = new THREE.Mesh(
        sphereGeo,
        new THREE.MeshBasicMaterial({ color: moved ? 0xf59e0b : 0x7dd3fc }),
      );
      const pos = basePosition(this.profile, this.rig, p.h, p.s, {
        k: this.k,
        includeLattice: true,
      });
      m.position.set(pos.x, pos.y, pos.z);
      m.userData = { latticePointId: p.id };
      this.latticeGroup.add(m);
    }
  }

  /** 形态编辑页:射线拾取晶格控制点 */
  pickLatticePoint(ndcX: number, ndcY: number): string | null {
    if (!this.sailMesh) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = ray.intersectObjects(this.latticeGroup.children, false);
    for (const hit of hits) {
      const id = hit.object.userData.latticePointId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  screenToNdc(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  private resize(container: HTMLElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.time += 1 / 60;
    if (this.profile && this.rig) this.updatePositions();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function lerpC(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
