import { Cpt, type CptData } from "./cpt";
import { HeightRaster, type HeightRasterData } from "./heightRaster";
import type { RdPoint } from "./rd";
import { REFERENCE_LINE_COLORS, ReferenceLine, type ReferenceLineData } from "./referenceLine";
import { Soil, type SoilData } from "./soil";
import { SoilProfile, type SoilLayer, type SoilProfileData, type SoilProfileSource } from "./soilProfile";
import type { MapViewState } from "./views/mapView";

/**
 * Version of the project format: the project file and the exported project
 * archive (see projectArchive.ts). Raise it when their shape changes.
 */
export const PROJECT_VERSION = "0.1";

// Saved project file.
export interface ProjectFile {
  version: typeof PROJECT_VERSION;
  map: MapViewState;
  referenceLines: ReferenceLineData[];
  cpts: CptData[];
  soils: SoilData[];
  soilProfiles: SavedSoilProfile[];
  heightRasters: HeightRasterData[];
}

/** A soil profile in a project file, with the name of its assigned reference line. */
export interface SavedSoilProfile extends SoilProfileData {
  referenceLine?: string;
}

function isSavedSoilProfile(value: unknown): value is SavedSoilProfile {
  return (
    SoilProfile.isData(value) &&
    ((value as SavedSoilProfile).referenceLine === undefined ||
      typeof (value as SavedSoilProfile).referenceLine === "string")
  );
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
    // Projects saved before PROJECT_VERSION existed say 1; they have the same shape as 0.1.
    (p.version === PROJECT_VERSION || (p.version as unknown) === 1) &&
    isMapViewState(p.map) &&
    // Files saved before reference lines existed have no `referenceLines`.
    (p.referenceLines === undefined ||
      (Array.isArray(p.referenceLines) && p.referenceLines.every(ReferenceLine.isData))) &&
    // Files saved before CPTs existed have no `cpts`.
    (p.cpts === undefined || (Array.isArray(p.cpts) && p.cpts.every(Cpt.isData))) &&
    // Files saved before soils existed have no `soils` or `soilProfiles`.
    (p.soils === undefined || (Array.isArray(p.soils) && p.soils.every(Soil.isData))) &&
    (p.soilProfiles === undefined ||
      (Array.isArray(p.soilProfiles) && p.soilProfiles.every(isSavedSoilProfile))) &&
    // Files saved before height data existed have no `heightRasters`.
    (p.heightRasters === undefined ||
      (Array.isArray(p.heightRasters) && p.heightRasters.every(HeightRaster.isData)))
  );
}

/** Names are compared trimmed and case-insensitively. */
function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export type NameError = "empty" | "taken";

/** Outcome of Project.assignSoilProfilesToClosestLines. */
export interface SoilProfileAssignment {
  assigned: number;
  /** Profiles farther than the maximum distance from every line. */
  tooFar: number;
  /** Profiles that lost a line's start or end to a closer profile. */
  endTaken: number;
}

// A project's contents, and the rules that span its reference lines: names
// are unique, and (once there are lines) exactly one is the chainage line.
// CPTs are unique by BRO id, soils by name, and every soil profile layer
// refers to a soil in the project. A soil profile can be assigned to one
// reference line; it then has a chainage along that line. At most one
// profile sits on a line's start and one on its end. A project can be saved
// at any time, but is only valid once it has a reference line.
export class Project {
  private lines: ReferenceLine[] = [];
  private cptsById = new Map<string, Cpt>();
  private rasters: HeightRaster[] = [];
  private soilsByName = new Map<string, Soil>();
  private profiles: SoilProfile[] = [];
  private profileLines = new Map<SoilProfile, ReferenceLine>();

  get referenceLines(): readonly ReferenceLine[] {
    return this.lines;
  }

