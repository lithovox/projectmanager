// The LithoVox API. Configured per environment in `.env.local` /
// `.env.production` (VITE_API_URL).
const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/** Full URL of an API path such as "/api/v1/auth/login". */
export function apiUrl(path: string): string {
  if (!API_URL) throw new Error("VITE_API_URL is not set");
  return `${API_URL}${path}`;
}
