import type { RdPoint } from "./rd";

/** How a CPT is stored in a project file. */
export interface CptData {
  /** BRO id, e.g. "CPT000000003504". */
  id: string;
  x: number;
  y: number;
  lat: number;
  lon: number;
  /** The CPT as delivered by the BRO (IMBRO XML). */
  xml: string;
}

/**
 * A cone penetration test (CPT) from the BRO, with its location in RD
 * (EPSG:28992) and WGS84 and the original XML for later processing.
 * Uniqueness of ids is a project-wide rule, enforced by Project.
 */
export class Cpt {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly lat: number;
  readonly lon: number;
  readonly xml: string;

  constructor(data: CptData) {
    this.id = data.id;
    this.x = data.x;
    this.y = data.y;
    this.lat = data.lat;
    this.lon = data.lon;
    this.xml = data.xml;
  }

  get rd(): RdPoint {
    return { x: this.x, y: this.y };
  }

  toData(): CptData {
    return { id: this.id, x: this.x, y: this.y, lat: this.lat, lon: this.lon, xml: this.xml };
  }

  static isData(value: unknown): value is CptData {
    const c = value as CptData | null;
    return (
      !!c &&
      typeof c === "object" &&
      typeof c.id === "string" &&
      Number.isFinite(c.x) &&
      Number.isFinite(c.y) &&
      Number.isFinite(c.lat) &&
      Number.isFinite(c.lon) &&
      typeof c.xml === "string"
    );
  }
}