  /** True once the project has at least one reference line. */
  get isValid(): boolean {
    return this.lines.length > 0;
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

  /**
   * Removes the named line; soil profiles assigned to it become unassigned.
   * If it was the chainage line, the first remaining line takes over.
   */
  removeReferenceLine(name: string): void {
    const line = this.getReferenceLine(name);
    if (!line) throw new Error(`Unknown reference line: ${name}`);
    for (const profile of this.profiles) {
      if (this.profileLines.get(profile) === line) this.unassignSoilProfile(profile);
    }
    this.lines = this.lines.filter((l) => l !== line);
    if (line.isChainageLine && this.lines.length > 0) this.setChainageLine(this.lines[0].name);
  }

  /** Removes every reference line; soil profiles assigned to one become unassigned. */
  removeAllReferenceLines(): void {
    this.resetSoilProfileAssignments();
    this.lines = [];
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

  get cpts(): readonly Cpt[] {
    return [...this.cptsById.values()];
  }

  hasCpt(id: string): boolean {
    return this.cptsById.has(id);
  }

  /** Adds a CPT, replacing any CPT with the same id. */
  addCpt(data: CptData): Cpt {
    const cpt = new Cpt(data);
    this.cptsById.set(cpt.id, cpt);
    return cpt;
  }

  removeCpt(id: string): void {
    this.cptsById.delete(id);
  }

  get heightRasters(): readonly HeightRaster[] {
    return this.rasters;
  }

  /**
   * Adds a height raster. A raster with the same file name (ignoring case) is
   * replaced, so re-uploading a file updates it.
   */
  addHeightRaster(data: HeightRasterData): HeightRaster {
    const raster = new HeightRaster(data);
    const key = normalizeName(raster.fileName);
    const index = this.rasters.findIndex((r) => normalizeName(r.fileName) === key);
    if (index === -1) this.rasters.push(raster);
    else this.rasters[index] = raster;
    return raster;
  }

  removeHeightRaster(raster: HeightRaster): void {
    this.rasters = this.rasters.filter((r) => r !== raster);
  }

  removeAllHeightRasters(): void {
    this.rasters = [];
  }

  removeAllCpts(): void {
    this.cptsById.clear();
  }

  get soils(): readonly Soil[] {
    return [...this.soilsByName.values()];
  }

  /** The soils used by at least one soil profile layer, in project order. */
  get usedSoils(): readonly Soil[] {
    const used = new Set(this.profiles.flatMap((profile) => profile.layers.map((layer) => layer.soil)));
    return this.soils.filter((soil) => used.has(soil.name));
  }

  /** Throws if the soil doesn't exist. */
  setSoilColor(name: string, color: string): void {
    const soil = this.getSoil(name);
    if (!soil) throw new Error(`Unknown soil: ${name}`);
    soil.color = color;
  }

  getSoil(name: string): Soil | undefined {
    return this.soilsByName.get(normalizeName(name));
  }

  /**
   * Adds a soil. If a soil by that name already exists it is kept as it is
   * (including its colour) and returned instead.
   */
  addSoil(name: string, color: string): Soil {
    const existing = this.getSoil(name);
    if (existing) return existing;
    const soil = new Soil(name.trim(), color);
    this.soilsByName.set(normalizeName(soil.name), soil);
    return soil;
  }

  get soilProfiles(): readonly SoilProfile[] {
    return this.profiles;
  }

  /**
   * Adds a soil profile. Layer soils are matched by name to the project's
   * soils (and stored under that soil's exact name); throws if one is missing.
   */
  addSoilProfile(point: RdPoint, layers: readonly SoilLayer[], weight?: number, source?: SoilProfileSource): SoilProfile {
    const profile = new SoilProfile(point, this.resolveLayerSoils(layers), weight, source);
    this.profiles.push(profile);
    return profile;
  }

  /** The layers with each soil name spelled as the project's soil; throws for an unknown soil. */
  private resolveLayerSoils(layers: readonly SoilLayer[]): SoilLayer[] {
    return layers.map((layer) => {
      const soil = this.getSoil(layer.soil);
      if (!soil) throw new Error(`Unknown soil: ${layer.soil}`);
      return { ...layer, soil: soil.name };
    });
  }

  /**
   * Replaces a soil profile's layers (given top to bottom). Layer soils are
   * matched by name to the project's soils; throws if one is missing or the
   * layers are invalid (see SoilProfile.validateLayers).
   */
  updateSoilProfileLayers(profile: SoilProfile, layers: readonly SoilLayer[]): void {
    if (!this.profiles.includes(profile)) throw new Error("Unknown soil profile");
    profile.setLayers(this.resolveLayerSoils(layers));
  }

  /** Removes one soil profile (its soils are kept). */
  removeSoilProfile(profile: SoilProfile): void {
    this.profileLines.delete(profile);
    this.profiles = this.profiles.filter((p) => p !== profile);
  }

  /** Removes every soil profile (the soils themselves are kept). */
  removeAllSoilProfiles(): void {
    this.profileLines.clear();
    this.profiles = [];
  }

  /** The reference line the profile is assigned to, if any. */
  getSoilProfileLine(profile: SoilProfile): ReferenceLine | undefined {
    return this.profileLines.get(profile);
  }

  /** Assigns the profile to `line` at `chainage` (rounded to whole metres). */
  assignSoilProfile(profile: SoilProfile, line: ReferenceLine, chainage: number): void {
    if (!this.profiles.includes(profile)) throw new Error("Unknown soil profile");
    if (!this.lines.includes(line)) throw new Error(`Unknown reference line: ${line.name}`);
    this.profileLines.set(profile, line);
    profile.chainage = Math.round(chainage);
  }

  /** Removes the profile's assignment (and chainage). */
  unassignSoilProfile(profile: SoilProfile): void {
    this.profileLines.delete(profile);
    profile.chainage = null;
  }

  get hasSoilProfileAssignments(): boolean {
    return this.profileLines.size > 0;
  }

  /** Unassigns every soil profile (their chainages become null). */
  resetSoilProfileAssignments(): void {
    for (const profile of this.profiles) this.unassignSoilProfile(profile);
  }

  /**
   * Assigns every soil profile to its closest reference line, at the chainage
   * (whole metres) of its projection onto that line. Profiles farther than
   * `maxDistance` metres from every line end up unassigned. Profiles beyond
   * a line's start or end all project onto that end; only the one closest to
   * it is assigned there, the others end up unassigned.
   */
  assignSoilProfilesToClosestLines(maxDistance = Infinity): SoilProfileAssignment {
    const result: SoilProfileAssignment = { assigned: 0, tooFar: 0, endTaken: 0 };
    type Candidate = { profile: SoilProfile; line: ReferenceLine; distance: number; chainage: number };
    const candidates: Candidate[] = [];
    for (const profile of this.profiles) {
      this.unassignSoilProfile(profile);
      let best: Candidate | undefined;
      for (const line of this.lines) {
        const { distance, chainage } = line.project(profile.rd);
        if (!best || distance < best.distance) best = { profile, line, distance, chainage: Math.round(chainage) };
      }
      if (best && best.distance <= maxDistance) candidates.push(best);
      else result.tooFar++;
    }

    // Per line end, the candidate closest to it.
    const endKey = (c: Candidate) =>
      c.chainage === 0 ? `${c.line.name}:start` : c.chainage === Math.round(c.line.length) ? `${c.line.name}:end` : null;
    const closestAtEnd = new Map<string, Candidate>();
    for (const c of candidates) {
      const key = endKey(c);
      if (key && (!closestAtEnd.has(key) || c.distance < closestAtEnd.get(key)!.distance)) closestAtEnd.set(key, c);
    }

    for (const c of candidates) {
      const key = endKey(c);
      if (key && closestAtEnd.get(key) !== c) {
        result.endTaken++;
        continue;
      }
      this.assignSoilProfile(c.profile, c.line, c.chainage);
      result.assigned++;
    }
    return result;
  }

  clear(): void {
    this.rasters = [];
    this.profileLines.clear();
    this.lines = [];
    this.cptsById.clear();
    this.soilsByName.clear();
    this.profiles = [];
  }

  toFile(map: MapViewState): ProjectFile {
    return {
      version: PROJECT_VERSION,
      map,
      referenceLines: this.lines.map((line) => line.toData()),
      cpts: this.cpts.map((cpt) => cpt.toData()),
      soils: this.soils.map((soil) => soil.toData()),
      soilProfiles: this.profiles.map((profile) => ({
        ...profile.toData(),
        referenceLine: this.profileLines.get(profile)?.name,
      })),
      heightRasters: this.rasters.map((raster) => raster.toData()),
    };
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

    for (const cpt of file.cpts ?? []) this.addCpt(cpt);

    for (const soil of file.soils ?? []) this.addSoil(soil.name, soil.color);
    // Skip profiles referring to a missing soil so a hand-edited file still loads.
    for (const raster of file.heightRasters ?? []) this.addHeightRaster(raster);

    for (const data of file.soilProfiles ?? []) {
      const saved = SoilProfile.fromData(data);
      if (!saved.layers.every((layer) => this.getSoil(layer.soil))) continue;
      const profile = this.addSoilProfile(saved.rd, saved.layers, saved.weight, saved.source);
      // A chainage only means something together with its (existing) line.
      const line = data.referenceLine !== undefined ? this.getReferenceLine(data.referenceLine) : undefined;
      if (line && saved.chainage !== null) this.assignSoilProfile(profile, line, saved.chainage);
    }
  }
}
