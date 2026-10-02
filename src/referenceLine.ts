import type { RdPoint } from "./rd";

/** A reference line vertex: RD position plus its distance along the line. */
export interface ReferenceLinePoint extends RdPoint {
  /** Distance in metres from the first point, measured along the line. */
  chainage: number;
}

/** Where a point lands when projected perpendicularly onto a line. */
export interface LineProjection {
  /** Distance in metres from the point to the line. */
  distance: number;
  /** Chainage (metres along the line) of the closest point on the line. */
  chainage: number;
}

/** How a reference line is stored in a project file. */
export interface ReferenceLineData {
  name: string;
  color: string;
  isChainageLine: boolean;
  points: ReferenceLinePoint[];
}

// Colours handed out to uploaded lines, in order. Picked to stand out on
// both the light topographic and the dark grey basemap.
export const REFERENCE_LINE_COLORS = [
  "#e4572e", // orange-red
  "#2e86de", // blue
  "#8e44ad", // purple
  "#27ae60", // green
  "#f39c12", // amber
  "#d81b60", // pink
  "#00897b", // teal
  "#6d4c41", // brown
];

function isPoint(value: unknown): value is RdPoint {
  const p = value as RdPoint | null;
  return !!p && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// Chainage starts at 0 on the first point and adds the straight-line (RD,
// metres) distance between consecutive points.
function withChainage(points: readonly RdPoint[]): ReferenceLinePoint[] {
  let chainage = 0;
  return points.map((point, i) => {
    if (i > 0) chainage += Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y);
    return { x: point.x, y: point.y, chainage };
  });
}

/**
 * A named line in RD (EPSG:28992) coordinates. Uniqueness of names and
 * "exactly one chainage line" are project-wide rules, enforced by Project.
 */
export class ReferenceLine {
  name: string;
  /** Display colour on the map (CSS colour). */
  color: string;
  isChainageLine: boolean;
  readonly points: readonly ReferenceLinePoint[];

  /** Chainage is computed from the points' positions; any given value is ignored. */
  constructor(name: string, points: readonly RdPoint[], color: string, isChainageLine = false) {
    if (points.length < 2) throw new Error("A reference line needs at least two points");
    this.name = name;
    this.color = color;
    this.isChainageLine = isChainageLine;
    this.points = withChainage(points);
  }

  get start(): ReferenceLinePoint {
    return this.points[0];
  }

  get end(): ReferenceLinePoint {
    return this.points[this.points.length - 1];
  }

  /** Total length in metres (the chainage of the last point). */
  get length(): number {
    return this.end.chainage;
  }

  /** The closest point on the line to `point` (both in RD). */
  project(point: RdPoint): LineProjection {
    let best: LineProjection = { distance: Infinity, chainage: 0 };
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      // Fraction along the segment of the perpendicular foot, clamped to the segment.
      const f = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
      const distance = Math.hypot(point.x - (a.x + f * dx), point.y - (a.y + f * dy));
      if (distance < best.distance) best = { distance, chainage: a.chainage + f * (b.chainage - a.chainage) };
    }
    return best;
  }

  toData(): ReferenceLineData {
    return {
      name: this.name,
      color: this.color,
      isChainageLine: this.isChainageLine,
      points: this.points.map((p) => ({ ...p })),
    };
  }

  /**
   * Checks the shape of a saved line. `color` and `isChainageLine` may be
   * missing: files saved before they existed don't have them, and Project
   * fills them in when loading.
   */
  static isData(value: unknown): value is ReferenceLineData {
    const l = value as ReferenceLineData | null;
    return (
      !!l &&
      typeof l === "object" &&
      typeof l.name === "string" &&
      (l.color === undefined || typeof l.color === "string") &&
      (l.isChainageLine === undefined || typeof l.isChainageLine === "boolean") &&
      Array.isArray(l.points) &&
      l.points.length >= 2 &&
      l.points.every(isPoint)
    );
  }
}
