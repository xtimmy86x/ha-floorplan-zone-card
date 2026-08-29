const CARD_TYPE = "floorplan-zone-card";
const CARD_TAG = "floorplan-zone-card";
const EDITOR_TAG = "floorplan-zone-card-editor";
const CANVAS_TAG = "floorplan-zone-canvas";
const VERSION = "0.2.0";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_SIZE = 1000;

const DEFAULT_FALLBACK_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_UNAVAILABLE_STYLE = Object.freeze({ color: "#9e9e9e", opacity: 0.2 });
const DEFAULT_STROKE = Object.freeze({ color: "#ffffff", width: 2 });
const DEFAULT_ON_STYLE = Object.freeze({ color: "#ff3b30", opacity: 0.55 });
const DEFAULT_OFF_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_TAP_ACTION = Object.freeze({ action: "more-info" });
const DEFAULT_NONE_ACTION = Object.freeze({ action: "none" });
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;
const HOLD_DELAY = 500;
const DOUBLE_TAP_DELAY = 280;
const GESTURE_MOVE_THRESHOLD = 12;
const PAN_MOVE_THRESHOLD = 4;
const AUTO_ZOOM_PADDING = 0.12;
const AUTO_ZOOM_TRANSITION_MS = 360;
const MIN_FOCUS_AREA_SIZE = 0.01;
const AUTO_ZOOM_EXIT_BEHAVIORS = new Set(["previous", "reset", "keep"]);
const STATE_EFFECTS = new Set(["none", "pulse", "blink"]);
const UNAVAILABLE_ENTITY_STATES = new Set(["unknown", "unavailable"]);
const HIGHLIGHT_BORDER_WIDTH = 4;
const LABEL_CONTENT_MODES = new Set(["name", "custom", "name_state"]);
const LABEL_POSITION_MODES = new Set(["auto", "custom"]);
const LABEL_FONT_WEIGHTS = new Set([400, 500, 600, 700]);
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
});
const DEFAULT_LABEL = Object.freeze({
  enabled: false,
  content: "name",
  text: "",
  position_mode: "auto",
  color: "#ffffff",
  size: 18,
  weight: 600,
  opacity: 1,
  background: false,
  background_color: "#000000",
  background_opacity: 0.55,
});

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function normalizePoint(point) {
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

function normalizeStyle(style, fallback) {
  return {
    color: typeof style?.color === "string" && style.color ? style.color : fallback.color,
    opacity: clamp01(style?.opacity ?? fallback.opacity),
  };
}

function normalizeLabel(label) {
  const weight = Number(label?.weight);
  return {
    enabled: label?.enabled === true,
    content: LABEL_CONTENT_MODES.has(label?.content) ? label.content : DEFAULT_LABEL.content,
    text: label?.text === undefined || label?.text === null ? "" : String(label.text),
    position_mode: LABEL_POSITION_MODES.has(label?.position_mode)
      ? label.position_mode
      : DEFAULT_LABEL.position_mode,
    position: label?.position && typeof label.position === "object"
      ? normalizePoint(label.position)
      : undefined,
    color: typeof label?.color === "string" && label.color
      ? label.color
      : DEFAULT_LABEL.color,
    size: clamp(label?.size ?? DEFAULT_LABEL.size, 8, 72),
    weight: LABEL_FONT_WEIGHTS.has(weight) ? weight : DEFAULT_LABEL.weight,
    opacity: clamp01(label?.opacity ?? DEFAULT_LABEL.opacity),
    background: label?.background === true,
    background_color: typeof label?.background_color === "string" && label.background_color
      ? label.background_color
      : DEFAULT_LABEL.background_color,
    background_opacity: clamp01(
      label?.background_opacity ?? DEFAULT_LABEL.background_opacity,
    ),
  };
}

function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length < 3) return { x: 0.5, y: 0.5 };
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = normalizePoint(points[index]);
    const next = normalizePoint(points[(index + 1) % points.length]);
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) {
    const xs = points.map((point) => clamp01(point.x));
    const ys = points.map((point) => clamp01(point.y));
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }
  return normalizePoint({
    x: x / (3 * twiceArea),
    y: y / (3 * twiceArea),
  });
}

