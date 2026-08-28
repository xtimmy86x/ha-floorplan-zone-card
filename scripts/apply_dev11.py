from pathlib import Path
import json
import re

SOURCE = Path("src/ha-floorplan-zone-card.js")
source = SOURCE.read_text()


def replace_once(old: str, new: str, label: str):
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    source = source.replace(old, new, 1)


def replace_regex(pattern: str, replacement: str, label: str, flags=re.S):
    global source
    source, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")


replace_once(
    'const VERSION = "0.1.0-dev.10";',
    'const VERSION = "0.1.0-dev.11";',
    "version",
)

replace_once(
    'const LABEL_FONT_WEIGHTS = new Set([400, 500, 600, 700]);',
    '''const LABEL_FONT_WEIGHTS = new Set([400, 500, 600, 700]);
const SVG_SOURCE_SHAPE_TAGS = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline"]);
const SVG_SOURCE_CONTAINER_TAGS = new Set(["g", "a", "symbol"]);
const SVG_SOURCE_SELECTABLE_TAGS = new Set([...SVG_SOURCE_SHAPE_TAGS, "g", "use"]);
const SVG_SOURCE_BLOCKED_ANCESTORS = new Set(["defs", "clipPath", "mask", "pattern", "marker"]);
const SVG_SOURCE_ATTRIBUTES = Object.freeze({
  path: ["d", "pathLength", "transform", "fill-rule", "clip-rule"],
  rect: ["x", "y", "width", "height", "rx", "ry", "transform"],
  circle: ["cx", "cy", "r", "transform"],
  ellipse: ["cx", "cy", "rx", "ry", "transform"],
  polygon: ["points", "transform", "fill-rule", "clip-rule"],
  polyline: ["points", "transform", "fill-rule", "clip-rule"],
});''',
    "svg constants",
)

replace_once(
    '''function normalizePoint(point) {
  return { x: clamp01(point?.x), y: clamp01(point?.y) };
}
''',
    '''function normalizePoint(point) {
  return { x: clamp01(point?.x), y: clamp01(point?.y) };
}

function normalizeSvgBounds(bounds) {
  const x = clamp01(bounds?.x);
  const y = clamp01(bounds?.y);
  return {
    x,
    y,
    width: clamp(bounds?.width ?? 0, 0, 1 - x),
    height: clamp(bounds?.height ?? 0, 0, 1 - y),
  };
}

function svgBoundsValid(bounds) {
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return false;
  const normalized = normalizeSvgBounds(bounds);
  return normalized.width > 0 && normalized.height > 0;
}

function zoneUsesSvgObject(zone) {
  return Boolean(
    (zone?.geometry === "svg" || zone?.svg_element_id) &&
    typeof zone?.svg_element_id === "string" &&
    zone.svg_element_id,
  );
}
''',
    "svg bounds helpers",
)

replace_regex(
    r'''function zoneLabelPoint\(zone\) \{.*?\n\}\n\nfunction entityDisplayState''',
    '''function zoneLabelPoint(zone) {
  const label = normalizeLabel(zone?.label);
  if (label.position_mode === "custom" && label.position) {
    return normalizePoint(label.position);
  }
  if (zoneUsesSvgObject(zone) && svgBoundsValid(zone?.svg_bounds)) {
    const bounds = normalizeSvgBounds(zone.svg_bounds);
    return normalizePoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
  }
  return polygonCentroid(zone?.points);
}

function entityDisplayState''',
    "zone label point",
)

replace_regex(
    r'''function zoneFocusArea\(zone\) \{.*?\n\}\n\nfunction autoZoomTargetArea''',
    '''function zoneFocusArea(zone) {
  if (zoneUsesSvgObject(zone) && svgBoundsValid(zone?.svg_bounds)) {
    return normalizeSvgBounds(zone.svg_bounds);
  }
  if (!Array.isArray(zone?.points) || zone.points.length < 3) return null;
  const xs = zone.points.map((point) => clamp01(point.x));
  const ys = zone.points.map((point) => clamp01(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const area = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return focusAreaValid(area) ? area : null;
}

function autoZoomTargetArea''',
    "zone focus area",
)

replace_regex(
    r'''function normalizeZone\(zone\) \{.*?\n\}\n\nfunction normalizedConfig''',
    '''function normalizeZone(zone) {
  const svgElementId = typeof zone?.svg_element_id === "string" ? zone.svg_element_id : "";
  const geometry = zone?.geometry === "svg" || svgElementId ? "svg" : "polygon";
  const normalized = {
    ...zone,
    geometry,
    svg_element_id: geometry === "svg" ? svgElementId : undefined,
    svg_bounds: geometry === "svg" && svgBoundsValid(zone?.svg_bounds)
      ? normalizeSvgBounds(zone.svg_bounds)
      : undefined,
    points: Array.isArray(zone?.points) ? zone.points.map(normalizePoint) : [],
    states: Array.isArray(zone?.states)
      ? zone.states.map(normalizeStateRule)
      : legacyStateRules(zone),
    default: normalizeStyle(zone?.default, DEFAULT_FALLBACK_STYLE),
    unavailable: normalizeStyle(zone?.unavailable, DEFAULT_UNAVAILABLE_STYLE),
    stroke: {
      color: typeof zone?.stroke?.color === "string" ? zone.stroke.color : DEFAULT_STROKE.color,
      width: Number.isFinite(Number(zone?.stroke?.width))
        ? Number(zone.stroke.width)
        : DEFAULT_STROKE.width,
    },
    tap_action: normalizeAction(zone?.tap_action),
    hold_action: normalizeAction(zone?.hold_action),
    double_tap_action: normalizeAction(zone?.double_tap_action),
    label: normalizeLabel(zone?.label),
  };
  if (geometry !== "svg") {
    delete normalized.svg_element_id;
    delete normalized.svg_bounds;
  }
  delete normalized.on;
  delete normalized.off;
  return normalized;
}

function normalizedConfig''',
    "normalize zone",
)

replace_once(
    '''  return {
    id,
    name: `Zone ${number}`,
    entity: "",
    points: points.map(normalizePoint),''',
    '''  return {
    id,
    name: `Zone ${number}`,
    entity: "",
    geometry: "polygon",
    points: points.map(normalizePoint),''',
    "polygon geometry marker",
)

