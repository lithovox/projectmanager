import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import { BASEMAPS } from "../basemaps";
import type { Cpt } from "../cpt";
import type { HeightRaster } from "../heightRaster";
import { formatMetres, t } from "../i18n";
import type { MessageKey } from "../i18n/en";
import type { ReferenceLine } from "../referenceLine";
import { rdToLatLng } from "../rd";
import type { Soil } from "../soil";
import type { SoilProfile } from "../soilProfile";
import { getTheme, onThemeChange, type Theme } from "../theme";
import { soilProfileChart } from "./soilProfileChart";

// Stroke widths (px) of reference lines; the chainage line is drawn heavier.
const LINE_WEIGHT = 3;
const CHAINAGE_LINE_WEIGHT = 5;
const HIGHLIGHT_WEIGHT = 7;
const HIT_WEIGHT = 16;
// Radius (px) of a CPT dot.
const CPT_RADIUS = 5;
// Radius (px) of a soil profile dot.
const SOIL_PROFILE_RADIUS = 5;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Centre of the Netherlands, zoomed so the whole country is in view.
const NL_CENTER: L.LatLngExpression = [52.2, 5.3];
const NL_ZOOM = 8;
const MAX_ZOOM = 19;

export interface MapViewState {
  center: [number, number];
  zoom: number;
}

export class MapView {
  private map: L.Map;
  private basemap: L.LayerGroup;
  private heightRasterLayer = L.featureGroup();
  private heightRasterPolygons = new Map<string, L.Polygon>();
  private referenceLineLayer = L.layerGroup();
  private cptLayer = L.layerGroup();
  private soilProfileLayer = L.featureGroup();
  private referenceLinePolylines = new Map<string, L.Polyline>();
  private chainageLineName: string | null = null;
  private referenceLineClickHandler: ((name: string) => void) | null = null;
  private soilProfileEditHandler: ((profile: SoilProfile) => void) | null = null;

