import { fetchCptMetadataByPolyline, fetchCptXml, type CptMetadata } from "./broApi";
import { t } from "./i18n";
import { referenceLineNameError, showReferenceLineDialog } from "./referenceLineDialog";
import { isProjectFile, Project } from "./project";
import { readShapefileLine } from "./shapefile";
import type { MapView } from "./views/mapView";

function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

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

// Wires the project buttons (new / save / load / upload referenceline) and
// clicks on referencelines to the Project, and keeps the map in sync with it.
export class ProjectController {
  private project = new Project();
  private mapView: MapView;
  private downloadCptsButton: HTMLButtonElement;
  private downloadCptsLabel: HTMLElement;
  private downloadingCpts = false;

  constructor(mapView: MapView) {
    this.mapView = mapView;
    this.mapView.onReferenceLineClick((name) => this.editReferenceLine(name));

    const projectInput = document.getElementById("project-input") as HTMLInputElement;
    projectInput.addEventListener("change", () => {
      const file = projectInput.files?.[0];
      if (file) this.loadProjectFile(file);
      projectInput.value = "";
    });

    const referenceLineInput = document.getElementById("referenceline-input") as HTMLInputElement;
    referenceLineInput.addEventListener("change", () => {
      const files = Array.from(referenceLineInput.files ?? []);
      referenceLineInput.value = "";
      if (files.length > 0) this.uploadReferenceLine(files);
    });

    document.getElementById("new-project-btn")!.addEventListener("click", () => this.newProject());
    document.getElementById("save-project-btn")!.addEventListener("click", () => this.saveProject());
    document.getElementById("load-project-btn")!.addEventListener("click", () => projectInput.click());

    this.downloadCptsButton = document.getElementById("download-bro-cpts-btn") as HTMLButtonElement;
    this.downloadCptsLabel = this.downloadCptsButton.querySelector("span")!;
    this.downloadCptsButton.addEventListener("click", () => this.downloadBroCpts());
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

      this.refreshMap();
      if (failed > 0) window.alert(t("bro.cptsFailed", { failed, total: missing.length }));
    } finally {
      this.downloadingCpts = false;
      this.downloadCptsLabel.textContent = t("bro.downloadCpts");
      this.updateButtons();
    }
  }

  private newProject(): void {
    if (!window.confirm(t("project.confirmNew"))) return;
    this.project.clear();
    this.refreshMap();
    this.mapView.resetView();
  }

  private saveProject(): void {
    downloadJson(this.project.toFile(this.mapView.getView()), "project.json");
  }

  private async loadProjectFile(file: File): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      window.alert(t("project.invalidJson"));
      return;
    }
    if (!isProjectFile(data)) {
      window.alert(t("project.notAProject"));
      return;
    }

    this.project.loadFile(data);
    this.refreshMap();
    this.mapView.setView(data.map);
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
    this.refreshMap();
    this.mapView.zoomToReferenceLine(added.name);
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
    this.refreshMap();
  }

  private refreshMap(): void {
    this.mapView.setReferenceLines(this.project.referenceLines);
    this.mapView.setCpts(this.project.cpts);
    this.updateButtons();
  }

  private updateButtons(): void {
    this.downloadCptsButton.disabled = this.downloadingCpts || this.project.referenceLines.length === 0;
  }
}
