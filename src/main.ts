import "./style.css";
import { applyTranslations } from "./i18n";
import { initTheme, initThemeToggle } from "./theme";
import { AuthController } from "./authController";
import { ProjectController } from "./projectController";
import { LoginView } from "./views/loginView";
import { MapView } from "./views/mapView";

type ViewName = "map" | "tables";
const VIEWS: ViewName[] = ["map", "tables"];
const DEFAULT_VIEW: ViewName = "map";

initTheme();
applyTranslations();

new AuthController(new LoginView(document.getElementById("login-screen") as HTMLElement));

const mapView = new MapView(document.getElementById("map") as HTMLElement);
new ProjectController(mapView);

const themeSwitch = document.getElementById("theme-switch-btn") as HTMLButtonElement | null;
if (themeSwitch) initThemeToggle(themeSwitch);

function currentView(): ViewName {
  const name = location.hash.replace(/^#\//, "") as ViewName;
  return VIEWS.includes(name) ? name : DEFAULT_VIEW;
}

function showView(view: ViewName): void {
  VIEWS.forEach((name) => {
    document.getElementById(`view-${name}`)?.classList.toggle("active", name === view);
  });
  document.querySelectorAll<HTMLAnchorElement>(".view-tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  if (view === "map") mapView.invalidateSize();
}

window.addEventListener("hashchange", () => showView(currentView()));
showView(currentView());
