import { readGeoscannerFile } from "./geoscanner";
import { readHeightGrid, readHeightRaster } from "./heightData";
import { HeightGrid, type HeightGridArea } from "./heightGrid";
import { showSoilProfileDialog } from "./soilProfileDialog";
import {
  DEFAULT_MAX_ASSIGN_DISTANCE,
  showAssignSoilProfilesDialog,
  type AssignSoilProfilesDialogResult,
} from "./assignSoilProfilesDialog";
import { ApiError } from "./apiClient";
import { getSession, onSessionChange } from "./auth";
import { fetchCptMetadataByPolyline, fetchCptXml, type CptMetadata } from "./broApi";
import { formatMetres, t } from "./i18n";
import type { MessageKey } from "./i18n/en";
import type { SoilProfile } from "./soilProfile";
import { referenceLineNameError, showReferenceLineDialog } from "./referenceLineDialog";
import { Project } from "./project";
import {
  createProject,
  deleteProject,
  downloadRaster,
  fetchHeights,
  listProjects,
  type ProjectSummary,
} from "./projectApi";
import { ArchiveError, readProjectArchive, writeProjectArchive, type ProjectArchive } from "./projectArchive";
import { showProjectManager } from "./projectManagerDialog";
import { NotAProjectError, ProjectSync } from "./projectSync";
import { readShapefileLine } from "./shapefile";
import type { MapView } from "./views/mapView";
import type { Scene3DView } from "./views/scene3dView";
import type { TableSection, TablesView } from "./views/tablesView";

// Search distance (metres) on either side of a reference line for BRO CPTs.
const CPT_SEARCH_OFFSET = 10;
// Number of CPT files downloaded at the same time.
const CPT_DOWNLOAD_CONCURRENCY = 4;

/** Runs `task` for every item, at most `limit` at a time. */
async function forEachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Wires the project buttons (projects / save, the upload and assign buttons)
// and clicks on the map and tables to the Project, and keeps the views in
// sync with it. Projects live in the database: after logging in the user
// picks or creates one, and changes are only stored by Save.
export class ProjectController {
  private project = new Project();
  private sync = new ProjectSync(this.project);
  private saveButton: HTMLButtonElement;
  private projectName: HTMLElement;
  private projectInvalid: HTMLElement;
  private saving = false;
  private managerOpen = false;
  /** Email of the user whose project is open, to notice a different user logging in. */
  private sessionEmail: string | null = null;
  private mapView: MapView;
  private tablesView: TablesView;
  private scene3dView: Scene3DView;
  private downloadCptsButton: HTMLButtonElement;
  private downloadCptsLabel: HTMLElement;
  private downloadingCpts = false;
  private exportButton: HTMLButtonElement;
  private exportLabel: HTMLElement;
  private importInput: HTMLInputElement;
  private importLabel: HTMLElement;
  /** An export or import is running. */
  private exchanging = false;
  private assignSoilProfilesButton: HTMLButtonElement;
  private resetAssignmentsButton: HTMLButtonElement;
  // Last maximum distance and "Auto Assign" choice, offered again the next time.
  private maxAssignDistance = DEFAULT_MAX_ASSIGN_DISTANCE;
  private autoAssignOnUpload = true;

