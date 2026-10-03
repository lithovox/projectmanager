import { strFromU8, strToU8, unzip, zip, type AsyncZippable, type Unzipped } from "fflate";
import { t } from "./i18n";
import { isProjectFile, PROJECT_VERSION, type ProjectFile } from "./project";

// An exported project: a zip file to exchange whole projects between users
// or databases. It holds
//   manifest.json      what the archive is (ArchiveManifest)
//   project.json       the project file (ProjectFile)
//   rasters/<name>     the GeoTIFF of every height raster, by its file name
// Raster ids in project.json belong to the database the project came from;
// they mean nothing elsewhere and are dropped when importing.

const FORMAT = "lithovox-project";
const MANIFEST = "manifest.json";
const PROJECT = "project.json";
const RASTER_DIR = "rasters/";

/** The archive's manifest.json. */
interface ArchiveManifest {
  format: typeof FORMAT;
  /** PROJECT_VERSION of the app that exported it. */
  version: string;
  /** Name of the project when it was exported. */
  name: string;
  /** ISO 8601 moment of the export. */
  exportedAt: string;
}

/** A project as exported or imported: its name, file and raster GeoTIFFs. */
export interface ProjectArchive {
  name: string;
  file: ProjectFile;
  /** The GeoTIFF of each height raster, by the raster's file name. */
  rasters: Map<string, Blob>;
}

/** A file that can't be imported; the message is for the user (translated). */
export class ArchiveError extends Error {}

function isManifest(value: unknown): value is ArchiveManifest {
  const m = value as ArchiveManifest | null;
  return !!m && typeof m === "object" && m.format === FORMAT && typeof m.version === "string" && typeof m.name === "string";
}

function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => zip(files, (err, data) => (err ? reject(err) : resolve(data))));
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => unzip(data, (err, files) => (err ? reject(err) : resolve(files))));
}

/** The archive as a zip file. */
export async function writeProjectArchive(archive: ProjectArchive): Promise<Blob> {
  const manifest: ArchiveManifest = {
    format: FORMAT,
    version: PROJECT_VERSION,
    name: archive.name,
    exportedAt: new Date().toISOString(),
  };
  const files: AsyncZippable = {
    [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)),
    [PROJECT]: strToU8(JSON.stringify(archive.file)),
  };
  for (const [fileName, blob] of archive.rasters) {
    // GeoTIFFs are usually compressed already; storing them as they are is
    // much faster and hardly bigger.
    files[RASTER_DIR + fileName] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([(await zipAsync(files)) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}

/** Reads an exported project; throws an ArchiveError if it can't be imported. */
export async function readProjectArchive(file: File): Promise<ProjectArchive> {
  let files: Unzipped;
  try {
    files = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new ArchiveError(t("archive.notZip"));
  }

  const json = (name: string): unknown => {
    if (!files[name]) return undefined;
    try {
      return JSON.parse(strFromU8(files[name]));
    } catch {
      return undefined;
    }
  };
  const manifest = json(MANIFEST);
  if (!isManifest(manifest)) throw new ArchiveError(t("archive.notProject"));
  if (manifest.version !== PROJECT_VERSION) {
    throw new ArchiveError(t("archive.wrongVersion", { version: manifest.version, supported: PROJECT_VERSION }));
  }
  const project = json(PROJECT);
  if (!isProjectFile(project)) throw new ArchiveError(t("archive.notProject"));

  const rasters = new Map<string, Blob>();
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith(RASTER_DIR) && path.length > RASTER_DIR.length) {
      rasters.set(path.slice(RASTER_DIR.length), new Blob([data as Uint8Array<ArrayBuffer>], { type: "image/tiff" }));
    }
  }
  return { name: manifest.name, file: project, rasters };
}
