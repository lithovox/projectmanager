import { fromBlob } from "geotiff";
import { HeightGrid, type HeightGridArea } from "./heightGrid";
import type { HeightRasterData } from "./heightRaster";
import { t } from "./i18n";

const RD_EPSG = 28992;
const EXTENSIONS = [".tif", ".tiff"];

// Reads the extent and size of a GeoTIFF height raster in RD (EPSG:28992).
// Only the header is read, so large files are fine. A file without a
// projection is taken to be in RD. Throws an Error with a user-facing
// (translated) message if the file is unusable.
export async function readHeightRaster(file: File): Promise<HeightRasterData> {
  const name = file.name.toLowerCase();
  if (!EXTENSIONS.some((ext) => name.endsWith(ext))) throw new Error(t("heightData.wrongExtension"));

  let data: HeightRasterData;
  let epsg: unknown;
  try {
    const image = await (await fromBlob(file)).getImage();
    const [minX, minY, maxX, maxY] = image.getBoundingBox();
    epsg = image.getGeoKeys()?.ProjectedCSTypeGeoKey;
    data = { fileName: file.name, minX, minY, maxX, maxY, width: image.getWidth(), height: image.getHeight() };
  } catch (err) {
    console.error(err);
    throw new Error(t("heightData.unreadable"));
  }
  if (epsg !== undefined && epsg !== RD_EPSG) throw new Error(t("heightData.notRd", { epsg: String(epsg) }));
  return data;
}

/**
 * The heights of `area` from a GeoTIFF that is only in the browser (not
 * stored yet), resampled here. Only the part over `area` is read, from the
 * file's coarsest overview that is still detailed enough, if it has any.
 */
export async function readHeightGrid(file: File, area: HeightGridArea): Promise<HeightGrid> {
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const grid = new HeightGrid(area);
  const cellWidth = grid.cellWidth;
  const cellHeight = grid.cellHeight;

  // The cells whose centres the raster covers, and their outer extent.
  const firstColumn = Math.max(0, Math.ceil((minX - area.minX) / cellWidth - 0.5));
  const lastColumn = Math.min(area.columns - 1, Math.floor((maxX - area.minX) / cellWidth - 0.5));
  const firstRow = Math.max(0, Math.ceil((area.maxY - maxY) / cellHeight - 0.5));
  const lastRow = Math.min(area.rows - 1, Math.floor((area.maxY - minY) / cellHeight - 0.5));
  if (firstColumn > lastColumn || firstRow > lastRow) return grid;
  const columns = lastColumn - firstColumn + 1;
  const rows = lastRow - firstRow + 1;
  const bbox = [
    Math.max(minX, area.minX + firstColumn * cellWidth),
    Math.max(minY, area.maxY - (lastRow + 1) * cellHeight),
    Math.min(maxX, area.minX + (lastColumn + 1) * cellWidth),
    Math.min(maxY, area.maxY - firstRow * cellHeight),
  ];

  const [band] = await tiff.readRasters({ bbox, width: columns, height: rows, samples: [0], resampleMethod: "bilinear" });
  const noData = image.getGDALNoData();
  const values = band as ArrayLike<number>;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const value = values[row * columns + column];
      grid.values[(firstRow + row) * area.columns + firstColumn + column] = value === noData ? NaN : value;
    }
  }
  // Applies the no-data threshold to the new values.
  return new HeightGrid(area, grid.values);
}
