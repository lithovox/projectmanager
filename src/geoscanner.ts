import { t } from "./i18n";
import type { SoilData } from "./soil";
import type { SoilLayer } from "./soilProfile";
import type { RdPoint } from "./rd";

export const GEOSCANNER_EXTENSION = ".geoscanner.json";

/** The soil profiles of a geoscanner export, ready to add to a Project. */
export interface GeoscannerData {
  soils: SoilData[];
  profiles: { point: RdPoint; layers: SoilLayer[] }[];
}

// The file as written by geoscanner. Coordinates are RD (EPSG:28992).
interface GeoscannerFile {
  soil_profiles: {
    x: number;
    y: number;
    soil_layers: { top: number; bottom: number; soil_code: string }[];
  }[];
  soil_colors: Record<string, string>;
}

function isGeoscannerFile(value: unknown): value is GeoscannerFile {
  const f = value as GeoscannerFile | null;
  return (
    !!f &&
    typeof f === "object" &&
    !!f.soil_colors &&
    typeof f.soil_colors === "object" &&
    Object.values(f.soil_colors).every((c) => typeof c === "string") &&
    Array.isArray(f.soil_profiles) &&
    f.soil_profiles.every(
      (p) =>
        !!p &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Array.isArray(p.soil_layers) &&
        p.soil_layers.length > 0 &&
        p.soil_layers.every(
          (l) =>
            !!l &&
            Number.isFinite(l.top) &&
            Number.isFinite(l.bottom) &&
            l.top >= l.bottom &&
            typeof l.soil_code === "string",
        ),
    )
  );
}

// Reads a *.geoscanner.json file. Throws an Error with a user-facing
// (translated) message if the file is unusable.
export async function readGeoscannerFile(file: File): Promise<GeoscannerData> {
  if (!file.name.toLowerCase().endsWith(GEOSCANNER_EXTENSION)) {
    throw new Error(t("geoscanner.wrongExtension", { extension: GEOSCANNER_EXTENSION }));
  }
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(t("geoscanner.invalidJson"));
  }
  if (!isGeoscannerFile(data)) throw new Error(t("geoscanner.notGeoscanner"));

  const unknownSoil = data.soil_profiles
    .flatMap((p) => p.soil_layers)
    .find((l) => !(l.soil_code in data.soil_colors));
  if (unknownSoil) throw new Error(t("geoscanner.unknownSoil", { soil: unknownSoil.soil_code }));

  return {
    soils: Object.entries(data.soil_colors).map(([name, color]) => ({ name, color })),
    profiles: data.soil_profiles.map((p) => ({
      point: { x: p.x, y: p.y },
      layers: p.soil_layers.map((l) => ({ top: l.top, bottom: l.bottom, soil: l.soil_code })),
    })),
  };
}
