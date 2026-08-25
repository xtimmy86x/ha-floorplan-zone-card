const CARD_TYPE = "floorplan-zone-card";
const CARD_TAG = "floorplan-zone-card";
const EDITOR_TAG = "floorplan-zone-card-editor";
const CANVAS_TAG = "floorplan-zone-canvas";
const VERSION = "0.1.0-dev.4";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_SIZE = 1000;

const DEFAULT_FALLBACK_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_UNAVAILABLE_STYLE = Object.freeze({ color: "#9e9e9e", opacity: 0.2 });
const DEFAULT_STROKE = Object.freeze({ color: "#ffffff", width: 2 });
const DEFAULT_ON_STYLE = Object.freeze({ color: "#ff3b30", opacity: 0.55 });
const DEFAULT_OFF_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_TAP_ACTION = Object.freeze({ action: "more-info" });
const DEFAULT_NONE_ACTION = Object.freeze({ action: "none" });

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
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
    this._drag = null;
    this._imageKey = null;
    this._resolvedImage = "";
    this._imageResolveToken = 0;
    this._actionGesture = null;
    this._pendingTap = null;
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

  connectedCallback() {
    this.refreshImage();
  }

  disconnectedCallback() {
    this.clearActionGesture();
    this.clearPendingTap();
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

  dispatchEditorEvent(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  dispatchHassAction(zone, action) {
    const event = new Event("hass-action", { bubbles: true, composed: true });
    event.detail = {
      config: zoneActionConfig(zone),
      action,
    };
    this.dispatchEvent(event);
  }

  clearActionGesture() {
    if (this._actionGesture?.holdTimer) clearTimeout(this._actionGesture.holdTimer);
    this._actionGesture = null;
  }

  clearPendingTap() {
    if (this._pendingTap?.timer) clearTimeout(this._pendingTap.timer);
    this._pendingTap = null;
  }

  beginZoneGesture(event, zone, svg, polygon) {
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
      moved: false,
      held: false,
      holdTimer: null,
    };

    polygon.classList.add("pressed");
    if (actionEnabled(holdAction)) {
      gesture.holdTimer = setTimeout(() => {
        if (this._actionGesture !== gesture || gesture.moved) return;
        gesture.held = true;
        polygon.classList.remove("pressed");
        this.dispatchHassAction(zone, "hold");
      }, 500);
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
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    );
    if (distance > 12 && !gesture.moved) {
      gesture.moved = true;
      gesture.polygon.classList.remove("pressed");
      if (gesture.holdTimer) {
        clearTimeout(gesture.holdTimer);
        gesture.holdTimer = null;
      }
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

    if (cancelled || gesture.moved || gesture.held) return;

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
    }, 280);
    this._pendingTap = { zoneId, timer };
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

  render() {
    if (!this.shadowRoot) return;
    this._drag = null;
    this.clearActionGesture();
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
      .canvas { position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius,12px); background:var(--secondary-background-color,#eee); }
      .canvas.empty { aspect-ratio:16/9; min-height:220px; }
      img { display:block; width:100%; height:auto; user-select:none; pointer-events:none; }
      svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      svg.interactive { touch-action:none; }
      polygon.zone { vector-effect:non-scaling-stroke; transition:fill 160ms ease,fill-opacity 160ms ease,stroke 120ms ease,filter 80ms ease; }
      polygon.actionable { cursor:pointer; pointer-events:auto; touch-action:manipulation; }
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
      .draw-hint { position:absolute; left:12px; bottom:12px; z-index:2; padding:7px 10px; border-radius:8px; background:color-mix(in srgb,var(--card-background-color,#fff) 88%,transparent); color:var(--primary-text-color,#212121); font-size:12px; pointer-events:none; }
    `;

    const container = document.createElement("div");
    container.className = "canvas";

    if (this._resolvedImage) {
      const img = document.createElement("img");
      img.src = this._resolvedImage;
      img.alt = this._config?.title || "Floorplan";
      container.append(img);
    } else {
      container.classList.add("empty");
      const message = document.createElement("div");
      message.className = "empty-message";
      message.textContent = imageConfigured
        ? "Loading floorplan image…"
        : interactive
          ? "Choose or upload a floorplan image, then draw zones on this canvas."
          : "Choose a floorplan image in the card editor.";
      container.append(message);
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Floorplan zones");
    if (interactive) svg.classList.add("interactive");

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
      polygon.setAttribute(
        "fill-opacity",
        String(zoneStyle.opacity ?? DEFAULT_FALLBACK_STYLE.opacity),
      );
      polygon.setAttribute("stroke", zone.stroke?.color ?? "transparent");
      polygon.setAttribute("stroke-width", String(zone.stroke?.width ?? 0));

      if (interactive && mode !== "draw") {
        polygon.classList.add("selectable");
        polygon.addEventListener("click", (event) => {
          event.stopPropagation();
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
          midpoint.setAttribute("r", "8");
          midpoint.addEventListener("pointerdown", (event) => {
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
          if (vertexIndex === selectedVertexIndex) {
            handle.classList.add("selected-vertex");
          }
          handle.setAttribute("cx", String(point.x * SVG_SIZE));
          handle.setAttribute("cy", String(point.y * SVG_SIZE));
          handle.setAttribute("r", vertexIndex === selectedVertexIndex ? "13" : "11");
          handle.addEventListener("pointerdown", (event) => {
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
        handle.setAttribute(
          "r",
          index === 0 && draftPoints.length >= 3 ? "14" : "9",
        );
        if (index === 0 && draftPoints.length >= 3) {
          handle.classList.add("close-target");
          handle.addEventListener("click", (event) => {
            event.stopPropagation();
            this.dispatchEditorEvent("floorplan-draw-close");
          });
        }
        svg.append(handle);
      });

      svg.addEventListener("click", (event) => {
        this.dispatchEditorEvent("floorplan-draw-point", {
          point: this.pointerPoint(event, svg),
        });
      });

      const hint = document.createElement("div");
      hint.className = "draw-hint";
      hint.textContent = draftPoints.length >= 3
        ? "Click the first point or Close polygon"
        : "Click on the floorplan to add polygon points";
      container.append(hint);
    }

    if (!interactive) {
      svg.addEventListener("pointermove", (event) => this.moveZoneGesture(event));
      svg.addEventListener("pointerup", (event) => this.finishZoneGesture(event, false));
      svg.addEventListener("pointercancel", (event) => this.finishZoneGesture(event, true));
    }

    if (interactive && mode === "edit") {
      svg.addEventListener("pointermove", (event) => {
        if (!this._drag || this._drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        this.updateDragGeometry(this.pointerPoint(event, svg));
      });

      const finishDrag = (event, commit) => {
        if (!this._drag || this._drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const drag = this._drag;
        if (commit) {
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

    container.append(svg);
    this.shadowRoot.append(style, container);
  }
}

class FloorplanZoneCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = undefined;
    this._hass = undefined;
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
    canvas.config = this._config;
    canvas.hass = this._hass;
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
    this._haFormReadyListener = null;
  }

  setConfig(config) {
    this._config = normalizedConfig(config);
    const selectedZone = this._config.zones.find(
      (zone) => zone.id === this._selectedZoneId,
    );
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
    this.shadowRoot?.querySelectorAll("ha-form").forEach((form) => {
      form.hass = hass;
    });
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

  updatePreview() {
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (!canvas) return;
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.editorState = this.canvasState();
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
    this._config = {
      ...this._config,
      zones: [...this._config.zones, zone],
    };
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
    zones[index] = {
      ...zones[index],
      points: points.map(normalizePoint),
    };
    this._config = { ...this._config, zones };
    this._selectedZoneId = zoneId;
    this._selectedVertexIndex = Number.isInteger(vertexIndex)
      ? vertexIndex
      : null;
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
    if (
      this._selectedZoneId === null ||
      this._selectedVertexIndex === null
    ) {
      return;
    }
    const zoneIndex = this._config.zones.findIndex(
      (zone) => zone.id === this._selectedZoneId,
    );
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
        this.createField(
          "Title",
          this.createTextInput(
            this._config.title,
            "Optional title",
            (value) => this.updateConfig({ title: value }),
          ),
        ),
        this.createField(
          "Floorplan image URL",
          this.createTextInput(
            typeof this._config.image === "string" ? this._config.image : "",
            "/local/floorplan.png",
            (value) => this.updateConfig({ image: value }),
          ),
        ),
      );
      return wrapper;
    }

    const form = document.createElement("ha-form");
    form.className = "native-form";
    form.hass = this._hass;
    const legacyImage =
      typeof this._config.image === "string" ? this._config.image : undefined;
    form.data = {
      title: this._config.title ?? "",
      image: legacyImage ? undefined : this._config.image,
    };
    form.schema = [
      { name: "title", selector: { text: {} } },
      {
        name: "image",
        selector: {
          media: {
            accept: ["image/*"],
            image_upload: true,
            clearable: true,
            hide_content_type: true,
          },
        },
      },
    ];
    form.computeLabel = (schema) =>
      schema.name === "title" ? "Title" : "Floorplan image";
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
    hint.textContent =
      "This card still uses a legacy image URL/path. You can keep it or replace it with the Home Assistant image picker above.";
    wrapper.append(
      hint,
      this.createField(
        "Legacy image URL/path",
        this.createTextInput(
          legacyImage,
          "/local/floorplan.png",
          (value) => this.updateConfig({ image: value }),
        ),
      ),
    );
    return wrapper;
  }

  createZoneMetadataForm(zone, index) {
    if (!customElements.get("ha-form")) {
      const grid = document.createElement("div");
      grid.className = "grid";
      grid.append(
        this.createField(
          "Name",
          this.createTextInput(
            zone.name,
            "Zone name",
            (value) =>
              this.updateZone(index, (current) => ({
                ...current,
                name: value,
              })),
          ),
        ),
        this.createField(
          "Entity",
          this.createTextInput(
            zone.entity,
            "sensor.example",
            (value) =>
              this.updateZone(index, (current) => ({
                ...current,
                entity: value,
              })),
          ),
        ),
      );
      return grid;
    }

    const form = document.createElement("ha-form");
    form.className = "native-form zone-native-form";
    form.hass = this._hass;
    form.data = {
      name: zone.name ?? "",
      entity: zone.entity || undefined,
    };
    form.schema = [
      { name: "name", selector: { text: {} } },
      { name: "entity", selector: { entity: {} } },
    ];
    form.computeLabel = (schema) =>
      schema.name === "name" ? "Name" : "Entity";
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
    description.textContent =
      "Configure standard Home Assistant tap, hold, and double-tap actions for this zone.";
    section.append(description);

    if (!customElements.get("ha-form")) {
      const fallback = document.createElement("p");
      fallback.className = "hint";
      fallback.textContent =
        "Home Assistant action controls are loading. They will appear automatically when ha-form is ready.";
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
      {
        name: "tap_action",
        selector: { ui_action: { default_action: "more-info" } },
      },
      {
        name: "hold_action",
        selector: { ui_action: { default_action: "none" } },
      },
      {
        name: "double_tap_action",
        selector: { ui_action: { default_action: "none" } },
      },
    ];
    form.computeLabel = (schema) => {
      switch (schema.name) {
        case "tap_action":
          return "Tap action";
        case "hold_action":
          return "Hold action";
        case "double_tap_action":
          return "Double tap action";
        default:
          return "";
      }
    };
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const value = event.detail?.value ?? {};
      this.updateZone(zoneIndex, (current) => ({
        ...current,
        tap_action: normalizeAction(value.tap_action) ?? { ...DEFAULT_NONE_ACTION },
        hold_action: normalizeAction(value.hold_action) ?? { ...DEFAULT_NONE_ACTION },
        double_tap_action:
          normalizeAction(value.double_tap_action) ?? { ...DEFAULT_NONE_ACTION },
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
    const add = this.createButton(
      "Add state",
      () => {
        this.updateZone(
          zoneIndex,
          (current) => ({
            ...current,
            states: [
              ...(current.states ?? []),
              { value: "", ...DEFAULT_FALLBACK_STYLE },
            ],
          }),
          true,
        );
      },
      { compact: true },
    );
    headingRow.append(heading, add);
    section.append(headingRow);

    const description = document.createElement("p");
    description.className = "hint";
    description.textContent =
      "Match the entity raw state exactly. Add as many state/color rules as needed.";
    section.append(description);

    if (!(zone.states?.length ?? 0)) {
      const empty = document.createElement("p");
      empty.className = "hint empty-rules";
      empty.textContent =
        "No state rules yet. The fallback style will be used for every available state.";
      section.append(empty);
    }

    (zone.states ?? []).forEach((rule, ruleIndex) => {
      const row = document.createElement("div");
      row.className = "state-rule-row";

      const valueInput = this.createTextInput(
        rule.value,
        "State value",
        (value) => {
          this.updateZone(zoneIndex, (current) => {
            const states = deepClone(current.states ?? []);
            states[ruleIndex] = { ...states[ruleIndex], value };
            return { ...current, states };
          });
        },
      );
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

      const remove = this.createButton(
        "Delete",
        () => {
          this.updateZone(
            zoneIndex,
            (current) => ({
              ...current,
              states: (current.states ?? []).filter(
                (_, index) => index !== ruleIndex,
              ),
            }),
            true,
          );
        },
        { kind: "danger", compact: true },
      );

      row.append(valueInput, colorInput, opacity, remove);
      section.append(row);
    });

    const styleGrid = document.createElement("div");
    styleGrid.className = "style-grid";
    styleGrid.append(
      this.createStyleBox(
        "Fallback",
        zone.default ?? DEFAULT_FALLBACK_STYLE,
        (patch) => {
          this.updateZone(zoneIndex, (current) => ({
            ...current,
            default: { ...current.default, ...patch },
          }));
        },
      ),
      this.createStyleBox(
        "Unavailable / unknown",
        zone.unavailable ?? DEFAULT_UNAVAILABLE_STYLE,
        (patch) => {
          this.updateZone(zoneIndex, (current) => ({
            ...current,
            unavailable: { ...current.unavailable, ...patch },
          }));
        },
      ),
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
      this.createOpacityControl(styleValue.opacity, (opacity) =>
        onChange({ opacity }),
      ),
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
      .native-form { display:block; }
      .zone-native-form { margin-top:4px; }
      .action-form { display:block; }
      .grid,.style-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .state-rules,.actions-editor { padding-top:12px; border-top:1px solid var(--divider-color,#ddd); }
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
      status.textContent = `Drawing · ${this._draftPoints.length} point${
        this._draftPoints.length === 1 ? "" : "s"
      }`;
    } else if (this._mode === "edit") {
      status.textContent =
        this._selectedVertexIndex === null
          ? "Editing shape"
          : `Vertex ${this._selectedVertexIndex + 1} selected`;
    } else {
      status.textContent = "Select a zone";
    }
    previewTitle.append(previewHeading, status);

    const canvas = document.createElement(CANVAS_TAG);
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.editorState = this.canvasState();
    canvas.addEventListener("floorplan-zone-select", (event) =>
      this.selectZone(event.detail.zoneId),
    );
    canvas.addEventListener("floorplan-draw-point", (event) => {
      if (this._mode !== "draw") return;
      this._draftPoints = [
        ...this._draftPoints,
        normalizePoint(event.detail.point),
      ];
      this.render();
    });
    canvas.addEventListener("floorplan-draw-close", () => this.closeDrawing());
    canvas.addEventListener("floorplan-vertex-commit", (event) =>
      this.commitVertices(
        event.detail.zoneId,
        event.detail.points,
        event.detail.vertexIndex,
      ),
    );
    canvas.addEventListener("floorplan-vertex-insert", (event) =>
      this.insertVertex(
        event.detail.zoneId,
        event.detail.afterIndex,
        event.detail.point,
      ),
    );
    preview.append(previewTitle, canvas);

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    if (this._mode === "draw") {
      toolbar.append(
        this.createButton(
          "Undo point",
          () => {
            this._draftPoints = this._draftPoints.slice(0, -1);
            this.render();
          },
          {
            kind: "secondary",
            disabled: this._draftPoints.length === 0,
          },
        ),
        this.createButton(
          "Close polygon",
          () => this.closeDrawing(),
          {
            disabled: this._draftPoints.length < 3,
          },
        ),
        this.createButton(
          "Cancel",
          () => this.cancelDrawing(),
          { kind: "danger" },
        ),
      );
    } else if (this._mode === "edit") {
      const zone = this._config.zones.find(
        (item) => item.id === this._selectedZoneId,
      );
      toolbar.append(
        this.createButton(
          "Done editing",
          () => {
            this._mode = "select";
            this._selectedZoneId = null;
            this._selectedVertexIndex = null;
            this.render();
          },
          { kind: "secondary" },
        ),
        this.createButton(
          "Delete vertex",
          () => this.deleteSelectedVertex(),
          {
            kind: "danger",
            disabled:
              this._selectedVertexIndex === null ||
              !zone ||
              (zone.points?.length ?? 0) <= 3,
          },
        ),
      );
    }
    if (toolbar.childElementCount) preview.append(toolbar);

    if (this._mode === "edit") {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent =
        "Drag a blue vertex to move it. Click a small white midpoint to insert a new vertex. Select a vertex by clicking/dragging it, then use Delete vertex if the polygon has more than three points. Zone actions are disabled while editing geometry.";
      preview.append(hint);
    }
    editor.append(preview);

    const zones = document.createElement("div");
    zones.className = "zones";
    const zoneTitle = document.createElement("div");
    zoneTitle.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "Zones";
    const add = this.createButton(
      "Add zone",
      () => this.startDrawing(),
      { disabled: this._mode === "draw" },
    );
    zoneTitle.append(heading, add);
    zones.append(zoneTitle);

    if ((this._config.zones?.length ?? 0) === 0) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent =
        "Press Add zone, then click at least three points on the floorplan and close the polygon.";
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
        this.createButton(
          "Edit shape",
          () => this.selectZone(zone.id),
          { kind: "secondary" },
        ),
        this.createButton(
          "Delete",
          () => {
            if (this._selectedZoneId === zone.id) {
              this._selectedZoneId = null;
              this._selectedVertexIndex = null;
              this._mode = "select";
            }
            this.updateConfig(
              {
                zones: this._config.zones.filter((_, i) => i !== index),
              },
              true,
            );
          },
          { kind: "danger" },
        ),
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
        ? `Current raw state: ${
            currentState ?? "not available"
          }. Exact state rules are evaluated before the fallback style.`
        : "Choose any Home Assistant entity, then associate each raw state value with a color and opacity.";
      zoneCard.append(hint);
      zones.append(zoneCard);
    }

    editor.append(zones);
    this.shadowRoot.append(style, editor);
  }
}

if (!customElements.get(CANVAS_TAG)) {
  customElements.define(CANVAS_TAG, FloorplanZoneCanvas);
}
if (!customElements.get(EDITOR_TAG)) {
  customElements.define(EDITOR_TAG, FloorplanZoneCardEditor);
}
if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, FloorplanZoneCard);
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some((card) => card.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: "Floorplan Zone Card",
    description: "Display a floorplan with state-driven polygon zones.",
    preview: true,
    documentationURL:
      "https://github.com/xtimmy86x/ha-floorplan-zone-card",
  });
}

console.info(
  `%c FLOORPLAN-ZONE-CARD %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;",
);