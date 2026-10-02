import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { BASEMAPS, tileUrl } from "../basemaps";
import { HeightGrid, type HeightGridArea } from "../heightGrid";
import type { HeightRaster } from "../heightRaster";
import { formatNumber, t } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { rdToLatLng, type RdPoint } from "../rd";
import type { ReferenceLine } from "../referenceLine";
import type { Soil } from "../soil";
import type { SoilLayer, SoilProfile } from "../soilProfile";
import { getTheme, onThemeChange, type Theme } from "../theme";

/** What the 3D page shows. */
export interface Scene3DData {
  referenceLines: readonly ReferenceLine[];
  soilProfiles: readonly SoilProfile[];
  /** The soils used by the soil profiles (for their colours). */
  soils: readonly Soil[];
  /** The project's height rasters; Full 3D needs at least one. */
  heightRasters: readonly HeightRaster[];
}

/** Gets the heights of an area, or null when there are none there. */
export type HeightsHandler = (area: HeightGridArea) => Promise<HeightGrid | null>;

type HeightsState = "idle" | "loading" | "loaded" | "none" | "failed";

const DEFAULT_EXAGGERATION = 5;
const MAX_EXAGGERATION = 50;
// Cylinder radius as a fraction of the scene's horizontal extent, and its
// minimum in metres, so profiles stay visible both in small and large projects.
const RADIUS_FRACTION = 0.004;
const MIN_RADIUS = 0.5;
const LINE_WIDTH = 3; // px
const CYLINDER_SEGMENTS = 24;
// The ground (map / grid) square is this much wider than the content.
const GROUND_MARGIN = 1.2;
// Largest width or height (px) of the map image on the ground.
const MAP_IMAGE_SIZE = 2048;
const TILE_SIZE = 256;
// The ground plane is split into this many squares per side. The map tiles
// are in Web Mercator; each vertex gets its own position in the tile image,
// so the map lines up with RD (exactly at the vertices, closely in between).
const GROUND_SEGMENTS = 32;
// Full 3D: the terrain has a vertex (height sample) per cell corner, this
// many cells per side.
const TERRAIN_SEGMENTS = 256;
// Holes in the height data up to about twice this many cells wide are closed.
const TERRAIN_GAP_PASSES = 4;
// Terrain opacity, so the soil profiles below the surface stay visible.
const TERRAIN_OPACITY = 0.8;
// How far (m) reference lines are drawn above the terrain, so they aren't
// hidden where the surface between the samples is a little higher.
const TERRAIN_LINE_LIFT = 0.2;

/** A square in RD (metres). */
interface RdSquare {
  centerX: number;
  centerY: number;
  size: number;
}

/** The basemap under an RD square: a tile mosaic and where RD points fall on it. */
interface GroundMap {
  texture: THREE.Texture;
  /** Texture coordinates (u, v) of an RD point. */
  uvOf: (x: number, y: number) => [number, number];
}

