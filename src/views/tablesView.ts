import type { Cpt } from "../cpt";
import type { HeightRaster } from "../heightRaster";
import { formatMetres, formatNumber, t } from "../i18n";
import type { MessageKey } from "../i18n/en";
import type { ReferenceLine } from "../referenceLine";
import type { Soil } from "../soil";
import type { SoilProfile } from "../soilProfile";

export type TableSection = "referenceLines" | "cpts" | "soilProfiles" | "heightRasters";

/** What the tables show; the soil profile's line comes from `lineOf`. */
export interface TablesData {
  referenceLines: readonly ReferenceLine[];
  cpts: readonly Cpt[];
  soilProfiles: readonly SoilProfile[];
  lineOf: (profile: SoilProfile) => ReferenceLine | undefined;
  /** The soils used by the soil profiles. */
  soils: readonly Soil[];
  heightRasters: readonly HeightRaster[];
}

/** Row actions report the section and the row's index in that section's list. */
export interface TablesViewHandlers {
  onEdit: (section: TableSection, index: number) => void;
  onRemove: (section: TableSection, index: number) => void;
  onRemoveAll: (section: TableSection) => void;
  onSoilColorChange: (name: string, color: string) => void;
}

interface Column {
  label: MessageKey;
  /** Right-aligned (numbers). */
  numeric?: boolean;
}

const EDIT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>';

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const coordinate = (value: number) => formatNumber(value, 2);
const level = (value: number) => formatNumber(value, 2);

function swatch(color: string): string {
  return `<span class="line-swatch table-swatch" style="background:${escapeHtml(color)}"></span>`;
}