replace_once(
    '''function entityRawState(hass, entityId) {''',
    '''function createSvgZone(element, bounds, zones) {
  const id = nextZoneId(zones);
  const number = id.replace(/^zone_/, "");
  const elementId = typeof element?.id === "string" ? element.id : "";
  const title = typeof element?.title === "string" ? element.title.trim() : "";
  return {
    id,
    name: title || elementId || `SVG Zone ${number}`,
    entity: "",
    geometry: "svg",
    svg_element_id: elementId,
    svg_bounds: svgBoundsValid(bounds) ? normalizeSvgBounds(bounds) : undefined,
    points: [],
    states: [
      { value: "off", ...DEFAULT_OFF_STYLE, effect: "none", highlight_border: false },
      { value: "on", ...DEFAULT_ON_STYLE, effect: "none", highlight_border: false },
    ],
    default: { ...DEFAULT_FALLBACK_STYLE },
    unavailable: { ...DEFAULT_UNAVAILABLE_STYLE },
    stroke: { ...DEFAULT_STROKE },
    tap_action: { ...DEFAULT_TAP_ACTION },
    hold_action: { ...DEFAULT_NONE_ACTION },
    double_tap_action: { ...DEFAULT_NONE_ACTION },
    label: { ...DEFAULT_LABEL },
  };
}

function entityRawState(hass, entityId) {''',
    "create svg zone",
)

svg_helpers = r'''
function parseSvgNumericLength(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function svgSourceElementTitle(element) {
  for (const child of element?.children ?? []) {
    if (child.localName === "title") return child.textContent?.trim() ?? "";
  }
  return "";
}

function svgSourceElementBlocked(element, root) {
  let current = element?.parentElement;
  while (current && current !== root) {
    if (SVG_SOURCE_BLOCKED_ANCESTORS.has(current.localName)) return true;
    if (current.localName === "svg") return true;
    current = current.parentElement;
  }
  return false;
}

function svgSourceHasGeometry(element, elementsById, seen = new Set()) {
  if (!element || seen.has(element)) return false;
  seen.add(element);
  const tag = element.localName;
  if (SVG_SOURCE_SHAPE_TAGS.has(tag)) return true;
  if (tag === "use") {
    const href = element.getAttribute("href") || element.getAttribute("xlink:href") || "";
    if (!href.startsWith("#")) return false;
    return svgSourceHasGeometry(elementsById.get(href.slice(1)), elementsById, seen);
  }
  if (!SVG_SOURCE_CONTAINER_TAGS.has(tag)) return false;
  return [...(element.children ?? [])].some((child) =>
    svgSourceHasGeometry(child, elementsById, new Set(seen))
  );
}

function parseSvgSource(text) {
  if (typeof DOMParser === "undefined" || typeof text !== "string") return null;
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = parsed?.documentElement;
  if (!root || root.localName !== "svg" || parsed.querySelector("parsererror")) return null;

  const rawViewBox = root.getAttribute("viewBox")?.trim() ?? "";
  const viewBoxParts = rawViewBox
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const width = parseSvgNumericLength(root.getAttribute("width"));
  const height = parseSvgNumericLength(root.getAttribute("height"));
  let viewBox;
  let aspectRatio;
  if (viewBoxParts.length === 4 && viewBoxParts[2] > 0 && viewBoxParts[3] > 0) {
    viewBox = viewBoxParts.join(" ");
    aspectRatio = width && height ? width / height : viewBoxParts[2] / viewBoxParts[3];
  } else if (width && height) {
    viewBox = `0 0 ${width} ${height}`;
    aspectRatio = width / height;
  } else {
    viewBox = `0 0 ${SVG_SIZE} ${SVG_SIZE}`;
    aspectRatio = 1;
  }

  const elementsById = new Map();
  root.querySelectorAll("[id]").forEach((element) => {
    const id = element.getAttribute("id")?.trim();
    if (id && !elementsById.has(id)) elementsById.set(id, element);
  });

  const entries = [];
  elementsById.forEach((element, id) => {
    if (!SVG_SOURCE_SELECTABLE_TAGS.has(element.localName)) return;
    if (svgSourceElementBlocked(element, root)) return;
    if (!svgSourceHasGeometry(element, elementsById)) return;
    entries.push({
      id,
      tag: element.localName,
      title: svgSourceElementTitle(element),
    });
  });
  entries.sort((a, b) => a.id.localeCompare(b.id));

  return {
    document: parsed,
    root,
    elementsById,
    entries,
    viewBox,
    preserveAspectRatio: root.getAttribute("preserveAspectRatio") || "xMidYMid meet",
    aspectRatio,
  };
}

function copySvgGeometryAttributes(sourceElement, targetElement) {
  const attributes = SVG_SOURCE_ATTRIBUTES[sourceElement.localName] ?? [];
  attributes.forEach((name) => {
    const value = sourceElement.getAttribute(name);
    if (value !== null) targetElement.setAttribute(name, value);
  });
}

function cloneSvgGeometryNode(sourceElement, descriptor, seen = new Set()) {
  if (!sourceElement || seen.has(sourceElement)) return null;
  seen.add(sourceElement);
  const tag = sourceElement.localName;

  if (SVG_SOURCE_SHAPE_TAGS.has(tag)) {
    const clone = document.createElementNS(SVG_NS, tag);
    copySvgGeometryAttributes(sourceElement, clone);
    return clone;
  }

  if (tag === "use") {
    const href = sourceElement.getAttribute("href") || sourceElement.getAttribute("xlink:href") || "";
    if (!href.startsWith("#")) return null;
    const target = descriptor.elementsById.get(href.slice(1));
    const resolved = cloneSvgGeometryNode(target, descriptor, new Set(seen));
    if (!resolved) return null;
    const transformed = document.createElementNS(SVG_NS, "g");
    const transform = sourceElement.getAttribute("transform");
    if (transform) transformed.setAttribute("transform", transform);
    const x = sourceElement.getAttribute("x");
    const y = sourceElement.getAttribute("y");
    if (x || y) {
      const placement = document.createElementNS(SVG_NS, "g");
      placement.setAttribute("transform", `translate(${x || 0} ${y || 0})`);
      placement.append(resolved);
      transformed.append(placement);
    } else {
      transformed.append(resolved);
    }
    return transformed;
  }

  if (!SVG_SOURCE_CONTAINER_TAGS.has(tag)) return null;
  const group = document.createElementNS(SVG_NS, "g");
  const transform = sourceElement.getAttribute("transform");
  if (transform) group.setAttribute("transform", transform);
  for (const child of sourceElement.children ?? []) {
    const clone = cloneSvgGeometryNode(child, descriptor, new Set(seen));
    if (clone) group.append(clone);
  }
  return group.childElementCount ? group : null;
}

function cloneSvgSourceObject(sourceElement, descriptor) {
  const geometry = cloneSvgGeometryNode(sourceElement, descriptor);
  if (!geometry) return null;

  const ancestors = [];
  let current = sourceElement.parentElement;
  while (current && current !== descriptor.root) {
    if (current.localName === "svg") return null;
    if (SVG_SOURCE_CONTAINER_TAGS.has(current.localName)) ancestors.unshift(current);
    current = current.parentElement;
  }

  let wrapped = geometry;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const transform = ancestors[index].getAttribute("transform");
    if (!transform) continue;
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("transform", transform);
    group.append(wrapped);
    wrapped = group;
  }

  const rootTransform = descriptor.root.getAttribute("transform");
  if (rootTransform) {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("transform", rootTransform);
    group.append(wrapped);
    wrapped = group;
  }
  return wrapped;
}

function likelySvgSource(image, resolvedUrl, zones = []) {
  const configured = imageContentId(image);
  return (
    /\.svg(?:$|[?#])/i.test(configured) ||
    /\.svg(?:$|[?#])/i.test(resolvedUrl ?? "") ||
    isMediaSourceContentId(configured) ||
    zones.some(zoneUsesSvgObject)
  );
}
'''

