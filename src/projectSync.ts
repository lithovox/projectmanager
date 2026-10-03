import type { HeightRaster } from "./heightRaster";
import { isProjectFile, type Project, type ProjectFile } from "./project";
import * as projectApi from "./projectApi";
import type { ProjectSummary } from "./projectApi";
import type { MapViewState } from "./views/mapView";

/** The stored data of a project isn't a ProjectManager project file. */
export class NotAProjectError extends Error {}

// What is compared to tell whether the project has unsaved changes: the
// project file without the map view (panning isn't a change to the data).
function snapshotOf(file: ProjectFile): string {
  return JSON.stringify({ ...file, map: null });
}

const NO_VIEW: MapViewState = { center: [0, 0], zoom: 0 };

/**
 * Keeps a Project in step with its copy in the database: which project is
 * open, whether it has changes that aren't saved yet, and the GeoTIFF files
 * of height rasters that still have to be uploaded. Nothing is sent to the
 * database except by `save()`.
 */
export class ProjectSync {
  private project: Project;
  private _current: ProjectSummary | null = null;
  private savedSnapshot: string;
  // Picked GeoTIFFs whose raster isn't stored in the database yet.
  private rasterFiles = new Map<HeightRaster, File>();

  constructor(project: Project) {
    this.project = project;
    this.savedSnapshot = this.snapshot();
  }

  /** The open project, or null when none is open. */
  get current(): ProjectSummary | null {
    return this._current;
  }

  /** True when the open project differs from what was last saved or opened. */
  get isDirty(): boolean {
    return this._current !== null && this.snapshot() !== this.savedSnapshot;
  }

  /** Remembers the file of a newly added raster, to upload on the next save. */
  addRasterFile(raster: HeightRaster, file: File): void {
    this.rasterFiles.set(raster, file);
  }

  /** The file of a raster that hasn't been uploaded yet; undefined once it is stored. */
  pendingRasterFile(raster: HeightRaster): File | undefined {
    return this.rasterFiles.get(raster);
  }

  /**
   * Loads a project from the database into the Project. Returns the saved
   * map view, or null for a project that was never saved. Throws
   * NotAProjectError if the stored data isn't a project file.
   */
  async open(summary: ProjectSummary): Promise<MapViewState | null> {
    const data = await projectApi.fetchProjectData(summary.id);
    const isBlank = !!data && typeof data === "object" && Object.keys(data).length === 0;
    if (!isBlank && !isProjectFile(data)) throw new NotAProjectError();

    if (isProjectFile(data)) this.project.loadFile(data);
    else this.project.clear();
    this._current = summary;
    this.rasterFiles.clear();
    this.savedSnapshot = this.snapshot();
    return isProjectFile(data) ? data.map : null;
  }

  /**
   * Fills the open project `summary`, which must have just been created (so
   * it is still empty in the database), with an imported project file, as
   * unsaved changes: Save stores it, uploading the rasters' GeoTIFFs. Raster
   * ids from the file are dropped (they belong to another database), and
   * rasters without a GeoTIFF in `rasterFiles` (by file name) are left out;
   * returns their file names.
   */
  openImported(summary: ProjectSummary, file: ProjectFile, rasterFiles: ReadonlyMap<string, File>): string[] {
    this.project.clear();
    this._current = summary;
    this.rasterFiles.clear();
    this.savedSnapshot = this.snapshot();
    this.project.loadFile({ ...file, heightRasters: (file.heightRasters ?? []).map((raster) => ({ ...raster, id: undefined })) });
    const missing: string[] = [];
    for (const raster of [...this.project.heightRasters]) {
      const rasterFile = rasterFiles.get(raster.fileName);
      if (rasterFile) this.rasterFiles.set(raster, rasterFile);
      else {
        this.project.removeHeightRaster(raster);
        missing.push(raster.fileName);
      }
    }
    return missing;
  }

  /** Closes the open project (e.g. after deleting it) and empties the Project. */
  close(): void {
    this.project.clear();
    this._current = null;
    this.rasterFiles.clear();
    this.savedSnapshot = this.snapshot();
  }

  /**
   * Saves the open project: uploads the GeoTIFFs of new height rasters, stores
   * the project file, then deletes stored GeoTIFFs the project no longer
   * refers to. Changes made while saving stay unsaved.
   */
  async save(map: MapViewState): Promise<void> {
    if (!this._current) throw new Error("No project is open");
    const id = this._current.id;

    for (const raster of this.project.heightRasters) {
      const file = this.rasterFiles.get(raster);
      if (raster.id === null && file) {
        raster.id = await projectApi.uploadRaster(id, raster, file);
        this.rasterFiles.delete(raster);
      }
    }

    const file = this.project.toFile(map);
    this._current = await projectApi.saveProjectData(id, file, this.project.isValid);
    this.savedSnapshot = snapshotOf(file);

    const used = new Set(file.heightRasters.map((raster) => raster.id));
    for (const stored of await projectApi.listRasters(id)) {
      if (!used.has(stored.id)) await projectApi.deleteRaster(id, stored.id);
    }
    // Forget files of rasters that were removed before they were uploaded.
    for (const raster of this.rasterFiles.keys()) {
      if (!this.project.heightRasters.includes(raster)) this.rasterFiles.delete(raster);
    }
  }

  private snapshot(): string {
    return snapshotOf(this.project.toFile(NO_VIEW));
  }
}