  constructor(mapView: MapView, tablesView: TablesView, scene3dView: Scene3DView) {
    this.mapView = mapView;
    this.tablesView = tablesView;
    this.scene3dView = scene3dView;
    this.scene3dView.onHeightsRequest((area) => this.loadHeights(area));
    this.tablesView.setHandlers({
      // Of the rows, only soil profiles can be edited so far.
      onEdit: (section, index) => {
        const profile = this.project.soilProfiles[index];
        if (section === "soilProfiles" && profile) this.editSoilProfile(profile);
      },
      onRemove: (section, index) => this.removeItem(section, index),
      onRemoveAll: (section) => this.removeAll(section),
      onSoilColorChange: (name, color) => {
        this.project.setSoilColor(name, color);
        this.refreshViews();
      },
    });
    this.mapView.onReferenceLineClick((name) => this.editReferenceLine(name));
    this.mapView.onSoilProfileEdit((profile) => this.editSoilProfile(profile));

    const referenceLineInput = document.getElementById("referenceline-input") as HTMLInputElement;
    referenceLineInput.addEventListener("change", () => {
      const files = Array.from(referenceLineInput.files ?? []);
      referenceLineInput.value = "";
      if (files.length > 0) this.uploadReferenceLine(files);
    });

    const geoscannerInput = document.getElementById("geoscanner-input") as HTMLInputElement;
    geoscannerInput.addEventListener("change", () => {
      const file = geoscannerInput.files?.[0];
      geoscannerInput.value = "";
      if (file) this.uploadGeoscannerData(file);
    });

    const heightDataInput = document.getElementById("height-data-input") as HTMLInputElement;
    heightDataInput.addEventListener("change", () => {
      const files = Array.from(heightDataInput.files ?? []);
      heightDataInput.value = "";
      if (files.length > 0) this.uploadHeightData(files);
    });

    this.saveButton = document.getElementById("save-project-btn") as HTMLButtonElement;
    this.saveButton.addEventListener("click", () => this.saveProject());
    this.projectName = document.getElementById("project-name")!;
    this.projectInvalid = document.getElementById("project-invalid")!;
    document.getElementById("new-project-btn")!.addEventListener("click", () => this.openProjectManager(true));
    document.getElementById("load-project-btn")!.addEventListener("click", () => this.openProjectManager());
    window.addEventListener("beforeunload", (e) => {
      if (this.sync.isDirty) e.preventDefault();
    });

    this.downloadCptsButton = document.getElementById("download-bro-cpts-btn") as HTMLButtonElement;
    this.downloadCptsLabel = this.downloadCptsButton.querySelector("span")!;
    this.downloadCptsButton.addEventListener("click", () => this.downloadBroCpts());
    this.assignSoilProfilesButton = document.getElementById("assign-soil-profiles-btn") as HTMLButtonElement;
    this.assignSoilProfilesButton.addEventListener("click", () => this.assignSoilProfiles());
    this.resetAssignmentsButton = document.getElementById("reset-assignments-btn") as HTMLButtonElement;
    this.resetAssignmentsButton.addEventListener("click", () => {
      this.project.resetSoilProfileAssignments();
      this.refreshViews();
    });
    this.exportButton = document.getElementById("export-project-btn") as HTMLButtonElement;
    this.exportLabel = this.exportButton.querySelector("span")!;
    this.exportButton.addEventListener("click", () => this.exportProject());
    this.importInput = document.getElementById("import-project-input") as HTMLInputElement;
    this.importLabel = document.querySelector<HTMLElement>("#import-project-btn > span")!;
    this.importInput.addEventListener("change", () => {
      const file = this.importInput.files?.[0];
      this.importInput.value = "";
      if (file) this.importProject(file);
    });
    this.refreshViews();

    // After logging in (now, or later), pick a project first.
    onSessionChange((session) => {
      if (session) this.onLogin(session.email);
    });
    const session = getSession();
    if (session) this.onLogin(session.email);
  }

  // The same user logging in again (after the token expired) keeps working on
  // the open project; anyone else starts by choosing one.
  private onLogin(email: string): void {
    if (this.sync.current && email === this.sessionEmail) return;
    this.sessionEmail = email;
    this.sync.close();
    this.refreshViews();
    this.mapView.resetView();
    this.openProjectManager();
  }

  private async openProjectManager(focusNew = false): Promise<void> {
    const session = getSession();
    if (this.managerOpen || !session) return;
    this.managerOpen = true;
    try {
      await showProjectManager({
        email: session.email,
        currentId: () => this.sync.current?.id ?? null,
        focusNew,
        list: listProjects,
        create: (name) => this.createProject(name),
        open: (project) => this.openProject(project),
        remove: (project) => this.deleteProject(project),
      });
    } finally {
      this.managerOpen = false;
    }
  }

  /** Asks before throwing away unsaved changes; true when there are none or the user agrees. */
  private confirmDiscard(): boolean {
    return !this.sync.isDirty || window.confirm(t("project.confirmDiscard", { name: this.sync.current?.name ?? "" }));
  }

  // Resolves with an error message for the dialog, or null once the new
  // project is created and open.
  private async createProject(name: string): Promise<string | null> {
    if (name.trim() === "") return t("projectManager.nameRequired");
    if (!this.confirmDiscard()) return "";
    let project: ProjectSummary;
    try {
      project = await createProject(name.trim());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return t("projectManager.nameTaken", { name: name.trim() });
      console.error(err);
      return t("projectManager.createFailed");
    }
    return (await this.openProject(project, false)) ? null : t("projectManager.openFailed");
  }