replace_once(
    '''function effectiveAction(zone, actionName) {''',
    svg_helpers + '''\nfunction effectiveAction(zone, actionName) {''',
    "svg source helpers",
)

replace_once(
    '''    this._resolvedImage = "";
    this._imageAspectRatio = null;
    this._imageResolveToken = 0;''',
    '''    this._resolvedImage = "";
    this._imageAspectRatio = null;
    this._imageResolveToken = 0;
    this._svgSourceKey = "";
    this._svgSource = null;
    this._svgSourceStatus = "idle";
    this._svgSourceError = "";
    this._svgSourceToken = 0;''',
    "canvas svg source state",
)

canvas_svg_methods = r'''
  clearSvgSource() {
    this._svgSourceToken += 1;
    this._svgSourceKey = "";
    this._svgSource = null;
    this._svgSourceStatus = "idle";
    this._svgSourceError = "";
  }

  emitSvgSourceChanged() {
    const entries = (this._svgSource?.entries ?? []).map((entry) => ({
      ...entry,
      bounds: this.svgElementBounds(entry.id) ?? undefined,
    }));
    this.dispatchEvent(
      new CustomEvent("floorplan-svg-source-changed", {
        bubbles: true,
        composed: true,
        detail: {
          status: this._svgSourceStatus,
          error: this._svgSourceError,
          elements: entries,
        },
      }),
    );
  }

  async refreshSvgSource() {
    const url = this._resolvedImage;
    if (!url) {
      this.clearSvgSource();
      this.emitSvgSourceChanged();
      return;
    }
    if (this._svgSourceKey === url && ["loading", "ready", "none", "error"].includes(this._svgSourceStatus)) {
      return;
    }
    this._svgSourceKey = url;
    this._svgSourceStatus = "loading";
    this._svgSourceError = "";
    const token = ++this._svgSourceToken;

    if (!likelySvgSource(this._config?.image, url, this._config?.zones ?? [])) {
      this._svgSourceStatus = "none";
      this.emitSvgSourceChanged();
      return;
    }

    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const explicitlySvg = /\.svg(?:$|[?#])/i.test(url) || /\.svg(?:$|[?#])/i.test(imageContentId(this._config?.image));
      const requiredByConfig = (this._config?.zones ?? []).some(zoneUsesSvgObject);
      if (!contentType.toLowerCase().includes("svg") && !explicitlySvg && !requiredByConfig) {
        if (token !== this._svgSourceToken) return;
        this._svgSourceStatus = "none";
        this.emitSvgSourceChanged();
        return;
      }
      const parsed = parseSvgSource(await response.text());
      if (!parsed) throw new Error("The selected image is not a readable SVG document.");
      if (token !== this._svgSourceToken || url !== this._svgSourceKey) return;
      this._svgSource = parsed;
      this._svgSourceStatus = "ready";
      this._svgSourceError = "";
      if (Number.isFinite(parsed.aspectRatio) && parsed.aspectRatio > 0) {
        this._imageAspectRatio = parsed.aspectRatio;
      }
      this.render();
      requestAnimationFrame(() => this.emitSvgSourceChanged());
    } catch (error) {
      if (token !== this._svgSourceToken || url !== this._svgSourceKey) return;
      this._svgSource = null;
      this._svgSourceStatus = "error";
      this._svgSourceError = error instanceof Error ? error.message : String(error);
      if ((this._config?.zones ?? []).some(zoneUsesSvgObject)) {
        console.warn("Floorplan Zone Card: unable to inspect SVG floorplan objects", error);
      }
      this.render();
      this.emitSvgSourceChanged();
    }
  }

  createSvgSourceLayer(overlay) {
    if (!this._svgSource) return null;
    const layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add("svg-source-layer");
    layer.setAttribute("x", "0");
    layer.setAttribute("y", "0");
    layer.setAttribute("width", String(SVG_SIZE));
    layer.setAttribute("height", String(SVG_SIZE));
    layer.setAttribute("viewBox", this._svgSource.viewBox);
    layer.setAttribute("preserveAspectRatio", this._svgSource.preserveAspectRatio);
    layer.setAttribute("pointer-events", "none");
    overlay.append(layer);
    return layer;
  }

  createSvgZoneShape(zone, sourceLayer) {
    if (!sourceLayer || !this._svgSource || !zoneUsesSvgObject(zone)) return null;
    const sourceElement = this._svgSource.elementsById.get(zone.svg_element_id);
    if (!sourceElement) return null;
    const geometry = cloneSvgSourceObject(sourceElement, this._svgSource);
    if (!geometry) return null;
    const wrapper = document.createElementNS(SVG_NS, "g");
    wrapper.classList.add("zone", "svg-source-zone");
    wrapper.dataset.zoneId = zone.id ?? "";
    wrapper.dataset.svgElementId = zone.svg_element_id;
    wrapper.setAttribute("pointer-events", "visiblePainted");
    wrapper.append(geometry);
    sourceLayer.append(wrapper);
    return wrapper;
  }

  svgElementBounds(elementId) {
    if (!this._svgSource || !elementId) return null;
    const sourceLayer = this.shadowRoot?.querySelector(".svg-source-layer");
    const sourceElement = this._svgSource.elementsById.get(elementId);
    if (!sourceLayer || !sourceElement) return null;
    const geometry = cloneSvgSourceObject(sourceElement, this._svgSource);
    if (!geometry) return null;
    const measure = document.createElementNS(SVG_NS, "g");
    measure.setAttribute("fill", "#000");
    measure.setAttribute("stroke", "#000");
    measure.setAttribute("opacity", "0");
    measure.setAttribute("pointer-events", "none");
    measure.append(geometry);
    sourceLayer.append(measure);
    const rect = measure.getBoundingClientRect();
    const layerRect = sourceLayer.getBoundingClientRect();
    measure.remove();
    if (!rect.width || !rect.height || !layerRect.width || !layerRect.height) return null;
    return normalizeSvgBounds({
      x: (rect.left - layerRect.left) / layerRect.width,
      y: (rect.top - layerRect.top) / layerRect.height,
      width: rect.width / layerRect.width,
      height: rect.height / layerRect.height,
    });
  }
'''