/** Web Mercator position of an RD point, as a fraction (0..1) of the world, y down. */
function mercatorOf(x: number, y: number): THREE.Vector2 {
  const [lat, lng] = rdToLatLng({ x, y });
  const phi = THREE.MathUtils.degToRad(lat);
  return new THREE.Vector2((lng + 180) / 360, (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

// Stitches the basemap tiles covering `square`, at the most detailed zoom
// level that keeps the mosaic within MAP_IMAGE_SIZE. Tiles that fail to load
// stay blank; throws only if none load.
async function loadGroundMap(theme: Theme, square: RdSquare): Promise<GroundMap> {
  const layers = BASEMAPS[theme];
  // Web Mercator bounds of the square, from points along its edges (RD's
  // grid is slightly rotated against Web Mercator's).
  const bounds = new THREE.Box2();
  const half = square.size / 2;
  for (let i = 0; i <= 8; i++) {
    const along = -half + (square.size * i) / 8;
    for (const [dx, dy] of [[along, -half], [along, half], [-half, along], [half, along]]) {
      bounds.expandByPoint(mercatorOf(square.centerX + dx, square.centerY + dy));
    }
  }
  const size = bounds.getSize(new THREE.Vector2());
  let zoom = Math.min(...layers.map((layer) => layer.maxNativeZoom));
  while (zoom > 0 && Math.max(size.x, size.y) * TILE_SIZE * 2 ** zoom > MAP_IMAGE_SIZE) zoom--;

  const tiles = 2 ** zoom;
  const x0 = Math.floor(bounds.min.x * tiles);
  const y0 = Math.floor(bounds.min.y * tiles);
  const columns = Math.floor(bounds.max.x * tiles) - x0 + 1;
  const rows = Math.floor(bounds.max.y * tiles) - y0 + 1;
  const canvas = document.createElement("canvas");
  canvas.width = columns * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  const context = canvas.getContext("2d")!;

  const positions = Array.from({ length: columns * rows }, (_, i) => ({ col: i % columns, row: Math.floor(i / columns) }));
  const images = await Promise.all(
    layers.map((layer) =>
      Promise.all(positions.map(({ col, row }) => loadImage(tileUrl(layer, zoom, x0 + col, y0 + row)))),
    ),
  );
  if (images.flat().every((image) => image === null)) throw new Error("No basemap tiles could be loaded");
  // Layers in order, so the dark theme's labels end up on top.
  for (const layerImages of images) {
    layerImages.forEach((image, i) => {
      if (image) context.drawImage(image, positions[i].col * TILE_SIZE, positions[i].row * TILE_SIZE);
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return {
    texture,
    uvOf: (x, y) => {
      const m = mercatorOf(x, y);
      // Texture v runs upwards (the canvas is flipped when uploaded).
      return [(m.x * tiles - x0) / columns, 1 - (m.y * tiles - y0) / rows];
    },
  };
}

/** The line with extra points so no segment is longer than `step`. */
function densify(points: readonly RdPoint[], step: number): RdPoint[] {
  const result: RdPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= count; k++) result.push({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count });
  }
  return result;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The layer a hovered cylinder shows. */
interface LayerInfo {
  profile: SoilProfile;
  layer: SoilLayer;
}

// The 3D page: the reference lines and the soil profiles, each profile as a
// stack of cylinders (one per layer, coloured by soil). Mouse: left drag
// rotates, right drag pans, the wheel zooms.
//
// Scene axes: RD x → x, RD y → -z, level (m NAP, times the vertical
// exaggeration) → y. Positions are relative to the centre of the content, so
// RD's large coordinates don't cost float precision. Reference lines have no
// level of their own; they are drawn at the highest soil profile top (NAP 0
// without profiles), or on the terrain in Full 3D. Full 3D asks for the
// heights through the handler set with `onHeightsRequest`.
export class Scene3DView {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
  private controls: OrbitControls;
  /** Everything built from the data; rebuilt by `render`. */
  private content = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  /** The loaded basemap and the theme + extent it shows. */
  private map: GroundMap | null = null;
  private mapKey = "";
  /** Key of the basemap being loaded, or that failed to load (not retried). */
  private mapRequestKey = "";
  private showMap = true;
  private attribution: HTMLElement;
  private lineMaterials: LineMaterial[] = [];
  private cylinder = new THREE.CylinderGeometry(1, 1, 1, CYLINDER_SEGMENTS);
  private raycaster = new THREE.Raycaster();
  private legend: HTMLElement;
  private tooltip: HTMLElement;
  private empty: HTMLElement;
  private exaggerationInput: HTMLInputElement;
  private exaggerationValue: HTMLElement;
  private full3dButton: HTMLButtonElement;
  private status: HTMLElement;
  /** Full 3D: the ground follows the terrain heights. */
  private full3d = false;
  private heightsHandler: HeightsHandler | null = null;
  /** The loaded heights (null if there were none) and the area + rasters they are for. */
  private heights: HeightGrid | null = null;
  private heightsKey = "";
  /** Key of the heights being loaded, or that failed to load (retried by Full 3D). */
  private heightsRequestKey = "";
  private heightsState: HeightsState = "idle";

  private data: Scene3DData = { referenceLines: [], soilProfiles: [], soils: [], heightRasters: [] };
  private exaggeration = DEFAULT_EXAGGERATION;
  private active = false;
  private renderQueued = false;
  /** Extent of the content last fitted to; the camera is refitted when it changes. */
  private fittedExtent = "";
  private bounds = new THREE.Box3();

  constructor(container: HTMLElement) {
    this.container = container;
    container.innerHTML =
      `<div class="scene3d-canvas"></div>` +
      `<div class="scene3d-toolbar">` +
      `<label class="scene3d-exaggeration"><span>${escapeHtml(t("scene3d.verticalExaggeration"))}</span>` +
      `<input type="range" min="1" max="${MAX_EXAGGERATION}" step="1" value="${DEFAULT_EXAGGERATION}" />` +
      `<output></output></label>` +
      `<label class="scene3d-map-toggle"><input type="checkbox" checked /><span>${escapeHtml(t("scene3d.showMap"))}</span></label>` +
      `<button type="button" class="toolbar-btn scene3d-full3d" aria-pressed="false">${escapeHtml(t("scene3d.full3d"))}</button>` +
      `<button type="button" class="toolbar-btn" data-action="reset" title="${escapeHtml(t("scene3d.resetViewTitle"))}">` +
      `${escapeHtml(t("scene3d.resetView"))}</button>` +
      `<button type="button" class="toolbar-btn" data-action="png" title="${escapeHtml(t("scene3d.savePngTitle"))}">` +
      `${escapeHtml(t("scene3d.savePng"))}</button>` +
      `<span class="scene3d-status" role="status"></span>` +
      `</div>` +
      `<div class="scene3d-legend"></div>` +
      `<div class="scene3d-hint">${escapeHtml(t("scene3d.mouseHint"))}</div>` +
      `<div class="scene3d-attribution">${escapeHtml(t("scene3d.mapAttribution"))}</div>` +
      `<div class="scene3d-tooltip"></div>` +
      `<div class="scene3d-empty">${escapeHtml(t("scene3d.empty"))}</div>`;
    const canvasHolder = container.querySelector<HTMLElement>(".scene3d-canvas")!;
    this.legend = container.querySelector<HTMLElement>(".scene3d-legend")!;
    this.tooltip = container.querySelector<HTMLElement>(".scene3d-tooltip")!;
    this.empty = container.querySelector<HTMLElement>(".scene3d-empty")!;
    this.exaggerationInput = container.querySelector<HTMLInputElement>(".scene3d-exaggeration input")!;
    this.exaggerationValue = container.querySelector<HTMLElement>(".scene3d-exaggeration output")!;
    this.exaggerationValue.textContent = `${this.exaggeration}×`;
    this.attribution = container.querySelector<HTMLElement>(".scene3d-attribution")!;
    this.full3dButton = container.querySelector<HTMLButtonElement>(".scene3d-full3d")!;
    this.status = container.querySelector<HTMLElement>(".scene3d-status")!;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    canvasHolder.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    this.scene.add(this.content);
    this.applyTheme();
    onThemeChange(() => {
      this.applyTheme();
      this.build();
    });

    this.exaggerationInput.addEventListener("input", () => {
      this.exaggeration = Number(this.exaggerationInput.value);
      this.exaggerationValue.textContent = `${this.exaggeration}×`;
      this.build();
    });
    const mapToggle = container.querySelector<HTMLInputElement>(".scene3d-map-toggle input")!;
    mapToggle.addEventListener("change", () => {
      this.showMap = mapToggle.checked;
      this.build();
    });
    this.full3dButton.addEventListener("click", () => {
      this.full3d = !this.full3d;
      // Heights that failed to load are tried again.
      if (this.full3d && this.heightsState === "failed") this.heightsRequestKey = "";
      this.build();
    });
    container.querySelector("[data-action=reset]")!.addEventListener("click", () => this.fitCamera());
    container.querySelector("[data-action=png]")!.addEventListener("click", () => this.savePng());
    this.renderer.domElement.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.renderer.domElement.addEventListener("pointerleave", () => this.hideTooltip());
    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Shows the lines and profiles; the camera is kept unless the content's extent changed. */
  render(data: Scene3DData): void {
    this.data = data;
    this.build();
  }

  /** Called for the terrain heights of an area when Full 3D is switched on. */
  onHeightsRequest(handler: HeightsHandler): void {
    this.heightsHandler = handler;
    this.updateFull3dButton();
  }

  /** Called when the page is shown or hidden; only a visible scene is drawn. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.resize();
  }

  private applyTheme(): void {
    this.scene.background = new THREE.Color(cssVar("--bg-panel") || "#ffffff");
    this.requestRender();
  }

  // Rebuilds the scene from `this.data` and the vertical exaggeration.
  private build(): void {
    this.clearContent();
    const { referenceLines, soilProfiles, soils } = this.data;
    const isEmpty = referenceLines.length === 0 && soilProfiles.length === 0;
    this.empty.classList.toggle("visible", isEmpty);
    this.renderLegend();
    this.updateFull3dButton();
    if (isEmpty) {
      this.attribution.classList.remove("visible");
      this.updateStatus(false);
      this.fittedExtent = "";
      this.requestRender();
      return;
    }

    // Horizontal extent (RD) and level range of everything shown.
    const rd = new THREE.Box2();
    for (const line of referenceLines) for (const p of line.points) rd.expandByPoint(new THREE.Vector2(p.x, p.y));
    for (const profile of soilProfiles) rd.expandByPoint(new THREE.Vector2(profile.x, profile.y));
    const center = rd.getCenter(new THREE.Vector2());
    const size = rd.getSize(new THREE.Vector2());
    const extent = Math.max(size.x, size.y, 1);
    const profileTop = soilProfiles.length > 0 ? Math.max(...soilProfiles.map((p) => p.top)) : 0;
    let top = profileTop;
    let bottom = soilProfiles.length > 0 ? Math.min(...soilProfiles.map((p) => p.bottom)) : 0;
    const e = this.exaggeration;
    const toScene = (x: number, y: number, level: number) => new THREE.Vector3(x - center.x, level * e, -(y - center.y));

    // The ground: a square somewhat larger than the content, at a round size
    // so the grid has round cells. In Full 3D it follows the terrain.
    const cell = 10 ** Math.floor(Math.log10((extent * GROUND_MARGIN) / 5));
    const divisions = Math.max(1, Math.round((extent * GROUND_MARGIN) / cell));
    const square: RdSquare = { centerX: center.x, centerY: center.y, size: divisions * cell };
    const terrain = this.full3d ? this.terrainHeights(square) : null;
    this.updateStatus(this.full3d);
    const terrainRange = terrain?.range ?? null;
    if (terrainRange) {
      top = Math.max(top, terrainRange.max);
      bottom = Math.min(bottom, terrainRange.min);
    }

    // Soil profiles: one cylinder per layer, sharing one unit cylinder and one
    // material per colour.
    const radius = Math.max(extent * RADIUS_FRACTION, MIN_RADIUS);
    const colors = new Map(soils.map((soil) => [soil.name, soil.color]));
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const materialFor = (color: string) => {
      let material = materials.get(color);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.8 });
        materials.set(color, material);
      }
      return material;
    };
    for (const profile of soilProfiles) {
      for (const layer of profile.layers) {
        const mesh = new THREE.Mesh(this.cylinder, materialFor(colors.get(layer.soil) ?? cssVar("--marker-unassigned")));
        const middle = toScene(profile.x, profile.y, (layer.top + layer.bottom) / 2);
        mesh.position.copy(middle);
        mesh.scale.set(radius, (layer.top - layer.bottom) * e, radius);
        mesh.userData.layer = { profile, layer } satisfies LayerInfo;
        this.content.add(mesh);
      }
    }

    // Reference lines, a few px wide whatever the zoom; the chainage line
    // wider. On terrain they follow the surface, just above it (and the
    // highest profile top where there are no heights); otherwise they are
    // drawn at the highest profile top.
    const resolution = this.resolution();
    const lift = terrainRange ? TERRAIN_LINE_LIFT + (terrainRange.max - terrainRange.min) * 0.01 : 0;
    const levelAt = (x: number, y: number) => {
      const height = terrain ? terrain.heightAt(x, y) : NaN;
      return Number.isNaN(height) ? profileTop : height + lift;
    };
    const step = square.size / TERRAIN_SEGMENTS;
    for (const line of referenceLines) {
      const points = terrain ? densify(line.points, step) : line.points;
      const geometry = new LineGeometry();
      geometry.setPositions(points.flatMap((p) => toScene(p.x, p.y, levelAt(p.x, p.y)).toArray()));
      const material = new LineMaterial({
        color: new THREE.Color(line.color).getHex(),
        linewidth: line.isChainageLine ? LINE_WIDTH * 1.5 : LINE_WIDTH,
        resolution,
      });
      this.lineMaterials.push(material);
      const object = new Line2(geometry, material);
      object.computeLineDistances();
      this.content.add(object);
    }

    // Flat, the ground lies under the deepest layer: the basemap once it is
    // loaded, otherwise (hidden, loading or unavailable) a grid for scale and
    // orientation. On terrain without the map it is plain grey.
    const groundLevel = (bottom - (top - bottom) * 0.05) * e;
    const map = this.showMap ? this.groundMap(square) : null;
    if (terrain) {
      this.content.add(this.terrainMesh(square, terrain, map));
    } else if (map) {
      const material = new THREE.MeshBasicMaterial({ map: map.texture, side: THREE.DoubleSide });
      const plane = this.groundMesh(square, GROUND_SEGMENTS, map, material);
      plane.position.y = groundLevel;
      this.content.add(plane);
    } else {
      const gridColor = new THREE.Color(cssVar("--border-color") || "#cccccc");
      this.grid = new THREE.GridHelper(square.size, divisions, gridColor, gridColor);
      this.grid.position.y = groundLevel;
      this.content.add(this.grid);
    }
    this.attribution.classList.toggle("visible", map !== null);

    this.bounds = new THREE.Box3(
      new THREE.Vector3(-size.x / 2, bottom * e, -size.y / 2),
      new THREE.Vector3(size.x / 2, top * e, size.y / 2),
    );
    // Refit when another project (or new data) changes the extent, not when
    // only colours, the exaggeration or the terrain change.
    const key = [rd.min.x, rd.min.y, rd.max.x, rd.max.y].map((v) => v.toFixed(0)).join(",");
    if (key !== this.fittedExtent) {
      this.fittedExtent = key;
      this.fitCamera();
    }
    this.requestRender();
  }

  // A flat square of `segments` x `segments` cells over `square`, laid in the
  // xz plane, with the map's texture coordinates when there is a map. The
  // plane faces +z with its +y pointing north; rotated flat, +y becomes -z
  // (north) and +z becomes up. So vertex (px, py) lies at RD (centre x + px,
  // centre y + py), and the vertices run row by row from north to south.
  private groundMesh(square: RdSquare, segments: number, map: GroundMap | null, material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(square.size, square.size, segments, segments);
    if (map) {
      const positions = geometry.getAttribute("position");
      const uvs = geometry.getAttribute("uv");
      for (let i = 0; i < positions.count; i++) {
        uvs.setXY(i, ...map.uvOf(square.centerX + positions.getX(i), square.centerY + positions.getY(i)));
      }
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  // The ground raised to the terrain heights (one vertex per grid cell), lit
  // so the relief shows, and a bit transparent so the soil profiles below
  // the surface stay visible. Triangles without heights are left out.
  private terrainMesh(square: RdSquare, terrain: HeightGrid, map: GroundMap | null): THREE.Mesh {
    const material = new THREE.MeshLambertMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: TERRAIN_OPACITY,
      depthWrite: false,
      ...(map ? { map: map.texture } : { color: new THREE.Color(cssVar("--marker-unassigned") || "#999999") }),
    });
    const mesh = this.groundMesh(square, TERRAIN_SEGMENTS, map, material);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const height = terrain.values[i];
      positions.setZ(i, Number.isNaN(height) ? 0 : height * this.exaggeration);
    }
    const index = geometry.getIndex()!;
    const kept: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const corners = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (corners.every((corner) => !Number.isNaN(terrain.values[corner]))) kept.push(...corners);
    }
    geometry.setIndex(kept);
    geometry.computeVertexNormals();
    return mesh;
  }

  // The terrain heights for `square`, with small holes closed, or null while
  // they are loading, when there are none or they couldn't be loaded.
  // Loading them rebuilds the scene; only the last ones are kept.
  private terrainHeights(square: RdSquare): HeightGrid | null {
    if (!this.heightsHandler) return null;
    // One sample per vertex: the grid's cells are centred on the vertices.
    const step = square.size / TERRAIN_SEGMENTS;
    const half = square.size / 2 + step / 2;
    const area: HeightGridArea = {
      minX: square.centerX - half,
      minY: square.centerY - half,
      maxX: square.centerX + half,
      maxY: square.centerY + half,
      columns: TERRAIN_SEGMENTS + 1,
      rows: TERRAIN_SEGMENTS + 1,
    };
    const rasters = this.data.heightRasters.map((raster) => `${raster.fileName}:${raster.id ?? "local"}`).join("|");
    const key = [area.minX, area.minY, area.maxX, area.maxY].map((v) => v.toFixed(1)).join(",") + `|${rasters}`;
    if (key === this.heightsKey) return this.heights;
    if (key === this.heightsRequestKey) return null;
    this.heightsRequestKey = key;
    this.heightsState = "loading";
    this.heightsHandler(area).then(
      (grid) => {
        // Meanwhile other heights may have been asked for.
        if (key !== this.heightsRequestKey) return;
        this.heights = grid?.hasData ? grid.withSmallGapsFilled(TERRAIN_GAP_PASSES) : null;
        this.heightsKey = key;
        this.heightsState = this.heights ? "loaded" : "none";
        this.build();
      },
      (err) => {
        console.error("Heights for the 3D view could not be loaded", err);
        if (key !== this.heightsRequestKey) return;
        this.heightsState = "failed";
        this.updateStatus(this.full3d);
      },
    );
    return null;
  }

  private updateFull3dButton(): void {
    const available = this.heightsHandler !== null && this.data.heightRasters.length > 0;
    this.full3dButton.disabled = !available;
    this.full3dButton.title = t(available ? "scene3d.full3dTitle" : "scene3d.full3dNoData");
    this.full3dButton.setAttribute("aria-pressed", String(this.full3d && available));
  }

  // Tells while heights load, or why the terrain isn't shown.
  private updateStatus(full3d: boolean): void {
    const messages: Record<HeightsState, MessageKey | null> = {
      idle: null,
      loaded: null,
      loading: "scene3d.loadingHeights",
      none: "scene3d.noHeights",
      failed: "scene3d.heightsFailed",
    };
    const message = full3d ? messages[this.heightsState] : null;
    this.status.textContent = message ? t(message) : "";
    this.status.classList.toggle("visible", message !== null);
  }

  // The basemap for `square` in the current theme, or null while it is
  // loading or when it couldn't be loaded. Loading it rebuilds the scene.
  // Only the last one is kept, so changing the exaggeration or colours
  // doesn't download it again.
  private groundMap(square: RdSquare): GroundMap | null {
    const theme = getTheme();
    const key = [theme, square.centerX.toFixed(0), square.centerY.toFixed(0), square.size.toFixed(0)].join(":");
    if (key === this.mapKey) return this.map;
    if (key === this.mapRequestKey) return null;
    this.mapRequestKey = key;
    loadGroundMap(theme, square).then(
      (map) => {
        // Meanwhile another extent or theme may have been asked for.
        if (key !== this.mapRequestKey) {
          map.texture.dispose();
          return;
        }
        this.map?.texture.dispose();
        this.map = map;
        this.mapKey = key;
        this.build();
      },
      (err) => console.warn("Basemap for the 3D view could not be loaded", err),
    );
    return null;
  }

  private clearContent(): void {
    const materials = new Set<THREE.Material>();
    this.content.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.geometry !== this.cylinder) object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
      }
    });
    materials.forEach((m) => m.dispose());
    this.grid?.dispose();
    this.grid = null;
    this.lineMaterials = [];
    this.content.clear();
  }

  // Looks at the content from the south-west, from above.
  private fitCamera(): void {
    const box = this.bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -10, -50), new THREE.Vector3(50, 0, 50)) : this.bounds;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = new THREE.Vector3(-0.6, 0.7, 0.9).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = distance / 1000;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  private renderLegend(): void {
    const { referenceLines, soils } = this.data;
    const item = (color: string, label: string, kind: string) =>
      `<li><span class="scene3d-swatch ${kind}" style="background:${escapeHtml(color)}"></span>${escapeHtml(label)}</li>`;
    const section = (title: string, items: string[]) =>
      items.length > 0 ? `<h4>${escapeHtml(title)}</h4><ul>${items.join("")}</ul>` : "";
    this.legend.innerHTML =
      section(t("tables.referenceLines"), referenceLines.map((line) => item(line.color, line.name, "line"))) +
      section(t("tables.soils"), soils.map((soil) => item(soil.color, soil.name, "soil")));
    this.legend.classList.toggle("visible", referenceLines.length + soils.length > 0);
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.buttons !== 0) {
      this.hideTooltip();
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const layers = this.content.children.filter((object) => object.userData.layer !== undefined);
    const hit = this.raycaster.intersectObjects(layers, false)[0];
    if (!hit) {
      this.hideTooltip();
      return;
    }
    const { profile, layer } = hit.object.userData.layer as LayerInfo;
    this.tooltip.innerHTML =
      `<strong>${escapeHtml(layer.soil)}</strong>` +
      `<span>${escapeHtml(t("scene3d.layerLevels", { top: formatNumber(layer.top, 2), bottom: formatNumber(layer.bottom, 2) }))}</span>` +
      `<span>${escapeHtml(t("soilProfile.location", { x: profile.x.toFixed(0), y: profile.y.toFixed(0) }))}</span>`;
    this.tooltip.style.left = `${e.clientX - this.container.getBoundingClientRect().left + 14}px`;
    this.tooltip.style.top = `${e.clientY - this.container.getBoundingClientRect().top + 14}px`;
    this.tooltip.classList.add("visible");
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove("visible");
  }

  private resolution(): THREE.Vector2 {
    return new THREE.Vector2(this.container.clientWidth, this.container.clientHeight);
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!this.active || width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const resolution = this.resolution();
    for (const material of this.lineMaterials) material.resolution.copy(resolution);
    this.requestRender();
  }

  // Downloads the view as a PNG at the canvas's full (device pixel)
  // resolution. With the map shown, its attribution is drawn in the bottom
  // right corner, as on screen.
  private savePng(): void {
    // The canvas's drawing is only kept until it is shown, so draw it again
    // right before copying it.
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(source, 0, 0);
    if (this.attribution.classList.contains("visible")) {
      const scale = window.devicePixelRatio;
      const style = getComputedStyle(this.attribution);
      context.font = `${parseFloat(style.fontSize) * scale}px ${style.fontFamily}`;
      context.textAlign = "right";
      context.textBaseline = "bottom";
      context.fillStyle = style.color;
      context.fillText(this.attribution.textContent ?? "", canvas.width - 12 * scale, canvas.height - 8 * scale);
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      link.download = `lithovox-3d-${stamp}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
  }

  // Draws once on the next frame; nothing is drawn while the page is hidden.
  private requestRender(): void {
    if (this.renderQueued || !this.active) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.scene, this.camera);
    });
  }
}
