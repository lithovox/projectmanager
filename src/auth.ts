import { apiUrl } from "./config";
import { Session } from "./session";

const STORAGE_KEY = "projectmanager_session";

/** Why logging in failed: wrong email/password, or the API couldn't be reached. */
export class LoginError extends Error {
  readonly reason: "invalid" | "unreachable";

  constructor(reason: "invalid" | "unreachable") {
    super(`Login failed: ${reason}`);
    this.reason = reason;
  }
}

interface LoginResponse {
  email: string;
  role: string;
  access_token: string;
  expires_at: string;
}

let current: Session | null = loadSession();
const listeners = new Set<(session: Session | null) => void>();

function loadSession(): Session | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const session = Session.isData(data) ? new Session(data) : null;
    return session && !session.isExpired ? session : null;
  } catch {
    return null;
  }
}

function setSession(session: Session | null): void {
  current = session;
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session.toData()));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (e.g. private mode): the session lasts until reload.
  }
  for (const listener of listeners) listener(session);
}

/** The logged-in user, or null when nobody is logged in or the token has expired. */
export function getSession(): Session | null {
  return current && !current.isExpired ? current : null;
}

/** Called with the new session after logging in, and with null when the session ends. */
export function onSessionChange(listener: (session: Session | null) => void): void {
  listeners.add(listener);
}

/** Logs in; throws a `LoginError` if that fails. */
export async function login(email: string, password: string): Promise<Session> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new LoginError("unreachable");
  }
  // 401: wrong password; 422: not a valid email address.
  if (response.status === 401 || response.status === 422) throw new LoginError("invalid");
  if (!response.ok) throw new LoginError("unreachable");

  const data = (await response.json()) as LoginResponse;
  const session = new Session({
    email: data.email,
    role: data.role,
    token: data.access_token,
    expiresAt: data.expires_at,
  });
  setSession(session);
  return session;
}

/** Forgets the session (logging out, or the API no longer accepting the token). */
export function endSession(): void {
  setSession(null);
}
