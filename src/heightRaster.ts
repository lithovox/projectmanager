import type { RdPoint } from "./rd";

/** How a height raster is stored in a project file: where it is, not its data. */
export interface HeightRasterData {
  /** Name of the GeoTIFF file the raster was read from. */
  fileName: string;
  /** Extent in RD (EPSG:28992), metres. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Size in pixels. */
  width: number;
  height: number;
  /**
   * Id of the GeoTIFF stored in the database for this project; missing until
   * the file has been uploaded (when the project is saved).
   */
  id?: string;
}

/**
 * A height raster (GeoTIFF) the project refers to. The project keeps its file
 * name and extent; the file itself is stored separately in the database and
 * referred to by `id`. Uniqueness of file names is a project-wide rule,
 * enforced by Project.
 */
export class HeightRaster {
  readonly fileName: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
  /** Database id of the stored GeoTIFF; null while it hasn't been uploaded. */
  id: string | null;

  constructor(data: HeightRasterData) {
    if (!HeightRaster.isData(data)) throw new Error("Invalid height raster");
    this.fileName = data.fileName;
    this.minX = data.minX;
    this.minY = data.minY;
    this.maxX = data.maxX;
    this.maxY = data.maxY;
    this.width = data.width;
    this.height = data.height;
    this.id = data.id ?? null;
  }

  /** Pixel size in metres, horizontally and vertically. */
  get resolution(): { x: number; y: number } {
    return { x: (this.maxX - this.minX) / this.width, y: (this.maxY - this.minY) / this.height };
  }

  /** The extent's corners, counter-clockwise from the bottom left. */
  get corners(): RdPoint[] {
    return [
      { x: this.minX, y: this.minY },
      { x: this.maxX, y: this.minY },
      { x: this.maxX, y: this.maxY },
      { x: this.minX, y: this.maxY },
    ];
  }

  toData(): HeightRasterData {
    return {
      fileName: this.fileName,
      minX: this.minX,
      minY: this.minY,
      maxX: this.maxX,
      maxY: this.maxY,
      width: this.width,
      height: this.height,
      ...(this.id ? { id: this.id } : {}),
    };
  }

  static isData(value: unknown): value is HeightRasterData {
    const r = value as HeightRasterData | null;
    return (
      !!r &&
      typeof r === "object" &&
      typeof r.fileName === "string" &&
      r.fileName.trim() !== "" &&
      Number.isFinite(r.minX) &&
      Number.isFinite(r.minY) &&
      Number.isFinite(r.maxX) &&
      Number.isFinite(r.maxY) &&
      r.maxX > r.minX &&
      r.maxY > r.minY &&
      Number.isInteger(r.width) &&
      Number.isInteger(r.height) &&
      r.width > 0 &&
      r.height > 0 &&
      (r.id === undefined || typeof r.id === "string")
    );
  }
}
