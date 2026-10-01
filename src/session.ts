/** How a session is kept in browser storage. */
export interface SessionData {
  email: string;
  role: string;
  /** Bearer token from the API's /auth/login. */
  token: string;
  /** ISO 8601 moment the token stops working. */
  expiresAt: string;
}

/** A logged-in user and the token that proves it to the API. */
export class Session {
  readonly email: string;
  readonly role: string;
  readonly token: string;
  readonly expiresAt: Date;

  constructor(data: SessionData) {
    this.email = data.email;
    this.role = data.role;
    this.token = data.token;
    this.expiresAt = new Date(data.expiresAt);
  }

  get isExpired(): boolean {
    return !(this.expiresAt.getTime() > Date.now());
  }

  toData(): SessionData {
    return { email: this.email, role: this.role, token: this.token, expiresAt: this.expiresAt.toISOString() };
  }

  static isData(value: unknown): value is SessionData {
    const s = value as SessionData | null;
    return (
      !!s &&
      typeof s === "object" &&
      typeof s.email === "string" &&
      typeof s.role === "string" &&
      typeof s.token === "string" &&
      typeof s.expiresAt === "string"
    );
  }
}