replace_once(
    '''  applyZoneVisualState(polygon, zone) {''',
    canvas_svg_methods + '''\n  applyZoneVisualState(polygon, zone) {''',
    "canvas svg methods",
)

replace_once(
    'const polygons = this.shadowRoot?.querySelectorAll("polygon.zone[data-zone-id]");',
    'const polygons = this.shadowRoot?.querySelectorAll(".zone[data-zone-id]");',
    "zone visual selector",
)

replace_once(
    '''      svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      polygon.zone { vector-effect:non-scaling-stroke; transition:fill 160ms ease,fill-opacity 160ms ease,stroke 120ms ease,stroke-width 120ms ease,filter 80ms ease; }
      polygon.zone.effect-pulse { animation:zone-pulse 1.4s ease-in-out infinite; }
      polygon.zone.effect-blink { animation:zone-blink 1s steps(1,end) infinite; }
      polygon.zone.highlight-border { stroke-linejoin:round; stroke-linecap:round; }''',
    '''      .floorplan-overlay { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .svg-source-layer { overflow:visible; pointer-events:none; }
      .zone { vector-effect:non-scaling-stroke; transition:fill 160ms ease,fill-opacity 160ms ease,stroke 120ms ease,stroke-width 120ms ease,filter 80ms ease; }
      .svg-source-zone * { vector-effect:non-scaling-stroke; }
      .zone.effect-pulse { animation:zone-pulse 1.4s ease-in-out infinite; }
      .zone.effect-blink { animation:zone-blink 1s steps(1,end) infinite; }
      .zone.highlight-border { stroke-linejoin:round; stroke-linecap:round; }''',
    "generic zone css",
)

source = source.replace('polygon.zone.effect-pulse,polygon.zone.effect-blink', '.zone.effect-pulse,.zone.effect-blink')
source = source.replace('polygon.actionable {', '.zone.actionable {')
source = source.replace('polygon.actionable.pressed {', '.zone.actionable.pressed {')
source = source.replace('polygon.actionable:focus-visible {', '.zone.actionable:focus-visible {')
source = source.replace('polygon.selectable {', '.zone.selectable {')
source = source.replace('polygon.selected {', '.zone.selected {')
source = source.replace('.canvas.zoomed polygon.actionable {', '.canvas.zoomed .zone.actionable {')

replace_once(
    '''    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);''',
    '''    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("floorplan-overlay");
    svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);''',
    "overlay class",
)

