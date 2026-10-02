import { t } from "./i18n";

export const DEFAULT_MAX_ASSIGN_DISTANCE = 50;

export interface AssignSoilProfilesDialogOptions {
  title: string;
  submitLabel: string;
  initialDistance: number;
  /**
   * Show the "Auto Assign" checkbox (when uploading soil profiles), with this
   * initial state; the distance only applies while it is ticked. Leave out
   * to always assign (the "Assign To Closest Line" button).
   */
  autoAssign?: boolean;
}

export interface AssignSoilProfilesDialogResult {
  /** Always true without the checkbox. */
  assign: boolean;
  /** Maximum distance (metres) between a soil profile and its referenceline. */
  maxDistance: number;
}

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Shows the #assign-soil-profiles-modal dialog and resolves with the choices,
// or null if the user cancels (Cancel button, Escape or a click outside).
export function showAssignSoilProfilesDialog(
  options: AssignSoilProfilesDialogOptions,
): Promise<AssignSoilProfilesDialogResult | null> {
  const modal = element<HTMLDivElement>("assign-soil-profiles-modal");
  const form = element<HTMLFormElement>("assign-soil-profiles-modal-form");
  const checkboxRow = element<HTMLLabelElement>("assign-soil-profiles-modal-auto-row");
  const checkbox = element<HTMLInputElement>("assign-soil-profiles-modal-auto");
  const input = element<HTMLInputElement>("assign-soil-profiles-modal-distance");
  const error = element<HTMLParagraphElement>("assign-soil-profiles-modal-error");
  const cancelBtn = element<HTMLButtonElement>("assign-soil-profiles-modal-cancel");

  const hasCheckbox = options.autoAssign !== undefined;
  element<HTMLHeadingElement>("assign-soil-profiles-modal-title").textContent = options.title;
  element<HTMLButtonElement>("assign-soil-profiles-modal-submit").textContent = options.submitLabel;
  checkboxRow.hidden = !hasCheckbox;
  checkbox.checked = options.autoAssign ?? true;
  input.value = String(options.initialDistance);
  input.disabled = !checkbox.checked;
  error.textContent = "";
  modal.classList.add("visible");
  if (hasCheckbox) {
    checkbox.focus();
  } else {
    input.focus();
    input.select();
  }

  return new Promise((resolve) => {
    function close(result: AssignSoilProfilesDialogResult | null): void {
      modal.classList.remove("visible");
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("input", onInput);
      checkbox.removeEventListener("change", onToggle);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("mousedown", onBackdrop);
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }

    function onSubmit(e: SubmitEvent): void {
      e.preventDefault();
      const distance = input.valueAsNumber;
      if (checkbox.checked && (!Number.isFinite(distance) || distance <= 0)) {
        error.textContent = t("soilProfile.maxDistanceInvalid");
        input.focus();
        return;
      }
      close({ assign: checkbox.checked, maxDistance: checkbox.checked ? distance : options.initialDistance });
    }

    function onInput(): void {
      error.textContent = "";
    }

    function onToggle(): void {
      input.disabled = !checkbox.checked;
      error.textContent = "";
    }

    function onCancel(): void {
      close(null);
    }

    function onBackdrop(e: MouseEvent): void {
      if (e.target === modal) close(null);
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") close(null);
    }

    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInput);
    checkbox.addEventListener("change", onToggle);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("mousedown", onBackdrop);
    document.addEventListener("keydown", onKeyDown);
  });
}
