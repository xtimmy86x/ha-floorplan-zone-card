const CARD_TYPE = "floorplan-zone-card";
const CARD_TAG = "floorplan-zone-card";
const EDITOR_TAG = "floorplan-zone-card-editor";
const CANVAS_TAG = "floorplan-zone-canvas";
const VERSION = "0.1.0-dev.5";
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

function normalizeStyle(style, fallback) {
  return {
    color: typeof style?.color === "string" && style.color ? style.color : fallback.color,
    opacity: clamp01(style?.opacity ?? fallback.opacity),
  };
}

function normalizeStateRule(rule) {
  return {
    value: rule?.value === undefined || rule?.value === null ? "" : String(rule.value),
    ...normalizeStyle(rule, DEFAULT_FALLBACK_STYLE),
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

function legacyStateRules(zone) {
  const rules = [];
  if (zone?.off) rules.push({ value: "off", ...normalizeStyle(zone.off, DEFAULT_OFF_STYLE) });
  if (zone?.on) rules.push({ value: "on", ...normalizeStyle(zone.on, DEFAULT_ON_STYLE) });
  return rules;
}

function normalizeZone(zone) {
  const normalized = {
    ...zone,
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
  };
  delete normalized.on;
  delete normalized.off;
  return normalized;
}

function normalizedConfig(config) {
  const clone = deepClone(config ?? {});
  return {
    ...clone,
    zones: Array.isArray(clone.zones) ? clone.zones.map(normalizeZone) : [],
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
    points: points.map(normalizePoint),
    states: [
      { value: "off", ...DEFAULT_OFF_STYLE },
      { value: "on", ...DEFAULT_ON_STYLE },
    ],
    default: { ...DEFAULT_FALLBACK_STYLE },
    unavailable: { ...DEFAULT_UNAVAILABLE_STYLE },
    stroke: { ...DEFAULT_STROKE },
    tap_action: { ...DEFAULT_TAP_ACTION },
    hold_action: { ...DEFAULT_NONE_ACTION },
    double_tap_action: { ...DEFAULT_NONE_ACTION },
  };
}

function entityRawState(hass, entityId) {
  if (!entityId) return undefined;
  return hass?.states?.[entityId]?.state;
}

function stateStyle(hass, zone) {
  const state = entityRawState(hass, zone.entity);
  if (state === undefined || state === "unknown" || state === "unavailable") {
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
    };
    this._view = normalizeViewState();
    this._drag = null;
    this._backgroundPan = null;
    this._actionGesture = null;
    this._pendingTap = null;
    this._touchPointers = new Map();
    this._pinch = null;
    this._suppressNextClick = false;
    this._clickSuppressTimer = null;
    this._imageKey = null;
    this._resolvedImage = "";
    this._imageResolveToken = 0;
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
    this._touchPointers.clear();
    this._pinch = null;
    if (this._clickSuppressTimer) clearTimeout(this._clickSuppressTimer);
    this._clickSuppressTimer = null;
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
    transform.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    transform.style.transformOrigin = "0 0";
    transform.querySelectorAll("[data-screen-radius]").forEach((node) => {
      const baseRadius = Number(node.dataset.screenRadius);
      if (Number.isFinite(baseRadius)) node.setAttribute("r", String(baseRadius / scale));
    });
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
    this._view = normalizeViewState();
    this.applyCurrentView();
    this.emitViewChanged();
  }

  setViewCenterFromPan(startView, startX, startY, clientX, clientY) {
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
    this.clearActionGesture();
    this._backgroundPan = null;
    this.cancelVertexDragGeometry();
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
    } = this._editorState;
    const imageConfigured = Boolean(imageContentId(this._config?.image));

    const style = document.createElement("style");
    style.textContent = `
      :host { display:block; }
      .canvas { position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius,12px); background:var(--secondary-background-color,#eee); touch-action:none; }
      .transform-layer { position:relative; width:100%; will-change:transform; }
      .transform-layer.empty { aspect-ratio:16/9; min-height:220px; }
      img { display:block; width:100%; height:auto; user-select:none; pointer-events:none; }
      svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      polygon.zone { vector-effect:non-scaling-stroke; transition:fill 160ms ease,fill-opacity 160ms ease,stroke 120ms ease,filter 80ms ease; }
      polygon.actionable { cursor:pointer; pointer-events:auto; }
      polygon.actionable.pressed { filter:brightness(.88); }
      polygon.actionable:focus-visible { outline:none; stroke:var(--primary-color,#03a9f4)!important; stroke-width:4!important; }
      polygon.selectable { cursor:pointer; }
      polygon.selected { stroke:var(--primary-color,#03a9f4)!important; stroke-width:4!important; }
      .draft-line { fill:none; stroke:var(--primary-color,#03a9f4); stroke-width:4; vector-effect:non-scaling-stroke; pointer-events:none; }
      .draft-point,.vertex { fill:var(--primary-color,#03a9f4); stroke:var(--card-background-color,#fff); stroke-width:3; vector-effect:non-scaling-stroke; }
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
      .canvas.zoomed polygon.actionable { cursor:pointer; }
    `;

    const container = document.createElement("div");
    container.className = "canvas";
    container.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    container.addEventListener("pointerdown", (event) => this.handleTouchPointerDownCapture(event), true);
    container.addEventListener("pointermove", (event) => this.handleTouchPointerMoveCapture(event), true);
    container.addEventListener("pointerup", (event) => this.handleTouchPointerEndCapture(event), true);
    container.addEventListener("pointercancel", (event) => this.handleTouchPointerEndCapture(event), true);

    const transform = document.createElement("div");
    transform.className = "transform-layer";

    if (this._resolvedImage) {
      const img = document.createElement("img");
      img.src = this._resolvedImage;
      img.alt = this._config?.title || "Floorplan";
      img.addEventListener("load", () => this.applyCurrentView());
      transform.append(img);
    } else {
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
    svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Floorplan zones");

    for (const zone of this._config?.zones ?? []) {
      if (!Array.isArray(zone.points) || zone.points.length < 3) continue;
      const polygon = document.createElementNS(SVG_NS, "polygon");
      const zoneStyle = stateStyle(this._hass, zone);
      const rawState = entityRawState(this._hass, zone.entity);
      const accessibleName = zone.name || zone.entity || zone.id || "Zone";
      polygon.classList.add("zone");
      polygon.dataset.zoneId = zone.id ?? "";
      polygon.setAttribute("points", pointList(zone.points));
      polygon.setAttribute("fill", zoneStyle.color ?? DEFAULT_FALLBACK_STYLE.color);
      polygon.setAttribute("fill-opacity", String(zoneStyle.opacity ?? DEFAULT_FALLBACK_STYLE.opacity));
      polygon.setAttribute("stroke", zone.stroke?.color ?? "transparent");
      polygon.setAttribute("stroke-width", String(zone.stroke?.width ?? 0));

      if (interactive && mode !== "draw") {
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

      if (interactive && zone.id === selectedZoneId && mode === "edit") {
        polygon.classList.add("selected");
      }

      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${accessibleName}${rawState !== undefined ? ` · ${rawState}` : ""}`;
      polygon.append(title);
      svg.append(polygon);

      if (interactive && zone.id === selectedZoneId && mode === "edit") {
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
      if (event.target !== svg) return;
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

    transform.append(svg);
    container.append(transform);
    if (imageConfigured || this._resolvedImage) this.createZoomControls(container);
    this.shadowRoot.append(style, container);
    requestAnimationFrame(() => this.applyCurrentView());
  }

  async refreshImage() {
    const key = imageContentId(this._config?.image);
    const needsResolution = isMediaSourceContentId(key);
    if (!key) {
      this._imageKey = "";
      this._resolvedImage = "";
      this._imageResolveToken += 1;
      this.render();
      return;
    }
    if (key === this._imageKey && this._resolvedImage) {
      this.render();
      return;
    }
    this._imageKey = key;
    const token = ++this._imageResolveToken;
    if (!needsResolution) {
      this._resolvedImage = hassUrl(this._hass, key);
      this.render();
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
  }
}

class FloorplanZoneCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = undefined;
    this._hass = undefined;
    this._viewState = normalizeViewState();
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
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (canvas) canvas.hass = hass;
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
    canvas.viewState = this._viewState;
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.addEventListener("floorplan-view-changed", (event) => {
      this._viewState = normalizeViewState(event.detail?.viewState);
    });
    content.append(canvas);
    card.append(content);
    this.shadowRoot.append(style, card);
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
    this._viewState = normalizeViewState();
    this._haFormReadyListener = null;
  }

  setConfig(config) {
    this._config = normalizedConfig(config);
    const selectedZone = this._config.zones.find((zone) => zone.id === this._selectedZoneId);
    if (!selectedZone) {
      this._selectedZoneId = null;
      this._selectedVertexIndex = null;
      if (this._mode === "edit") this._mode = "select";
    } else if (
      this._selectedVertexIndex !== null &&
      this._selectedVertexIndex >= selectedZone.points.length
    ) {
      this._selectedVertexIndex = null;
    }
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.updatePreview();
    this.shadowRoot?.querySelectorAll("ha-form").forEach((form) => { form.hass = hass; });
  }

  get hass() {
    return this._hass;
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
    };
  }

  configureCanvas(canvas) {
    canvas.viewState = this._viewState;
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.editorState = this.canvasState();
    canvas.addEventListener("floorplan-view-changed", (event) => {
      this._viewState = normalizeViewState(event.detail?.viewState);
    });
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

  selectZone(zoneId) {
    if (!this._config?.zones?.some((zone) => zone.id === zoneId)) return;
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = null;
    this._mode = "edit";
    this._draftPoints = [];
    this.render();
  }

  startDrawing() {
    this._mode = "draw";
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
        this.createField("Floorplan image URL", this.createTextInput(
          typeof this._config.image === "string" ? this._config.image : "",
          "/local/floorplan.png",
          (value) => this.updateConfig({ image: value }),
        )),
      );
      return wrapper;
    }

    const form = document.createElement("ha-form");
    form.className = "native-form";
    form.hass = this._hass;
    const legacyImage = typeof this._config.image === "string" ? this._config.image : undefined;
    form.data = { title: this._config.title ?? "", image: legacyImage ? undefined : this._config.image };
    form.schema = [
      { name: "title", selector: { text: {} } },
      { name: "image", selector: { media: { accept: ["image/*"], image_upload: true, clearable: true, hide_content_type: true } } },
    ];
    form.computeLabel = (schema) => (schema.name === "title" ? "Title" : "Floorplan image");
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const value = event.detail?.value ?? {};
      const patch = { title: value.title ?? "" };
      if (legacyImage) {
        if (value.image) patch.image = value.image;
      } else {
        patch.image = value.image;
      }
      this.updateConfig(patch);
    });
    if (!legacyImage) return form;
    const wrapper = document.createElement("div");
    wrapper.className = "native-form-wrapper";
    wrapper.append(form);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "This card still uses a legacy image URL/path. You can keep it or replace it with the Home Assistant image picker above.";
    wrapper.append(hint, this.createField("Legacy image URL/path", this.createTextInput(legacyImage, "/local/floorplan.png", (value) => this.updateConfig({ image: value }))));
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

  createStateRulesEditor(zone, zoneIndex) {
    const section = document.createElement("div");
    section.className = "state-rules";
    const headingRow = document.createElement("div");
    headingRow.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "State colors";
    const add = this.createButton("Add state", () => {
      this.updateZone(zoneIndex, (current) => ({
        ...current,
        states: [...(current.states ?? []), { value: "", ...DEFAULT_FALLBACK_STYLE }],
      }), true);
    }, { compact: true });
    headingRow.append(heading, add);
    section.append(headingRow);
    const description = document.createElement("p");
    description.className = "hint";
    description.textContent = "Match the entity raw state exactly. Add as many state/color rules as needed.";
    section.append(description);
    if (!(zone.states?.length ?? 0)) {
      const empty = document.createElement("p");
      empty.className = "hint empty-rules";
      empty.textContent = "No state rules yet. The fallback style will be used for every available state.";
      section.append(empty);
    }
    (zone.states ?? []).forEach((rule, ruleIndex) => {
      const row = document.createElement("div");
      row.className = "state-rule-row";
      const valueInput = this.createTextInput(rule.value, "State value", (value) => {
        this.updateZone(zoneIndex, (current) => {
          const states = deepClone(current.states ?? []);
          states[ruleIndex] = { ...states[ruleIndex], value };
          return { ...current, states };
        });
      });
      valueInput.setAttribute("aria-label", "State value");
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
      const remove = this.createButton("Delete", () => {
        this.updateZone(zoneIndex, (current) => ({
          ...current,
          states: (current.states ?? []).filter((_, index) => index !== ruleIndex),
        }), true);
      }, { kind: "danger", compact: true });
      row.append(valueInput, colorInput, opacity, remove);
      section.append(row);
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
      :host { display:block; }
      .editor,.zones,.zone-card,.field,.preview,.fallback-form,.native-form-wrapper,.state-rules,.style-box,.actions-editor { display:grid; gap:10px; }
      .editor { gap:18px; }
      .field > span,.style-box-title { color:var(--primary-text-color); font-size:14px; font-weight:500; }
      input { box-sizing:border-box; width:100%; min-height:42px; padding:8px 12px; border:1px solid var(--divider-color,#c7c7c7); border-radius:8px; background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121); font:inherit; }
      input[type="color"] { width:54px; min-width:54px; padding:4px; }
      input[type="range"] { min-height:auto; padding:0; border:0; }
      button { min-height:40px; padding:8px 14px; border:0; border-radius:8px; background:var(--primary-color,#03a9f4); color:var(--text-primary-color,#fff); cursor:pointer; font:inherit; font-weight:500; }
      button.compact { min-height:34px; padding:6px 10px; font-size:13px; }
      button.secondary { background:transparent; color:var(--primary-color,#03a9f4); border:1px solid var(--primary-color,#03a9f4); }
      button.danger { background:transparent; color:var(--error-color,#db4437); border:1px solid var(--error-color,#db4437); }
      button:disabled { opacity:.45; cursor:default; }
      .section-title,.toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .toolbar { justify-content:flex-start; flex-wrap:wrap; }
      .mode-status { padding:8px 10px; border-radius:8px; background:var(--secondary-background-color,#eee); color:var(--secondary-text-color,#727272); font-size:13px; }
      .zone-card { padding:12px; border:1px solid var(--divider-color,#d0d0d0); border-radius:10px; gap:14px; }
      .zone-card.selected { border-color:var(--primary-color,#03a9f4); box-shadow:inset 0 0 0 1px var(--primary-color,#03a9f4); }
      .native-form,.action-form { display:block; }
      .zone-native-form { margin-top:4px; }
      .grid,.style-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .state-rules,.actions-editor { padding-top:4px; border-top:1px solid var(--divider-color,#ddd); }
      .state-rule-row { display:grid; grid-template-columns:minmax(110px,1fr) 54px minmax(140px,1fr) auto; gap:10px; align-items:center; }
      .opacity-control { display:grid; grid-template-columns:minmax(90px,1fr) 42px; gap:8px; align-items:center; }
      .opacity-control > span { color:var(--secondary-text-color,#727272); font-size:12px; text-align:right; }
      .style-box { padding:10px; border:1px solid var(--divider-color,#ddd); border-radius:8px; }
      .style-controls { display:grid; grid-template-columns:54px minmax(140px,1fr); gap:10px; align-items:center; }
      .hint { margin:0; color:var(--secondary-text-color,#727272); font-size:13px; line-height:1.45; }
      .empty-rules { font-style:italic; }
      @media (max-width:700px) {
        .grid,.style-grid { grid-template-columns:1fr; }
        .state-rule-row { grid-template-columns:minmax(0,1fr) 54px; }
        .state-rule-row .opacity-control { grid-column:1/-1; }
      }
    `;

    const editor = document.createElement("div");
    editor.className = "editor";
    editor.append(this.createCardForm());

    const preview = document.createElement("div");
    preview.className = "preview";
    const previewTitle = document.createElement("div");
    previewTitle.className = "section-title";
    const previewHeading = document.createElement("strong");
    previewHeading.textContent = "Floorplan editor";
    const status = document.createElement("span");
    status.className = "mode-status";
    if (this._mode === "draw") {
      status.textContent = `Drawing · ${this._draftPoints.length} point${this._draftPoints.length === 1 ? "" : "s"}`;
    } else if (this._mode === "edit") {
      status.textContent = this._selectedVertexIndex === null
        ? "Editing shape"
        : `Vertex ${this._selectedVertexIndex + 1} selected`;
    } else {
      status.textContent = "Select a zone";
    }
    previewTitle.append(previewHeading, status);

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
    preview.append(previewTitle, canvas);

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
    if (this._mode === "edit") {
      interactionHint.textContent = "Drag a blue vertex to move it. Click a white midpoint to insert a vertex. Use the zoom controls or mouse wheel/pinch, and drag empty space to pan. Zone actions stay disabled while editing.";
    } else if (this._mode === "draw") {
      interactionHint.textContent = "Zoom with +/−, mouse wheel, or pinch. When zoomed, drag empty space to pan; a click still adds a polygon point.";
    } else {
      interactionHint.textContent = "Zoom with +/−, mouse wheel, or pinch. When zoomed, drag empty space to pan without changing zone coordinates.";
    }
    preview.append(interactionHint);
    editor.append(preview);

    const zones = document.createElement("div");
    zones.className = "zones";
    const zoneTitle = document.createElement("div");
    zoneTitle.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "Zones";
    const add = this.createButton("Add zone", () => this.startDrawing(), { disabled: this._mode === "draw" });
    zoneTitle.append(heading, add);
    zones.append(zoneTitle);

    if ((this._config.zones?.length ?? 0) === 0) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Press Add zone, then click at least three points on the floorplan and close the polygon.";
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
      actions.append(
        this.createButton("Edit shape", () => this.selectZone(zone.id), { kind: "secondary" }),
        this.createButton("Delete", () => {
          if (this._selectedZoneId === zone.id) {
            this._selectedZoneId = null;
            this._selectedVertexIndex = null;
            this._mode = "select";
          }
          this.updateConfig({ zones: this._config.zones.filter((_, i) => i !== index) }, true);
        }, { kind: "danger" }),
      );
      header.append(name, actions);
      zoneCard.append(
        header,
        this.createZoneMetadataForm(zone, index),
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
    description: "Display a zoomable floorplan with state-driven polygon zones and Home Assistant actions.",
    preview: true,
    documentationURL: "https://github.com/xtimmy86x/ha-floorplan-zone-card",
  });
}

console.info(
  `%c FLOORPLAN-ZONE-CARD %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;",
);