new_zone_loop = r'''    const sourceSvgLayer = this.createSvgSourceLayer(svg);

    for (const zone of this._config?.zones ?? []) {
      const svgObjectZone = zoneUsesSvgObject(zone);
      let polygon;
      if (svgObjectZone) {
        polygon = this.createSvgZoneShape(zone, sourceSvgLayer);
        if (!polygon) continue;
      } else {
        if (!Array.isArray(zone.points) || zone.points.length < 3) continue;
        polygon = document.createElementNS(SVG_NS, "polygon");
        polygon.classList.add("zone", "polygon-zone");
        polygon.dataset.zoneId = zone.id ?? "";
        polygon.setAttribute("points", pointList(zone.points));
        svg.append(polygon);
      }

      const accessibleName = zone.name || zone.entity || zone.id || "Zone";
      this.applyZoneVisualState(polygon, zone);

      if (interactive && mode !== "draw" && mode !== "focus-area" && mode !== "label-position") {
        polygon.classList.add("selectable");
        polygon.addEventListener("click", (event) => {
          event.stopPropagation();
          if (this.consumeSuppressedClick()) return;
          this.dispatchEditorEvent("floorplan-zone-select", { zoneId: zone.id });
        });
      } else if (!interactive && zoneHasActions(zone)) {
        polygon.classList.add("actionable");
        polygon.setAttribute("tabindex", "0");
        polygon.setAttribute("role", "button");
        polygon.setAttribute("aria-label", accessibleName);
        polygon.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          this.beginZoneGesture(event, zone, svg, polygon);
        });
        polygon.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (actionEnabled(effectiveAction(zone, "tap_action"))) {
            this.dispatchHassAction(zone, "tap");
          }
        });
      } else {
        polygon.style.pointerEvents = "none";
      }

      if (interactive && zone.id === selectedZoneId && mode === "edit" && !svgObjectZone) {
        polygon.classList.add("selected");
      }

      if (interactive && zone.id === selectedZoneId && mode === "edit" && !svgObjectZone) {
        const handles = [];
        const midpointHandles = [];
        zone.points.forEach((point, edgeIndex) => {
          const next = zone.points[(edgeIndex + 1) % zone.points.length];
          const midpoint = document.createElementNS(SVG_NS, "circle");
          midpoint.classList.add("midpoint");
          midpoint.setAttribute("cx", String(((point.x + next.x) / 2) * SVG_SIZE));
          midpoint.setAttribute("cy", String(((point.y + next.y) / 2) * SVG_SIZE));
          midpoint.dataset.screenRadius = "8";
          midpoint.setAttribute("r", String(8 / this._view.scale));
          midpoint.addEventListener("pointerdown", (event) => {
            if (this._pinch) return;
            event.preventDefault();
            event.stopPropagation();
            this.dispatchEditorEvent("floorplan-vertex-insert", {
              zoneId: zone.id,
              afterIndex: edgeIndex,
              point: this.pointerPoint(event, svg),
            });
          });
          midpointHandles.push(midpoint);
          svg.append(midpoint);
        });

        zone.points.forEach((point, vertexIndex) => {
          const handle = document.createElementNS(SVG_NS, "circle");
          handle.classList.add("vertex");
          if (vertexIndex === selectedVertexIndex) handle.classList.add("selected-vertex");
          handle.setAttribute("cx", String(point.x * SVG_SIZE));
          handle.setAttribute("cy", String(point.y * SVG_SIZE));
          const vertexRadius = vertexIndex === selectedVertexIndex ? 13 : 11;
          handle.dataset.screenRadius = String(vertexRadius);
          handle.setAttribute("r", String(vertexRadius / this._view.scale));
          handle.addEventListener("pointerdown", (event) => {
            if (this._pinch) return;
            event.preventDefault();
            event.stopPropagation();
            this._drag = {
              zoneId: zone.id,
              vertexIndex,
              pointerId: event.pointerId,
              points: deepClone(zone.points),
              polygon,
              handles,
              midpointHandles,
            };
            try {
              svg.setPointerCapture(event.pointerId);
            } catch (_error) {
              // Pointer capture is optional.
            }
          });
          handles.push(handle);
          svg.append(handle);
        });
      }
    }
'''

replace_regex(
    r'''    for \(const zone of this\._config\?\.zones \?\? \[\]\) \{.*?\n    \}\n\n    const labelsLayer = document\.createElement\("div"\);''',
    new_zone_loop + '\n    const labelsLayer = document.createElement("div");',
    "zone render loop",
)

replace_once(
    '''      if (!label.enabled || !Array.isArray(zone.points) || zone.points.length < 3) continue;''',
    '''      const hasGeometry = zoneUsesSvgObject(zone)
        ? svgBoundsValid(zone.svg_bounds)
        : Array.isArray(zone.points) && zone.points.length >= 3;
      if (!label.enabled || !hasGeometry) continue;''',
    "label geometry eligibility",
)

replace_regex(
    r'''  async refreshImage\(\) \{.*?\n  \}\n\}\n\nclass FloorplanZoneCard extends HTMLElement''',
    r'''  async refreshImage() {
    const key = imageContentId(this._config?.image);
    const needsResolution = isMediaSourceContentId(key);
    if (!key) {
      this._imageKey = "";
      this._resolvedImage = "";
      this._imageAspectRatio = null;
      this._imageResolveToken += 1;
      this.clearSvgSource();
      this.render();
      this.emitSvgSourceChanged();
      return;
    }
    if (key === this._imageKey && this._resolvedImage) {
      this.render();
      this.refreshSvgSource();
      return;
    }
    if (key !== this._imageKey) {
      this._imageAspectRatio = null;
      this.clearSvgSource();
    }
    this._imageKey = key;
    const token = ++this._imageResolveToken;
    if (!needsResolution) {
      this._resolvedImage = hassUrl(this._hass, key);
      this.render();
      this.refreshSvgSource();
      return;
    }
    this._resolvedImage = "";
    this.render();
    if (!this._hass) return;
    try {
      const resolved = await resolveImageSource(this._hass, this._config?.image);
      if (token !== this._imageResolveToken || key !== this._imageKey) return;
      this._resolvedImage = resolved;
    } catch (error) {
      if (token !== this._imageResolveToken || key !== this._imageKey) return;
      console.warn("Floorplan Zone Card: unable to resolve media source image", error);
      this._resolvedImage = "";
    }
    this.render();
    this.refreshSvgSource();
  }
}

class FloorplanZoneCard extends HTMLElement''',
    "refresh image",
)

replace_once(
    '''    this._viewState = normalizeViewState();
    this._haFormReadyListener = null;''',
    '''    this._viewState = normalizeViewState();
    this._svgElements = [];
    this._svgSourceError = "";
    this._selectedSvgElementId = "";
    this._haFormReadyListener = null;''',
    "editor svg state",
)

replace_once(
    '''  setConfig(config) {
    this._config = normalizedConfig(config);''',
    '''  setConfig(config) {
    const previousImage = imageContentId(this._config?.image);
    this._config = normalizedConfig(config);
    if (previousImage !== imageContentId(this._config?.image)) {
      this._svgElements = [];
      this._svgSourceError = "";
      this._selectedSvgElementId = "";
    }''',
    "editor set config svg reset",
)