function zoneLabelPoint(zone) {
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

function entityDisplayState(hass, entityId) {
  if (!entityId) return "";
  const entity = hass?.states?.[entityId];
  if (!entity) return "";
  const unit = entity.attributes?.unit_of_measurement;
  return `${entity.state}${unit ? ` ${unit}` : ""}`;
}

function zoneLabelLines(hass, zone) {
  const label = normalizeLabel(zone?.label);
  const name = zone?.name || zone?.entity || zone?.id || "Zone";
  if (label.content === "custom") return [label.text || name];
  if (label.content === "name_state") {
    const state = entityDisplayState(hass, zone?.entity);
    return state ? [name, state] : [name];
  }
  return [name];
}

function normalizeStateRule(rule) {
  return {
    value: rule?.value === undefined || rule?.value === null ? "" : String(rule.value),
    ...normalizeStyle(rule, DEFAULT_FALLBACK_STYLE),
    effect: STATE_EFFECTS.has(rule?.effect) ? rule.effect : "none",
    highlight_border: rule?.highlight_border === true,
  };
}

function stateRuleValidation(states) {
  const indexesByValue = new Map();
  const emptyIndexes = [];
  const reservedIndexes = [];
  const duplicateIndexes = new Set();

  (states ?? []).forEach((rule, index) => {
    const value = rule?.value === undefined || rule?.value === null
      ? ""
      : String(rule.value);
    if (value === "") emptyIndexes.push(index);
    if (UNAVAILABLE_ENTITY_STATES.has(value)) reservedIndexes.push(index);
    const indexes = indexesByValue.get(value) ?? [];
    indexes.push(index);
    indexesByValue.set(value, indexes);
  });

  const duplicateValues = [];
  indexesByValue.forEach((indexes, value) => {
    if (indexes.length < 2) return;
    duplicateValues.push(value);
    indexes.forEach((index) => duplicateIndexes.add(index));
  });

  return {
    emptyIndexes,
    reservedIndexes,
    duplicateIndexes: [...duplicateIndexes].sort((a, b) => a - b),
    duplicateValues,
  };
}

function normalizeAction(action) {
  return action && typeof action === "object" && !Array.isArray(action)
    ? deepClone(action)
    : undefined;
}

function normalizeViewState(state) {
  const scale = clamp(state?.scale ?? MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const halfVisible = 0.5 / scale;
  return {
    scale,
    centerX: clamp(state?.centerX ?? 0.5, halfVisible, 1 - halfVisible),
    centerY: clamp(state?.centerY ?? 0.5, halfVisible, 1 - halfVisible),
  };
}

function normalizeFocusArea(area) {
  const x = clamp01(area?.x ?? 0.25);
  const y = clamp01(area?.y ?? 0.25);
  const width = clamp(area?.width ?? 0.5, 0, 1 - x);
  const height = clamp(area?.height ?? 0.5, 0, 1 - y);
  return { x, y, width, height };
}

function focusAreaValid(area) {
  if (!area || typeof area !== "object" || Array.isArray(area)) return false;
  const normalized = normalizeFocusArea(area);
  return normalized.width >= MIN_FOCUS_AREA_SIZE && normalized.height >= MIN_FOCUS_AREA_SIZE;
}

function normalizeAutoZoomRule(rule) {
  const target = rule?.target === "area" ? "area" : "zone";
  const exitBehavior = AUTO_ZOOM_EXIT_BEHAVIORS.has(rule?.exit_behavior)
    ? rule.exit_behavior
    : "previous";
  return {
    ...rule,
    entity: typeof rule?.entity === "string" ? rule.entity : "",
    state: rule?.state === undefined || rule?.state === null ? "" : String(rule.state),
    target,
    zone_id: typeof rule?.zone_id === "string" ? rule.zone_id : "",
    area: focusAreaValid(rule?.area) ? normalizeFocusArea(rule.area) : undefined,
    exit_behavior: exitBehavior,
  };
}

function zoneFocusArea(zone, svgBoundsOverride = null) {
  if (zoneUsesSvgObject(zone) && svgBoundsValid(svgBoundsOverride)) {
    return normalizeSvgBounds(svgBoundsOverride);
  }
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

function autoZoomTargetArea(config, rule, svgBoundsByZoneId = null) {
  if (!rule) return null;
  if (rule.target === "area") {
    return focusAreaValid(rule.area) ? normalizeFocusArea(rule.area) : null;
  }
  const zone = (config?.zones ?? []).find((item) => item.id === rule.zone_id);
  const activeBounds = zone?.id && svgBoundsByZoneId?.get
    ? svgBoundsByZoneId.get(zone.id)
    : null;
  return zoneFocusArea(zone, activeBounds);
}

function viewForFocusArea(area, padding = AUTO_ZOOM_PADDING) {
  const normalized = normalizeFocusArea(area);
  if (!focusAreaValid(normalized)) return normalizeViewState();
  const width = clamp(normalized.width * (1 + padding * 2), MIN_FOCUS_AREA_SIZE, 1);
  const height = clamp(normalized.height * (1 + padding * 2), MIN_FOCUS_AREA_SIZE, 1);
  const scale = clamp(Math.min(1 / width, 1 / height), MIN_ZOOM, MAX_ZOOM);
  return normalizeViewState({
    scale,
    centerX: normalized.x + normalized.width / 2,
    centerY: normalized.y + normalized.height / 2,
  });
}

function matchingAutoZoomRule(config, hass, svgBoundsByZoneId = null) {
  const rules = config?.auto_zoom ?? [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule?.entity || entityRawState(hass, rule.entity) !== rule.state) continue;
    const area = autoZoomTargetArea(config, rule, svgBoundsByZoneId);
    if (area) return { index, rule, area };
  }
  return null;
}

function autoZoomRuleValidation(config, rule) {
  const issues = [];
  if (!rule?.entity) issues.push("Choose an entity.");
  if (rule?.state === undefined || rule?.state === null || String(rule.state) === "") {
    issues.push("Enter the exact trigger state.");
  }

  if (rule?.target === "area") {
    if (!focusAreaValid(rule?.area)) issues.push("Draw a valid custom focus area.");
  } else if (!rule?.zone_id) {
    issues.push("Select a zone to focus.");
  } else if (!(config?.zones ?? []).some((zone) => zone.id === rule.zone_id)) {
    issues.push("The selected focus zone no longer exists.");
  }

  return issues;
}

function legacyStateRules(zone) {
  const rules = [];
  if (zone?.off) {
    rules.push(normalizeStateRule({ value: "off", ...normalizeStyle(zone.off, DEFAULT_OFF_STYLE) }));
  }
  if (zone?.on) {
    rules.push(normalizeStateRule({ value: "on", ...normalizeStyle(zone.on, DEFAULT_ON_STYLE) }));
  }
  return rules;
}

function normalizeZone(zone) {
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

function normalizedConfig(config) {
  const clone = deepClone(config ?? {});
  return {
    ...clone,
    zones: Array.isArray(clone.zones) ? clone.zones.map(normalizeZone) : [],
    auto_zoom: Array.isArray(clone.auto_zoom)
      ? clone.auto_zoom.map(normalizeAutoZoomRule)
      : [],
  };
}

function nextZoneId(zones) {
  const used = new Set((zones ?? []).map((zone) => zone.id).filter(Boolean));
  let index = 1;
  while (used.has(`zone_${index}`)) index += 1;
  return `zone_${index}`;
}

function createZone(points, zones) {
  const id = nextZoneId(zones);
  const number = id.replace(/^zone_/, "");
  return {
    id,
    name: `Zone ${number}`,
    entity: "",
    geometry: "polygon",
    points: points.map(normalizePoint),
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

function createSvgZone(element, bounds, zones) {
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

function entityRawState(hass, entityId) {
  if (!entityId) return undefined;
  return hass?.states?.[entityId]?.state;
}

function stateStyle(hass, zone) {
  const state = entityRawState(hass, zone.entity);
  if (state === undefined || UNAVAILABLE_ENTITY_STATES.has(state)) {
    return zone.unavailable ?? DEFAULT_UNAVAILABLE_STYLE;
  }
  const rule = (zone.states ?? []).find((item) => String(item.value) === state);
  return rule ?? zone.default ?? DEFAULT_FALLBACK_STYLE;
}

function pointList(points) {
  return points.map((point) => `${point.x * SVG_SIZE},${point.y * SVG_SIZE}`).join(" ");
}

function imageContentId(image) {
  if (typeof image === "string") return image.trim();
  if (image && typeof image === "object" && typeof image.media_content_id === "string") {
    return image.media_content_id.trim();
  }
  return "";
}

function activeImageSource(config, hass) {
  const darkMode = hass?.themes?.darkMode === true;
  const darkImage = config?.image_dark;
  return darkMode && imageContentId(darkImage) ? darkImage : config?.image;
}

function activeFloorplanTheme(config, hass) {
  return hass?.themes?.darkMode === true && imageContentId(config?.image_dark)
    ? "dark"
    : "light";
}

function themeImageConfigKey(config) {
  return `${imageContentId(config?.image)}|${imageContentId(config?.image_dark)}`;
}

function themeCompatibilityKey(config) {
  const zoneIds = (config?.zones ?? [])
    .filter(zoneUsesSvgObject)
    .map((zone) => zone.svg_element_id)
    .sort()
    .join(",");
  return `${themeImageConfigKey(config)}|${zoneIds}`;
}

function isMediaSourceContentId(value) {
  return typeof value === "string" && value.startsWith("media-source://");
}

function hassUrl(hass, value) {
  if (!value) return "";
  try {
    return typeof hass?.hassUrl === "function" ? hass.hassUrl(value) : value;
  } catch (_error) {
    return value;
  }
}

async function resolveImageSource(hass, image) {
  const source = imageContentId(image);
  if (!source) return "";
  if (!isMediaSourceContentId(source)) return hassUrl(hass, source);
  if (typeof hass?.callWS !== "function") return "";
  const resolved = await hass.callWS({
    type: "media_source/resolve_media",
    media_content_id: source,
  });
  return hassUrl(hass, resolved?.url ?? "");
}


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

function svgViewBoxParts(descriptor) {
  return String(descriptor?.viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function dualThemeSvgWarnings(lightDescriptor, darkDescriptor, zones = []) {
  if (!lightDescriptor || !darkDescriptor) return [];
  const warnings = [];
  const lightViewBox = svgViewBoxParts(lightDescriptor);
  const darkViewBox = svgViewBoxParts(darkDescriptor);
  if (
    lightViewBox.length === 4 &&
    darkViewBox.length === 4 &&
    lightViewBox.some((value, index) => Math.abs(value - darkViewBox[index]) > 1e-9)
  ) {
    warnings.push("Light and dark SVG floorplans use different viewBox dimensions. SVG zones may not align identically.");
  }

  const lightIds = lightDescriptor.elementsById ?? new Map();
  const darkIds = darkDescriptor.elementsById ?? new Map();
  const usedIds = [...new Set((zones ?? []).filter(zoneUsesSvgObject).map((zone) => zone.svg_element_id))];
  for (const id of usedIds) {
    if (!lightIds.has(id)) warnings.push(`Light floorplan is missing SVG object #${id}.`);
    if (!darkIds.has(id)) warnings.push(`Dark floorplan is missing SVG object #${id}.`);
  }
  return warnings;
}

async function inspectSvgImage(hass, image, zones = []) {
  const configured = imageContentId(image);
  if (!configured) return null;
  const url = await resolveImageSource(hass, image);
  if (!url || !likelySvgSource(image, url, zones)) return null;
  const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = parseSvgSource(await response.text());
  if (!parsed) throw new Error("The selected image is not a readable SVG document.");
  return parsed;
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

function effectiveAction(zone, actionName) {
  const configured = normalizeAction(zone?.[actionName]);
  if (configured) return configured;
  if (actionName === "tap_action" && zone?.entity) return { ...DEFAULT_TAP_ACTION };
  return { ...DEFAULT_NONE_ACTION };
}

function actionEnabled(action) {
  return Boolean(action && action.action && action.action !== "none");
}

function zoneHasActions(zone) {
  return (
    actionEnabled(effectiveAction(zone, "tap_action")) ||
    actionEnabled(effectiveAction(zone, "hold_action")) ||
    actionEnabled(effectiveAction(zone, "double_tap_action"))
  );
}

function zoneActionConfig(zone) {
  return {
    ...(zone.entity ? { entity: zone.entity } : {}),
    tap_action: effectiveAction(zone, "tap_action"),
    hold_action: effectiveAction(zone, "hold_action"),
    double_tap_action: effectiveAction(zone, "double_tap_action"),
  };
}

class FloorplanZoneCanvas extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { zones: [] };
    this._hass = undefined;
    this._editorState = {
      interactive: false,
      mode: "view",
      selectedZoneId: null,
      selectedVertexIndex: null,
      draftPoints: [],
      focusArea: null,
      labelZoneId: null,
    };
    this._view = normalizeViewState();
    this._drag = null;
    this._focusAreaDrag = null;
    this._labelDrag = null;
    this._backgroundPan = null;
    this._actionGesture = null;
    this._pendingTap = null;
    this._touchPointers = new Map();
    this._pinch = null;
    this._suppressNextClick = false;
    this._clickSuppressTimer = null;
    this._imageKey = null;
    this._resolvedImage = "";
    this._imageAspectRatio = null;
    this._imageResolveToken = 0;
    this._svgSourceKey = "";
    this._svgSource = null;
    this._svgSourceStatus = "idle";
    this._svgSourceError = "";
    this._svgSourceToken = 0;
    this._viewTransitionTimer = null;
    this._resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => this.applyCurrentView())
      : null;
  }

  set config(config) {
    this._config = config ?? { zones: [] };
    this.refreshImage();
  }

  get config() {
    return this._config;
  }

  set hass(hass) {
    this._hass = hass;
    const key = imageContentId(activeImageSource(this._config, this._hass));
    if (key && key === this._imageKey && this._resolvedImage) {
      this.updateZoneVisualStates();
      this.updateZoneLabels();
      return;
    }
    this.refreshImage();
  }

  get hass() {
    return this._hass;
  }

  set editorState(state) {
    this._editorState = {
      interactive: Boolean(state?.interactive),
      mode: state?.mode ?? "view",
      selectedZoneId: state?.selectedZoneId ?? null,
      selectedVertexIndex: Number.isInteger(state?.selectedVertexIndex)
        ? state.selectedVertexIndex
        : null,
      draftPoints: Array.isArray(state?.draftPoints)
        ? state.draftPoints.map(normalizePoint)
        : [],
      focusArea: state?.focusArea ? normalizeFocusArea(state.focusArea) : null,
      labelZoneId: state?.labelZoneId ?? null,
    };
    this.render();
  }

  set viewState(state) {
    this._view = normalizeViewState(state);
    this.applyCurrentView();
  }

  get viewState() {
    return deepClone(this._view);
  }

  connectedCallback() {
    this._resizeObserver?.observe(this);
    this.refreshImage();
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this.clearActionGesture();
    this.clearPendingTap();
    this._backgroundPan = null;
    this._focusAreaDrag = null;
    this._labelDrag = null;
    this._touchPointers.clear();
    this._pinch = null;
    if (this._clickSuppressTimer) clearTimeout(this._clickSuppressTimer);
    this._clickSuppressTimer = null;
    if (this._viewTransitionTimer) clearTimeout(this._viewTransitionTimer);
    this._viewTransitionTimer = null;
  }

  suppressClicksFor(delay = 120) {
    this._suppressNextClick = true;
    if (this._clickSuppressTimer) clearTimeout(this._clickSuppressTimer);
    this._clickSuppressTimer = setTimeout(() => {
      this._suppressNextClick = false;
      this._clickSuppressTimer = null;
    }, delay);
  }

  consumeSuppressedClick() {
    if (!this._suppressNextClick) return false;
    this._suppressNextClick = false;
    if (this._clickSuppressTimer) clearTimeout(this._clickSuppressTimer);
    this._clickSuppressTimer = null;
    return true;
  }

  emitViewChanged() {
    this.dispatchEvent(
      new CustomEvent("floorplan-view-changed", {
        bubbles: true,
        composed: true,
        detail: { viewState: this.viewState },
      }),
    );
  }

  viewElements() {
    return {
      viewport: this.shadowRoot?.querySelector(".canvas"),
      transform: this.shadowRoot?.querySelector(".transform-layer"),
      indicator: this.shadowRoot?.querySelector(".zoom-indicator"),
      zoomIn: this.shadowRoot?.querySelector('[data-zoom="in"]'),
      zoomOut: this.shadowRoot?.querySelector('[data-zoom="out"]'),
      reset: this.shadowRoot?.querySelector('[data-zoom="reset"]'),
    };
  }

  viewMetrics() {
    const { viewport } = this.viewElements();
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { viewport, rect, width: rect.width, height: rect.height };
  }

  clampView() {
    this._view = normalizeViewState(this._view);
  }

  applyCurrentView() {
    this.clampView();
    const { viewport, transform, indicator, zoomIn, zoomOut, reset } = this.viewElements();
    if (!viewport || !transform) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;

    const { scale, centerX, centerY } = this._view;
    const panX = width / 2 - centerX * width * scale;
    const panY = height / 2 - centerY * height * scale;
    // Resize the render layer to the requested zoom instead of scaling a
    // pre-rasterized 100% texture. This lets the browser sample the original
    // floorplan image at the final CSS size and keeps raster plans sharper.
    transform.style.width = `${scale * 100}%`;
    transform.style.height = `${scale * 100}%`;
    transform.style.transform = `translate(${panX}px, ${panY}px)`;
    transform.querySelectorAll("[data-screen-radius]").forEach((node) => {
      const baseRadius = Number(node.dataset.screenRadius);
      if (Number.isFinite(baseRadius)) node.setAttribute("r", String(baseRadius / scale));
    });
    // HTML labels are positioned by the enlarged layout layer but are no
    // longer themselves scaled, so they remain readable without counter-scale.
    transform.style.setProperty("--label-counter-scale", "1");
    viewport.classList.toggle("zoomed", scale > MIN_ZOOM + 0.001);
    if (indicator) indicator.textContent = `${Math.round(scale * 100)}%`;
    if (zoomIn) zoomIn.disabled = scale >= MAX_ZOOM - 0.001;
    if (zoomOut) zoomOut.disabled = scale <= MIN_ZOOM + 0.001;
    if (reset) reset.disabled = scale <= MIN_ZOOM + 0.001;
  }

  normalizedPointUnderClient(clientX, clientY) {
    const metrics = this.viewMetrics();
    if (!metrics) return { x: 0.5, y: 0.5 };
    const screenX = clientX - metrics.rect.left;
    const screenY = clientY - metrics.rect.top;
    const { scale, centerX, centerY } = this._view;
    const panX = metrics.width / 2 - centerX * metrics.width * scale;
    const panY = metrics.height / 2 - centerY * metrics.height * scale;
    return {
      x: clamp01((screenX - panX) / (metrics.width * scale)),
      y: clamp01((screenY - panY) / (metrics.height * scale)),
    };
  }

  setZoomAt(clientX, clientY, nextScale, emit = true) {
    this.stopViewAnimation();
    const metrics = this.viewMetrics();
    if (!metrics) return;
    const scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
    const anchor = this.normalizedPointUnderClient(clientX, clientY);
    const screenX = clientX - metrics.rect.left;
    const screenY = clientY - metrics.rect.top;
    this._view = normalizeViewState({
      scale,
      centerX: anchor.x - (screenX - metrics.width / 2) / (metrics.width * scale),
      centerY: anchor.y - (screenY - metrics.height / 2) / (metrics.height * scale),
    });
    this.applyCurrentView();
    if (emit) this.emitViewChanged();
  }

  zoomAroundCenter(delta) {
    const metrics = this.viewMetrics();
    if (!metrics) return;
    this.setZoomAt(
      metrics.rect.left + metrics.width / 2,
      metrics.rect.top + metrics.height / 2,
      this._view.scale + delta,
    );
  }

  resetView() {
    this.stopViewAnimation();
    this._view = normalizeViewState();
    this.applyCurrentView();
    this.emitViewChanged();
  }

  stopViewAnimation() {
    if (this._viewTransitionTimer) clearTimeout(this._viewTransitionTimer);
    this._viewTransitionTimer = null;
    this.viewElements().transform?.classList.remove("view-animated");
  }

  animateToView(state, emit = true) {
    this.stopViewAnimation();
    this._view = normalizeViewState(state);
    const transform = this.viewElements().transform;
    transform?.classList.add("view-animated");
    this.applyCurrentView();
    if (emit) this.emitViewChanged();
    this._viewTransitionTimer = setTimeout(() => {
      this.viewElements().transform?.classList.remove("view-animated");
      this._viewTransitionTimer = null;
    }, AUTO_ZOOM_TRANSITION_MS + 80);
  }

  focusArea(area, emit = true) {
    if (!focusAreaValid(area)) return false;
    this.animateToView(viewForFocusArea(area), emit);
    return true;
  }

  setViewCenterFromPan(startView, startX, startY, clientX, clientY) {
    this.stopViewAnimation();
    const metrics = this.viewMetrics();
    if (!metrics || startView.scale <= MIN_ZOOM) return;
    this._view = normalizeViewState({
      scale: startView.scale,
      centerX: startView.centerX - (clientX - startX) / (metrics.width * startView.scale),
      centerY: startView.centerY - (clientY - startY) / (metrics.height * startView.scale),
    });
    this.applyCurrentView();
    this.emitViewChanged();
  }

  handleWheel(event) {
    if (!this._resolvedImage) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    this.setZoomAt(
      event.clientX,
      event.clientY,
      this._view.scale + direction * ZOOM_STEP,
    );
  }

  cancelVertexDragGeometry() {
    const drag = this._drag;
    if (!drag) return;
    const zone = (this._config?.zones ?? []).find((item) => item.id === drag.zoneId);
    if (zone?.points?.length === drag.points.length) {
      drag.polygon?.setAttribute("points", pointList(zone.points));
      zone.points.forEach((point, index) => {
        const handle = drag.handles?.[index];
        if (handle) {
          handle.setAttribute("cx", String(point.x * SVG_SIZE));
          handle.setAttribute("cy", String(point.y * SVG_SIZE));
        }
        const next = zone.points[(index + 1) % zone.points.length];
        const midpoint = drag.midpointHandles?.[index];
        if (midpoint) {
          midpoint.setAttribute("cx", String(((point.x + next.x) / 2) * SVG_SIZE));
          midpoint.setAttribute("cy", String(((point.y + next.y) / 2) * SVG_SIZE));
        }
      });
    }
    this._drag = null;
  }

  startPinch() {
    if (this._touchPointers.size !== 2) return;
    const points = [...this._touchPointers.values()];
    const metrics = this.viewMetrics();
    if (!metrics) return;
    const midpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    if (!distance) return;
    this.stopViewAnimation();
    this.clearActionGesture();
    this._backgroundPan = null;
    if (this._focusAreaDrag) {
      const drag = this._focusAreaDrag;
      const area = this._editorState.focusArea;
      if (focusAreaValid(area)) {
        drag.rect.setAttribute("x", String(area.x * SVG_SIZE));
        drag.rect.setAttribute("y", String(area.y * SVG_SIZE));
        drag.rect.setAttribute("width", String(area.width * SVG_SIZE));
        drag.rect.setAttribute("height", String(area.height * SVG_SIZE));
      } else {
        drag.rect.setAttribute("width", "0");
        drag.rect.setAttribute("height", "0");
      }
      drag.rect.classList.remove("drawing");
      this._focusAreaDrag = null;
    }
    this.cancelVertexDragGeometry();
    if (this._labelDrag) {
      const drag = this._labelDrag;
      try {
        drag.anchor.releasePointerCapture(drag.pointerId);
      } catch (_error) {
        // Pointer capture is optional.
      }
      drag.anchor.style.left = `${drag.startPoint.x * 100}%`;
      drag.anchor.style.top = `${drag.startPoint.y * 100}%`;
      drag.anchor.classList.remove("dragging");
      this._labelDrag = null;
    }
    this.clearPendingTap();
    this._pinch = {
      startDistance: distance,
      startScale: this._view.scale,
      anchor: this.normalizedPointUnderClient(midpoint.x, midpoint.y),
    };
  }

  updatePinch() {
    if (!this._pinch || this._touchPointers.size < 2) return;
    const points = [...this._touchPointers.values()].slice(0, 2);
    const metrics = this.viewMetrics();
    if (!metrics) return;
    const midpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    if (!distance) return;
    const scale = clamp(
      this._pinch.startScale * (distance / this._pinch.startDistance),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const screenX = midpoint.x - metrics.rect.left;
    const screenY = midpoint.y - metrics.rect.top;
    this._view = normalizeViewState({
      scale,
      centerX:
        this._pinch.anchor.x - (screenX - metrics.width / 2) / (metrics.width * scale),
      centerY:
        this._pinch.anchor.y - (screenY - metrics.height / 2) / (metrics.height * scale),
    });
    this.applyCurrentView();
    this.emitViewChanged();
  }

  handleTouchPointerDownCapture(event) {
    if (event.pointerType !== "touch") return;
    if (event.composedPath().some((node) => node?.classList?.contains?.("zoom-controls"))) return;
    this._touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._touchPointers.size === 2) {
      event.preventDefault();
      this.startPinch();
    }
  }

  handleTouchPointerMoveCapture(event) {
    if (event.pointerType !== "touch" || !this._touchPointers.has(event.pointerId)) return;
    this._touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this._pinch) return;
    event.preventDefault();
    event.stopPropagation();
    this.updatePinch();
  }

  handleTouchPointerEndCapture(event) {
    if (event.pointerType !== "touch" || !this._touchPointers.has(event.pointerId)) return;
    const wasPinching = Boolean(this._pinch);
    this._touchPointers.delete(event.pointerId);
    if (this._touchPointers.size < 2) this._pinch = null;
    if (wasPinching) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressClicksFor(400);
    }
  }

  dispatchEditorEvent(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  dispatchHassAction(zone, action) {
    this.dispatchEvent(
      new CustomEvent("hass-action", {
        bubbles: true,
        composed: true,
        detail: { config: zoneActionConfig(zone), action },
      }),
    );
  }

  clearActionGesture() {
    if (this._actionGesture?.holdTimer) clearTimeout(this._actionGesture.holdTimer);
    this._actionGesture?.polygon?.classList?.remove("pressed");
    this._actionGesture = null;
  }

  clearPendingTap() {
    if (this._pendingTap?.timer) clearTimeout(this._pendingTap.timer);
    this._pendingTap = null;
  }

  beginZoneGesture(event, zone, svg, polygon) {
    if (this._pinch) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.clearActionGesture();
    const holdAction = effectiveAction(zone, "hold_action");
    const gesture = {
      pointerId: event.pointerId,
      zone,
      svg,
      polygon,
      startX: event.clientX,
      startY: event.clientY,
      startView: deepClone(this._view),
      moved: false,
      held: false,
      panning: false,
      holdTimer: null,
    };
    polygon.classList.add("pressed");
    if (actionEnabled(holdAction)) {
      gesture.holdTimer = setTimeout(() => {
        if (this._actionGesture !== gesture || gesture.moved || this._pinch) return;
        gesture.held = true;
        polygon.classList.remove("pressed");
        this.dispatchHassAction(zone, "hold");
      }, HOLD_DELAY);
    }
    this._actionGesture = gesture;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
  }

  moveZoneGesture(event) {
    const gesture = this._actionGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || this._pinch) return;
    const distance = Math.hypot(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    );
    if (distance > GESTURE_MOVE_THRESHOLD && !gesture.moved) {
      gesture.moved = true;
      gesture.panning = gesture.startView.scale > MIN_ZOOM + 0.001;
      gesture.polygon.classList.remove("pressed");
      if (gesture.holdTimer) {
        clearTimeout(gesture.holdTimer);
        gesture.holdTimer = null;
      }
    }
    if (gesture.panning) {
      event.preventDefault();
      this.setViewCenterFromPan(
        gesture.startView,
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
      );
    }
  }

  finishZoneGesture(event, cancelled = false) {
    const gesture = this._actionGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (gesture.holdTimer) clearTimeout(gesture.holdTimer);
    gesture.polygon.classList.remove("pressed");
    try {
      gesture.svg.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
    this._actionGesture = null;
    if (cancelled || gesture.moved || gesture.held || this._pinch) return;

    const doubleAction = effectiveAction(gesture.zone, "double_tap_action");
    if (!actionEnabled(doubleAction)) {
      if (actionEnabled(effectiveAction(gesture.zone, "tap_action"))) {
        this.dispatchHassAction(gesture.zone, "tap");
      }
      return;
    }

    const previous = this._pendingTap;
    if (previous && previous.zoneId === gesture.zone.id) {
      clearTimeout(previous.timer);
      this._pendingTap = null;
      this.dispatchHassAction(gesture.zone, "double_tap");
      return;
    }

    this.clearPendingTap();
    const zoneId = gesture.zone.id;
    const timer = setTimeout(() => {
      if (this._pendingTap?.timer !== timer) return;
      this._pendingTap = null;
      if (actionEnabled(effectiveAction(gesture.zone, "tap_action"))) {
        this.dispatchHassAction(gesture.zone, "tap");
      }
    }, DOUBLE_TAP_DELAY);
    this._pendingTap = { zoneId, timer };
  }

  beginBackgroundPan(event, svg) {
    if (this._pinch || this._view.scale <= MIN_ZOOM + 0.001) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this._backgroundPan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startView: deepClone(this._view),
      panned: false,
      svg,
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
  }

  moveBackgroundPan(event) {
    const gesture = this._backgroundPan;
    if (!gesture || gesture.pointerId !== event.pointerId || this._pinch) return;
    const distance = Math.hypot(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    );
    if (distance > PAN_MOVE_THRESHOLD) gesture.panned = true;
    if (!gesture.panned) return;
    event.preventDefault();
    this.setViewCenterFromPan(
      gesture.startView,
      gesture.startX,
      gesture.startY,
      event.clientX,
      event.clientY,
    );
  }

  finishBackgroundPan(event, cancelled = false) {
    const gesture = this._backgroundPan;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    try {
      gesture.svg.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
    this._backgroundPan = null;
    if (!cancelled && gesture.panned) {
      this.suppressClicksFor(120);
    }
    return gesture.panned;
  }

  startFocusAreaDrag(event, svg, rect) {
    if (this._pinch) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = this.pointerPoint(event, svg);
    this._focusAreaDrag = {
      pointerId: event.pointerId,
      start,
      rect,
      svg,
    };
    rect.setAttribute("x", String(start.x * SVG_SIZE));
    rect.setAttribute("y", String(start.y * SVG_SIZE));
    rect.setAttribute("width", "0");
    rect.setAttribute("height", "0");
    rect.classList.add("drawing");
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
  }

  updateFocusAreaDrag(event) {
    const drag = this._focusAreaDrag;
    if (!drag || drag.pointerId !== event.pointerId || this._pinch) return;
    event.preventDefault();
    const point = this.pointerPoint(event, drag.svg);
    const x = Math.min(drag.start.x, point.x);
    const y = Math.min(drag.start.y, point.y);
    const width = Math.abs(point.x - drag.start.x);
    const height = Math.abs(point.y - drag.start.y);
    drag.area = normalizeFocusArea({ x, y, width, height });
    drag.rect.setAttribute("x", String(x * SVG_SIZE));
    drag.rect.setAttribute("y", String(y * SVG_SIZE));
    drag.rect.setAttribute("width", String(width * SVG_SIZE));
    drag.rect.setAttribute("height", String(height * SVG_SIZE));
  }

  finishFocusAreaDrag(event, cancelled = false) {
    const drag = this._focusAreaDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    try {
      drag.svg.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
    this._focusAreaDrag = null;
    drag.rect.classList.remove("drawing");
    if (cancelled || this._pinch || !focusAreaValid(drag.area)) {
      this.render();
      return;
    }
    this.dispatchEditorEvent("floorplan-focus-area-commit", {
      area: normalizeFocusArea(drag.area),
    });
  }

  pointerPoint(event, svg) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  updateDragGeometry(point) {
    if (!this._drag) return;
    const { polygon, handles, midpointHandles, points, vertexIndex } = this._drag;
    points[vertexIndex] = normalizePoint(point);
    polygon.setAttribute("points", pointList(points));
    const handle = handles[vertexIndex];
    if (handle) {
      handle.setAttribute("cx", String(points[vertexIndex].x * SVG_SIZE));
      handle.setAttribute("cy", String(points[vertexIndex].y * SVG_SIZE));
    }
    const previousEdge = (vertexIndex - 1 + points.length) % points.length;
    const nextEdge = vertexIndex;
    for (const edgeIndex of [previousEdge, nextEdge]) {
      const midpointHandle = midpointHandles[edgeIndex];
      if (!midpointHandle) continue;
      const a = points[edgeIndex];
      const b = points[(edgeIndex + 1) % points.length];
      midpointHandle.setAttribute("cx", String(((a.x + b.x) / 2) * SVG_SIZE));
      midpointHandle.setAttribute("cy", String(((a.y + b.y) / 2) * SVG_SIZE));
    }
  }

  createZoomControls(container) {
    const controls = document.createElement("div");
    controls.className = "zoom-controls";

    const zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.dataset.zoom = "in";
    zoomIn.textContent = "+";
    zoomIn.setAttribute("aria-label", "Zoom in");
    zoomIn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.zoomAroundCenter(ZOOM_STEP);
    });

    const indicator = document.createElement("span");
    indicator.className = "zoom-indicator";
    indicator.textContent = `${Math.round(this._view.scale * 100)}%`;

    const zoomOut = document.createElement("button");
    zoomOut.type = "button";
    zoomOut.dataset.zoom = "out";
    zoomOut.textContent = "−";
    zoomOut.setAttribute("aria-label", "Zoom out");
    zoomOut.addEventListener("click", (event) => {
      event.stopPropagation();
      this.zoomAroundCenter(-ZOOM_STEP);
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.dataset.zoom = "reset";
    reset.textContent = "↺";
    reset.setAttribute("aria-label", "Reset zoom");
    reset.title = "Reset zoom";
    reset.addEventListener("click", (event) => {
      event.stopPropagation();
      this.resetView();
    });

    controls.append(zoomIn, indicator, zoomOut, reset);
    container.append(controls);
  }


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
          theme: activeFloorplanTheme(this._config, this._hass),
          zone_bounds: Object.fromEntries(
            (this._config?.zones ?? [])
              .filter(zoneUsesSvgObject)
              .map((zone) => {
                const bounds = entries.find((entry) => entry.id === zone.svg_element_id)?.bounds;
                return [zone.id, svgBoundsValid(bounds) ? normalizeSvgBounds(bounds) : null];
              })
              .filter(([, bounds]) => bounds),
          ),
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

    const configuredImage = activeImageSource(this._config, this._hass);
    if (!likelySvgSource(configuredImage, url, this._config?.zones ?? [])) {
      this._svgSourceStatus = "none";
      this.emitSvgSourceChanged();
      return;
    }

    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const explicitlySvg = /\.svg(?:$|[?#])/i.test(url) || /\.svg(?:$|[?#])/i.test(imageContentId(configuredImage));
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

  createSvgSourceLayer(transform) {
    if (!this._svgSource) return null;
    const layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add("svg-source-layer");
    // This SVG is a CSS-sized sibling of the floorplan image, not a nested
    // 1000x1000 viewport. Using the source viewBox and preserveAspectRatio on
    // the exact same rendered rectangle makes the browser apply the same
    // source-to-screen matrix to both the original SVG image and its zones.
    layer.setAttribute("viewBox", this._svgSource.viewBox);
    layer.setAttribute("preserveAspectRatio", this._svgSource.preserveAspectRatio);
    layer.setAttribute("pointer-events", "none");
    transform.append(layer);
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

  applyZoneVisualState(polygon, zone) {
    if (!polygon || !zone) return;
    const zoneStyle = stateStyle(this._hass, zone);
    const rawState = entityRawState(this._hass, zone.entity);
    const accessibleName = zone.name || zone.entity || zone.id || "Zone";
    const fillOpacity = zoneStyle.opacity ?? DEFAULT_FALLBACK_STYLE.opacity;
    const effect = STATE_EFFECTS.has(zoneStyle.effect) ? zoneStyle.effect : "none";
    const highlightBorder = zoneStyle.highlight_border === true;

    polygon.classList.remove("effect-pulse", "effect-blink", "highlight-border");
    polygon.setAttribute("fill", zoneStyle.color ?? DEFAULT_FALLBACK_STYLE.color);
    polygon.setAttribute("fill-opacity", String(fillOpacity));
    polygon.style.setProperty("--zone-fill-opacity", String(fillOpacity));
    polygon.style.setProperty(
      "--zone-effect-low-opacity",
      String(Math.max(0.02, fillOpacity * 0.35)),
    );
    if (effect !== "none") polygon.classList.add(`effect-${effect}`);

    if (highlightBorder) {
      polygon.classList.add("highlight-border");
      polygon.setAttribute("stroke", zoneStyle.color ?? DEFAULT_FALLBACK_STYLE.color);
      polygon.setAttribute(
        "stroke-width",
        String(Math.max(Number(zone.stroke?.width) || 0, HIGHLIGHT_BORDER_WIDTH)),
      );
    } else {
      polygon.setAttribute("stroke", zone.stroke?.color ?? "transparent");
      polygon.setAttribute("stroke-width", String(zone.stroke?.width ?? 0));
    }

    let title = polygon.querySelector("title");
    if (!title) {
      title = document.createElementNS(SVG_NS, "title");
      polygon.append(title);
    }
    title.textContent = `${accessibleName}${rawState !== undefined ? ` · ${rawState}` : ""}`;
  }

  updateZoneVisualStates() {
    const polygons = this.shadowRoot?.querySelectorAll(".zone[data-zone-id]");
    if (!polygons?.length) return;
    const configuredZones = this._config?.zones ?? [];
    const zonesById = new Map(
      configuredZones.filter((zone) => zone.id).map((zone) => [zone.id, zone]),
    );
    polygons.forEach((polygon, index) => {
      const zoneId = polygon.dataset.zoneId ?? "";
      const zone = (zoneId ? zonesById.get(zoneId) : undefined) ?? configuredZones[index];
      if (zone) this.applyZoneVisualState(polygon, zone);
    });
  }

  applyZoneLabelContent(element, zone) {
    if (!element || !zone) return;
    const lines = zoneLabelLines(this._hass, zone);
    const primary = element.querySelector(".zone-label-primary");
    const secondary = element.querySelector(".zone-label-secondary");
    if (primary) primary.textContent = lines[0] ?? "";
    if (secondary) {
      secondary.textContent = lines[1] ?? "";
      secondary.hidden = !lines[1];
    }
  }

  updateZoneLabels() {
    const labels = this.shadowRoot?.querySelectorAll(".zone-label-anchor[data-zone-id]");
    if (!labels?.length) return;
    const zonesById = new Map(
      (this._config?.zones ?? []).filter((zone) => zone.id).map((zone) => [zone.id, zone]),
    );
    labels.forEach((label) => {
      const zone = zonesById.get(label.dataset.zoneId ?? "");
      if (zone) this.applyZoneLabelContent(label, zone);
    });
  }

  beginLabelDrag(event, zone, anchor) {
    if (this._pinch || !zone?.id) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._labelDrag = {
      zoneId: zone.id,
      pointerId: event.pointerId,
      anchor,
      startPoint: zoneLabelPoint(zone),
    };
    anchor.classList.add("dragging");
    try {
      anchor.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
  }

  moveLabelDrag(event) {
    const drag = this._labelDrag;
    if (!drag || drag.pointerId !== event.pointerId || this._pinch) return;
    event.preventDefault();
    event.stopPropagation();
    const point = this.normalizedPointUnderClient(event.clientX, event.clientY);
    drag.anchor.style.left = `${point.x * 100}%`;
    drag.anchor.style.top = `${point.y * 100}%`;
  }

  finishLabelDrag(event, commit = true) {
    const drag = this._labelDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      drag.anchor.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional.
    }
    const point = commit && !this._pinch
      ? this.normalizedPointUnderClient(event.clientX, event.clientY)
      : drag.startPoint;
    drag.anchor.style.left = `${point.x * 100}%`;
    drag.anchor.style.top = `${point.y * 100}%`;
    drag.anchor.classList.remove("dragging");
    this._labelDrag = null;
    if (commit && !this._pinch) {
      this.dispatchEditorEvent("floorplan-label-position-commit", {
        zoneId: drag.zoneId,
        point: normalizePoint(point),
      });
    }
  }

  render() {
    if (!this.shadowRoot) return;
    this._drag = null;
    this.clearActionGesture();
    this._backgroundPan = null;
    this.shadowRoot.replaceChildren();

    const {
      interactive,
      mode,
      selectedZoneId,
      selectedVertexIndex,
      draftPoints,
      focusArea,
      labelZoneId,
    } = this._editorState;
    const imageConfigured = Boolean(imageContentId(activeImageSource(this._config, this._hass)));

    const style = document.createElement("style");
    style.textContent = `
      :host { display:block; }
      .canvas { position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius,12px); background:var(--secondary-background-color,#eee); touch-action:none; aspect-ratio:16/9; }
      .canvas.empty-canvas { min-height:220px; }
      .transform-layer { position:absolute; left:0; top:0; width:100%; height:100%; }
      .transform-layer.view-animated { transition:transform ${AUTO_ZOOM_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1),width ${AUTO_ZOOM_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1),height ${AUTO_ZOOM_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1); }
      .floorplan-image { display:block; width:100%; height:100%; image-rendering:auto; user-select:none; pointer-events:none; }
      .floorplan-overlay { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .svg-source-layer { position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
      .zone { vector-effect:non-scaling-stroke; transition:fill 160ms ease,fill-opacity 160ms ease,stroke 120ms ease,stroke-width 120ms ease,filter 80ms ease; }
      .svg-source-zone * { vector-effect:non-scaling-stroke; }
      .zone.effect-pulse { animation:zone-pulse 1.4s ease-in-out infinite; }
      .zone.effect-blink { animation:zone-blink 1s steps(1,end) infinite; }
      .zone.highlight-border { stroke-linejoin:round; stroke-linecap:round; }
      @keyframes zone-pulse {
        0%,100% { fill-opacity:var(--zone-fill-opacity); }
        50% { fill-opacity:var(--zone-effect-low-opacity); }
      }
      @keyframes zone-blink {
        0%,49% { fill-opacity:var(--zone-fill-opacity); }
        50%,99% { fill-opacity:.02; }
        100% { fill-opacity:var(--zone-fill-opacity); }
      }
      @media (prefers-reduced-motion: reduce) {
        .zone.effect-pulse,.zone.effect-blink { animation:none; }
      }
      .zone.actionable { cursor:pointer; pointer-events:auto; }
      .zone.actionable.pressed { filter:brightness(.88); }
      .zone.actionable:focus-visible { outline:none; stroke:var(--primary-color,#03a9f4)!important; stroke-width:4!important; }
      .zone.selectable { cursor:pointer; }
      .zone.selected { stroke:var(--primary-color,#03a9f4)!important; stroke-width:4!important; }
      .draft-line { fill:none; stroke:var(--primary-color,#03a9f4); stroke-width:4; vector-effect:non-scaling-stroke; pointer-events:none; }
      .draft-point,.vertex { fill:var(--primary-color,#03a9f4); stroke:var(--card-background-color,#fff); stroke-width:3; vector-effect:non-scaling-stroke; }
      .focus-area { fill:color-mix(in srgb,var(--primary-color,#03a9f4) 18%,transparent); stroke:var(--primary-color,#03a9f4); stroke-width:3; stroke-dasharray:14 10; vector-effect:non-scaling-stroke; pointer-events:none; }
      .focus-area.drawing { fill:color-mix(in srgb,var(--primary-color,#03a9f4) 28%,transparent); }
      .vertex.selected-vertex { fill:var(--warning-color,#ff9800); stroke-width:5; }
      .midpoint { fill:var(--card-background-color,#fff); stroke:var(--primary-color,#03a9f4); stroke-width:3; vector-effect:non-scaling-stroke; cursor:copy; }
      .draft-point { pointer-events:none; }
      .draft-point.close-target { pointer-events:auto; cursor:pointer; }
      .vertex { cursor:grab; }
      .vertex:active { cursor:grabbing; }
      .empty-message { position:absolute; inset:0; display:grid; place-items:center; padding:24px; box-sizing:border-box; text-align:center; color:var(--secondary-text-color,#727272); font-size:14px; pointer-events:none; }
      .draw-hint { position:absolute; left:12px; bottom:12px; z-index:4; padding:7px 10px; border-radius:8px; background:color-mix(in srgb,var(--card-background-color,#fff) 88%,transparent); color:var(--primary-text-color,#212121); font-size:12px; pointer-events:none; }
      .zoom-controls { position:absolute; top:10px; right:10px; z-index:5; display:flex; align-items:center; gap:4px; padding:4px; border-radius:10px; background:color-mix(in srgb,var(--card-background-color,#fff) 90%,transparent); box-shadow:0 1px 5px rgba(0,0,0,.18); }
      .zoom-controls button { width:34px; height:34px; padding:0; border:0; border-radius:7px; background:transparent; color:var(--primary-text-color,#212121); font:600 20px/1 sans-serif; cursor:pointer; }
      .zoom-controls button:hover:not(:disabled) { background:var(--secondary-background-color,#eee); }
      .zoom-controls button:disabled { opacity:.35; cursor:default; }
      .zoom-indicator { min-width:48px; text-align:center; color:var(--secondary-text-color,#727272); font-size:12px; font-weight:600; user-select:none; }
      .canvas.zoomed svg { cursor:grab; }
      .canvas.zoomed svg:active { cursor:grabbing; }
      .canvas.zoomed .zone.actionable { cursor:pointer; }
      .zone-label-layer { position:absolute; inset:0; pointer-events:none; }
      .zone-label-anchor { position:absolute; width:0; height:0; pointer-events:none; }
      .zone-label-box { position:absolute; left:0; top:0; transform:translate(-50%,-50%) scale(var(--label-counter-scale,1)); transform-origin:center; display:grid; justify-items:center; gap:1px; min-width:max-content; padding:3px 7px; border-radius:6px; box-sizing:border-box; font-family:var(--ha-card-header-font-family,var(--primary-font-family,sans-serif)); line-height:1.15; text-align:center; white-space:nowrap; user-select:none; transition:box-shadow 120ms ease,outline-color 120ms ease; }
      .transform-layer.view-animated .zone-label-box { transition:transform ${AUTO_ZOOM_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1),box-shadow 120ms ease,outline-color 120ms ease; }
      .zone-label-anchor.editable { pointer-events:auto; z-index:3; }
      .zone-label-anchor.editable .zone-label-box { cursor:grab; outline:2px dashed color-mix(in srgb,var(--primary-color,#03a9f4) 70%,transparent); outline-offset:3px; }
      .zone-label-anchor.dragging .zone-label-box { cursor:grabbing; box-shadow:0 2px 10px rgba(0,0,0,.28); }
      .zone-label-primary { font-size:1em; font-weight:inherit; }
      .zone-label-secondary { font-size:.78em; font-weight:500; }
    `;

    const container = document.createElement("div");
    container.className = "canvas";
    container.style.aspectRatio = this._imageAspectRatio
      ? String(this._imageAspectRatio)
      : "16 / 9";
    container.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    container.addEventListener("pointerdown", (event) => this.handleTouchPointerDownCapture(event), true);
    container.addEventListener("pointermove", (event) => this.handleTouchPointerMoveCapture(event), true);
    container.addEventListener("pointerup", (event) => this.handleTouchPointerEndCapture(event), true);
    container.addEventListener("pointercancel", (event) => this.handleTouchPointerEndCapture(event), true);

    const transform = document.createElement("div");
    transform.className = "transform-layer";

    if (this._resolvedImage) {
      const img = document.createElement("img");
      img.className = "floorplan-image";
      img.src = this._resolvedImage;
      img.alt = this._config?.title || "Floorplan";
      img.addEventListener("load", () => {
        if (img.naturalWidth && img.naturalHeight) {
          this._imageAspectRatio = img.naturalWidth / img.naturalHeight;
          container.style.aspectRatio = String(this._imageAspectRatio);
        }
        this.applyCurrentView();
      });
      transform.append(img);
    } else {
      container.classList.add("empty-canvas");
      transform.classList.add("empty");
      const message = document.createElement("div");
      message.className = "empty-message";
      message.textContent = imageConfigured
        ? "Loading floorplan image…"
        : interactive
          ? "Choose or upload a floorplan image, then draw zones on this canvas."
          : "Choose a floorplan image in the card editor.";
      transform.append(message);
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("floorplan-overlay");
    svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Floorplan zones");

    const sourceSvgLayer = this.createSvgSourceLayer(transform);

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
          this.beginZoneGesture(
            event,
            zone,
            svgObjectZone && sourceSvgLayer ? sourceSvgLayer : svg,
            polygon,
          );
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

    const labelsLayer = document.createElement("div");
    labelsLayer.className = "zone-label-layer";
    for (const zone of this._config?.zones ?? []) {
      const label = normalizeLabel(zone.label);
      const activeSvgBounds = zoneUsesSvgObject(zone)
        ? this.svgElementBounds(zone.svg_element_id) ?? zone.svg_bounds
        : null;
      const hasGeometry = zoneUsesSvgObject(zone)
        ? svgBoundsValid(activeSvgBounds)
        : Array.isArray(zone.points) && zone.points.length >= 3;
      if (!label.enabled || !hasGeometry) continue;
      const point = zoneLabelPoint(
        zoneUsesSvgObject(zone) ? { ...zone, svg_bounds: activeSvgBounds } : zone,
      );
      const anchor = document.createElement("div");
      anchor.className = "zone-label-anchor";
      anchor.dataset.zoneId = zone.id ?? "";
      anchor.style.left = `${point.x * 100}%`;
      anchor.style.top = `${point.y * 100}%`;

      const box = document.createElement("div");
      box.className = "zone-label-box";
      box.style.color = label.color;
      box.style.fontSize = `${label.size}px`;
      box.style.fontWeight = String(label.weight);
      box.style.background = label.background
        ? `color-mix(in srgb, ${label.background_color} ${Math.round(label.background_opacity * 100)}%, transparent)`
        : "transparent";

      const primary = document.createElement("span");
      primary.className = "zone-label-primary";
      primary.style.opacity = String(label.opacity);
      const secondary = document.createElement("span");
      secondary.className = "zone-label-secondary";
      secondary.style.opacity = String(label.opacity * 0.86);
      box.append(primary, secondary);
      anchor.append(box);
      this.applyZoneLabelContent(anchor, zone);

      if (interactive && mode === "label-position" && zone.id === labelZoneId) {
        anchor.classList.add("editable");
        anchor.addEventListener("pointerdown", (event) => this.beginLabelDrag(event, zone, anchor));
        anchor.addEventListener("pointermove", (event) => this.moveLabelDrag(event));
        anchor.addEventListener("pointerup", (event) => this.finishLabelDrag(event, true));
        anchor.addEventListener("pointercancel", (event) => this.finishLabelDrag(event, false));
      }
      labelsLayer.append(anchor);
    }
    transform.append(labelsLayer);

    if (interactive && mode === "label-position") {
      svg.addEventListener("click", (event) => {
        if (this.consumeSuppressedClick()) return;
        this.dispatchEditorEvent("floorplan-label-position-commit", {
          zoneId: labelZoneId,
          point: this.pointerPoint(event, svg),
        });
      });
      const hint = document.createElement("div");
      hint.className = "draw-hint";
      hint.textContent = "Click to place the label or drag the label itself · wheel/pinch zoom remains available";
      container.append(hint);
    }

    if (interactive && mode === "focus-area") {
      const area = focusArea ? normalizeFocusArea(focusArea) : null;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.classList.add("focus-area");
      if (area && focusAreaValid(area)) {
        rect.setAttribute("x", String(area.x * SVG_SIZE));
        rect.setAttribute("y", String(area.y * SVG_SIZE));
        rect.setAttribute("width", String(area.width * SVG_SIZE));
        rect.setAttribute("height", String(area.height * SVG_SIZE));
      } else {
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", "0");
        rect.setAttribute("height", "0");
      }
      svg.append(rect);
      svg.addEventListener("pointerdown", (event) => {
        if (event.target !== svg) return;
        this.startFocusAreaDrag(event, svg, rect);
      });
      svg.addEventListener("pointermove", (event) => this.updateFocusAreaDrag(event));
      svg.addEventListener("pointerup", (event) => this.finishFocusAreaDrag(event, false));
      svg.addEventListener("pointercancel", (event) => this.finishFocusAreaDrag(event, true));
      const hint = document.createElement("div");
      hint.className = "draw-hint";
      hint.textContent = "Drag a rectangle over the area to focus · wheel/pinch zoom remains available";
      container.append(hint);
    }

    if (interactive && mode === "draw") {
      if (draftPoints.length >= 2) {
        const line = document.createElementNS(SVG_NS, "polyline");
        line.classList.add("draft-line");
        line.setAttribute("points", pointList(draftPoints));
        svg.append(line);
      }
      draftPoints.forEach((point, index) => {
        const handle = document.createElementNS(SVG_NS, "circle");
        handle.classList.add("draft-point");
        handle.setAttribute("cx", String(point.x * SVG_SIZE));
        handle.setAttribute("cy", String(point.y * SVG_SIZE));
        const draftRadius = index === 0 && draftPoints.length >= 3 ? 14 : 9;
        handle.dataset.screenRadius = String(draftRadius);
        handle.setAttribute("r", String(draftRadius / this._view.scale));
        if (index === 0 && draftPoints.length >= 3) {
          handle.classList.add("close-target");
          handle.addEventListener("click", (event) => {
            event.stopPropagation();
            if (this.consumeSuppressedClick()) return;
            this.dispatchEditorEvent("floorplan-draw-close");
          });
        }
        svg.append(handle);
      });
      svg.addEventListener("click", (event) => {
        if (this.consumeSuppressedClick()) return;
        this.dispatchEditorEvent("floorplan-draw-point", {
          point: this.pointerPoint(event, svg),
        });
      });
      const hint = document.createElement("div");
      hint.className = "draw-hint";
      hint.textContent = draftPoints.length >= 3
        ? "Click the first point or Close polygon · drag empty space to pan when zoomed"
        : "Click to add points · drag empty space to pan when zoomed";
      container.append(hint);
    }

    svg.addEventListener("pointerdown", (event) => {
      if (mode === "focus-area" || event.target !== svg) return;
      this.beginBackgroundPan(event, svg);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!interactive) this.moveZoneGesture(event);
      this.moveBackgroundPan(event);
    });
    svg.addEventListener("pointerup", (event) => {
      if (!interactive) this.finishZoneGesture(event, false);
      this.finishBackgroundPan(event, false);
    });
    svg.addEventListener("pointercancel", (event) => {
      if (!interactive) this.finishZoneGesture(event, true);
      this.finishBackgroundPan(event, true);
    });

    // SVG-object zones live in a separate native-viewBox overlay. Capture and
    // finish their action/pan gestures on that overlay while empty areas pass
    // through to the normalized editor overlay beneath it.
    if (sourceSvgLayer) {
      sourceSvgLayer.addEventListener("pointermove", (event) => {
        if (!interactive) this.moveZoneGesture(event);
      });
      sourceSvgLayer.addEventListener("pointerup", (event) => {
        if (!interactive) this.finishZoneGesture(event, false);
      });
      sourceSvgLayer.addEventListener("pointercancel", (event) => {
        if (!interactive) this.finishZoneGesture(event, true);
      });
    }

    if (interactive && mode === "edit") {
      svg.addEventListener("pointermove", (event) => {
        if (!this._drag || this._drag.pointerId !== event.pointerId || this._pinch) return;
        event.preventDefault();
        this.updateDragGeometry(this.pointerPoint(event, svg));
      });
      const finishDrag = (event, commit) => {
        if (!this._drag || this._drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const drag = this._drag;
        if (commit && !this._pinch) {
          this.updateDragGeometry(this.pointerPoint(event, svg));
          this.dispatchEditorEvent("floorplan-vertex-commit", {
            zoneId: drag.zoneId,
            vertexIndex: drag.vertexIndex,
            points: drag.points.map(normalizePoint),
          });
        }
        try {
          svg.releasePointerCapture(event.pointerId);
        } catch (_error) {
          // Pointer capture is optional.
        }
        this._drag = null;
        if (!commit) this.render();
      };
      svg.addEventListener("pointerup", (event) => finishDrag(event, true));
      svg.addEventListener("pointercancel", (event) => finishDrag(event, false));
    }

    if (labelsLayer?.parentElement === transform) {
      transform.insertBefore(svg, labelsLayer);
      // Keep native SVG-object zones above the normalized polygon overlay so
      // their painted geometry can receive pointer events. The source SVG root
      // itself remains pointer-events:none, so empty space still reaches the
      // normalized overlay for drawing and background panning.
      if (sourceSvgLayer?.parentElement === transform) {
        transform.insertBefore(sourceSvgLayer, labelsLayer);
      }
    } else {
      transform.append(svg);
      if (sourceSvgLayer?.parentElement === transform) transform.append(sourceSvgLayer);
    }
    container.append(transform);
    if (imageConfigured || this._resolvedImage) this.createZoomControls(container);
    this.shadowRoot.append(style, container);
    requestAnimationFrame(() => this.applyCurrentView());
  }

  async refreshImage() {
    const configuredImage = activeImageSource(this._config, this._hass);
    const key = imageContentId(configuredImage);
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
      const resolved = await resolveImageSource(this._hass, configuredImage);
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

class FloorplanZoneCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = undefined;
    this._hass = undefined;
    this._viewState = normalizeViewState();
    this._activeAutoZoomIndex = null;
    this._autoZoomRestoreView = null;
    this._activeSvgBounds = new Map();
    this._activeImageKey = "";
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig() {
    return { image: undefined, zones: [] };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid Floorplan Zone Card configuration.");
    }
    this._config = normalizedConfig(config);
    this._activeAutoZoomIndex = null;
    this._autoZoomRestoreView = null;
    this._activeSvgBounds = new Map();
    this._activeImageKey = imageContentId(activeImageSource(this._config, this._hass));
    this.render();
  }

  set hass(hass) {
    const previousImageKey = this._activeImageKey;
    this._hass = hass;
    this._activeImageKey = imageContentId(activeImageSource(this._config, this._hass));
    if (previousImageKey && previousImageKey !== this._activeImageKey) {
      this._activeSvgBounds = new Map();
      this._activeAutoZoomIndex = null;
    }
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (canvas) {
      canvas.hass = hass;
      this.evaluateAutoZoom(canvas);
    }
  }

  evaluateAutoZoom(canvas) {
    if (!canvas || !this._config || !this._hass) return;
    const match = matchingAutoZoomRule(this._config, this._hass, this._activeSvgBounds);
    const previousIndex = this._activeAutoZoomIndex;

    if (match && previousIndex === match.index) return;

    if (match) {
      if (previousIndex === null) {
        this._autoZoomRestoreView = deepClone(this._viewState);
      }
      this._activeAutoZoomIndex = match.index;
      canvas.focusArea(match.area);
      return;
    }

    if (previousIndex === null) return;
    const previousRule = this._config.auto_zoom?.[previousIndex];
    const exitBehavior = previousRule?.exit_behavior ?? "previous";
    this._activeAutoZoomIndex = null;

    if (exitBehavior === "previous" && this._autoZoomRestoreView) {
      canvas.animateToView(this._autoZoomRestoreView);
    } else if (exitBehavior === "reset") {
      canvas.animateToView(normalizeViewState());
    }
    this._autoZoomRestoreView = null;
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 5;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.replaceChildren();
    const style = document.createElement("style");
    style.textContent = `
      :host { display:block; }
      ha-card { overflow:hidden; }
      .header { padding:16px 16px 0; color:var(--ha-card-header-color,var(--primary-text-color)); font-size:var(--ha-card-header-font-size,24px); line-height:1.2; }
      .content { padding:16px; }
      .header + .content { padding-top:12px; }
    `;
    const card = document.createElement("ha-card");
    if (this._config.title) {
      const header = document.createElement("div");
      header.className = "header";
      header.textContent = this._config.title;
      card.append(header);
    }
    const content = document.createElement("div");
    content.className = "content";
    const canvas = document.createElement(CANVAS_TAG);
    canvas.addEventListener("floorplan-view-changed", (event) => {
      this._viewState = normalizeViewState(event.detail?.viewState);
    });
    canvas.addEventListener("floorplan-svg-source-changed", (event) => {
      this._activeSvgBounds = new Map(
        Object.entries(event.detail?.zone_bounds ?? {}).map(([zoneId, bounds]) => [zoneId, bounds]),
      );
      this.evaluateAutoZoom(canvas);
    });
    canvas.viewState = this._viewState;
    canvas.config = this._config;
    canvas.hass = this._hass;
    content.append(canvas);
    card.append(content);
    this.shadowRoot.append(style, card);
    if (this._hass) {
      requestAnimationFrame(() => this.evaluateAutoZoom(canvas));
    }
  }
}

class FloorplanZoneCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = undefined;
    this._hass = undefined;
    this._mode = "select";
    this._selectedZoneId = null;
    this._selectedVertexIndex = null;
    this._draftPoints = [];
    this._focusRuleIndex = null;
    this._labelZoneId = null;
    this._viewState = normalizeViewState();
    this._svgElements = [];
    this._svgSourceError = "";
    this._selectedSvgElementId = "";
    this._haFormReadyListener = null;
    this._workspaceOpen = false;
    this._expandedZoneIds = new Set();
    this._themeCompatibilityWarnings = [];
    this._themeCompatibilityKey = "";
    this._themeCompatibilityToken = 0;
  }

  setConfig(config) {
    const previousImages = themeImageConfigKey(this._config);
    this._config = normalizedConfig(config);
    if (previousImages !== themeImageConfigKey(this._config)) {
      this._svgElements = [];
      this._svgSourceError = "";
      this._selectedSvgElementId = "";
    }
    const availableZoneIds = new Set(this._config.zones.map((zone) => zone.id));
    this._expandedZoneIds = new Set(
      [...this._expandedZoneIds].filter((zoneId) => availableZoneIds.has(zoneId)),
    );
    const selectedZone = this._config.zones.find((zone) => zone.id === this._selectedZoneId);
    if (!selectedZone) {
      this._selectedZoneId = null;
      this._selectedVertexIndex = null;
      if (this._mode === "edit" || this._mode === "label-position") this._mode = "select";
    } else if (
      this._selectedVertexIndex !== null &&
      this._selectedVertexIndex >= selectedZone.points.length
    ) {
      this._selectedVertexIndex = null;
    }
    if (this._labelZoneId && !this._config.zones.some((zone) => zone.id === this._labelZoneId)) {
      this._labelZoneId = null;
      if (this._mode === "label-position") this._mode = "select";
    }
    if (
      this._focusRuleIndex !== null &&
      !this._config.auto_zoom?.[this._focusRuleIndex]
    ) {
      this._focusRuleIndex = null;
      if (this._mode === "focus-area") this._mode = "select";
    }
    this.refreshThemeCompatibility();
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (canvas) canvas.hass = hass;
    this.shadowRoot?.querySelectorAll("ha-form").forEach((form) => { form.hass = hass; });
    this.refreshThemeCompatibility();
  }

  get hass() {
    return this._hass;
  }

  workspaceForcedOpen() {
    return this._mode !== "select";
  }

  setWorkspaceOpen(open) {
    this._workspaceOpen = Boolean(open);
    this.render();
  }

  toggleZoneExpanded(zoneId) {
    if (!zoneId) return;
    if (this._expandedZoneIds.has(zoneId)) this._expandedZoneIds.delete(zoneId);
    else this._expandedZoneIds.add(zoneId);
    this.render();
  }

  connectedCallback() {
    this.render();
    if (!customElements.get("ha-form") && !this._haFormReadyListener) {
      this._haFormReadyListener = true;
      customElements.whenDefined("ha-form").then(() => {
        this._haFormReadyListener = null;
        if (this.isConnected) this.render();
      });
    }
  }

  emitConfigChanged() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        bubbles: true,
        composed: true,
        detail: { config: deepClone(this._config) },
      }),
    );
  }

  canvasState() {
    return {
      interactive: true,
      mode: this._mode,
      selectedZoneId: this._selectedZoneId,
      selectedVertexIndex: this._selectedVertexIndex,
      draftPoints: this._draftPoints,
      focusArea: this._focusRuleIndex === null
        ? null
        : this._config?.auto_zoom?.[this._focusRuleIndex]?.area ?? null,
      labelZoneId: this._labelZoneId,
    };
  }

  configureCanvas(canvas) {
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
    if (
      boundsChanged &&
      (activeFloorplanTheme(this._config, this._hass) === "light" || !imageContentId(this._config?.image_dark))
    ) {
      this._config = { ...this._config, zones };
      this.emitConfigChanged();
    }

    if (previousCatalog !== nextCatalog || nextError !== (this._lastSvgSourceError ?? "") || boundsChanged) {
      this._lastSvgSourceError = nextError;
      this.render();
    }
  }

  async refreshThemeCompatibility() {
    const key = themeCompatibilityKey(this._config);
    const hasDarkImage = Boolean(imageContentId(this._config?.image_dark));
    if (!this._hass || !hasDarkImage) {
      const hadWarnings = this._themeCompatibilityWarnings.length > 0;
      this._themeCompatibilityKey = key;
      this._themeCompatibilityWarnings = [];
      if (hadWarnings && this.isConnected) this.render();
      return;
    }
    if (key === this._themeCompatibilityKey) return;
    this._themeCompatibilityKey = key;
    const token = ++this._themeCompatibilityToken;
    try {
      const [lightDescriptor, darkDescriptor] = await Promise.all([
        inspectSvgImage(this._hass, this._config?.image, this._config?.zones ?? []),
        inspectSvgImage(this._hass, this._config?.image_dark, this._config?.zones ?? []),
      ]);
      if (token !== this._themeCompatibilityToken || key !== this._themeCompatibilityKey) return;
      const warnings = dualThemeSvgWarnings(
        lightDescriptor,
        darkDescriptor,
        this._config?.zones ?? [],
      );
      if (JSON.stringify(warnings) !== JSON.stringify(this._themeCompatibilityWarnings)) {
        this._themeCompatibilityWarnings = warnings;
        if (this.isConnected) this.render();
      }
    } catch (error) {
      if (token !== this._themeCompatibilityToken || key !== this._themeCompatibilityKey) return;
      const warning = `Unable to compare light and dark SVG floorplans: ${error instanceof Error ? error.message : String(error)}`;
      if (this._themeCompatibilityWarnings.length !== 1 || this._themeCompatibilityWarnings[0] !== warning) {
        this._themeCompatibilityWarnings = [warning];
        if (this.isConnected) this.render();
      }
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
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zone.id);
    const used = this.usedSvgElementIds();
    this._selectedSvgElementId = this._svgElements.find((item) => !used.has(item.id))?.id ?? "";
    this.emitConfigChanged();
    this.render();
  }

  updatePreview() {
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (!canvas) return;
    this.configureCanvas(canvas);
  }

  updateConfig(patch, rerender = false) {
    this._config = { ...this._config, ...patch };
    this.emitConfigChanged();
    if (rerender) this.render();
    else this.updatePreview();
  }

  updateZone(index, updater, rerender = false) {
    const zones = deepClone(this._config?.zones ?? []);
    zones[index] = normalizeZone(updater(zones[index]));
    this.updateConfig({ zones }, rerender);
  }

  updateAutoZoomRule(index, updater, rerender = false) {
    const rules = deepClone(this._config?.auto_zoom ?? []);
    if (!rules[index]) return;
    rules[index] = normalizeAutoZoomRule(updater(rules[index]));
    this.updateConfig({ auto_zoom: rules }, rerender);
  }

  addAutoZoomRule() {
    const defaultZoneId = this._config?.zones?.[0]?.id ?? "";
    const rule = normalizeAutoZoomRule({
      entity: "",
      state: "on",
      target: defaultZoneId ? "zone" : "area",
      zone_id: defaultZoneId,
      exit_behavior: "previous",
    });
    this.updateConfig({ auto_zoom: [...(this._config.auto_zoom ?? []), rule] }, true);
  }

  moveAutoZoomRule(index, delta) {
    const rules = deepClone(this._config?.auto_zoom ?? []);
    const targetIndex = index + delta;
    if (index < 0 || index >= rules.length || targetIndex < 0 || targetIndex >= rules.length) return;
    [rules[index], rules[targetIndex]] = [rules[targetIndex], rules[index]];
    if (this._focusRuleIndex === index) this._focusRuleIndex = targetIndex;
    else if (this._focusRuleIndex === targetIndex) this._focusRuleIndex = index;
    this.updateConfig({ auto_zoom: rules }, true);
  }

  deleteAutoZoomRule(index) {
    const rules = (this._config?.auto_zoom ?? []).filter((_, ruleIndex) => ruleIndex !== index);
    if (this._focusRuleIndex === index) {
      this._focusRuleIndex = null;
      this._mode = "select";
    } else if (this._focusRuleIndex !== null && this._focusRuleIndex > index) {
      this._focusRuleIndex -= 1;
    }
    this.updateConfig({ auto_zoom: rules }, true);
  }

  startFocusAreaSelection(index) {
    if (!this._config?.auto_zoom?.[index]) return;
    this._focusRuleIndex = index;
    this._labelZoneId = null;
    this._mode = "focus-area";
    this._workspaceOpen = true;
    this._selectedZoneId = null;
    this._selectedVertexIndex = null;
    this._draftPoints = [];
    this.render();
  }

  cancelFocusAreaSelection() {
    this._focusRuleIndex = null;
    this._mode = "select";
    this.render();
  }

  commitFocusArea(area) {
    if (this._focusRuleIndex === null || !focusAreaValid(area)) return;
    const index = this._focusRuleIndex;
    this._focusRuleIndex = null;
    this._mode = "select";
    this.updateAutoZoomRule(index, (current) => ({
      ...current,
      target: "area",
      area: normalizeFocusArea(area),
    }), true);
  }

  selectZone(zoneId) {
    const zone = this._config?.zones?.find((item) => item.id === zoneId);
    if (!zone) return;
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = null;
    this._focusRuleIndex = null;
    this._labelZoneId = null;
    this._mode = zoneUsesSvgObject(zone) ? "select" : "edit";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zoneId);
    this._draftPoints = [];
    this.render();
  }

  startLabelPositioning(zoneId) {
    const zone = this._config?.zones?.find((item) => item.id === zoneId);
    if (!zone) return;
    this._labelZoneId = zoneId;
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = null;
    this._focusRuleIndex = null;
    this._draftPoints = [];
    this._mode = "label-position";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zoneId);
    const index = this._config.zones.findIndex((item) => item.id === zoneId);
    if (index >= 0 && normalizeLabel(zone.label).position_mode !== "custom") {
      this.updateZone(index, (current) => ({
        ...current,
        label: {
          ...normalizeLabel(current.label),
          position_mode: "custom",
          position: zoneLabelPoint(current),
        },
      }), true);
    } else {
      this.render();
    }
  }

  finishLabelPositioning() {
    this._labelZoneId = null;
    this._mode = "select";
    this.render();
  }

  commitLabelPosition(zoneId, point) {
    const index = this._config?.zones?.findIndex((zone) => zone.id === zoneId);
    if (index < 0 || !point) return;
    this._labelZoneId = zoneId;
    this._selectedZoneId = zoneId;
    this.updateZone(index, (current) => ({
      ...current,
      label: {
        ...normalizeLabel(current.label),
        enabled: true,
        position_mode: "custom",
        position: normalizePoint(point),
      },
    }));
  }

  startDrawing() {
    this._mode = "draw";
    this._workspaceOpen = true;
    this._focusRuleIndex = null;
    this._labelZoneId = null;
    this._selectedZoneId = null;
    this._selectedVertexIndex = null;
    this._draftPoints = [];
    this.render();
  }

  cancelDrawing() {
    this._mode = "select";
    this._draftPoints = [];
    this.render();
  }

  closeDrawing() {
    if (this._draftPoints.length < 3) return;
    const zone = createZone(this._draftPoints, this._config.zones);
    this._config = { ...this._config, zones: [...this._config.zones, zone] };
    this._draftPoints = [];
    this._selectedZoneId = zone.id;
    this._selectedVertexIndex = null;
    this._mode = "edit";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zone.id);
    this.emitConfigChanged();
    this.render();
  }

  commitVertices(zoneId, points, vertexIndex = null) {
    const index = this._config.zones.findIndex((zone) => zone.id === zoneId);
    if (index < 0 || !Array.isArray(points) || points.length < 3) return;
    const zones = deepClone(this._config.zones);
    zones[index] = { ...zones[index], points: points.map(normalizePoint) };
    this._config = { ...this._config, zones };
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = Number.isInteger(vertexIndex) ? vertexIndex : null;
    this.emitConfigChanged();
    this.updatePreview();
  }

  insertVertex(zoneId, afterIndex, point) {
    const zoneIndex = this._config.zones.findIndex((zone) => zone.id === zoneId);
    if (zoneIndex < 0 || !Number.isInteger(afterIndex)) return;
    const zones = deepClone(this._config.zones);
    const points = zones[zoneIndex].points ?? [];
    const insertIndex = Math.min(points.length, Math.max(0, afterIndex + 1));
    points.splice(insertIndex, 0, normalizePoint(point));
    zones[zoneIndex] = { ...zones[zoneIndex], points };
    this._config = { ...this._config, zones };
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = insertIndex;
    this._mode = "edit";
    this.emitConfigChanged();
    this.render();
  }

  deleteSelectedVertex() {
    if (this._selectedZoneId === null || this._selectedVertexIndex === null) return;
    const zoneIndex = this._config.zones.findIndex((zone) => zone.id === this._selectedZoneId);
    if (zoneIndex < 0) return;
    const zones = deepClone(this._config.zones);
    const points = zones[zoneIndex].points ?? [];
    if (points.length <= 3 || this._selectedVertexIndex >= points.length) return;
    points.splice(this._selectedVertexIndex, 1);
    zones[zoneIndex] = { ...zones[zoneIndex], points };
    this._config = { ...this._config, zones };
    this._selectedVertexIndex = null;
    this.emitConfigChanged();
    this.render();
  }

  createField(labelText, input) {
    const field = document.createElement("label");
    field.className = "field";
    const label = document.createElement("span");
    label.textContent = labelText;
    field.append(label, input);
    return field;
  }

  createTextInput(value, placeholder, onInput) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.placeholder = placeholder ?? "";
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  createNumberInput(value, min, max, step, onInput) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value ?? "");
    input.addEventListener("input", () => {
      const number = Number(input.value);
      if (Number.isFinite(number)) onInput(number);
    });
    return input;
  }

  createSelect(value, options, onChange) {
    const select = document.createElement("select");
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = value ?? "";
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  createCheckbox(labelText, checked, onChange) {
    const label = document.createElement("label");
    label.className = "checkbox-control";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange(input.checked));
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(input, text);
    return label;
  }

  createColorInput(value, onInput) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = value || DEFAULT_FALLBACK_STYLE.color;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  createOpacityControl(value, onInput) {
    const wrapper = document.createElement("div");
    wrapper.className = "opacity-control";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.05";
    input.value = String(clamp01(value));
    const output = document.createElement("span");
    output.textContent = `${Math.round(Number(input.value) * 100)}%`;
    input.addEventListener("input", () => {
      output.textContent = `${Math.round(Number(input.value) * 100)}%`;
      onInput(Number(input.value));
    });
    wrapper.append(input, output);
    return wrapper;
  }

  createButton(text, onClick, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (options.kind) button.classList.add(options.kind);
    if (options.compact) button.classList.add("compact");
    button.disabled = Boolean(options.disabled);
    button.addEventListener("click", onClick);
    return button;
  }

  createCardForm() {
    if (!customElements.get("ha-form")) {
      const wrapper = document.createElement("div");
      wrapper.className = "fallback-form";
      wrapper.append(
        this.createField("Title", this.createTextInput(this._config.title, "Optional title", (value) => this.updateConfig({ title: value }))),
        this.createField("Light / default floorplan URL", this.createTextInput(
          typeof this._config.image === "string" ? this._config.image : "",
          "/local/floorplan_light.svg",
          (value) => this.updateConfig({ image: value }),
        )),
        this.createField("Dark floorplan URL (optional)", this.createTextInput(
          typeof this._config.image_dark === "string" ? this._config.image_dark : "",
          "/local/floorplan_dark.svg",
          (value) => this.updateConfig({ image_dark: value }),
        )),
      );
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "If no dark floorplan is configured, the light/default floorplan is used for both Home Assistant themes.";
      wrapper.append(hint);
      return wrapper;
    }

    const form = document.createElement("ha-form");
    form.className = "native-form";
    form.hass = this._hass;
    const legacyImage = typeof this._config.image === "string" ? this._config.image : undefined;
    const legacyDarkImage = typeof this._config.image_dark === "string" ? this._config.image_dark : undefined;
    form.data = {
      title: this._config.title ?? "",
      image: legacyImage ? undefined : this._config.image,
      image_dark: legacyDarkImage ? undefined : this._config.image_dark,
    };
    form.schema = [
      { name: "title", selector: { text: {} } },
      { name: "image", selector: { media: { accept: ["image/*"], image_upload: true, clearable: true, hide_content_type: true } } },
      { name: "image_dark", selector: { media: { accept: ["image/*"], image_upload: true, clearable: true, hide_content_type: true } } },
    ];
    form.computeLabel = (schema) => {
      if (schema.name === "title") return "Title";
      if (schema.name === "image_dark") return "Dark floorplan (optional)";
      return "Light / default floorplan";
    };
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const value = event.detail?.value ?? {};
      const patch = { title: value.title ?? "" };
      if (legacyImage) {
        if (value.image) patch.image = value.image;
      } else {
        patch.image = value.image;
      }
      if (legacyDarkImage) {
        if (value.image_dark) patch.image_dark = value.image_dark;
      } else {
        patch.image_dark = value.image_dark;
      }
      this.updateConfig(patch);
      this.refreshThemeCompatibility();
    });

    const wrapper = document.createElement("div");
    wrapper.className = "native-form-wrapper";
    wrapper.append(form);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "The dark floorplan is optional. Home Assistant theme changes are applied automatically; without a dark image, the default floorplan is used for both themes.";
    wrapper.append(hint);
    if (legacyImage) {
      wrapper.append(this.createField("Legacy light/default image URL/path", this.createTextInput(
        legacyImage,
        "/local/floorplan_light.svg",
        (value) => this.updateConfig({ image: value }),
      )));
    }
    if (legacyDarkImage) {
      wrapper.append(this.createField("Legacy dark image URL/path", this.createTextInput(
        legacyDarkImage,
        "/local/floorplan_dark.svg",
        (value) => this.updateConfig({ image_dark: value }),
      )));
    }
    return wrapper;
  }

  createZoneMetadataForm(zone, index) {
    if (!customElements.get("ha-form")) {
      const grid = document.createElement("div");
      grid.className = "grid";
      grid.append(
        this.createField("Name", this.createTextInput(zone.name, "Zone name", (value) => this.updateZone(index, (current) => ({ ...current, name: value })))),
        this.createField("Entity", this.createTextInput(zone.entity, "sensor.example", (value) => this.updateZone(index, (current) => ({ ...current, entity: value })))),
      );
      return grid;
    }
    const form = document.createElement("ha-form");
    form.className = "native-form zone-native-form";
    form.hass = this._hass;
    form.data = { name: zone.name ?? "", entity: zone.entity || undefined };
    form.schema = [
      { name: "name", selector: { text: {} } },
      { name: "entity", selector: { entity: {} } },
    ];
    form.computeLabel = (schema) => (schema.name === "name" ? "Name" : "Entity");
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const value = event.detail?.value ?? {};
      this.updateZone(index, (current) => ({
        ...current,
        name: value.name ?? "",
        entity: value.entity ?? "",
      }));
    });
    return form;
  }


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

  createActionsEditor(zone, zoneIndex) {
    const section = document.createElement("div");
    section.className = "actions-editor";
    const heading = document.createElement("strong");
    heading.textContent = "Actions";
    section.append(heading);
    const description = document.createElement("p");
    description.className = "hint";
    description.textContent = "Configure standard Home Assistant tap, hold, and double-tap actions for this zone.";
    section.append(description);
    if (!customElements.get("ha-form")) {
      const fallback = document.createElement("p");
      fallback.className = "hint";
      fallback.textContent = "Home Assistant action controls are loading. They will appear automatically when ha-form is ready.";
      section.append(fallback);
      return section;
    }
    const form = document.createElement("ha-form");
    form.className = "native-form action-form";
    form.hass = this._hass;
    form.data = {
      tap_action: effectiveAction(zone, "tap_action"),
      hold_action: effectiveAction(zone, "hold_action"),
      double_tap_action: effectiveAction(zone, "double_tap_action"),
    };
    form.schema = [
      { name: "tap_action", selector: { ui_action: { default_action: "more-info" } } },
      { name: "hold_action", selector: { ui_action: { default_action: "none" } } },
      { name: "double_tap_action", selector: { ui_action: { default_action: "none" } } },
    ];
    form.computeLabel = (schema) => {
      if (schema.name === "tap_action") return "Tap action";
      if (schema.name === "hold_action") return "Hold action";
      if (schema.name === "double_tap_action") return "Double tap action";
      return "";
    };
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const value = event.detail?.value ?? {};
      this.updateZone(zoneIndex, (current) => ({
        ...current,
        tap_action: normalizeAction(value.tap_action) ?? { ...DEFAULT_NONE_ACTION },
        hold_action: normalizeAction(value.hold_action) ?? { ...DEFAULT_NONE_ACTION },
        double_tap_action: normalizeAction(value.double_tap_action) ?? { ...DEFAULT_NONE_ACTION },
      }));
    });
    section.append(form);
    return section;
  }

  createAutoZoomEditor() {
    const section = document.createElement("div");
    section.className = "auto-zoom-editor";

    const titleRow = document.createElement("div");
    titleRow.className = "section-title";
    const title = document.createElement("strong");
    title.textContent = "Auto zoom";
    const add = this.createButton("Add rule", () => this.addAutoZoomRule(), { compact: true });
    titleRow.append(title, add);
    section.append(titleRow);

    const description = document.createElement("p");
    description.className = "hint";
    description.textContent = "Focus the floorplan automatically when an entity reaches an exact raw state. If multiple rules match, the first rule in this list has priority.";
    section.append(description);

    const rules = this._config?.auto_zoom ?? [];
    if (!rules.length) {
      const empty = document.createElement("p");
      empty.className = "hint empty-rules";
      empty.textContent = "No auto-zoom rules configured.";
      section.append(empty);
      return section;
    }

    rules.forEach((rule, index) => {
      const card = document.createElement("section");
      card.className = "auto-zoom-card";
      if (this._mode === "focus-area" && this._focusRuleIndex === index) {
        card.classList.add("selected");
      }

      const header = document.createElement("div");
      header.className = "section-title";
      const name = document.createElement("strong");
      name.textContent = `Rule ${index + 1}`;
      const actions = document.createElement("div");
      actions.className = "toolbar";
      actions.append(
        this.createButton("↑", () => this.moveAutoZoomRule(index, -1), { compact: true, kind: "secondary", disabled: index === 0 }),
        this.createButton("↓", () => this.moveAutoZoomRule(index, 1), { compact: true, kind: "secondary", disabled: index === rules.length - 1 }),
        this.createButton("Delete", () => this.deleteAutoZoomRule(index), { compact: true, kind: "danger" }),
      );
      header.append(name, actions);
      card.append(header);

      if (customElements.get("ha-form")) {
        const form = document.createElement("ha-form");
        form.className = "native-form auto-zoom-native-form";
        form.hass = this._hass;
        form.data = { entity: rule.entity || undefined, state: rule.state ?? "" };
        form.schema = [
          { name: "entity", selector: { entity: {} } },
          { name: "state", selector: { text: {} } },
        ];
        form.computeLabel = (schema) => schema.name === "entity" ? "Entity" : "Trigger state";
        form.addEventListener("value-changed", (event) => {
          event.stopPropagation();
          const value = event.detail?.value ?? {};
          this.updateAutoZoomRule(index, (current) => ({
            ...current,
            entity: value.entity ?? "",
            state: value.state ?? "",
          }));
        });
        card.append(form);
      } else {
        const grid = document.createElement("div");
        grid.className = "grid";
        grid.append(
          this.createField("Entity", this.createTextInput(rule.entity, "binary_sensor.example", (value) => {
            this.updateAutoZoomRule(index, (current) => ({ ...current, entity: value }));
          })),
          this.createField("Trigger state", this.createTextInput(rule.state, "on", (value) => {
            this.updateAutoZoomRule(index, (current) => ({ ...current, state: value }));
          })),
        );
        card.append(grid);
      }

      const settings = document.createElement("div");
      settings.className = "grid";
      settings.append(
        this.createField("Focus target", this.createSelect(rule.target, [
          { value: "zone", label: "Existing zone" },
          { value: "area", label: "Custom area" },
        ], (value) => {
          this.updateAutoZoomRule(index, (current) => ({ ...current, target: value }), true);
        })),
        this.createField("After condition ends", this.createSelect(rule.exit_behavior, [
          { value: "previous", label: "Return to previous view" },
          { value: "reset", label: "Reset to 100%" },
          { value: "keep", label: "Keep current view" },
        ], (value) => {
          this.updateAutoZoomRule(index, (current) => ({ ...current, exit_behavior: value }));
        })),
      );
      card.append(settings);

      if (rule.target === "zone") {
        if ((this._config.zones?.length ?? 0) > 0) {
          const options = [
            { value: "", label: "Select a zone" },
            ...this._config.zones.map((zone, zoneIndex) => ({
              value: zone.id,
              label: zone.name || `Zone ${zoneIndex + 1}`,
            })),
          ];
          card.append(this.createField("Zone", this.createSelect(rule.zone_id, options, (value) => {
            this.updateAutoZoomRule(index, (current) => ({ ...current, zone_id: value }));
          })));
        } else {
          const warning = document.createElement("p");
          warning.className = "hint";
          warning.textContent = "Create a floorplan zone first, or switch this rule to Custom area.";
          card.append(warning);
        }
      } else {
        const areaRow = document.createElement("div");
        areaRow.className = "focus-area-row";
        const areaText = document.createElement("span");
        areaText.className = "hint";
        areaText.textContent = focusAreaValid(rule.area)
          ? `Area: ${Math.round(rule.area.x * 100)}%, ${Math.round(rule.area.y * 100)}% · ${Math.round(rule.area.width * 100)}% × ${Math.round(rule.area.height * 100)}%`
          : "No custom area selected yet.";
        const selectArea = this.createButton(
          focusAreaValid(rule.area) ? "Redraw area" : "Select area",
          () => this.startFocusAreaSelection(index),
          { kind: "secondary", compact: true },
        );
        areaRow.append(areaText, selectArea);
        card.append(areaRow);
      }

      const validationIssues = autoZoomRuleValidation(this._config, rule);
      if (validationIssues.length) {
        const warning = document.createElement("p");
        warning.className = "validation-warning";
        warning.textContent = validationIssues.join(" ");
        card.append(warning);
      }

      const current = entityRawState(this._hass, rule.entity);
      const status = document.createElement("p");
      status.className = "hint";
      status.textContent = rule.entity
        ? `Current raw state: ${current ?? "not available"}${current === rule.state ? " · condition matches" : ""}.`
        : "Choose an entity and enter the exact raw state that should trigger this focus rule.";
      card.append(status);
      section.append(card);
    });

    return section;
  }

  createLabelEditor(zone, zoneIndex) {
    const label = normalizeLabel(zone.label);
    const section = document.createElement("div");
    section.className = "label-editor";

    const heading = document.createElement("strong");
    heading.textContent = "Zone label";
    section.append(heading);
    section.append(this.createCheckbox("Show label", label.enabled, (enabled) => {
      this.updateZone(zoneIndex, (current) => ({
        ...current,
        label: { ...normalizeLabel(current.label), enabled },
      }), true);
    }));

    if (!label.enabled) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Enable the label to show the zone name, custom text, or the zone name with the entity state.";
      section.append(hint);
      return section;
    }

    const contentGrid = document.createElement("div");
    contentGrid.className = "grid";
    contentGrid.append(
      this.createField("Content", this.createSelect(label.content, [
        { value: "name", label: "Zone name" },
        { value: "custom", label: "Custom text" },
        { value: "name_state", label: "Zone name + entity state" },
      ], (content) => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: { ...normalizeLabel(current.label), content },
        }), true);
      })),
      this.createField("Position", this.createSelect(label.position_mode, [
        { value: "auto", label: "Automatic center" },
        { value: "custom", label: "Custom position" },
      ], (positionMode) => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: {
            ...normalizeLabel(current.label),
            position_mode: positionMode,
            position: positionMode === "custom"
              ? normalizeLabel(current.label).position ?? zoneLabelPoint(current)
              : normalizeLabel(current.label).position,
          },
        }), true);
      })),
    );
    section.append(contentGrid);

    if (label.content === "custom") {
      section.append(this.createField("Custom text", this.createTextInput(
        label.text,
        zone.name || "Zone label",
        (text) => this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: { ...normalizeLabel(current.label), text },
        })),
      )));
    }

    if (label.position_mode === "custom") {
      const positionRow = document.createElement("div");
      positionRow.className = "label-position-row";
      const point = zoneLabelPoint(zone);
      const positionText = document.createElement("span");
      positionText.className = "hint";
      positionText.textContent = `Position: ${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%`;
      positionRow.append(
        positionText,
        this.createButton(
          this._mode === "label-position" && this._labelZoneId === zone.id
            ? "Positioning…"
            : "Place label",
          () => this.startLabelPositioning(zone.id),
          { kind: "secondary", compact: true },
        ),
      );
      section.append(positionRow);
    }

    const styleGrid = document.createElement("div");
    styleGrid.className = "label-style-grid";
    styleGrid.append(
      this.createField("Text color", this.createColorInput(label.color, (color) => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: { ...normalizeLabel(current.label), color },
        }));
      })),
      this.createField("Font size", this.createNumberInput(label.size, 8, 72, 1, (size) => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: { ...normalizeLabel(current.label), size },
        }));
      })),
      this.createField("Font weight", this.createSelect(String(label.weight), [
        { value: "400", label: "Normal" },
        { value: "500", label: "Medium" },
        { value: "600", label: "Semibold" },
        { value: "700", label: "Bold" },
      ], (weight) => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: { ...normalizeLabel(current.label), weight: Number(weight) },
        }));
      })),
      this.createField("Text opacity", this.createOpacityControl(label.opacity, (opacity) => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          label: { ...normalizeLabel(current.label), opacity },
        }));
      })),
    );
    section.append(styleGrid);

    section.append(this.createCheckbox("Background", label.background, (background) => {
      this.updateZone(zoneIndex, (current) => ({
        ...current,
        label: { ...normalizeLabel(current.label), background },
      }), true);
    }));
    if (label.background) {
      const backgroundGrid = document.createElement("div");
      backgroundGrid.className = "label-style-grid";
      backgroundGrid.append(
        this.createField("Background color", this.createColorInput(label.background_color, (backgroundColor) => {
          this.updateZone(zoneIndex, (current) => ({
            ...current,
            label: { ...normalizeLabel(current.label), background_color: backgroundColor },
          }));
        })),
        this.createField("Background opacity", this.createOpacityControl(label.background_opacity, (backgroundOpacity) => {
          this.updateZone(zoneIndex, (current) => ({
            ...current,
            label: { ...normalizeLabel(current.label), background_opacity: backgroundOpacity },
          }));
        })),
      );
      section.append(backgroundGrid);
    }

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = label.content === "name_state"
      ? "The displayed state updates live and includes the Home Assistant unit of measurement when available."
      : "Labels remain readable while zooming and stay independent from zone pulse/blink effects.";
    section.append(hint);
    return section;
  }

  createStateRulesEditor(zone, zoneIndex) {
    const section = document.createElement("div");
    section.className = "state-rules";
    const headingRow = document.createElement("div");
    headingRow.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "State styles";
    const add = this.createButton("Add state", () => {
      this.updateZone(zoneIndex, (current) => ({
        ...current,
        states: [...(current.states ?? []), { value: "", ...DEFAULT_FALLBACK_STYLE, effect: "none", highlight_border: false }],
      }), true);
    }, { compact: true });
    headingRow.append(heading, add);
    section.append(headingRow);
    const description = document.createElement("p");
    description.className = "hint";
    description.textContent = "Match the entity raw state exactly, then choose its color, opacity, visual effect and optional active border. The live preview uses the entity's current raw state.";
    section.append(description);
    const validation = stateRuleValidation(zone.states ?? []);
    if (validation.duplicateValues.length) {
      const warning = document.createElement("p");
      warning.className = "validation-warning";
      warning.textContent = `Duplicate state values detected (${validation.duplicateValues.map((value) => value || "empty").join(", ")}). The first matching rule wins.`;
      section.append(warning);
    }
    if (!(zone.states?.length ?? 0)) {
      const empty = document.createElement("p");
      empty.className = "hint empty-rules";
      empty.textContent = "No state rules yet. The fallback style will be used for every available state.";
      section.append(empty);
    }
    (zone.states ?? []).forEach((rule, ruleIndex) => {
      const item = document.createElement("div");
      item.className = "state-rule-item";
      const row = document.createElement("div");
      row.className = "state-rule-row";
      const ruleWarnings = [];
      if (validation.emptyIndexes.includes(ruleIndex)) {
        ruleWarnings.push("State value is empty and is unlikely to match a Home Assistant entity state.");
      }
      if (validation.duplicateIndexes.includes(ruleIndex)) {
        ruleWarnings.push("This state value is duplicated; only the first matching rule is used.");
      }
      if (validation.reservedIndexes.includes(ruleIndex)) {
        ruleWarnings.push(`"${rule.value}" always uses the dedicated Unavailable / unknown style, so this rule cannot be reached.`);
      }
      if (ruleWarnings.length) row.classList.add("has-warning");

      const valueInput = this.createTextInput(rule.value, "State value", (value) => {
        this.updateZone(zoneIndex, (current) => {
          const states = deepClone(current.states ?? []);
          states[ruleIndex] = { ...states[ruleIndex], value };
          return { ...current, states };
        });
      });
      valueInput.setAttribute("aria-label", "State value");
      valueInput.classList.add("state-value-input");
      if (ruleWarnings.length) {
        valueInput.setAttribute("aria-invalid", "true");
        valueInput.title = ruleWarnings.join(" ");
      }
      valueInput.addEventListener("change", () => this.render());
      const colorInput = this.createColorInput(rule.color, (value) => {
        this.updateZone(zoneIndex, (current) => {
          const states = deepClone(current.states ?? []);
          states[ruleIndex] = { ...states[ruleIndex], color: value };
          return { ...current, states };
        });
      });
      colorInput.setAttribute("aria-label", "State color");
      const opacity = this.createOpacityControl(rule.opacity, (value) => {
        this.updateZone(zoneIndex, (current) => {
          const states = deepClone(current.states ?? []);
          states[ruleIndex] = { ...states[ruleIndex], opacity: value };
          return { ...current, states };
        });
      });
      const effect = this.createSelect(rule.effect ?? "none", [
        { value: "none", label: "No effect" },
        { value: "pulse", label: "Pulse" },
        { value: "blink", label: "Blink" },
      ], (value) => {
        this.updateZone(zoneIndex, (current) => {
          const states = deepClone(current.states ?? []);
          states[ruleIndex] = { ...states[ruleIndex], effect: value };
          return { ...current, states };
        });
      });
      effect.setAttribute("aria-label", "State visual effect");
      const highlightBorder = this.createCheckbox(
        "Highlight border",
        rule.highlight_border === true,
        (value) => {
          this.updateZone(zoneIndex, (current) => {
            const states = deepClone(current.states ?? []);
            states[ruleIndex] = { ...states[ruleIndex], highlight_border: value };
            return { ...current, states };
          });
        },
      );
      const remove = this.createButton("Delete", () => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          states: (current.states ?? []).filter((_, index) => index !== ruleIndex),
        }), true);
      }, { kind: "danger", compact: true });
      remove.classList.add("state-rule-delete");
      row.append(valueInput, colorInput, opacity, effect, highlightBorder, remove);
      item.append(row);
      if (ruleWarnings.length) {
        const warning = document.createElement("p");
        warning.className = "validation-warning rule-warning";
        warning.textContent = ruleWarnings.join(" ");
        item.append(warning);
      }
      section.append(item);
    });
    const styleGrid = document.createElement("div");
    styleGrid.className = "style-grid";
    styleGrid.append(
      this.createStyleBox("Fallback", zone.default ?? DEFAULT_FALLBACK_STYLE, (patch) => {
        this.updateZone(zoneIndex, (current) => ({ ...current, default: { ...current.default, ...patch } }));
      }),
      this.createStyleBox("Unavailable / unknown", zone.unavailable ?? DEFAULT_UNAVAILABLE_STYLE, (patch) => {
        this.updateZone(zoneIndex, (current) => ({ ...current, unavailable: { ...current.unavailable, ...patch } }));
      }),
    );
    section.append(styleGrid);
    return section;
  }

  createStyleBox(titleText, styleValue, onChange) {
    const box = document.createElement("div");
    box.className = "style-box";
    const title = document.createElement("span");
    title.className = "style-box-title";
    title.textContent = titleText;
    const controls = document.createElement("div");
    controls.className = "style-controls";
    controls.append(
      this.createColorInput(styleValue.color, (color) => onChange({ color })),
      this.createOpacityControl(styleValue.opacity, (opacity) => onChange({ opacity })),
    );
    box.append(title, controls);
    return box;
  }

  render() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.replaceChildren();
    const style = document.createElement("style");
    style.textContent = `
      :host { display:block; max-width:100%; overflow-x:clip; container-type:inline-size; }
      *,*::before,*::after { box-sizing:border-box; min-width:0; }
      .editor,.zones,.zone-card,.field,.preview,.fallback-form,.native-form-wrapper,.state-rules,.style-box,.actions-editor,.label-editor,.auto-zoom-editor,.auto-zoom-card,.svg-geometry-editor,.zone-card-body,.workspace-body,.add-zone-card { display:grid; gap:10px; }
      .editor { gap:16px; width:100%; max-width:100%; overflow:hidden; }
      .editor > * { width:100%; max-width:100%; }
      .field > span,.style-box-title { color:var(--primary-text-color); font-size:14px; font-weight:500; }
      input,select { box-sizing:border-box; width:100%; max-width:100%; min-height:42px; padding:8px 12px; border:1px solid var(--divider-color,#c7c7c7); border-radius:8px; background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121); font:inherit; }
      input[type="color"] { width:54px; min-width:54px; padding:4px; }
      input[type="range"] { min-height:auto; padding:0; border:0; }
      input[type="checkbox"] { width:18px; min-width:18px; min-height:18px; padding:0; margin:0; accent-color:var(--primary-color,#03a9f4); }
      button { max-width:100%; min-height:40px; padding:8px 14px; border:0; border-radius:8px; background:var(--primary-color,#03a9f4); color:var(--text-primary-color,#fff); cursor:pointer; font:inherit; font-weight:500; }
      button.compact { min-height:34px; padding:6px 10px; font-size:13px; }
      button.secondary { background:transparent; color:var(--primary-color,#03a9f4); border:1px solid var(--primary-color,#03a9f4); }
      button.danger { background:transparent; color:var(--error-color,#db4437); border:1px solid var(--error-color,#db4437); }
      button:disabled { opacity:.45; cursor:default; }
      .section-title,.toolbar,.workspace-header,.zone-card-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .section-title > strong { font-size:15px; }
      .toolbar { justify-content:flex-start; flex-wrap:wrap; }
      .section-panel { border:1px solid var(--divider-color,#d0d0d0); border-radius:12px; background:var(--card-background-color,#fff); }
      .workspace { position:relative; overflow:hidden; }
      .workspace-header { padding:12px 14px; background:color-mix(in srgb,var(--secondary-background-color,#eee) 45%,transparent); }
      .workspace-heading { display:grid; gap:3px; }
      .workspace-heading strong { font-size:15px; }
      .workspace-heading .hint { font-size:12px; }
      .workspace-header-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
      .workspace-body { padding:0 14px 14px; }
      .workspace-body.collapsed { height:0; max-height:0; overflow:hidden; visibility:hidden; pointer-events:none; padding-top:0; padding-bottom:0; }
      .mode-status { padding:6px 9px; border-radius:999px; background:var(--secondary-background-color,#eee); color:var(--secondary-text-color,#727272); font-size:12px; white-space:nowrap; }
      .zones,.auto-zoom-editor { padding:14px; }
      .zone-count { color:var(--secondary-text-color,#727272); font-size:12px; font-weight:500; }
      .add-zone-card { padding:12px; border:1px dashed var(--divider-color,#c8c8c8); border-radius:10px; background:color-mix(in srgb,var(--secondary-background-color,#eee) 25%,transparent); }
      .add-zone-header { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
      .add-zone-header strong { font-size:14px; }
      .zone-card { padding:0; border:1px solid var(--divider-color,#d0d0d0); border-radius:10px; gap:0; overflow:hidden; }
      .zone-card.selected { border-color:var(--primary-color,#03a9f4); box-shadow:inset 0 0 0 1px var(--primary-color,#03a9f4); }
      .zone-card-header { padding:10px 12px; background:color-mix(in srgb,var(--secondary-background-color,#eee) 32%,transparent); }
      .zone-heading { display:flex; align-items:center; gap:8px; min-width:0; flex:1 1 auto; }
      button.zone-toggle { display:grid; grid-template-columns:auto minmax(0,1fr); gap:7px; align-items:center; min-height:32px; padding:4px 6px; border:0; background:transparent; color:var(--primary-text-color,#212121); text-align:left; flex:1 1 auto; }
      button.zone-toggle:hover { background:var(--secondary-background-color,#eee); }
      .zone-chevron { color:var(--secondary-text-color,#727272); font-size:14px; }
      .zone-title-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
      .zone-summary { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--secondary-text-color,#727272); font-size:11px; margin-top:1px; }
      .zone-card-body { padding:12px; gap:14px; border-top:1px solid var(--divider-color,#ddd); }
      .native-form,.action-form { display:block; max-width:100%; }
      .zone-native-form { margin-top:2px; }
      .grid,.style-grid,.label-style-grid,.svg-zone-add-row { display:grid; grid-template-columns:1fr; gap:12px; }
      .state-rules,.actions-editor,.label-editor,.svg-geometry-editor { padding-top:10px; border-top:1px solid var(--divider-color,#ddd); }
      .svg-zone-add-row { align-items:end; }
      .auto-zoom-editor { gap:12px; }
      .auto-zoom-card { padding:12px; border:1px solid var(--divider-color,#ddd); border-radius:9px; background:color-mix(in srgb,var(--secondary-background-color,#eee) 18%,transparent); }
      .auto-zoom-card.selected { border-color:var(--primary-color,#03a9f4); box-shadow:inset 0 0 0 1px var(--primary-color,#03a9f4); }
      .focus-area-row,.label-position-row { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .state-rule-item { display:grid; gap:6px; }
      .state-rule-row { display:grid; grid-template-columns:minmax(0,1fr) 54px; gap:10px; align-items:center; padding:8px; border:1px solid var(--divider-color,#e0e0e0); border-radius:8px; }
      .state-rule-row .opacity-control,.state-rule-row select,.state-rule-row .checkbox-control { grid-column:1/-1; }
      .state-rule-delete { grid-column:1/-1; justify-self:end; }
      .state-rule-row.has-warning { border-color:var(--warning-color,#f57c00); background:color-mix(in srgb,var(--warning-color,#f57c00) 7%,transparent); }
      .checkbox-control { display:flex; align-items:center; gap:7px; min-height:42px; color:var(--primary-text-color,#212121); font-size:13px; white-space:normal; cursor:pointer; }
      .opacity-control { display:grid; grid-template-columns:minmax(0,1fr) 42px; gap:8px; align-items:center; }
      .opacity-control > span { color:var(--secondary-text-color,#727272); font-size:12px; text-align:right; }
      .style-box { padding:10px; border:1px solid var(--divider-color,#ddd); border-radius:8px; }
      .style-controls { display:grid; grid-template-columns:54px minmax(0,1fr); gap:10px; align-items:center; }
      .hint { margin:0; color:var(--secondary-text-color,#727272); font-size:13px; line-height:1.45; overflow-wrap:anywhere; }
      .validation-warning { margin:0; color:var(--warning-color,#f57c00); font-size:12px; line-height:1.45; font-weight:500; overflow-wrap:anywhere; }
      .rule-warning { padding:0 6px; }
      .empty-rules { font-style:italic; }
      @container (min-width:600px) {
        .grid,.style-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .svg-zone-add-row { grid-template-columns:minmax(0,1fr) auto; }
      }
      @container (min-width:760px) {
        .label-style-grid { grid-template-columns:54px minmax(120px,.7fr) minmax(130px,.9fr) minmax(160px,1.2fr); align-items:end; }
        .state-rule-row { grid-template-columns:minmax(110px,1fr) 54px minmax(140px,1fr) minmax(110px,.7fr) auto auto; border-color:transparent; padding:6px; }
        .state-rule-row .opacity-control,.state-rule-row select,.state-rule-row .checkbox-control { grid-column:auto; }
        .state-rule-delete { grid-column:auto; justify-self:stretch; }
      }
      @container (max-width:520px) {
        .section-title,.workspace-header,.zone-card-header { align-items:flex-start; }
        .workspace-header,.zone-card-header { flex-wrap:wrap; }
        .workspace-header-actions,.zone-card-header > .toolbar { width:100%; justify-content:flex-start; }
        .focus-area-row,.label-position-row { align-items:flex-start; }
      }
    `;

    const editor = document.createElement("div");
    editor.className = "editor";
    editor.append(this.createCardForm());
    if (this._themeCompatibilityWarnings.length) {
      const warningBox = document.createElement("div");
      warningBox.className = "theme-compatibility-warnings";
      this._themeCompatibilityWarnings.forEach((message) => {
        const warning = document.createElement("p");
        warning.className = "validation-warning";
        warning.textContent = message;
        warningBox.append(warning);
      });
      editor.append(warningBox);
    }

    const workspace = document.createElement("section");
    workspace.className = "workspace section-panel";
    const forcedWorkspace = this.workspaceForcedOpen();
    const workspaceOpen = this._workspaceOpen || forcedWorkspace;
    if (!workspaceOpen) workspace.classList.add("collapsed");

    const workspaceHeader = document.createElement("div");
    workspaceHeader.className = "workspace-header";
    const workspaceHeading = document.createElement("div");
    workspaceHeading.className = "workspace-heading";
    const previewHeading = document.createElement("strong");
    previewHeading.textContent = "Floorplan workspace";
    const workspaceHint = document.createElement("span");
    workspaceHint.className = "hint";
    const themeLabel = activeFloorplanTheme(this._config, this._hass) === "dark"
      ? "Dark floorplan"
      : "Light / default floorplan";
    workspaceHint.textContent = `${themeLabel} · Open only when you need to draw, edit, position labels, or select focus areas.`;
    workspaceHeading.append(previewHeading, workspaceHint);

    const workspaceHeaderActions = document.createElement("div");
    workspaceHeaderActions.className = "workspace-header-actions";
    const status = document.createElement("span");
    status.className = "mode-status";
    if (this._mode === "draw") {
      status.textContent = `Drawing · ${this._draftPoints.length} point${this._draftPoints.length === 1 ? "" : "s"}`;
    } else if (this._mode === "focus-area") {
      status.textContent = `Auto zoom · Rule ${(this._focusRuleIndex ?? 0) + 1}`;
    } else if (this._mode === "label-position") {
      const zone = this._config.zones.find((item) => item.id === this._labelZoneId);
      status.textContent = `Label · ${zone?.name || "Zone"}`;
    } else if (this._mode === "edit") {
      const zone = this._config.zones.find((item) => item.id === this._selectedZoneId);
      status.textContent = this._selectedVertexIndex === null
        ? `Shape · ${zone?.name || "Zone"}`
        : `Vertex ${this._selectedVertexIndex + 1}`;
    } else {
      const selected = this._config.zones.find((item) => item.id === this._selectedZoneId);
      status.textContent = zoneUsesSvgObject(selected)
        ? `SVG · #${selected.svg_element_id}`
        : "Ready";
    }
    const workspaceToggle = this.createButton(
      forcedWorkspace ? "Workspace in use" : workspaceOpen ? "Hide workspace" : "Open workspace",
      () => this.setWorkspaceOpen(!workspaceOpen),
      { kind: "secondary", compact: true, disabled: forcedWorkspace },
    );
    workspaceHeaderActions.append(status, workspaceToggle);
    workspaceHeader.append(workspaceHeading, workspaceHeaderActions);

    const preview = document.createElement("div");
    preview.className = "preview workspace-body";
    if (!workspaceOpen) preview.classList.add("collapsed");

    const canvas = document.createElement(CANVAS_TAG);
    this.configureCanvas(canvas);
    canvas.addEventListener("floorplan-zone-select", (event) => this.selectZone(event.detail.zoneId));
    canvas.addEventListener("floorplan-draw-point", (event) => {
      if (this._mode !== "draw") return;
      this._draftPoints = [...this._draftPoints, normalizePoint(event.detail.point)];
      this.render();
    });
    canvas.addEventListener("floorplan-draw-close", () => this.closeDrawing());
    canvas.addEventListener("floorplan-vertex-commit", (event) => {
      this.commitVertices(event.detail.zoneId, event.detail.points, event.detail.vertexIndex);
    });
    canvas.addEventListener("floorplan-vertex-insert", (event) => {
      this.insertVertex(event.detail.zoneId, event.detail.afterIndex, event.detail.point);
    });
    canvas.addEventListener("floorplan-focus-area-commit", (event) => {
      this.commitFocusArea(event.detail.area);
    });
    canvas.addEventListener("floorplan-label-position-commit", (event) => {
      this.commitLabelPosition(event.detail.zoneId, event.detail.point);
    });
    preview.append(canvas);

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    if (this._mode === "draw") {
      toolbar.append(
        this.createButton("Undo point", () => {
          this._draftPoints = this._draftPoints.slice(0, -1);
          this.render();
        }, { kind: "secondary", disabled: this._draftPoints.length === 0 }),
        this.createButton("Close polygon", () => this.closeDrawing(), { disabled: this._draftPoints.length < 3 }),
        this.createButton("Cancel", () => this.cancelDrawing(), { kind: "danger" }),
      );
    } else if (this._mode === "focus-area") {
      toolbar.append(
        this.createButton("Cancel area selection", () => this.cancelFocusAreaSelection(), { kind: "danger" }),
      );
    } else if (this._mode === "label-position") {
      toolbar.append(
        this.createButton("Done positioning", () => this.finishLabelPositioning(), { kind: "secondary" }),
      );
    } else if (this._mode === "edit") {
      const zone = this._config.zones.find((item) => item.id === this._selectedZoneId);
      toolbar.append(
        this.createButton("Done editing", () => {
          this._mode = "select";
          this._selectedZoneId = null;
          this._selectedVertexIndex = null;
          this.render();
        }, { kind: "secondary" }),
        this.createButton("Delete vertex", () => this.deleteSelectedVertex(), {
          kind: "danger",
          disabled: this._selectedVertexIndex === null || !zone || (zone.points?.length ?? 0) <= 3,
        }),
      );
    }
    if (toolbar.childElementCount) preview.append(toolbar);

    const interactionHint = document.createElement("p");
    interactionHint.className = "hint";
    if (this._mode === "label-position") {
      interactionHint.textContent = "Click anywhere on the floorplan to place the label, or drag the label itself. Zoom and pan remain available.";
    } else if (this._mode === "edit") {
      interactionHint.textContent = "Drag a blue vertex to move it. Click a white midpoint to insert a vertex. Zoom and pan remain available.";
    } else if (this._mode === "focus-area") {
      interactionHint.textContent = "Drag a rectangle around the area that should fill the view when this rule matches.";
    } else if (this._mode === "draw") {
      interactionHint.textContent = "Click to add polygon points. Zoom with +/−, wheel, or pinch; drag empty space to pan when zoomed.";
    } else {
      interactionHint.textContent = "Select a zone on the floorplan to open its settings, or keep this workspace closed while editing forms below.";
    }
    preview.append(interactionHint);
    workspace.append(workspaceHeader, preview);
    editor.append(workspace, this.createAutoZoomEditor());

    const zones = document.createElement("div");
    zones.className = "zones section-panel";
    const zoneTitle = document.createElement("div");
    zoneTitle.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "Zones";
    const zoneCount = document.createElement("span");
    zoneCount.className = "zone-count";
    zoneCount.textContent = `${this._config.zones?.length ?? 0} configured`;
    zoneTitle.append(heading, zoneCount);
    zones.append(zoneTitle);

    const addZoneCard = document.createElement("div");
    addZoneCard.className = "add-zone-card";
    const addZoneHeader = document.createElement("div");
    addZoneHeader.className = "add-zone-header";
    const addZoneTitle = document.createElement("strong");
    addZoneTitle.textContent = "Add zone";
    const drawZone = this.createButton("Draw manually", () => this.startDrawing(), {
      compact: true,
      disabled: this._mode === "draw" || this._mode === "focus-area" || this._mode === "label-position",
    });
    addZoneHeader.append(addZoneTitle, drawZone);
    addZoneCard.append(addZoneHeader);

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
        this.createField("Use existing SVG object", selector),
        this.createButton("Add SVG zone", () => this.addSvgObjectZone(this._selectedSvgElementId), {
          compact: true,
          disabled: !this._selectedSvgElementId,
        }),
      );
      addZoneCard.append(svgRow);
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "SVG elements with an id are detected automatically. You can draw a zone or reuse the original SVG geometry.";
      addZoneCard.append(hint);
    } else if (this._svgSourceError) {
      const warning = document.createElement("p");
      warning.className = "validation-warning";
      warning.textContent = `SVG object detection failed: ${this._svgSourceError}`;
      addZoneCard.append(warning);
    } else {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Draw a polygon manually. If the selected floorplan is SVG, reusable objects with an id will appear here automatically.";
      addZoneCard.append(hint);
    }
    zones.append(addZoneCard);

    if ((this._config.zones?.length ?? 0) === 0) {
      const hint = document.createElement("p");
      hint.className = "hint empty-rules";
      hint.textContent = "No zones configured yet.";
      zones.append(hint);
    }

    for (const [index, zone] of (this._config.zones ?? []).entries()) {
      const zoneCard = document.createElement("section");
      zoneCard.className = "zone-card";
      if (zone.id === this._selectedZoneId) zoneCard.classList.add("selected");
      const expanded = this._expandedZoneIds.has(zone.id);

      const header = document.createElement("div");
      header.className = "zone-card-header";
      const headingWrap = document.createElement("div");
      headingWrap.className = "zone-heading";
      const toggle = this.createButton("", () => this.toggleZoneExpanded(zone.id), {
        kind: "secondary",
        compact: true,
      });
      toggle.classList.add("zone-toggle");
      toggle.setAttribute("aria-expanded", String(expanded));
      const chevron = document.createElement("span");
      chevron.className = "zone-chevron";
      chevron.textContent = expanded ? "▾" : "▸";
      const titleGroup = document.createElement("span");
      const titleText = document.createElement("span");
      titleText.className = "zone-title-text";
      titleText.textContent = zone.name || `Zone ${index + 1}`;
      const summary = document.createElement("span");
      summary.className = "zone-summary";
      const geometrySummary = zoneUsesSvgObject(zone)
        ? `SVG #${zone.svg_element_id}`
        : `${zone.points?.length ?? 0} vertices`;
      summary.textContent = `${zone.entity || "No entity"} · ${geometrySummary}`;
      titleGroup.append(titleText, summary);
      toggle.append(chevron, titleGroup);
      headingWrap.append(toggle);

      const actions = document.createElement("div");
      actions.className = "toolbar";
      if (!zoneUsesSvgObject(zone)) {
        actions.append(this.createButton("Edit shape", () => this.selectZone(zone.id), {
          compact: true,
          kind: "secondary",
        }));
      }
      actions.append(this.createButton("Delete", () => {
        if (this._selectedZoneId === zone.id) {
          this._selectedZoneId = null;
          if (this._labelZoneId === zone.id) this._labelZoneId = null;
          this._selectedVertexIndex = null;
          this._mode = "select";
        }
        this._expandedZoneIds.delete(zone.id);
        const nextZones = this._config.zones.filter((_, i) => i !== index);
        const autoZoom = (this._config.auto_zoom ?? []).map((rule) =>
          rule.target === "zone" && rule.zone_id === zone.id
            ? normalizeAutoZoomRule({ ...rule, zone_id: "" })
            : rule
        );
        this.updateConfig({ zones: nextZones, auto_zoom: autoZoom }, true);
      }, { kind: "danger", compact: true }));
      header.append(headingWrap, actions);
      zoneCard.append(header);

      if (expanded) {
        const body = document.createElement("div");
        body.className = "zone-card-body";
        body.append(this.createZoneMetadataForm(zone, index));
        if (zoneUsesSvgObject(zone)) body.append(this.createSvgGeometryEditor(zone, index));
        body.append(
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
        body.append(hint);
        zoneCard.append(body);
      }
      zones.append(zoneCard);
    }

    editor.append(zones);
    this.shadowRoot.append(style, editor);
  }
}

if (!customElements.get(CANVAS_TAG)) customElements.define(CANVAS_TAG, FloorplanZoneCanvas);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, FloorplanZoneCardEditor);
if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, FloorplanZoneCard);

window.customCards = window.customCards ?? [];
if (!window.customCards.some((card) => card.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: "Floorplan Zone Card",
    description: "Display a zoomable floorplan with state-driven drawn or SVG-object zones, configurable labels and Home Assistant actions.",
    preview: true,
    documentationURL: "https://github.com/xtimmy86x/ha-floorplan-zone-card",
  });
}

console.info(
  `%c FLOORPLAN-ZONE-CARD %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;",
);
