import { t } from "../i18n";

const STORAGE_KEY = "projectmanager_sidebar_collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Storage unavailable (e.g. private mode): the choice lasts until reload.
  }
}

// The left menu (#sidebar): its button folds it to a narrow strip (hiding its
// contents, #sidebar-content) and unfolds it again. The choice is remembered
// in this browser. `onResize` is called once the width has changed (e.g. so
// the map can re-measure itself).
export class SidebarView {
  private root: HTMLElement;
  private toggle: HTMLButtonElement;
  private onResize: () => void;

  constructor(root: HTMLElement, onResize: () => void) {
    this.root = root;
    this.toggle = root.querySelector<HTMLButtonElement>("#sidebar-toggle")!;
    this.onResize = onResize;
    this.setCollapsed(loadCollapsed());
    this.toggle.addEventListener("click", () => {
      const collapsed = !root.classList.contains("collapsed");
      this.setCollapsed(collapsed);
      saveCollapsed(collapsed);
      // At once too, for when the width doesn't animate (reduced motion).
      requestAnimationFrame(() => this.onResize());
    });
    // The width animates: re-measure once it has settled.
    root.addEventListener("transitionend", (e) => {
      if (e.target === root && e.propertyName === "flex-basis") this.onResize();
    });
  }

  private setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("collapsed", collapsed);
    this.toggle.setAttribute("aria-expanded", String(!collapsed));
    this.toggle.title = t(collapsed ? "sidebar.expand" : "sidebar.collapse");
  }
}
