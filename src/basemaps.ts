import type { Theme } from "./theme";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

/** A Web Mercator (XYZ) tile layer. */
export interface BasemapLayer {
  url: string;
  attribution: string;
  maxNativeZoom: number;
}

// Esri basemaps: worldwide coverage, no API key. The dark canvas has its
// labels in a separate transparent layer drawn on top of the base. Shared by
// the Map page and the ground of the 3D page.
export const BASEMAPS: Record<Theme, BasemapLayer[]> = {
  light: [
    {
      url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
      attribution:
        "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community",
      maxNativeZoom: 19,
    },
  ],
  dark: [
    {
      url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
      maxNativeZoom: 16,
    },
    {
      url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      attribution: "",
      maxNativeZoom: 16,
    },
  ],
};

/** The URL of one tile of `layer`. */
export function tileUrl(layer: BasemapLayer, z: number, x: number, y: number): string {
  return layer.url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