replace_regex(
    r'''  configureCanvas\(canvas\) \{.*?\n  \}\n\n  updatePreview\(\)''',
    r'''  configureCanvas(canvas) {
    canvas.addEventListener("floorplan-view-changed", (event) => {
      this._viewState = normalizeViewState(event.detail?.viewState);
    });
    canvas.addEventListener("floorplan-svg-source-changed", (event) => {
      this.handleSvgSourceChanged(event.detail ?? {});
    });
    canvas.viewState = this._viewState;
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.editorState = this.canvasState();
  }

  handleSvgSourceChanged(detail) {
    const nextElements = Array.isArray(detail?.elements) ? detail.elements : [];
    const nextError = typeof detail?.error === "string" ? detail.error : "";
    const previousCatalog = this._svgElements.map((item) => `${item.id}:${item.tag}`).join("|");
    const nextCatalog = nextElements.map((item) => `${item.id}:${item.tag}`).join("|");
    this._svgElements = nextElements;
    this._svgSourceError = nextError;

    const availableIds = new Set(nextElements.map((item) => item.id));
    if (!availableIds.has(this._selectedSvgElementId)) {
      const used = this.usedSvgElementIds();
      this._selectedSvgElementId = nextElements.find((item) => !used.has(item.id))?.id ?? "";
    }

    let boundsChanged = false;
    const byId = new Map(nextElements.map((item) => [item.id, item]));
    const zones = deepClone(this._config?.zones ?? []);
    zones.forEach((zone, index) => {
      if (!zoneUsesSvgObject(zone)) return;
      const bounds = byId.get(zone.svg_element_id)?.bounds;
      if (!svgBoundsValid(bounds)) return;
      const normalized = normalizeSvgBounds(bounds);
      const current = svgBoundsValid(zone.svg_bounds) ? normalizeSvgBounds(zone.svg_bounds) : null;
      const differs = !current || ["x", "y", "width", "height"].some(
        (key) => Math.abs(current[key] - normalized[key]) > 0.0005,
      );
      if (!differs) return;
      zones[index] = normalizeZone({ ...zone, svg_bounds: normalized });
      boundsChanged = true;
    });
    if (boundsChanged) {
      this._config = { ...this._config, zones };
      this.emitConfigChanged();
    }

    if (previousCatalog !== nextCatalog || nextError !== (this._lastSvgSourceError ?? "") || boundsChanged) {
      this._lastSvgSourceError = nextError;
      this.render();
    }
  }

  usedSvgElementIds(excludeZoneId = null) {
    return new Set(
      (this._config?.zones ?? [])
        .filter((zone) => zone.id !== excludeZoneId && zoneUsesSvgObject(zone))
        .map((zone) => zone.svg_element_id),
    );
  }

  addSvgObjectZone(elementId) {
    const element = this._svgElements.find((item) => item.id === elementId);
    if (!element || this.usedSvgElementIds().has(elementId)) return;
    const zone = createSvgZone(element, element.bounds, this._config?.zones ?? []);
    this._config = { ...this._config, zones: [...(this._config?.zones ?? []), zone] };
    this._selectedZoneId = zone.id;
    this._selectedVertexIndex = null;
    this._mode = "select";
    const used = this.usedSvgElementIds();
    this._selectedSvgElementId = this._svgElements.find((item) => !used.has(item.id))?.id ?? "";
    this.emitConfigChanged();
    this.render();
  }

  updatePreview()''',
    "editor canvas config and svg handlers",
)

replace_regex(
    r'''  selectZone\(zoneId\) \{.*?\n  \}\n\n  startLabelPositioning''',
    r'''  selectZone(zoneId) {
    const zone = this._config?.zones?.find((item) => item.id === zoneId);
    if (!zone) return;
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = null;
    this._focusRuleIndex = null;
    this._labelZoneId = null;
    this._mode = zoneUsesSvgObject(zone) ? "select" : "edit";
    this._draftPoints = [];
    this.render();
  }

  startLabelPositioning''',
    "select svg zone",
)

svg_editor_method = r'''
  createSvgGeometryEditor(zone, zoneIndex) {
    const section = document.createElement("div");
    section.className = "svg-geometry-editor";
    const heading = document.createElement("strong");
    heading.textContent = "SVG object";
    section.append(heading);

    const used = this.usedSvgElementIds(zone.id);
    const options = this._svgElements
      .filter((item) => !used.has(item.id) || item.id === zone.svg_element_id)
      .map((item) => ({
        value: item.id,
        label: `${item.id} · <${item.tag}>${item.title ? ` · ${item.title}` : ""}`,
      }));
    if (!options.some((item) => item.value === zone.svg_element_id)) {
      options.unshift({ value: zone.svg_element_id, label: `${zone.svg_element_id} · not found in current SVG` });
    }

    section.append(this.createField("Source object", this.createSelect(
      zone.svg_element_id,
      options,
      (elementId) => {
        const element = this._svgElements.find((item) => item.id === elementId);
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          geometry: "svg",
          svg_element_id: elementId,
          svg_bounds: svgBoundsValid(element?.bounds) ? normalizeSvgBounds(element.bounds) : current.svg_bounds,
        }), true);
      },
    )));

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "This zone uses the geometry of an existing SVG element. Its state styles, effects, actions, labels and auto-zoom work exactly like a drawn zone.";
    section.append(hint);

    if (this._svgSourceError) {
      const warning = document.createElement("p");
      warning.className = "validation-warning";
      warning.textContent = `Unable to inspect the SVG source: ${this._svgSourceError}`;
      section.append(warning);
    } else if (!this._svgElements.some((item) => item.id === zone.svg_element_id)) {
      const warning = document.createElement("p");
      warning.className = "validation-warning";
      warning.textContent = `SVG object #${zone.svg_element_id} is not present in the current floorplan.`;
      section.append(warning);
    }
    return section;
  }
'''

replace_once(
    '''  createActionsEditor(zone, zoneIndex) {''',
    svg_editor_method + '''\n  createActionsEditor(zone, zoneIndex) {''',
    "svg geometry editor",
)

replace_once(
    '''      .editor,.zones,.zone-card,.field,.preview,.fallback-form,.native-form-wrapper,.state-rules,.style-box,.actions-editor,.label-editor,.auto-zoom-editor,.auto-zoom-card { display:grid; gap:10px; }''',
    '''      .editor,.zones,.zone-card,.field,.preview,.fallback-form,.native-form-wrapper,.state-rules,.style-box,.actions-editor,.label-editor,.auto-zoom-editor,.auto-zoom-card,.svg-geometry-editor { display:grid; gap:10px; }''',
    "editor grid svg section",
)

replace_once(
    '''      .state-rules,.actions-editor,.label-editor { padding-top:4px; border-top:1px solid var(--divider-color,#ddd); }''',
    '''      .state-rules,.actions-editor,.label-editor,.svg-geometry-editor { padding-top:4px; border-top:1px solid var(--divider-color,#ddd); }
      .svg-zone-add-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:end; padding:10px; border:1px dashed var(--divider-color,#ccc); border-radius:9px; }''',
    "editor svg css",
)

