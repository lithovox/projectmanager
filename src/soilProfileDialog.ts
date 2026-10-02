import { formatNumber, t } from "./i18n";
import type { MessageKey } from "./i18n/en";
import type { Soil } from "./soil";
import { SoilProfile, type LayerError, type SoilLayer } from "./soilProfile";
import { soilProfileChart } from "./views/soilProfileChart";

export interface SoilProfileDialogOptions {
  profile: SoilProfile;
  /** The soils a layer can be set to. */
  soils: readonly Soil[];
  /** Name of the referenceline the profile is assigned to, if any. */
  lineName?: string;
}

const ERROR_MESSAGES: Record<LayerError["reason"], MessageKey> = {
  notANumber: "soilProfileEditor.notANumber",
  topNotAboveBottom: "soilProfileEditor.topNotAboveBottom",
  overlap: "soilProfileEditor.overlap",
};

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Shows the #soil-profile-modal editor for a profile's layers (top, bottom and
// soil per layer) with a live chart preview. Resolves with the edited layers
// (top to bottom) on Save, or null when the user cancels (Cancel or Escape).
// Reset puts back the profile's current layers.
export function showSoilProfileDialog(options: SoilProfileDialogOptions): Promise<SoilLayer[] | null> {
  const { profile, soils, lineName } = options;
  const modal = element<HTMLDivElement>("soil-profile-modal");
  const form = element<HTMLFormElement>("soil-profile-modal-form");
  const rows = element<HTMLTableSectionElement>("soil-profile-modal-rows");
  const error = element<HTMLParagraphElement>("soil-profile-modal-error");
  const preview = element<HTMLDivElement>("soil-profile-modal-preview");
  const saveBtn = element<HTMLButtonElement>("soil-profile-modal-save");
  const resetBtn = element<HTMLButtonElement>("soil-profile-modal-reset");
  const cancelBtn = element<HTMLButtonElement>("soil-profile-modal-cancel");
  const colors = new Map(soils.map((soil) => [soil.name, soil.color]));

  element<HTMLParagraphElement>("soil-profile-modal-subtitle").textContent = t("soilProfile.location", {
    x: formatNumber(profile.x, 2),
    y: formatNumber(profile.y, 2),
  });

  function fillRows(layers: readonly SoilLayer[]): void {
    rows.replaceChildren(
      ...layers.map((layer, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td class="numeric">${index + 1}</td>` +
          `<td><input type="number" step="0.01" data-field="top" /></td>` +
          `<td><input type="number" step="0.01" data-field="bottom" /></td>` +
          `<td><div class="soil-select"><span class="soil-swatch"></span><select data-field="soil"></select></div></td>`;
        tr.querySelector<HTMLInputElement>('[data-field="top"]')!.value = String(layer.top);
        tr.querySelector<HTMLInputElement>('[data-field="bottom"]')!.value = String(layer.bottom);
        const select = tr.querySelector<HTMLSelectElement>("select")!;
        for (const soil of soils) select.add(new Option(soil.name, soil.name));
        select.value = layer.soil;
        return tr;
      }),
    );
    update();
  }

  function readLayers(): SoilLayer[] {
    return [...rows.rows].map((tr) => ({
      top: tr.querySelector<HTMLInputElement>('[data-field="top"]')!.valueAsNumber,
      bottom: tr.querySelector<HTMLInputElement>('[data-field="bottom"]')!.valueAsNumber,
      soil: tr.querySelector<HTMLSelectElement>("select")!.value,
    }));
  }

  // Validates the form, marks the offending row and redraws the preview. An
  // invalid form keeps the last valid preview, dimmed.
  function update(): SoilLayer[] | null {
    const layers = readLayers();
    [...rows.rows].forEach((tr, i) => {
      tr.querySelector<HTMLElement>(".soil-swatch")!.style.background = colors.get(layers[i].soil) ?? "";
    });
    const layerError = SoilProfile.validateLayers(layers);
    [...rows.rows].forEach((tr, i) => tr.classList.toggle("invalid", layerError?.index === i));
    error.textContent = layerError ? t(ERROR_MESSAGES[layerError.reason], { layer: layerError.index + 1 }) : "";
    saveBtn.disabled = layerError !== null;
    preview.classList.toggle("stale", layerError !== null);
    if (layerError) return null;

    const edited = new SoilProfile(profile.rd, layers, profile.weight, profile.source);
    edited.chainage = profile.chainage;
    preview.innerHTML = soilProfileChart(edited, colors, lineName);
    return layers;
  }

  fillRows(profile.layers);
  modal.classList.add("visible");
  rows.querySelector<HTMLInputElement>("input")?.focus();

  return new Promise((resolve) => {
    function close(result: SoilLayer[] | null): void {
      modal.classList.remove("visible");
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("input", onInput);
      resetBtn.removeEventListener("click", onReset);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }

    function onSubmit(e: SubmitEvent): void {
      e.preventDefault();
      const layers = update();
      if (layers) close(layers);
    }

    function onInput(): void {
      update();
    }

    function onReset(): void {
      fillRows(profile.layers);
    }

    function onCancel(): void {
      close(null);
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") close(null);
    }

    // No closing on a click outside: that would too easily throw away edits.
    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", onInput);
    resetBtn.addEventListener("click", onReset);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKeyDown);
  });
}