  private async openProject(project: ProjectSummary, askDiscard = true): Promise<boolean> {
    if (askDiscard && !this.confirmDiscard()) return false;
    let view;
    try {
      view = await this.sync.open(project);
    } catch (err) {
      console.error(err);
      window.alert(t(err instanceof NotAProjectError ? "project.notAProject" : "projectManager.openFailed"));
      return false;
    }
    this.refreshViews();
    if (view) this.mapView.setView(view);
    else this.mapView.resetView();
    return true;
  }

  private async deleteProject(project: ProjectSummary): Promise<void> {
    if (!window.confirm(t("projectManager.confirmDelete", { name: project.name }))) return;
    try {
      await deleteProject(project.id);
    } catch (err) {
      console.error(err);
      window.alert(t("projectManager.deleteFailed"));
      return;
    }
    if (project.id === this.sync.current?.id) {
      this.sync.close();
      this.refreshViews();
      this.mapView.resetView();
    }
  }

  private async saveProject(): Promise<void> {
    if (this.saving || !this.sync.current) return;
    this.saving = true;
    this.updateSaveState();
    let saved = false;
    try {
      await this.sync.save(this.mapView.getView());
      saved = true;
    } catch (err) {
      console.error(err);
      window.alert(t("project.saveFailed"));
    } finally {
      this.saving = false;
      this.refreshViews();
    }
    // An incomplete project is still saved, so work isn't lost; the user is
    // only told what is missing.
    if (saved && !this.project.isValid) window.alert(t("project.savedNotValid"));
  }

