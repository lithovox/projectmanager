import { endSession, getSession } from "./auth";
import { apiUrl } from "./config";

/** An API request that didn't succeed; `status` is the HTTP status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`${path}: HTTP ${status}`);
    this.status = status;
  }
}

// Sends a request as the logged-in user. If there is no valid session, or the
// API rejects the token, the session ends (which brings up the login screen).
// Throws an ApiError for any non-2xx response.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getSession();
  if (!session) {
    endSession();
    throw new ApiError(path, 401);
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(apiUrl(path), { ...init, headers });
  if (response.status === 401) endSession();
  if (!response.ok) throw new ApiError(path, response.status);
  return response;
}

/** Sends `body` as JSON. */
export function apiJson(path: string, method: string, body?: unknown): Promise<Response> {
  return apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
