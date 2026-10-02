/**
 * Where a height grid lies: an RD (EPSG:28992) rectangle, in metres, split
 * into `columns` x `rows` equal cells.
 */
export interface HeightGridArea {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  columns: number;
  rows: number;
}

// Sampled heights at or above this are taken as "no data" (some rasters use
// float32's maximum instead of a no-data value).
const NO_DATA_THRESHOLD = 1e30;

/**
 * Heights (m NAP) on a regular grid: one value per cell, for the cell's
 * centre, rows from north to south. NaN where there is no data.
 */
export class HeightGrid {
  readonly area: HeightGridArea;
  readonly values: Float32Array;

  /** Without `values` the grid has no data anywhere. */
  constructor(area: HeightGridArea, values?: Float32Array) {
    const count = area.columns * area.rows;
    if (values && values.length !== count) throw new Error(`Expected ${count} heights, got ${values.length}`);
    this.area = { ...area };
    this.values = values ?? new Float32Array(count).fill(NaN);
    for (let i = 0; i < this.values.length; i++) {
      if (Math.abs(this.values[i]) >= NO_DATA_THRESHOLD) this.values[i] = NaN;
    }
  }

  get cellWidth(): number {
    return (this.area.maxX - this.area.minX) / this.area.columns;
  }

  get cellHeight(): number {
    return (this.area.maxY - this.area.minY) / this.area.rows;
  }

  /** NaN outside the grid and where there is no data. */
  at(column: number, row: number): number {
    const { columns, rows } = this.area;
    if (column < 0 || row < 0 || column >= columns || row >= rows) return NaN;
    return this.values[row * columns + column];
  }

  get hasData(): boolean {
    return this.values.some((v) => !Number.isNaN(v));
  }

  get hasGaps(): boolean {
    return this.values.some((v) => Number.isNaN(v));
  }

  /** Lowest and highest height, or null without data. */
  get range(): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.values) {
      if (Number.isNaN(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return min <= max ? { min, max } : null;
  }

  /** Takes `other`'s heights (a grid of the same size) where this grid has none. */
  fillGapsFrom(other: HeightGrid): void {
    if (other.values.length !== this.values.length) throw new Error("Height grids differ in size");
    this.values.forEach((v, i) => {
      if (Number.isNaN(v)) this.values[i] = other.values[i];
    });
  }

  /**
   * A copy in which cells without data next to cells with data get their
   * neighbours' average, `passes` times over, closing holes up to about
   * twice that many cells wide (e.g. water or removed buildings).
   */
  withSmallGapsFilled(passes: number): HeightGrid {
    const { columns, rows } = this.area;
    let values = this.values.slice();
    for (let pass = 0; pass < passes; pass++) {
      const next = values.slice();
      let filled = false;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const i = row * columns + column;
          if (!Number.isNaN(values[i])) continue;
          let sum = 0;
          let count = 0;
          for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const c = column + dc;
            const r = row + dr;
            if (c < 0 || r < 0 || c >= columns || r >= rows) continue;
            const v = values[r * columns + c];
            if (!Number.isNaN(v)) {
              sum += v;
              count++;
            }
          }
          if (count > 0) {
            next[i] = sum / count;
            filled = true;
          }
        }
      }
      values = next;
      if (!filled) break;
    }
    return new HeightGrid(this.area, values);
  }

  /**
   * The height at an RD point, interpolated between the surrounding cell
   * centres; NaN if one of them has no data or the point is outside.
   */
  heightAt(x: number, y: number): number {
    const fx = (x - this.area.minX) / this.cellWidth - 0.5;
    const fy = (this.area.maxY - y) / this.cellHeight - 0.5;
    const column = Math.floor(fx);
    const row = Math.floor(fy);
    const tx = fx - column;
    const ty = fy - row;
    // On the outer half cells there is only one neighbour to use.
    const c0 = Math.max(column, 0);
    const c1 = Math.min(column + 1, this.area.columns - 1);
    const r0 = Math.max(row, 0);
    const r1 = Math.min(row + 1, this.area.rows - 1);
    if (fx < -0.5 || fy < -0.5 || c0 > c1 || r0 > r1) return NaN;
    const top = this.at(c0, r0) * (1 - tx) + this.at(c1, r0) * tx;
    const bottom = this.at(c0, r1) * (1 - tx) + this.at(c1, r1) * tx;
    return top * (1 - ty) + bottom * ty;
  }
}
