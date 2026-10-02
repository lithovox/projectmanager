import { en, type MessageKey, type Messages } from "./en";

export type Language = "en";

// Add a language by creating e.g. `nl.ts` exporting a `Messages` object and
// registering it here (and in the `Language` type).
const dictionaries: Record<Language, Messages> = { en };

const STORAGE_KEY = "projectmanager_language";

let current: Language = loadLanguage();

function loadLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && stored in dictionaries ? (stored as Language) : "en";
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
  localStorage.setItem(STORAGE_KEY, language);
  applyTranslations();
}

// Translates `key`, replacing `{name}` placeholders with values from `params`.
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const message = dictionaries[current][key] ?? en[key];
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Formats a distance rounded to whole metres, without thousands separators, e.g. "10000 m". */
export function formatMetres(value: number): string {
  const number = new Intl.NumberFormat(current, {
    maximumFractionDigits: 0,
    useGrouping: false,
  }).format(value);
  return t("units.metres", { value: number });
}

/** Formats a number with exactly `decimals` decimals, without thousands separators. */
export function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat(current, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(value);
}

/** Formats a byte count, e.g. "850 kB" or "12.3 MB". */
export function formatBytes(bytes: number): string {
  const [key, value]: [MessageKey, number] =
    bytes >= 1e9 ? ["units.gigabytes", bytes / 1e9] : bytes >= 1e6 ? ["units.megabytes", bytes / 1e6] : ["units.kilobytes", bytes / 1e3];
  const number = new Intl.NumberFormat(current, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  return t(key, { value: number });
}

/** Formats an ISO 8601 moment as a local date and time. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(current, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// Fills every element carrying a `data-i18n="key"` attribute with its
// translated text, sets the tooltip of every `data-i18n-title="key"` element,
// and sets <html lang>.
export function applyTranslations(root: ParentNode = document): void {
  document.documentElement.lang = current;
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as MessageKey);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  });
}