  // Downloads the open project, as it is now (unsaved changes included), as
  // a .zip file with the GeoTIFFs of its height rasters.
  private async exportProject(): Promise<void> {
    const current = this.sync.current;
    if (this.exchanging || !current) return;
    this.setExchanging(true, this.exportLabel, "archive.exporting");
    try {
      const rasters = new Map<string, Blob>();
      for (const raster of this.project.heightRasters) {
        const file = this.sync.pendingRasterFile(raster);
        if (file) rasters.set(raster.fileName, file);
        else if (raster.id !== null) rasters.set(raster.fileName, await downloadRaster(current.id, raster.id));
      }
      const zip = await writeProjectArchive({
        name: current.name,
        file: this.project.toFile(this.mapView.getView()),
        rasters,
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zip);
      // Characters that aren't allowed in file names on some systems.
      link.download = `${current.name.replace(/[\\/:*?"<>|]+/g, "_")}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (err) {
      console.error(err);
      window.alert(t("archive.exportFailed"));
    } finally {
      this.setExchanging(false, this.exportLabel, "archive.export");
    }
  }

  // Imports an exported project as a new project, named as in the export
  // (with a number added if the user already has a project by that name).
  // Its contents arrive as unsaved changes; Save stores them.
  private async importProject(file: File): Promise<void> {
    if (this.exchanging) return;
    let archive: ProjectArchive;
    try {
      archive = await readProjectArchive(file);
    } catch (err) {
      if (!(err instanceof ArchiveError)) console.error(err);
      window.alert(err instanceof ArchiveError ? err.message : t("archive.importFailed"));
      return;
    }
    if (!this.confirmDiscard()) return;

    this.setExchanging(true, this.importLabel, "archive.importing");
    try {
      const summary = await this.createProjectWithFreeName(archive.name);
      const rasterFiles = new Map(
        [...archive.rasters].map(([fileName, blob]) => [fileName, new File([blob], fileName, { type: blob.type })]),
      );
      const missing = this.sync.openImported(summary, archive.file, rasterFiles);
      this.refreshViews();
      this.mapView.setView(archive.file.map);
      const messages = [t("archive.imported", { name: summary.name })];
      if (missing.length > 0) messages.push(t("archive.missingRasters", { files: missing.join(", ") }));
      window.alert(messages.join("\n\n"));
    } catch (err) {
      console.error(err);
      window.alert(t("archive.importFailed"));
    } finally {
      this.setExchanging(false, this.importLabel, "archive.import");
    }
  }

  /** Creates an empty project named `name`, or "name (2)", "name (3)", … if that is taken. */
  private async createProjectWithFreeName(name: string): Promise<ProjectSummary> {
    for (let n = 1; ; n++) {
      try {
        return await createProject(n === 1 ? name : `${name} (${n})`);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409) || n >= 100) throw err;
      }
    }
  }

  private setExchanging(exchanging: boolean, label: HTMLElement, text: MessageKey): void {
    this.exchanging = exchanging;
    label.textContent = t(text);
    this.importInput.disabled = exchanging;
    this.updateButtons();
  }

  // Finds the BRO CPTs along every reference line, downloads the ones the
  // project doesn't have yet and shows them on the map once all are in.
  private async downloadBroCpts(): Promise<void> {
    if (this.downloadingCpts || this.project.referenceLines.length === 0) return;
    this.downloadingCpts = true;
    this.updateButtons();
    this.downloadCptsLabel.textContent = t("bro.downloadingCptList");
    try {
      let found: CptMetadata[];
      try {
        const perLine = await Promise.all(
          this.project.referenceLines.map((line) => fetchCptMetadataByPolyline(line.points, CPT_SEARCH_OFFSET)),
        );
        // Lines can share CPTs; keep each id once.
        found = [...new Map(perLine.flat().map((cpt) => [cpt.id, cpt])).values()];
      } catch (err) {
        console.error(err);
        window.alert(t("bro.cptListFailed"));
        return;
      }
      if (found.length === 0) {
        window.alert(t("bro.noCptsFound"));
        return;
      }

      const missing = found.filter((cpt) => !this.project.hasCpt(cpt.id));
      let done = 0;
      let failed = 0;
      const showProgress = () => {
        this.downloadCptsLabel.textContent = t("bro.downloadingCpts", { done, total: missing.length });
      };
      showProgress();
      await forEachLimited(missing, CPT_DOWNLOAD_CONCURRENCY, async (cpt) => {
        try {
          this.project.addCpt({ ...cpt, xml: await fetchCptXml(cpt.id) });
        } catch (err) {
          console.error(err);
          failed++;
        }
        done++;
        showProgress();
      });

      this.refreshViews();
      if (failed > 0) window.alert(t("bro.cptsFailed", { failed, total: missing.length }));
    } finally {
      this.downloadingCpts = false;
      this.downloadCptsLabel.textContent = t("bro.downloadCpts");
      this.updateButtons();
    }
  }

  private async uploadReferenceLine(files: File[]): Promise<void> {
    let line;
    try {
      line = await readShapefileLine(files);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t("shapefile.unreadable"));
      return;
    }

    const isFirst = this.project.referenceLines.length === 0;
    const color = this.project.nextColor();
    const result = await showReferenceLineDialog({
      title: t("referenceLine.uploadDialogTitle"),
      color,
      // Suggest the shapefile's name unless a line by that name already exists.
      initialName: this.project.hasReferenceLine(line.baseName) ? "" : line.baseName,
      isChainageLine: isFirst,
      chainageLocked: isFirst,
      chainageHint: isFirst
        ? t("referenceLine.chainageFirstLine")
        : t("referenceLine.chainageReplaces", { name: this.project.chainageLine?.name ?? "" }),
      validate: (value) => referenceLineNameError(this.project.validateReferenceLineName(value), value),
    });
    if (!result) return;

    const added = this.project.addReferenceLine(result.name, line.points, result.isChainageLine, color);
    this.refreshViews();
    this.mapView.zoomToReferenceLine(added.name);
  }

  // Adds the soils and soil profiles of a geoscanner export. Soils the project
  // already has keep their colour.
  private async uploadGeoscannerData(file: File): Promise<void> {
    let data;
    try {
      data = await readGeoscannerFile(file);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t("geoscanner.unreadable"));
      return;
    }
    if (data.profiles.length === 0) {
      window.alert(t("geoscanner.noProfiles"));
      return;
    }

    // With referencelines in the project, offer to assign the profiles right away.
    let assign: AssignSoilProfilesDialogResult | null = null;
    if (this.project.referenceLines.length > 0) {
      assign = await showAssignSoilProfilesDialog({
        title: t("geoscanner.uploadDialogTitle"),
        submitLabel: t("geoscanner.uploadSubmit"),
        initialDistance: this.maxAssignDistance,
        autoAssign: this.autoAssignOnUpload,
      });
      if (!assign) return;
      this.autoAssignOnUpload = assign.assign;
    }

    for (const soil of data.soils) this.project.addSoil(soil.name, soil.color);
    for (const profile of data.profiles) {
      this.project.addSoilProfile(profile.point, profile.layers, undefined, "geoscanner");
    }
    this.refreshViews();
    this.mapView.zoomToSoilProfiles();
    if (assign?.assign) this.assignToClosestLines(assign.maxDistance);
  }

  // Asks for the maximum distance, then assigns every soil profile within it
  // to its closest referenceline.
  private async assignSoilProfiles(): Promise<void> {
    const result = await showAssignSoilProfilesDialog({
      title: t("soilProfile.assignDialogTitle"),
      submitLabel: t("soilProfile.assign"),
      initialDistance: this.maxAssignDistance,
    });
    if (result) this.assignToClosestLines(result.maxDistance);
  }

  // Assigns every soil profile and reports the ones that couldn't be.
  private assignToClosestLines(maxDistance: number): void {
    this.maxAssignDistance = maxDistance;
    const { tooFar, endTaken } = this.project.assignSoilProfilesToClosestLines(maxDistance);
    this.refreshViews();
    const total = this.project.soilProfiles.length;
    const messages = [];
    if (tooFar > 0) {
      messages.push(t("soilProfile.tooFar", { count: tooFar, total, distance: formatMetres(maxDistance) }));
    }
    if (endTaken > 0) messages.push(t("soilProfile.endTaken", { count: endTaken, total }));
    if (messages.length > 0) window.alert(messages.join("\n\n"));
  }

  // Opened by clicking a line on the map: rename it and/or make it the
  // chainage line.
  private async editReferenceLine(name: string): Promise<void> {
    const line = this.project.getReferenceLine(name);
    if (!line) return;

    this.mapView.highlightReferenceLine(line.name);
    const result = await showReferenceLineDialog({
      title: t("referenceLine.editDialogTitle"),
      color: line.color,
      initialName: line.name,
      isChainageLine: line.isChainageLine,
      // There must always be a chainage line, so it can only be moved by
      // promoting another line, not by unticking this one.
      chainageLocked: line.isChainageLine,
      chainageHint: line.isChainageLine
        ? t("referenceLine.chainageAlready")
        : t("referenceLine.chainageReplaces", { name: this.project.chainageLine?.name ?? "" }),
      validate: (value) =>
        referenceLineNameError(this.project.validateReferenceLineName(value, line.name), value),
    });
    this.mapView.highlightReferenceLine(null);
    if (!result) return;

    this.project.renameReferenceLine(line.name, result.name);
    if (result.isChainageLine) this.project.setChainageLine(line.name);
    this.refreshViews();
  }

  // Opens the layer editor for a soil profile and stores the result on Save.
  private async editSoilProfile(profile: SoilProfile): Promise<void> {
    const layers = await showSoilProfileDialog({
      profile,
      soils: this.project.soils,
      lineName: this.project.getSoilProfileLine(profile)?.name,
    });
    if (!layers) return;
    this.project.updateSoilProfileLayers(profile, layers);
    this.refreshViews();
  }

  // Adds the extent of each picked GeoTIFF to the project and zooms to the
  // last one read. The files are uploaded to the database on Save.
  private async uploadHeightData(files: File[]): Promise<void> {
    const failures: string[] = [];
    let last: string | undefined;
    for (const file of files) {
      try {
        const raster = this.project.addHeightRaster(await readHeightRaster(file));
        this.sync.addRasterFile(raster, file);
        last = raster.fileName;
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : t("heightData.unreadable")}`);
      }
    }
    this.refreshViews();
    if (last) this.mapView.zoomToHeightRaster(last);
    if (failures.length > 0) window.alert(failures.join("\n"));
  }

  // The heights of an area for the 3D view: from the stored rasters through
  // the API (which resamples them), then gaps filled from rasters that are
  // only in the browser until the next save. Null when there are none there.
  private async loadHeights(area: HeightGridArea): Promise<HeightGrid | null> {
    const grid = new HeightGrid(area);
    const rasters = this.project.heightRasters;
    const local = rasters.filter((raster) => this.sync.pendingRasterFile(raster));
    const storedIds = rasters
      .filter((raster) => !local.includes(raster) && raster.id !== null)
      .map((raster) => raster.id!);
    const projectId = this.sync.current?.id;
    if (projectId && storedIds.length > 0) grid.fillGapsFrom(await fetchHeights(projectId, area, storedIds));
    for (const raster of local) {
      if (!grid.hasGaps) break;
      grid.fillGapsFrom(await readHeightGrid(this.sync.pendingRasterFile(raster)!, area));
    }
    return grid.hasData ? grid : null;
  }

  // Removes the item shown in row `index` of a table (rows follow the
  // project's order), after confirmation.
  private removeItem(section: TableSection, index: number): void {
    const p = this.project;
    if (section === "referenceLines") {
      const line = p.referenceLines[index];
      if (!line || !window.confirm(t("tables.confirmRemoveReferenceLine", { name: line.name }))) return;
      p.removeReferenceLine(line.name);
    } else if (section === "cpts") {
      const cpt = p.cpts[index];
      if (!cpt || !window.confirm(t("tables.confirmRemoveCpt", { id: cpt.id }))) return;
      p.removeCpt(cpt.id);
    } else if (section === "heightRasters") {
      const raster = p.heightRasters[index];
      if (!raster || !window.confirm(t("tables.confirmRemoveHeightRaster", { name: raster.fileName }))) return;
      p.removeHeightRaster(raster);
    } else {
      const profile = p.soilProfiles[index];
      if (!profile || !window.confirm(t("tables.confirmRemoveSoilProfile"))) return;
      p.removeSoilProfile(profile);
    }
    this.refreshViews();
  }

  // Removes all items of one table, after confirmation.
  private removeAll(section: TableSection): void {
    const p = this.project;
    const actions: Record<TableSection, { count: number; confirm: MessageKey; remove: () => void }> = {
      referenceLines: {
        count: p.referenceLines.length,
        confirm: "tables.confirmRemoveReferenceLines",
        remove: () => p.removeAllReferenceLines(),
      },
      cpts: { count: p.cpts.length, confirm: "tables.confirmRemoveCpts", remove: () => p.removeAllCpts() },
      soilProfiles: {
        count: p.soilProfiles.length,
        confirm: "tables.confirmRemoveSoilProfiles",
        remove: () => p.removeAllSoilProfiles(),
      },
      heightRasters: {
        count: p.heightRasters.length,
        confirm: "tables.confirmRemoveHeightRasters",
        remove: () => p.removeAllHeightRasters(),
      },
    };
    const action = actions[section];
    if (!window.confirm(t(action.confirm, { count: action.count }))) return;
    action.remove();
    this.refreshViews();
  }

  // Redraws the map, the tables and the 3D scene from the project.
  private refreshViews(): void {
    const lineOf = (profile: SoilProfile) => this.project.getSoilProfileLine(profile);
    this.mapView.setHeightRasters(this.project.heightRasters);
    this.mapView.setReferenceLines(this.project.referenceLines);
    this.mapView.setCpts(this.project.cpts);
    this.mapView.setSoilProfiles(this.project.soilProfiles, this.project.soils, lineOf);
    this.tablesView.render({
      referenceLines: this.project.referenceLines,
      cpts: this.project.cpts,
      soilProfiles: this.project.soilProfiles,
      lineOf,
      soils: this.project.usedSoils,
      heightRasters: this.project.heightRasters,
    });
    this.scene3dView.render({
      referenceLines: this.project.referenceLines,
      soilProfiles: this.project.soilProfiles,
      soils: this.project.usedSoils,
      heightRasters: this.project.heightRasters,
    });
    this.updateButtons();
  }

  // Shows the open project's name, highlights Save while there are unsaved
  // changes and marks a project that isn't valid yet.
  private updateSaveState(): void {
    const dirty = this.sync.isDirty;
    this.saveButton.disabled = this.saving || !this.sync.current;
    this.saveButton.classList.toggle("unsaved", dirty && !this.saving);
    this.saveButton.classList.toggle("saving", this.saving);
    this.saveButton.title = t(this.saving ? "project.saving" : dirty ? "project.saveUnsaved" : "project.save");
    this.projectName.textContent = this.sync.current?.name ?? "";
    this.projectName.classList.toggle("unsaved", dirty);
    // Follows the project as it is now, saved or not.
    this.projectInvalid.hidden = !this.sync.current || this.project.isValid;
  }

  private updateButtons(): void {
    this.updateSaveState();
    this.resetAssignmentsButton.disabled = !this.project.hasSoilProfileAssignments;
    this.assignSoilProfilesButton.disabled =
      this.project.referenceLines.length === 0 || this.project.soilProfiles.length === 0;
    this.downloadCptsButton.disabled = this.downloadingCpts || this.project.referenceLines.length === 0;
    this.exportButton.disabled = this.exchanging || !this.sync.current;
  }
}