  constructor(container: HTMLElement) {
    this.map = L.map(container, {
      center: NL_CENTER,
      zoom: NL_ZOOM,
      minZoom: 3,
      maxZoom: MAX_ZOOM,
      // Left-button dragging is off: panning is done with the right mouse
      // button (see enableRightButtonPan) so the left button stays free for
      // future tools such as selecting or drawing.
      dragging: false,
      scrollWheelZoom: true,
      wheelPxPerZoomLevel: 120,
      zoomControl: false,
    });
    L.control.zoom({ position: "topright" }).addTo(this.map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(this.map);

    this.basemap = this.createBasemap(getTheme()).addTo(this.map);
    onThemeChange((theme) => {
      this.basemap.remove();
      this.basemap = this.createBasemap(theme).addTo(this.map);
    });
    // Raster extents go first, so lines and points are drawn on top of them.
    this.heightRasterLayer.addTo(this.map);
    this.referenceLineLayer.addTo(this.map);
    this.cptLayer.addTo(this.map);
    this.soilProfileLayer.addTo(this.map);
    this.addLayerToggles();

    this.enableRightButtonPan(container);
  }

  getView(): MapViewState {
    const center = this.map.getCenter();
    return { center: [center.lat, center.lng], zoom: this.map.getZoom() };
  }

  setView(view: MapViewState): void {
    this.map.setView(view.center, view.zoom, { animate: false });
  }

  resetView(): void {
    this.map.setView(NL_CENTER, NL_ZOOM, { animate: false });
  }

  /** Called with the line's name when the user clicks a reference line. */
  onReferenceLineClick(handler: (name: string) => void): void {
    this.referenceLineClickHandler = handler;
  }

  /** Called when the user clicks "Edit" in a soil profile's popup. */
  onSoilProfileEdit(handler: (profile: SoilProfile) => void): void {
    this.soilProfileEditHandler = handler;
  }

  /** Replaces all reference lines drawn on the map. */
  setReferenceLines(lines: readonly ReferenceLine[]): void {
    this.referenceLineLayer.clearLayers();
    this.referenceLinePolylines.clear();
    this.chainageLineName = lines.find((line) => line.isChainageLine)?.name ?? null;
    for (const line of lines) {
      const latLngs = line.points.map(rdToLatLng);
      const polyline = L.polyline(latLngs, {
        color: line.color,
        weight: line.isChainageLine ? CHAINAGE_LINE_WEIGHT : LINE_WEIGHT,
        interactive: false,
      }).addTo(this.referenceLineLayer);
      this.referenceLinePolylines.set(line.name, polyline);

      // An invisible, wider copy on top catches hover and clicks, so a 3px
      // line doesn't need pixel-perfect aiming.
      L.polyline(latLngs, { opacity: 0, weight: HIT_WEIGHT })
        .bindTooltip(`${escapeHtml(line.name)} (${formatMetres(line.length)})`, {
          sticky: true,
        })
        .on("click", () => this.referenceLineClickHandler?.(line.name))
        .addTo(this.referenceLineLayer);

      if (line.isChainageLine) {
        this.addChainageMarker(latLngs[0], line.color, formatMetres(line.start.chainage));
        this.addChainageMarker(latLngs[latLngs.length - 1], line.color, formatMetres(line.end.chainage));
      }
    }
  }

  /** Replaces all CPT locations drawn on the map. */
  setCpts(cpts: readonly Cpt[]): void {
    this.cptLayer.clearLayers();
    for (const cpt of cpts) {
      // Colours come from the .cpt-marker CSS rule, so they follow the theme.
      L.circleMarker([cpt.lat, cpt.lon], { radius: CPT_RADIUS, weight: 2, fillOpacity: 1, className: "cpt-marker" })
        .bindTooltip(escapeHtml(cpt.id), { direction: "top", offset: [0, -CPT_RADIUS] })
        .addTo(this.cptLayer);
    }
  }

  /**
   * Replaces all soil profile locations drawn on the map; `soils` gives the
   * layer colours of the chart in the popup a click on a profile opens. A
   * profile assigned to a reference line (`lineOf`) is drawn in that line's
   * colour.
   */
  setSoilProfiles(
    profiles: readonly SoilProfile[],
    soils: readonly Soil[],
    lineOf: (profile: SoilProfile) => ReferenceLine | undefined,
  ): void {
    this.soilProfileLayer.clearLayers();
    const colors = new Map(soils.map((soil) => [soil.name, soil.color]));
    for (const profile of profiles) {
      const line = lineOf(profile);
      // Unassigned profiles get their (grey) fill from the .soil-profile-marker
      // CSS rule, so it follows the theme; assigned ones use their line's colour.
      L.circleMarker(rdToLatLng(profile.rd), {
        radius: SOIL_PROFILE_RADIUS,
        weight: 2,
        fillOpacity: 1,
        fillColor: line?.color,
        className: line ? "soil-profile-marker assigned" : "soil-profile-marker",
      })
        .bindPopup(() => this.soilProfilePopup(profile, colors, line?.name), {
          offset: [0, -SOIL_PROFILE_RADIUS],
          className: "soil-profile-popup",
          maxWidth: 400,
        })
        .addTo(this.soilProfileLayer);
    }
  }

  // The profile's chart with an "Edit" button.
  private soilProfilePopup(profile: SoilProfile, colors: ReadonlyMap<string, string>, lineName?: string): HTMLElement {
    const content = document.createElement("div");
    content.innerHTML = soilProfileChart(profile, colors, lineName);
    const actions = L.DomUtil.create("div", "soil-popup-actions", content);
    const button = L.DomUtil.create("button", "toolbar-btn primary-btn", actions);
    button.type = "button";
    button.textContent = t("soilProfileEditor.edit");
    button.addEventListener("click", () => {
      this.map.closePopup();
      this.soilProfileEditHandler?.(profile);
    });
    return content;
  }

  /** Replaces all height raster extents drawn on the map. */
  setHeightRasters(rasters: readonly HeightRaster[]): void {
    this.heightRasterLayer.clearLayers();
    this.heightRasterPolygons.clear();
    for (const raster of rasters) {
      // Colours come from the .height-raster-extent CSS rule, so they follow the theme.
      const polygon = L.polygon(raster.corners.map(rdToLatLng), { className: "height-raster-extent", weight: 2 })
        .bindTooltip(escapeHtml(raster.fileName), { sticky: true })
        .addTo(this.heightRasterLayer);
      this.heightRasterPolygons.set(raster.fileName, polygon);
    }
  }

  /** Zooms to the extent of the raster with this file name. */
  zoomToHeightRaster(fileName: string): void {
    const polygon = this.heightRasterPolygons.get(fileName);
    if (polygon) this.map.fitBounds(polygon.getBounds(), { padding: [40, 40] });
  }

  zoomToSoilProfiles(): void {
    const bounds = this.soilProfileLayer.getBounds();
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }

  /** Draws the named line thicker (e.g. while it is being edited); null clears it. */
  highlightReferenceLine(name: string | null): void {
    for (const [lineName, polyline] of this.referenceLinePolylines) {
      polyline.setStyle({ weight: lineName === name ? HIGHLIGHT_WEIGHT : this.baseWeight(lineName) });
    }
  }

  zoomToReferenceLine(name: string): void {
    const polyline = this.referenceLinePolylines.get(name);
    if (polyline) this.map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
  }

  private baseWeight(lineName: string): number {
    return lineName === this.chainageLineName ? CHAINAGE_LINE_WEIGHT : LINE_WEIGHT;
  }

  // A dot on a line end with a permanently visible chainage label.
  private addChainageMarker(latLng: L.LatLngExpression, color: string, label: string): void {
    L.circleMarker(latLng, {
      radius: 5,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
      interactive: false,
    })
      .bindTooltip(escapeHtml(label), {
        permanent: true,
        direction: "top",
        offset: [0, -6],
        className: "chainage-label",
      })
      .addTo(this.referenceLineLayer);
  }

  // Must be called after the container becomes visible again, since Leaflet
  // cannot measure a hidden (display: none) element.
  invalidateSize(): void {
    this.map.invalidateSize();
  }

  // Bottom-right buttons that show or hide the CPT, soil profile and height
  // raster layers. Their icons use the same CSS as what they toggle.
  private addLayerToggles(): void {
    const dot = (markerClass: string) =>
      `<circle class="leaflet-interactive ${markerClass}" cx="7" cy="7" r="5" stroke-width="2" />`;
    const toggles: { layer: L.Layer; label: MessageKey; icon: string }[] = [
      { layer: this.cptLayer, label: "map.toggleCpts", icon: dot("cpt-marker") },
      { layer: this.soilProfileLayer, label: "map.toggleSoilProfiles", icon: dot("soil-profile-marker") },
      {
        layer: this.heightRasterLayer,
        label: "map.toggleHeightData",
        icon: `<rect class="leaflet-interactive height-raster-extent" x="2" y="2" width="10" height="10" stroke-width="1.5" />`,
      },
    ];
    const control = new L.Control({ position: "bottomright" });
    control.onAdd = () => {
      const panel = L.DomUtil.create("div", "leaflet-bar layer-toggles");
      L.DomEvent.disableClickPropagation(panel);
      for (const { layer, label, icon } of toggles) {
        const button = L.DomUtil.create("button", "layer-toggle", panel);
        button.type = "button";
        button.setAttribute("aria-pressed", "true");
        button.innerHTML =
          `<svg viewBox="0 0 14 14">${icon}</svg>` +
          `<span data-i18n="${label}">${escapeHtml(t(label))}</span>`;
        button.addEventListener("click", () => {
          const visible = this.map.hasLayer(layer);
          if (visible) this.map.removeLayer(layer);
          else this.map.addLayer(layer);
          button.setAttribute("aria-pressed", String(!visible));
        });
      }
      return panel;
    };
    control.addTo(this.map);
  }

  private createBasemap(theme: Theme): L.LayerGroup {
    return L.layerGroup(
      BASEMAPS[theme].map((layer) =>
        L.tileLayer(layer.url, {
          attribution: layer.attribution,
          maxNativeZoom: layer.maxNativeZoom,
          maxZoom: MAX_ZOOM,
        }),
      ),
    );
  }

  private enableRightButtonPan(container: HTMLElement): void {
    let last: L.Point | null = null;

    container.addEventListener("contextmenu", (e) => e.preventDefault());

    container.addEventListener("mousedown", (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      last = L.point(e.clientX, e.clientY);
      container.classList.add("panning");
    });

    window.addEventListener("mousemove", (e) => {
      if (!last) return;
      const current = L.point(e.clientX, e.clientY);
      this.map.panBy(last.subtract(current), { animate: false });
      last = current;
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button !== 2 || !last) return;
      last = null;
      container.classList.remove("panning");
    });
  }
}