replace_once(
    '''        .grid,.style-grid,.label-style-grid { grid-template-columns:1fr; }''',
    '''        .grid,.style-grid,.label-style-grid,.svg-zone-add-row { grid-template-columns:1fr; }''',
    "mobile svg add row",
)

replace_once(
    '''    } else {
      status.textContent = "Select a zone";
    }''',
    '''    } else {
      const selected = this._config.zones.find((item) => item.id === this._selectedZoneId);
      status.textContent = zoneUsesSvgObject(selected)
        ? `SVG zone · #${selected.svg_element_id}`
        : "Select a zone";
    }''',
    "svg zone editor status",
)

new_zone_editor = r'''    const zones = document.createElement("div");
    zones.className = "zones";
    const zoneTitle = document.createElement("div");
    zoneTitle.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "Zones";
    const add = this.createButton("Add drawn zone", () => this.startDrawing(), { disabled: this._mode === "draw" || this._mode === "focus-area" || this._mode === "label-position" });
    zoneTitle.append(heading, add);
    zones.append(zoneTitle);

    const unusedSvgElements = this._svgElements.filter((item) => !this.usedSvgElementIds().has(item.id));
    if (unusedSvgElements.length) {
      if (!unusedSvgElements.some((item) => item.id === this._selectedSvgElementId)) {
        this._selectedSvgElementId = unusedSvgElements[0].id;
      }
      const svgRow = document.createElement("div");
      svgRow.className = "svg-zone-add-row";
      const selector = this.createSelect(
        this._selectedSvgElementId,
        unusedSvgElements.map((item) => ({
          value: item.id,
          label: `${item.id} · <${item.tag}>${item.title ? ` · ${item.title}` : ""}`,
        })),
        (value) => { this._selectedSvgElementId = value; },
      );
      svgRow.append(
        this.createField("Existing SVG object", selector),
        this.createButton("Add SVG zone", () => this.addSvgObjectZone(this._selectedSvgElementId), {
          disabled: !this._selectedSvgElementId,
        }),
      );
      zones.append(svgRow);
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "SVG objects are detected from elements with an id. Standard paths, rectangles, circles, ellipses, polygons, polylines, groups and internal <use> references are supported.";
      zones.append(hint);
    } else if (this._svgSourceError) {
      const warning = document.createElement("p");
      warning.className = "validation-warning";
      warning.textContent = `SVG object detection failed: ${this._svgSourceError}`;
      zones.append(warning);
    }

    if ((this._config.zones?.length ?? 0) === 0) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = this._svgElements.length
        ? "Draw a polygon zone or select one of the detected SVG objects above."
        : "Press Add drawn zone, then click at least three points on the floorplan and close the polygon.";
      zones.append(hint);
    }

    for (const [index, zone] of (this._config.zones ?? []).entries()) {
      const zoneCard = document.createElement("section");
      zoneCard.className = "zone-card";
      if (zone.id === this._selectedZoneId) zoneCard.classList.add("selected");
      const header = document.createElement("div");
      header.className = "section-title";
      const name = document.createElement("strong");
      name.textContent = zone.name || `Zone ${index + 1}`;
      const actions = document.createElement("div");
      actions.className = "toolbar";
      if (!zoneUsesSvgObject(zone)) {
        actions.append(this.createButton("Edit shape", () => this.selectZone(zone.id), { kind: "secondary" }));
      }
      actions.append(this.createButton("Delete", () => {
        if (this._selectedZoneId === zone.id) {
          this._selectedZoneId = null;
          if (this._labelZoneId === zone.id) this._labelZoneId = null;
          this._selectedVertexIndex = null;
          this._mode = "select";
        }
        const zones = this._config.zones.filter((_, i) => i !== index);
        const autoZoom = (this._config.auto_zoom ?? []).map((rule) =>
          rule.target === "zone" && rule.zone_id === zone.id
            ? normalizeAutoZoomRule({ ...rule, zone_id: "" })
            : rule
        );
        this.updateConfig({ zones, auto_zoom: autoZoom }, true);
      }, { kind: "danger" }));
      header.append(name, actions);
      zoneCard.append(header, this.createZoneMetadataForm(zone, index));
      if (zoneUsesSvgObject(zone)) zoneCard.append(this.createSvgGeometryEditor(zone, index));
      zoneCard.append(
        this.createLabelEditor(zone, index),
        this.createActionsEditor(zone, index),
        this.createStateRulesEditor(zone, index),
      );
      const hint = document.createElement("p");
      hint.className = "hint";
      const currentState = entityRawState(this._hass, zone.entity);
      hint.textContent = zone.entity
        ? `Current raw state: ${currentState ?? "not available"}. Exact state rules are evaluated before the fallback style.`
        : "Choose any Home Assistant entity, then associate each raw state value with a color and opacity.";
      zoneCard.append(hint);
      zones.append(zoneCard);
    }
'''

replace_regex(
    r'''    const zones = document\.createElement\("div"\);.*?\n    editor\.append\(zones\);''',
    new_zone_editor + '\n    editor.append(zones);',
    "zones editor section",
)

replace_once(
    'description: "Display a zoomable floorplan with state-driven polygon zones, configurable labels and Home Assistant actions.",',
    'description: "Display a zoomable floorplan with state-driven drawn or SVG-object zones, configurable labels and Home Assistant actions.",',
    "custom card description",
)

SOURCE.write_text(source)

package_path = Path("package.json")
package = json.loads(package_path.read_text())
package["version"] = "0.1.0-dev.11"
package["description"] = "A visual Home Assistant floorplan card with state-driven drawn and SVG-object zones, native actions, zoom/pan, auto focus, animated effects, configurable zone labels and editor validation."
package_path.write_text(json.dumps(package, indent=2) + "\n")

