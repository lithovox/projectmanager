import { t } from "./i18n";
import type { NameError } from "./project";

export interface ReferenceLineDialogOptions {
  title: string;
  color: string;
  initialName: string;
  /** Initial state of the "Chainage line" checkbox. */
  isChainageLine: boolean;
  /** When true the checkbox can't be changed (e.g. the only/current chainage line). */
  chainageLocked: boolean;
  /** Explanation shown under the checkbox (empty for none). */
  chainageHint: string;
  /** Returns an error message for an unacceptable name, or null if it's fine. */
  validate: (name: string) => string | null;
}

export interface ReferenceLineDialogResult {
  name: string;
  isChainageLine: boolean;
}

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Shows the #referenceline-modal dialog and resolves with the trimmed,
// validated name and the chainage-line choice, or null if the user cancels
// (Cancel button, Escape or a click outside).
export function showReferenceLineDialog(options: ReferenceLineDialogOptions): Promise<ReferenceLineDialogResult | null> {
  const modal = element<HTMLDivElement>("referenceline-modal");
  const form = element<HTMLFormElement>("referenceline-modal-form");
  const input = element<HTMLInputElement>("referenceline-modal-name");
  const error = element<HTMLParagraphElement>("referenceline-modal-error");
  const chainage = element<HTMLInputElement>("referenceline-modal-chainage");
  const chainageHint = element<HTMLParagraphElement>("referenceline-modal-chainage-hint");
  const cancelBtn = element<HTMLButtonElement>("referenceline-modal-cancel");

  element<HTMLSpanElement>("referenceline-modal-title").textContent = options.title;
  element<HTMLSpanElement>("referenceline-modal-swatch").style.background = options.color;
  input.value = options.initialName;
  error.textContent = "";
  chainage.checked = options.isChainageLine;
  chainage.disabled = options.chainageLocked;
  chainageHint.textContent = options.chainageHint;
  modal.classList.add("visible");
  input.focus();
  input.select();

  return new Promise((resolve) => {
    function close(result: ReferenceLineDialogResult | null): void {
      modal.classList.remove("visible");
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("input", onInput);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("mousedown", onBackdrop);
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }

    function onSubmit(e: SubmitEvent): void {
      e.preventDefault();
      const message = options.validate(input.value);
      if (message) {
        error.textContent = message;
        input.focus();
        return;
      }
      close({ name: input.value.trim(), isChainageLine: chainage.checked });
    }

    function onInput(): void {
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
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("mousedown", onBackdrop);
    document.addEventListener("keydown", onKeyDown);
  });
}

export function referenceLineNameError(reason: NameError | null, name: string): string | null {
  if (reason === "empty") return t("referenceLine.nameRequired");
  if (reason === "taken") return t("referenceLine.nameTaken", { name: name.trim() });
  return null;
}
