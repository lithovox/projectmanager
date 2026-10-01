import type { RdPoint } from "./rd";
import { REFERENCE_LINE_COLORS, ReferenceLine, type ReferenceLineData } from "./referenceLine";
import type { MapViewState } from "./views/mapView";

// Saved project file. Bump `version` when the shape changes in a way older
// files cannot be read as-is.
export interface ProjectFile {
  version: 1;
  map: MapViewState;
  referenceLines: ReferenceLineData[];
}

function isMapViewState(value: unknown): value is MapViewState {
  const m = value as MapViewState | null;
  return (
    !!m &&
    typeof m === "object" &&
    Array.isArray(m.center) &&
    m.center.length === 2 &&
    m.center.every((n) => typeof n === "number") &&
    typeof m.zoom === "number"
  );
}

export function isProjectFile(value: unknown): value is ProjectFile {
  const p = value as ProjectFile | null;
  return (
    !!p &&
    typeof p === "object" &&
    p.version === 1 &&
    isMapViewState(p.map) &&
    // Files saved before reference lines existed have no `referenceLines`.
    (p.referenceLines === undefined ||
      (Array.isArray(p.referenceLines) && p.referenceLines.every(ReferenceLine.isData)))
  );
}

/** Names are compared trimmed and case-insensitively. */
function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export type NameError = "empty" | "taken";

// A project's contents, and the rules that span its reference lines: names
// are unique, and (once there are lines) exactly one is the chainage line.
export class Project {
  private lines: ReferenceLine[] = [];

  get referenceLines(): readonly ReferenceLine[] {
    return this.lines;
  }

  get chainageLine(): ReferenceLine | undefined {
    return this.lines.find((line) => line.isChainageLine);
  }

  getReferenceLine(name: string): ReferenceLine | undefined {
    const key = normalizeName(name);
    return this.lines.find((line) => normalizeName(line.name) === key);
  }

  hasReferenceLine(name: string): boolean {
    return this.getReferenceLine(name) !== undefined;
  }

  /**
   * Checks a (new) name. Pass `currentName` when renaming, so a line keeping
   * its own name (or only changing its capitalisation) is not "taken".
   */
  validateReferenceLineName(name: string, currentName?: string): NameError | null {
    if (name.trim() === "") return "empty";
    const existing = this.getReferenceLine(name);
    if (existing && (currentName === undefined || existing !== this.getReferenceLine(currentName))) {
      return "taken";
    }
    return null;
  }

  /**
   * Adds a line, by default with the next free colour. The first line always
   * becomes the chainage line; for later lines `isChainageLine` moves the
   * role to the new line. Throws if the name is invalid (see
   * `validateReferenceLineName`).
   */
  addReferenceLine(name: string, points: readonly RdPoint[], isChainageLine = false, color?: string): ReferenceLine {
    const error = this.validateReferenceLineName(name);
    if (error) throw new Error(`Invalid reference line name: ${error}`);
    const line = new ReferenceLine(name.trim(), points, color ?? this.nextColor());
    this.lines.push(line);
    if (isChainageLine || this.lines.length === 1) this.setChainageLine(line.name);
    return line;
  }

  /** Throws if the line doesn't exist or the new name is invalid. */
  renameReferenceLine(currentName: string, newName: string): void {
    const line = this.getReferenceLine(currentName);
    if (!line) throw new Error(`Unknown reference line: ${currentName}`);
    const error = this.validateReferenceLineName(newName, currentName);
    if (error) throw new Error(`Invalid reference line name: ${error}`);
    line.name = newName.trim();
  }

  /** Makes the named line the (only) chainage line. */
  setChainageLine(name: string): void {
    const target = this.getReferenceLine(name);
    if (!target) throw new Error(`Unknown reference line: ${name}`);
    for (const line of this.lines) line.isChainageLine = line === target;
  }

  /** The colour the next added line gets: the first unused palette colour, cycling once all are used. */
  nextColor(): string {
    const used = new Set(this.lines.map((line) => line.color));
    return (
      REFERENCE_LINE_COLORS.find((color) => !used.has(color)) ??
      REFERENCE_LINE_COLORS[this.lines.length % REFERENCE_LINE_COLORS.length]
    );
  }

  clear(): void {
    this.lines = [];
  }

  toFile(map: MapViewState): ProjectFile {
    return { version: 1, map, referenceLines: this.lines.map((line) => line.toData()) };
  }

  /** Replaces this project's contents with the (validated) file's. */
  loadFile(file: ProjectFile): void {
    this.clear();
    // Skip duplicate names so a hand-edited file can't break uniqueness.
    for (const line of file.referenceLines ?? []) {
      if (!this.validateReferenceLineName(line.name)) {
        this.addReferenceLine(line.name, line.points, false, line.color);
      }
    }
    // addReferenceLine made the first line the chainage line; honour the
    // file's choice instead if it has one (the first flagged line wins).
    const flagged = (file.referenceLines ?? []).find(
      (line) => line.isChainageLine && this.hasReferenceLine(line.name),
    );
    if (flagged) this.setChainageLine(flagged.name);
  }
}
