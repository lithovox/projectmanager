import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import type { Cpt } from "../cpt";
import { formatMetres } from "../i18n";
import type { ReferenceLine } from "../referenceLine";
import { rdToLatLng } from "../rd";
import { getTheme, onThemeChange, type Theme } from "../theme";

// Stroke widths (px) of reference lines; the chainage line is drawn heavier.
const LINE_WEIGHT = 3;
const CHAINAGE_LINE_WEIGHT = 5;
const HIGHLIGHT_WEIGHT = 7;
const HIT_WEIGHT = 16;
// Radius (px) of a CPT dot.
const CPT_RADIUS = 5;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Centre of the Netherlands, zoomed so the whole country is in view.
const NL_CENTER: L.LatLngExpression = [52.2, 5.3];
const NL_ZOOM = 8;
const MAX_ZOOM = 19;

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

interface BasemapLayer {
  url: string;
  attribution: string;
  maxNativeZoom: number;
}

// Esri basemaps: worldwide coverage, no API key. The dark canvas has its
// labels in a separate transparent layer drawn on top of the base.
const BASEMAPS: Record<Theme, BasemapLayer[]> = {
  light: [
    {
      url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
      attribution:
        "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community",
      maxNativeZoom: 19,
    },
  ],
  dark: [
    {
      url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
      maxNativeZoom: 16,
    },
    {
      url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      attribution: "",
      maxNativeZoom: 16,
    },
  ],
};

export interface MapViewState {
  center: [number, number];
  zoom: number;
}

export class MapView {
  private map: L.Map;
  private basemap: L.LayerGroup;
  private referenceLineLayer = L.layerGroup();
  private cptLayer = L.layerGroup();
  private referenceLinePolylines = new Map<string, L.Polyline>();
  private chainageLineName: string | null = null;
  private referenceLineClickHandler: ((name: string) => void) | null = null;

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
    this.referenceLineLayer.addTo(this.map);
    this.cptLayer.addTo(this.map);

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
