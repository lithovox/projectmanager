import type { RdPoint } from "./rd";

/** One layer of a soil profile; levels in metres relative to NAP. */
export interface SoilLayer {
  top: number;
  bottom: number;
  /** Name of the layer's Soil in the project. */
  soil: string;
}

/** Where a soil profile came from; null when unknown or entered by hand. */
export type SoilProfileSource = "geoscanner" | null;

/** How a soil profile is stored in a project file. */
export interface SoilProfileData {
  x: number;
  y: number;
  layers: SoilLayer[];
  weight: number;
  source: SoilProfileSource;
  /** Whole metres along the profile's reference line; null when not assigned. */
  chainage: number | null;
}

export const DEFAULT_SOIL_PROFILE_WEIGHT = 1.0;

/**
 * What is wrong with an edited list of layers (see SoilProfile.validateLayers):
 * a level that isn't a number, a layer whose top isn't above its bottom, or a
 * layer whose top is above the previous layer's bottom.
 */
export interface LayerError {
  index: number;
  reason: "notANumber" | "topNotAboveBottom" | "overlap";
}

function isLayer(value: unknown): value is SoilLayer {
  const l = value as SoilLayer | null;
  return (
    !!l &&
    typeof l === "object" &&
    Number.isFinite(l.top) &&
    Number.isFinite(l.bottom) &&
    l.top >= l.bottom &&
    typeof l.soil === "string"
  );
}

/**
 * A soil profile at an RD (EPSG:28992) location: its layers from top to
 * bottom, the weight it gets when combined with other profiles and its
 * source. That every layer's soil exists is a project-wide rule, enforced by
 * Project.
 */
export class SoilProfile {
  readonly x: number;
  readonly y: number;
  private _layers: SoilLayer[];
  weight: number;
  source: SoilProfileSource;
  /**
   * Position (whole metres) along the reference line the profile is assigned
   * to; null when it isn't assigned. Which line that is, is kept by Project.
   */
  chainage: number | null = null;

  /** Layers are sorted top to bottom. */
  constructor(
    point: RdPoint,
    layers: readonly SoilLayer[],
    weight = DEFAULT_SOIL_PROFILE_WEIGHT,
    source: SoilProfileSource = null,
  ) {
    if (layers.length === 0) throw new Error("A soil profile needs at least one layer");
    if (!layers.every(isLayer)) throw new Error("Invalid soil layer");
    this.x = point.x;
    this.y = point.y;
    this._layers = [...layers].sort((a, b) => b.top - a.top).map((l) => ({ ...l }));
    this.weight = weight;
    this.source = source;
  }

  /** Sorted top to bottom. */
  get layers(): readonly SoilLayer[] {
    return this._layers;
  }

  /**
   * Replaces the layers. They must be given top to bottom and pass
   * `validateLayers`; throws otherwise.
   */
  setLayers(layers: readonly SoilLayer[]): void {
    if (layers.length === 0) throw new Error("A soil profile needs at least one layer");
    const error = SoilProfile.validateLayers(layers);
    if (error) throw new Error(`Invalid soil layer ${error.index}: ${error.reason}`);
    this._layers = layers.map((l) => ({ ...l }));
  }

  /**
   * Checks layers given top to bottom: every level is a number, every layer
   * is thicker than zero and no layer reaches above the one before it (gaps
   * are allowed). Returns the first problem, or null.
   */
  static validateLayers(layers: readonly SoilLayer[]): LayerError | null {
    for (let index = 0; index < layers.length; index++) {
      const { top, bottom } = layers[index];
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return { index, reason: "notANumber" };
      if (top <= bottom) return { index, reason: "topNotAboveBottom" };
      if (index > 0 && top > layers[index - 1].bottom) return { index, reason: "overlap" };
    }
    return null;
  }

  get rd(): RdPoint {
    return { x: this.x, y: this.y };
  }

  get top(): number {
    return this.layers[0].top;
  }

  get bottom(): number {
    return this.layers[this.layers.length - 1].bottom;
  }

  toData(): SoilProfileData {
    return {
      x: this.x,
      y: this.y,
      layers: this.layers.map((l) => ({ ...l })),
      weight: this.weight,
      source: this.source,
      chainage: this.chainage,
    };
  }

  static fromData(data: SoilProfileData): SoilProfile {
    const profile = new SoilProfile(
      data,
      data.layers,
      data.weight ?? DEFAULT_SOIL_PROFILE_WEIGHT,
      data.source ?? null,
    );
    profile.chainage = data.chainage ?? null;
    return profile;
  }

  /** `weight`, `source` and `chainage` may be missing; fromData fills in the defaults. */
  static isData(value: unknown): value is SoilProfileData {
    const p = value as SoilProfileData | null;
    return (
      !!p &&
      typeof p === "object" &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Array.isArray(p.layers) &&
      p.layers.length > 0 &&
      p.layers.every(isLayer) &&
      (p.weight === undefined || Number.isFinite(p.weight)) &&
      (p.source === undefined || p.source === null || p.source === "geoscanner") &&
      (p.chainage === undefined || p.chainage === null || Number.isInteger(p.chainage))
    );
  }
}
