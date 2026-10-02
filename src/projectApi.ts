import { apiFetch, apiJson } from "./apiClient";
import { HeightGrid, type HeightGridArea } from "./heightGrid";
import type { HeightRaster } from "./heightRaster";

const BASE = "/api/v1/projects";

/** A project in the database, as listed by the API (without its contents). */
export interface ProjectSummary {
  id: string;
  name: string;
  /** ISO 8601 moments. */
  createdAt: string;
  updatedAt: string;
  /** Size of the project file as JSON, and as stored compressed (bytes). */
  dataSize: number;
  compressedSize: number;
  rasterCount: number;
  /** Total size of the project's height raster files (bytes). */
  rasterSize: number;
}

interface ProjectSummaryResponse {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  data_size: number;
  compressed_size: number;
  raster_count: number;
  raster_size: number;
}

/** A height raster file stored for a project. */
export interface StoredRaster {
  id: string;
  fileName: string;
}

function toSummary(p: ProjectSummaryResponse): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    dataSize: p.data_size,
    compressedSize: p.compressed_size,
    rasterCount: p.raster_count,
    rasterSize: p.raster_size,
  };
}

const projectPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/** The logged-in user's projects, most recently changed first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await apiFetch(BASE);
  return ((await response.json()) as ProjectSummaryResponse[]).map(toSummary);
}

/** Creates an empty project; throws ApiError 409 if the name is taken. */
export async function createProject(name: string): Promise<ProjectSummary> {
  const response = await apiJson(BASE, "POST", { name });
  return toSummary((await response.json()) as ProjectSummaryResponse);
}

/** The project file; `{}` for a project that was never saved. */
export async function fetchProjectData(id: string): Promise<unknown> {
  const response = await apiFetch(`${projectPath(id)}/data`, { cache: "no-store" });
  return response.json();
}

/** Replaces the stored project file. */
export async function saveProjectData(id: string, data: unknown): Promise<ProjectSummary> {
  const response = await apiJson(projectPath(id), "PUT", { data });
  return toSummary((await response.json()) as ProjectSummaryResponse);
}

/** Deletes the project and its height rasters. */
export async function deleteProject(id: string): Promise<void> {
  await apiFetch(projectPath(id), { method: "DELETE" });
}

export async function listRasters(projectId: string): Promise<StoredRaster[]> {
  const response = await apiFetch(`${projectPath(projectId)}/rasters`);
  const rasters = (await response.json()) as { id: string; file_name: string }[];
  return rasters.map((r) => ({ id: r.id, fileName: r.file_name }));
}

/** Uploads the GeoTIFF of `raster`, replacing a stored file with the same name; returns its id. */
export async function uploadRaster(projectId: string, raster: HeightRaster, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, raster.fileName);
  form.append("min_x", String(raster.minX));
  form.append("min_y", String(raster.minY));
  form.append("max_x", String(raster.maxX));
  form.append("max_y", String(raster.maxY));
  form.append("width", String(raster.width));
  form.append("height", String(raster.height));
  const response = await apiFetch(`${projectPath(projectId)}/rasters`, { method: "POST", body: form });
  return ((await response.json()) as { id: string }).id;
}

export async function deleteRaster(projectId: string, rasterId: string): Promise<void> {
  await apiFetch(`${projectPath(projectId)}/rasters/${encodeURIComponent(rasterId)}`, { method: "DELETE" });
}

/**
 * The heights of `area` from the stored rasters with these ids (where they
 * overlap, the first one with data wins), resampled by the API.
 */
export async function fetchHeights(projectId: string, area: HeightGridArea, rasterIds: readonly string[]): Promise<HeightGrid> {
  const params = new URLSearchParams({
    min_x: String(area.minX),
    min_y: String(area.minY),
    max_x: String(area.maxX),
    max_y: String(area.maxY),
    width: String(area.columns),
    height: String(area.rows),
    ids: rasterIds.join(","),
  });
  const response = await apiFetch(`${projectPath(projectId)}/heights?${params}`);
  // Little-endian float32s, as every browser platform is.
  return new HeightGrid(area, new Float32Array(await response.arrayBuffer()));
}