readme_path = Path("README.md")
readme = readme_path.read_text()
readme = readme.replace(
    "A Home Assistant custom dashboard card for displaying a zoomable floorplan with polygon zones driven by entity state.",
    "A Home Assistant custom dashboard card for displaying a zoomable floorplan with drawn polygon or existing SVG-object zones driven by entity state.",
)
readme = readme.replace(
    "2. add a zone;\n3. draw the zone directly on the floorplan;",
    "2. add a zone;\n3. draw the zone directly on the floorplan **or**, when the floorplan is SVG, select an existing object by its `id`;",
)
readme = readme.replace(
    "graphical polygon editing, unlimited exact-state styling rules",
    "graphical polygon editing, direct SVG-object zones, unlimited exact-state styling rules",
)
readme = readme.replace(
    "- Home Assistant entity selector with no domain restriction.\n",
    "- Home Assistant entity selector with no domain restriction.\n- Automatic discovery of usable SVG elements with `id` attributes and direct SVG-object zone creation.\n- SVG-object zones support paths, rectangles, circles, ellipses, polygons, polylines, groups and internal `<use>` references while preserving group transforms.\n",
)
readme = readme.replace(
    "- Auto-focus target can be an existing polygon zone or a custom rectangle drawn directly in the graphical editor.",
    "- Auto-focus target can be an existing drawn or SVG-object zone, or a custom rectangle drawn directly in the graphical editor.",
)
svg_section = '''## SVG object zones

When the selected floorplan is an SVG, the editor inspects the SVG document and lists supported elements that have an `id`. A detected object can be added directly as a zone, so rooms or machine areas that already exist as SVG geometry do not need to be redrawn as polygons.

Supported source objects include `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `g`, and internal `use` references. Parent group transforms are preserved. The original SVG is still rendered as the floorplan image; only sanitized geometry attributes are cloned into the interaction overlay, so source scripts, event handlers and arbitrary SVG markup are never injected into the card DOM.

A generated SVG-backed zone stores the source element id and a normalized bounding box:

```yaml
geometry: svg
svg_element_id: kitchen
svg_bounds:
  x: 0.08
  y: 0.12
  width: 0.31
  height: 0.27
```

The bounding box lets labels and state-triggered auto-zoom work exactly like they do for drawn polygons. It is refreshed by the visual editor when the SVG is inspected again. State colors, opacity, pulse/blink effects, active borders, tap/hold/double-tap actions and labels all apply to SVG-backed zones.

Each SVG element can be assigned to one zone at a time in the visual editor. If a referenced id disappears from a replaced SVG file, the editor shows a validation warning instead of silently assigning another object.

> SVG object discovery requires the SVG source to be readable by the browser. Home Assistant `/local/` files and media-source uploads are supported; a remote SVG must allow CORS access for its objects to be inspected.

'''
if "## SVG object zones" not in readme:
    readme = readme.replace("## State styles and visual effects\n", svg_section + "## State styles and visual effects\n")
readme_path.write_text(readme)

notes = '''# 0.1.0-dev.11 implementation notes

Feature: use existing SVG objects as floorplan zones.

Implemented:
- SVG floorplans are inspected for supported elements with `id` attributes;
- the editor can create a zone directly from an existing SVG object instead of drawing a polygon;
- supported source geometry includes path, rect, circle, ellipse, polygon, polyline, group, and internal use references;
- parent group transforms are preserved when the object geometry is cloned into the zone overlay;
- only geometry attributes are cloned: scripts, event handlers, styles, foreignObject content, external use references, and unrelated SVG markup are not injected;
- SVG zones use the same state styles, pulse/blink effects, active border, Home Assistant actions and labels as drawn zones;
- SVG object bounds are normalized and persisted so auto-zoom and automatic label centering work without changing the existing view model;
- source bounds are refreshed by the visual editor when the SVG is inspected;
- duplicate assignment of the same SVG object is prevented by the editor;
- missing/replaced source ids are reported as editor warnings;
- legacy polygon zones remain backward compatible and are normalized as `geometry: polygon`;
- SVG object inspection supports direct `.svg` paths and Home Assistant media-source images, subject to normal browser CORS rules for remote sources.

Validation:
- npm run check;
- npm run build;
- source/distribution identity check;
- normalization, SVG-bound auto-zoom/label and backward-compatibility tests.
'''
Path("DEV11_NOTES.md").write_text(notes)

test_path = Path("tests/core.test.mjs")
tests = test_path.read_text()
tests = tests.replace(
    '''    zoneLabelLines,\n    stateRuleValidation,''',
    '''    zoneLabelLines,\n    normalizeSvgBounds,\n    svgBoundsValid,\n    zoneUsesSvgObject,\n    stateRuleValidation,''',
)
tests = tests.replace(
    '''    matchingAutoZoomRule,\n    zoneFocusArea,''',
    '''    matchingAutoZoomRule,\n    zoneFocusArea,''',
)
if 'test("normalizes SVG object zones and uses their bounds for focus and labels"' not in tests:
    tests += '''\n\ntest("normalizes SVG object zones and uses their bounds for focus and labels", () => {
  const config = core.normalizedConfig({
    zones: [{
      id: "zone_svg",
      svg_element_id: "room_kitchen",
      svg_bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    }],
  });
  const zone = config.zones[0];
  assert.equal(zone.geometry, "svg");
  assert.equal(zone.svg_element_id, "room_kitchen");
  assert.deepEqual(structuredClone(core.zoneFocusArea(zone)), {
    x: 0.1, y: 0.2, width: 0.3, height: 0.4,
  });
  assert.deepEqual(structuredClone(core.zoneLabelPoint(zone)), { x: 0.25, y: 0.4 });
  assert.equal(core.zoneUsesSvgObject(zone), true);
});

test("legacy drawn zones remain polygon geometry", () => {
  const zone = core.normalizedConfig({
    zones: [{
      id: "zone_1",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    }],
  }).zones[0];
  assert.equal(zone.geometry, "polygon");
  assert.equal(core.zoneUsesSvgObject(zone), false);
  assert.equal(zone.svg_element_id, undefined);
});

test("SVG bounds are clamped to normalized floorplan coordinates", () => {
  assert.deepEqual(structuredClone(core.normalizeSvgBounds({ x: -1, y: 0.8, width: 2, height: 1 })), {
    x: 0, y: 0.8, width: 1, height: 0.2,
  });
  assert.equal(core.svgBoundsValid({ x: 0.2, y: 0.2, width: 0, height: 0.3 }), false);
});
'''
test_path.write_text(tests)
