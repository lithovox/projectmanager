import { t } from "./i18n";

export type Theme = "light" | "dark";

const STORAGE_KEY = "projectmanager_theme";
const listeners: Array<(theme: Theme) => void> = [];

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : systemTheme();
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  listeners.forEach((fn) => fn(theme));
}

export function onThemeChange(fn: (theme: Theme) => void): void {
  listeners.push(fn);
}

// Call once, as early as possible (before the app renders anything), so the
// stored/system theme is applied before first paint.
export function initTheme(): Theme {
  const theme = getTheme();
  applyTheme(theme);
  return theme;
}

export function initThemeToggle(button: HTMLButtonElement): void {
  let theme: Theme = getTheme();

  function render(): void {
    button.setAttribute("aria-checked", String(theme === "dark"));
    button.title = theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark");
  }
  render();

  button.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    setTheme(theme);
    render();
  });
}
