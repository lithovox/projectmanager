import proj4 from "proj4";

// RD New (EPSG:28992), the Dutch national grid. Same definition used by the
// other apps in this workspace (e.g. geoscanner).
const RD_DEF =
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.33,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs";
proj4.defs("EPSG:28992", RD_DEF);

/** A point in RD (EPSG:28992) coordinates, in metres. */
export interface RdPoint {
  x: number;
  y: number;
}

/** Converts an RD point to a Leaflet-style [lat, lng] pair (WGS84). */
export function rdToLatLng(point: RdPoint): [number, number] {
  const [lng, lat] = proj4("EPSG:28992", "EPSG:4326", [point.x, point.y]);
  return [lat, lng];
}
