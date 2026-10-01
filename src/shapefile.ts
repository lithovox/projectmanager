import { parseShp } from "shpjs";
import { t } from "./i18n";
import type { RdPoint } from "./rd";

const REQUIRED_EXTENSIONS = ["shp", "shx", "dbf"];

function baseFileName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? filename : filename.slice(0, dot);
}

export interface ShapefileLine {
  /** File name of the .shp without extension, e.g. as a default line name. */
  baseName: string;
  points: RdPoint[];
}

// Reads the files the user picked (.shp, .shx and .dbf of a single
// shapefile) into a line. Coordinates are taken as RD (EPSG:28992) as-is; any
// other selected file (such as a .prj) is ignored. Throws an Error with a
// user-facing (translated) message if the selection is unusable.
export async function readShapefileLine(files: File[]): Promise<ShapefileLine> {
  const byExt = new Map<string, File>();
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext && REQUIRED_EXTENSIONS.includes(ext)) byExt.set(ext, file);
  }
  const missing = REQUIRED_EXTENSIONS.filter((ext) => !byExt.has(ext));
  if (missing.length > 0) {
    throw new Error(t("shapefile.missingFiles", { files: missing.map((ext) => `.${ext}`).join(", ") }));
  }

  const baseNames = new Set(REQUIRED_EXTENSIONS.map((ext) => baseFileName(byExt.get(ext)!.name).toLowerCase()));
  if (baseNames.size > 1) {
    throw new Error(t("shapefile.mismatchedFiles"));
  }

  const shp = await byExt.get("shp")!.arrayBuffer();
  return {
    baseName: baseFileName(byExt.get("shp")!.name),
    points: parseShapefileToRd(shp),
  };
}

function parseShapefileToRd(shp: ArrayBuffer): RdPoint[] {
  let geometry: unknown;
  try {
    // No prj: shpjs returns the raw (RD) coordinates without reprojecting.
    geometry = parseShp(shp, false);
  } catch {
    throw new Error(t("shapefile.unreadable"));
  }
  const rawCoords = flattenCoordinates(geometry);
  if (rawCoords.length < 2) {
    throw new Error(t("shapefile.noLine"));
  }

  return rawCoords.map((coord) => ({ x: coord[0], y: coord[1] }));
}

// Recursively descends GeoJSON-shaped geometry (a single geometry, an array
// of them, or nested coordinate arrays) down to the [x, y(, z)] leaves.
function flattenCoordinates(value: unknown): number[][] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    if (typeof value[0] === "number") {
      return [value as number[]];
    }
    return (value as unknown[]).flatMap(flattenCoordinates);
  }
  if (typeof value === "object" && "coordinates" in value) {
    return flattenCoordinates((value as { coordinates: unknown }).coordinates);
  }
  return [];
}