// The Tables page: one table per kind of project data (referencelines, CPTs,
// soil profiles), for checking and maintaining it. Reports the user's actions
// through the handlers; it doesn't change the project itself.
export class TablesView {
  private container: HTMLElement;
  private handlers: TablesViewHandlers | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("change", (e) => this.onChange(e));
  }

  /**
   * Called when the user clicks a row's edit / remove button or a section's
   * "Remove all", or picks a new soil colour.
   */
  setHandlers(handlers: TablesViewHandlers): void {
    this.handlers = handlers;
  }

  render(data: TablesData): void {
    const profileCounts = new Map<ReferenceLine, number>();
    const soilCounts = new Map<string, { profiles: number; layers: number }>();
    for (const profile of data.soilProfiles) {
      const line = data.lineOf(profile);
      if (line) profileCounts.set(line, (profileCounts.get(line) ?? 0) + 1);
      for (const soil of new Set(profile.layers.map((layer) => layer.soil))) {
        const counts = soilCounts.get(soil) ?? { profiles: 0, layers: 0 };
        counts.profiles++;
        counts.layers += profile.layers.filter((layer) => layer.soil === soil).length;
        soilCounts.set(soil, counts);
      }
    }

    this.container.innerHTML =
      this.section(
        "referenceLines",
        "tables.referenceLines",
        "tables.noReferenceLines",
        [
          { label: "tables.name" },
          { label: "referenceLine.isChainageLine" },
          { label: "tables.length", numeric: true },
          { label: "tables.points", numeric: true },
          { label: "tables.soilProfiles", numeric: true },
        ],
        data.referenceLines.map((line) => [
          `${swatch(line.color)}${escapeHtml(line.name)}`,
          line.isChainageLine ? escapeHtml(t("tables.yes")) : "",
          escapeHtml(formatMetres(line.length)),
          String(line.points.length),
          String(profileCounts.get(line) ?? 0),
        ]),
      ) +
      this.section(
        "cpts",
        "tables.cpts",
        "tables.noCpts",
        [{ label: "tables.broId" }, { label: "tables.x", numeric: true }, { label: "tables.y", numeric: true }],
        data.cpts.map((cpt) => [escapeHtml(cpt.id), coordinate(cpt.x), coordinate(cpt.y)]),
      ) +
      this.section(
        "soilProfiles",
        "tables.soilProfiles",
        "tables.noSoilProfiles",
        [
          { label: "tables.x", numeric: true },
          { label: "tables.y", numeric: true },
          { label: "tables.top", numeric: true },
          { label: "tables.bottom", numeric: true },
          { label: "tables.layers", numeric: true },
          { label: "tables.weight", numeric: true },
          { label: "tables.source" },
          { label: "tables.referenceLine" },
          { label: "tables.chainage", numeric: true },
        ],
        data.soilProfiles.map((profile) => {
          const line = data.lineOf(profile);
          return [
            coordinate(profile.x),
            coordinate(profile.y),
            level(profile.top),
            level(profile.bottom),
            String(profile.layers.length),
            formatNumber(profile.weight, 2),
            profile.source === "geoscanner" ? escapeHtml(t("soilProfile.sourceGeoscanner")) : "",
            line ? `${swatch(line.color)}${escapeHtml(line.name)}` : "",
            profile.chainage !== null ? escapeHtml(formatMetres(profile.chainage)) : "",
          ];
        }),
      ) +
      this.section(
        "heightRasters",
        "tables.heightRasters",
        "tables.noHeightRasters",
        [
          { label: "tables.fileName" },
          { label: "tables.size", numeric: true },
          { label: "tables.resolution", numeric: true },
          { label: "tables.minX", numeric: true },
          { label: "tables.minY", numeric: true },
          { label: "tables.maxX", numeric: true },
          { label: "tables.maxY", numeric: true },
        ],
        data.heightRasters.map((raster) => [
          escapeHtml(raster.fileName),
          escapeHtml(t("tables.pixels", { width: raster.width, height: raster.height })),
          formatNumber(raster.resolution.x, 2),
          coordinate(raster.minX),
          coordinate(raster.minY),
          coordinate(raster.maxX),
          coordinate(raster.maxY),
        ]),
      ) +
      // Soils follow from the soil profiles: they can't be added or removed
      // here, only recoloured.
      this.section(
        "soils",
        "tables.soils",
        "tables.noSoils",
        [
          { label: "tables.color" },
          { label: "tables.name" },
          { label: "tables.soilProfiles", numeric: true },
          { label: "tables.layers", numeric: true },
        ],
        data.soils.map((soil) => [
          `<input type="color" class="soil-color-input" data-soil="${escapeHtml(soil.name)}" value="${escapeHtml(soil.color)}" title="${escapeHtml(t("tables.changeColor"))}" />`,
          escapeHtml(soil.name),
          String(soilCounts.get(soil.name)?.profiles ?? 0),
          String(soilCounts.get(soil.name)?.layers ?? 0),
        ]),
        false,
      );
  }

  // A titled card with a table. Cells are HTML (already escaped). Unless
  // `maintainable` is false, the card has a "Remove all" button and every row
  // ends in edit / remove buttons.
  private section(
    section: TableSection | "soils",
    title: MessageKey,
    empty: MessageKey,
    columns: Column[],
    rows: string[][],
    maintainable = true,
  ): string {
    const head = columns
      .map((c) => `<th${c.numeric ? ' class="numeric"' : ""}>${escapeHtml(t(c.label))}</th>`)
      .join("");
    const body =
      rows.length === 0
        ? `<tr><td class="table-empty" colspan="${columns.length + (maintainable ? 1 : 0)}">${escapeHtml(t(empty))}</td></tr>`
        : rows
            .map(
              (cells, index) =>
                `<tr>${cells.map((cell, i) => `<td${columns[i].numeric ? ' class="numeric"' : ""}>${cell}</td>`).join("")}` +
                (maintainable
                  ? `<td class="row-actions">` +
                    `<button type="button" class="icon-btn" data-action="edit" data-section="${section}" data-index="${index}" title="${escapeHtml(t("tables.edit"))}">${EDIT_ICON}</button>` +
                    `<button type="button" class="icon-btn btn-danger" data-action="remove" data-section="${section}" data-index="${index}" title="${escapeHtml(t("tables.remove"))}">${REMOVE_ICON}</button>` +
                    `</td>`
                  : "") +
                `</tr>`,
            )
            .join("");

    return (
      `<section class="table-card">` +
      `<header class="table-card-header">` +
      `<h2>${escapeHtml(t(title))} <span class="table-count">${rows.length}</span></h2>` +
      (maintainable
        ? `<button type="button" class="toolbar-btn btn-danger" data-action="removeAll" data-section="${section}"${rows.length === 0 ? " disabled" : ""}>` +
          `${REMOVE_ICON}<span>${escapeHtml(t("tables.removeAll"))}</span></button>`
        : "") +
      `</header>` +
      `<div class="table-scroll"><table class="data-table"><thead><tr>${head}${maintainable ? "<th></th>" : ""}</tr></thead><tbody>${body}</tbody></table></div>` +
      `</section>`
    );
  }

  // Fires once the colour picker is closed, so the table isn't re-rendered
  // (which would close the picker) while the user is still picking.
  private onChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("soil-color-input") || !this.handlers) return;
    this.handlers.onSoilColorChange(input.dataset.soil!, input.value);
  }

  private onClick(e: MouseEvent): void {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled || !this.handlers) return;
    const section = button.dataset.section as TableSection;
    const index = Number(button.dataset.index);
    switch (button.dataset.action) {
      case "edit":
        this.handlers.onEdit(section, index);
        break;
      case "remove":
        this.handlers.onRemove(section, index);
        break;
      case "removeAll":
        this.handlers.onRemoveAll(section);
        break;
    }
  }
}
