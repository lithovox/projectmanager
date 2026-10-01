import { endSession, getSession } from "./auth";
import { apiUrl } from "./config";
import type { RdPoint } from "./rd";

/** Location of a CPT as returned by the metadata search. */
export interface CptMetadata {
  id: string;
  x: number;
  y: number;
  lat: number;
  lon: number;
}

interface CptMetadataResponse {
  objects: { bro_id: string; x: number; y: number; lat: number; lon: number }[];
}

// POSTs as the logged-in user. If there is no valid session, or the API
// rejects the token, the session ends (which brings up the login screen).
async function post(path: string, body?: unknown): Promise<Response> {
  const session = getSession();
  if (!session) {
    endSession();
    throw new Error(`${path}: not logged in`);
  }
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) endSession();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

/** CPTs within `offset` metres of the polyline (RD coordinates). */
export async function fetchCptMetadataByPolyline(
  points: readonly RdPoint[],
  offset: number,
): Promise<CptMetadata[]> {
  const response = await post("/api/v1/bro/cpt_metadata/by_polyline", {
    points: points.map((p) => [p.x, p.y]),
    offset,
  });
  const data = (await response.json()) as CptMetadataResponse;
  return data.objects.map((o) => ({ id: o.bro_id, x: o.x, y: o.y, lat: o.lat, lon: o.lon }));
}

/** The CPT's BRO XML file. */
export async function fetchCptXml(id: string): Promise<string> {
  const response = await post(`/api/v1/bro/cpt/${encodeURIComponent(id)}`);
  return response.text();
}
