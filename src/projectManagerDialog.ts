import { formatBytes, formatDateTime, t } from "./i18n";
import type { ProjectSummary } from "./projectApi";

export interface ProjectManagerOptions {
  email: string;
  /** Id of the open project, if any (it can change, e.g. after deleting it). */
  currentId: () => string | null;
  /** Put the focus on the "new project" name field. */
  focusNew?: boolean;
  list: () => Promise<ProjectSummary[]>;
  /**
   * Creates and opens a project. Resolves with an error message to show, or
   * null once it is open (which closes the dialog).
   */
  create: (name: string) => Promise<string | null>;
  /** Opens the project; resolves true once it is open (which closes the dialog). */
  open: (project: ProjectSummary) => Promise<boolean>;
  /** Deletes the project (after asking); resolves when done. */
  remove: (project: ProjectSummary) => Promise<void>;
}

const OPEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Shows the #project-manager-modal: the user's projects in the database, to
// open or delete, and a field to create a new one. It can only be closed
// (close button or Escape) while a project is open; resolves once it closes.
export function showProjectManager(options: ProjectManagerOptions): Promise<void> {
  const modal = element<HTMLDivElement>("project-manager-modal");
  const form = element<HTMLFormElement>("project-manager-new");
  const nameInput = element<HTMLInputElement>("project-manager-name");
  const error = element<HTMLParagraphElement>("project-manager-error");
  const rows = element<HTMLTableSectionElement>("project-manager-rows");
  const closeBtn = element<HTMLButtonElement>("project-manager-close");

  element<HTMLParagraphElement>("project-manager-user").textContent = t("projectManager.signedInAs", {
    email: options.email,
  });
  nameInput.placeholder = t("projectManager.newPlaceholder");
  nameInput.value = "";
  error.textContent = "";
  let projects: ProjectSummary[] = [];
  let busy = false;

  const canClose = () => options.currentId() !== null;

  function render(): void {
    closeBtn.hidden = !canClose();
    const currentId = options.currentId();
    if (projects.length === 0) {
      rows.innerHTML = `<tr><td class="table-empty" colspan="4">${escapeHtml(t("projectManager.empty"))}</td></tr>`;
      return;
    }
    rows.innerHTML = projects
      .map((p, index) => {
        const isOpen = p.id === currentId;
        return (
          `<tr data-index="${index}"${isOpen ? ' class="current"' : ""}>` +
          `<td><span class="project-manager-name">${escapeHtml(p.name)}</span>` +
          (isOpen ? ` <span class="table-count">${escapeHtml(t("projectManager.openBadge"))}</span>` : "") +
          (p.isValid
            ? ""
            : ` <span class="invalid-badge" title="${escapeHtml(t("project.notValidHint"))}">${escapeHtml(t("project.notValid"))}</span>`) +
          `</td>` +
          `<td>${escapeHtml(formatDateTime(p.updatedAt))}</td>` +
          `<td class="numeric" title="${escapeHtml(
            t("projectManager.sizeDetail", {
              project: formatBytes(p.compressedSize),
              rasters: formatBytes(p.rasterSize),
              count: p.rasterCount,
            }),
          )}">${escapeHtml(formatBytes(p.compressedSize + p.rasterSize))}</td>` +
          `<td class="row-actions">` +
          `<button type="button" class="icon-btn" data-action="open" title="${escapeHtml(t("projectManager.open"))}"${isOpen ? " disabled" : ""}>${OPEN_ICON}</button>` +
          `<button type="button" class="icon-btn btn-danger" data-action="delete" title="${escapeHtml(t("projectManager.delete"))}">${REMOVE_ICON}</button>` +
          `</td></tr>`
        );
      })
      .join("");
  }

  async function reload(): Promise<void> {
    rows.innerHTML = `<tr><td class="table-empty" colspan="4">${escapeHtml(t("projectManager.loading"))}</td></tr>`;
    try {
      projects = await options.list();
      render();
    } catch (err) {
      console.error(err);
      projects = [];
      render();
      error.textContent = t("projectManager.listFailed");
    }
  }

  // Runs one action at a time, with the dialog's controls disabled meanwhile.
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    modal.classList.add("busy");
    error.textContent = "";
    try {
      await action();
    } finally {
      busy = false;
      modal.classList.remove("busy");
    }
  }

  modal.classList.add("visible");
  if (options.focusNew) nameInput.focus();
  render();
  reload();

  return new Promise((resolve) => {
    function close(): void {
      modal.classList.remove("visible");
      form.removeEventListener("submit", onSubmit);
      rows.removeEventListener("click", onRowClick);
      rows.removeEventListener("dblclick", onRowDoubleClick);
      closeBtn.removeEventListener("click", onClose);
      document.removeEventListener("keydown", onKeyDown);
      resolve();
    }

    function onSubmit(e: SubmitEvent): void {
      e.preventDefault();
      run(async () => {
        const message = await options.create(nameInput.value);
        if (message === null) close();
        else {
          error.textContent = message;
          nameInput.focus();
        }
      });
    }

    function projectOf(target: EventTarget | null): ProjectSummary | undefined {
      const tr = (target as HTMLElement).closest<HTMLTableRowElement>("tr[data-index]");
      return tr ? projects[Number(tr.dataset.index)] : undefined;
    }

    function open(project: ProjectSummary): void {
      if (project.id === options.currentId()) return;
      run(async () => {
        if (await options.open(project)) close();
      });
    }

    function onRowClick(e: MouseEvent): void {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      const project = projectOf(e.target);
      if (!button || button.disabled || !project) return;
      if (button.dataset.action === "open") open(project);
      else
        run(async () => {
          await options.remove(project);
          await reload();
        });
    }

    function onRowDoubleClick(e: MouseEvent): void {
      const project = projectOf(e.target);
      if (project) open(project);
    }

    function onClose(): void {
      if (canClose() && !busy) close();
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }

    form.addEventListener("submit", onSubmit);
    rows.addEventListener("click", onRowClick);
    rows.addEventListener("dblclick", onRowDoubleClick);
    closeBtn.addEventListener("click", onClose);
    document.addEventListener("keydown", onKeyDown);
  });
}
