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
