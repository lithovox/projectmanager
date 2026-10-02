import { formatMetres, t } from "../i18n";
import type { MessageKey } from "../i18n/en";
import type { SoilProfile, SoilProfileSource } from "../soilProfile";

const SOURCE_LABELS: Record<NonNullable<SoilProfileSource> | "none", MessageKey> = {
  geoscanner: "soilProfile.sourceGeoscanner",
  none: "soilProfile.sourceNone",
};

// Chart layout (px). The soil column sits between the level axis on the left
// and the soil names on the right.
const WIDTH = 230;
const PLOT_TOP = 8;
const PLOT_HEIGHT = 170;
const COLUMN_X = 46;
const COLUMN_WIDTH = 26;
const LABEL_X = COLUMN_X + COLUMN_WIDTH + 14;
// Minimum vertical distance (px) between two labels on the same side.
const LABEL_SPACING = 11;

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Spreads label positions (sorted top to bottom) so they are at least
 * `spacing` apart, keeping them within [min, max] where possible.
 */
function spreadLabels(wanted: number[], spacing: number, min: number, max: number): number[] {
  const placed = [...wanted];
  for (let i = 0; i < placed.length; i++) {
    placed[i] = Math.max(placed[i], i === 0 ? min : placed[i - 1] + spacing);
  }
  // Pushed past the bottom: shift back up from the end.
  for (let i = placed.length - 1; i >= 0; i--) {
    placed[i] = Math.min(placed[i], i === placed.length - 1 ? max : placed[i + 1] - spacing);
  }
  return placed;
}

/** An SVG chart of the profile's layers (HTML string), coloured by soil. */
export function soilProfileChart(
  profile: SoilProfile,
  soilColors: ReadonlyMap<string, string>,
  lineName?: string,
): string {
  const range = profile.top - profile.bottom || 1;
  const yOf = (level: number) => PLOT_TOP + ((profile.top - level) / range) * PLOT_HEIGHT;
  const height = PLOT_TOP * 2 + PLOT_HEIGHT;

  const rects = profile.layers
    .map((layer) => {
      const y = yOf(layer.top);
      const h = Math.max(yOf(layer.bottom) - y, 0.5);
      const color = escapeXml(soilColors.get(layer.soil) ?? "transparent");
      return `<rect x="${COLUMN_X}" y="${y}" width="${COLUMN_WIDTH}" height="${h}" fill="${color}" />`;
    })
    .join("");

  // Level ticks on every layer boundary; labels that would overlap are skipped.
  const boundaries = [profile.top, ...profile.layers.map((layer) => layer.bottom)];
  let lastLabelY = -Infinity;
  const ticks = boundaries
    .map((level, i) => {
      const y = yOf(level);
      const isEnd = i === boundaries.length - 1;
      const fits = y - lastLabelY >= LABEL_SPACING && (isEnd || yOf(profile.bottom) - y >= LABEL_SPACING);
      const tick = `<line class="chart-tick" x1="${COLUMN_X - 4}" x2="${COLUMN_X}" y1="${y}" y2="${y}" />`;
      if (!fits) return tick;
      lastLabelY = y;
      return `${tick}<text class="chart-level" x="${COLUMN_X - 7}" y="${y}">${level.toFixed(2)}</text>`;
    })
    .join("");

  // Soil names next to each layer's middle, spread out where layers are thin,
  // with a leader line back to the layer.
  const middles = profile.layers.map((layer) => yOf((layer.top + layer.bottom) / 2));
  const labelYs = spreadLabels(middles, LABEL_SPACING, PLOT_TOP + 4, PLOT_TOP + PLOT_HEIGHT - 4);
  const names = profile.layers
    .map((layer, i) => {
      const from = COLUMN_X + COLUMN_WIDTH;
      return (
        `<polyline class="chart-leader" points="${from},${middles[i]} ${from + 6},${middles[i]} ${LABEL_X - 3},${labelYs[i]}" />` +
        `<text class="chart-soil" x="${LABEL_X}" y="${labelYs[i]}">${escapeXml(layer.soil)}</text>`
      );
    })
    .join("");

  const outline = `<rect class="chart-outline" x="${COLUMN_X}" y="${PLOT_TOP}" width="${COLUMN_WIDTH}" height="${PLOT_HEIGHT}" />`;
  const header =
    `<div class="soil-chart-header"><strong>${escapeXml(t("soilProfile.title"))}</strong>` +
    `<span>${escapeXml(t("soilProfile.location", { x: profile.x.toFixed(0), y: profile.y.toFixed(0) }))}</span></div>` +
    `<div class="soil-chart-source">${escapeXml(t("soilProfile.source", { source: t(SOURCE_LABELS[profile.source ?? "none"]) }))}</div>` +
    `<div class="soil-chart-source">${escapeXml(
      lineName !== undefined && profile.chainage !== null
        ? t("soilProfile.chainage", { chainage: formatMetres(profile.chainage), line: lineName })
        : t("soilProfile.notAssigned"),
    )}</div>`;

  return (
    `<div class="soil-chart">${header}` +
    `<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">` +
    `${rects}${outline}${ticks}${names}</svg>` +
    `<div class="soil-chart-unit">${escapeXml(t("soilProfile.levelUnit"))}</div></div>`
  );
}
