const CARD_TYPE = "floorplan-zone-card";
const CARD_TAG = "floorplan-zone-card";
const EDITOR_TAG = "floorplan-zone-card-editor";
const CANVAS_TAG = "floorplan-zone-canvas";
const VERSION = "0.1.0-dev.2";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_SIZE = 1000;

const DEFAULT_ON_STYLE = Object.freeze({ color: "#ff3b30", opacity: 0.55 });
const DEFAULT_OFF_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_UNAVAILABLE_STYLE = Object.freeze({ color: "#9e9e9e", opacity: 0.2 });
const DEFAULT_STROKE = Object.freeze({ color: "#ffffff", width: 2 });

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function normalizePoint(point) {
  return { x: clamp01(point?.x), y: clamp01(point?.y) };
}

function normalizedConfig(config) {
  const clone = deepClone(config ?? {});
  return {
    ...clone,
    zones: Array.isArray(clone.zones)
      ? clone.zones.map((zone) => ({
          ...zone,
          points: Array.isArray(zone.points) ? zone.points.map(normalizePoint) : [],
        }))
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
    points: points.map(normalizePoint),
    on: { ...DEFAULT_ON_STYLE },
    off: { ...DEFAULT_OFF_STYLE },
    unavailable: { ...DEFAULT_UNAVAILABLE_STYLE },
    stroke: { ...DEFAULT_STROKE },
  };
}

function stateStyle(hass, zone) {
  const state = zone.entity ? hass?.states?.[zone.entity]?.state : undefined;
  if (state === "on") return zone.on ?? DEFAULT_ON_STYLE;
  if (state === "off") return zone.off ?? DEFAULT_OFF_STYLE;
  return zone.unavailable ?? DEFAULT_UNAVAILABLE_STYLE;
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
      selectedVertexIndex:
        Number.isInteger(state?.selectedVertexIndex) ? state.selectedVertexIndex : null,
      draftPoints: Array.isArray(state?.draftPoints) ? state.draftPoints.map(normalizePoint) : [],
    };
    this.render();
  }

  connectedCallback() {
    this.refreshImage();
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
    this.dispatchEvent(
      new CustomEvent(name, {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
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
    this.shadowRoot.replaceChildren();

    const interactive = this._editorState.interactive;
    const mode = this._editorState.mode;
    const selectedZoneId = this._editorState.selectedZoneId;
    const selectedVertexIndex = this._editorState.selectedVertexIndex;
    const draftPoints = this._editorState.draftPoints;
    const imageConfigured = Boolean(imageContentId(this._config?.image));

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .canvas {
        position: relative;
        overflow: hidden;
        border-radius: var(--ha-card-border-radius, 12px);
        background: var(--secondary-background-color, #eeeeee);
      }
      .canvas.empty { aspect-ratio: 16 / 9; min-height: 220px; }
      img { display: block; width: 100%; height: auto; user-select: none; pointer-events: none; }
      svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      svg.interactive { touch-action: none; }
      polygon.zone {
        vector-effect: non-scaling-stroke;
        transition: fill 160ms ease, fill-opacity 160ms ease, stroke 120ms ease;
      }
      polygon.selectable { cursor: pointer; }
      polygon.selected { stroke: var(--primary-color, #03a9f4) !important; stroke-width: 4 !important; }
      .draft-line {
        fill: none; stroke: var(--primary-color, #03a9f4); stroke-width: 4;
        vector-effect: non-scaling-stroke; pointer-events: none;
      }
      .draft-point, .vertex {
        fill: var(--primary-color, #03a9f4); stroke: var(--card-background-color, #ffffff);
        stroke-width: 3; vector-effect: non-scaling-stroke;
      }
      .vertex.selected-vertex {
        fill: var(--warning-color, #ff9800);
        stroke-width: 5;
      }
      .midpoint {
        fill: var(--card-background-color, #ffffff);
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 3; vector-effect: non-scaling-stroke;
        cursor: copy;
      }
      .draft-point { pointer-events: none; }
      .draft-point.close-target { pointer-events: auto; cursor: pointer; }
      .vertex { cursor: grab; }
      .vertex:active { cursor: grabbing; }
      .empty-message {
        position: absolute; inset: 0; display: grid; place-items: center; padding: 24px;
        box-sizing: border-box; text-align: center; color: var(--secondary-text-color, #727272);
        font-size: 14px; pointer-events: none;
      }
      .draw-hint {
        position: absolute; left: 12px; bottom: 12px; z-index: 2;
        padding: 7px 10px; border-radius: 8px;
        background: color-mix(in srgb, var(--card-background-color, #fff) 88%, transparent);
        color: var(--primary-text-color, #212121); font-size: 12px; pointer-events: none;
      }
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
      if (imageConfigured) {
        message.textContent = "Loading floorplan image…";
      } else {
        message.textContent = interactive
          ? "Choose or upload a floorplan image, then draw zones on this canvas."
          : "Choose a floorplan image in the card editor.";
      }
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
      polygon.classList.add("zone");
      polygon.dataset.zoneId = zone.id ?? "";
      polygon.setAttribute("points", pointList(zone.points));
      polygon.setAttribute("fill", zoneStyle.color ?? DEFAULT_UNAVAILABLE_STYLE.color);
      polygon.setAttribute("fill-opacity", String(zoneStyle.opacity ?? DEFAULT_UNAVAILABLE_STYLE.opacity));
      polygon.setAttribute("stroke", zone.stroke?.color ?? "transparent");
      polygon.setAttribute("stroke-width", String(zone.stroke?.width ?? 0));

      if (interactive && mode !== "draw") {
        polygon.classList.add("selectable");
        polygon.addEventListener("click", (event) => {
          event.stopPropagation();
          this.dispatchEditorEvent("floorplan-zone-select", { zoneId: zone.id });
        });
      } else {
        polygon.style.pointerEvents = "none";
      }

      if (interactive && zone.id === selectedZoneId && mode === "edit") {
        polygon.classList.add("selected");
      }

      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = zone.name || zone.entity || zone.id || "Zone";
      polygon.append(title);
      svg.append(polygon);

      if (interactive && zone.id === selectedZoneId && mode === "edit") {
        const handles = [];
        const midpointHandles = [];

        zone.points.forEach((point, edgeIndex) => {
          const next = zone.points[(edgeIndex + 1) % zone.points.length];
          const midpoint = document.createElementNS(SVG_NS, "circle");
          midpoint.classList.add("midpoint");
          midpoint.dataset.edgeIndex = String(edgeIndex);
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
          if (vertexIndex === selectedVertexIndex) handle.classList.add("selected-vertex");
          handle.dataset.vertexIndex = String(vertexIndex);
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
              // Pointer capture is an optimization; dragging still works without it.
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
        handle.setAttribute("r", index === 0 && draftPoints.length >= 3 ? "14" : "9");
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
        const point = this.pointerPoint(event, svg);
        this.dispatchEditorEvent("floorplan-draw-point", { point });
      });

      const hint = document.createElement("div");
      hint.className = "draw-hint";
      hint.textContent = draftPoints.length >= 3
        ? "Click the first point or Close polygon"
        : "Click on the floorplan to add polygon points";
      container.append(hint);
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
          // Ignore browsers that did not establish pointer capture.
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
      :host { display: block; }
      ha-card { overflow: hidden; }
      .header {
        padding: 16px 16px 0; color: var(--ha-card-header-color, var(--primary-text-color));
        font-size: var(--ha-card-header-font-size, 24px); line-height: 1.2;
      }
      .content { padding: 16px; }
      .header + .content { padding-top: 12px; }
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
    this.shadowRoot?.querySelectorAll("ha-form").forEach((form) => {
      form.hass = hass;
    });
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this.render();
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
    zones[index] = updater(zones[index]);
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

  createButton(text, onClick, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (options.kind) button.classList.add(options.kind);
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
          this.createTextInput(this._config.title, "Optional title", (value) => {
            this.updateConfig({ title: value });
          }),
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
    const legacyImage = typeof this._config.image === "string" ? this._config.image : undefined;
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
    const input = this.createTextInput(legacyImage, "/local/floorplan.png", (value) => {
      this.updateConfig({ image: value });
    });
    wrapper.append(hint, this.createField("Legacy image URL/path", input));
    return wrapper;
  }

  createZoneForm(zone, index) {
    if (!customElements.get("ha-form")) {
      const grid = document.createElement("div");
      grid.className = "grid";
      const name = this.createTextInput(zone.name, "Zone name", (value) => {
        this.updateZone(index, (current) => ({ ...current, name: value }));
      });
      const entity = this.createTextInput(zone.entity, "binary_sensor.example", (value) => {
        this.updateZone(index, (current) => ({ ...current, entity: value }));
      });
      grid.append(this.createField("Name", name), this.createField("Binary sensor entity", entity));
      return grid;
    }

    const form = document.createElement("ha-form");
    form.className = "native-form zone-native-form";
    form.hass = this._hass;
    form.data = {
      name: zone.name ?? "",
      entity: zone.entity || undefined,
      on_color: zone.on?.color ?? DEFAULT_ON_STYLE.color,
      off_color: zone.off?.color ?? DEFAULT_OFF_STYLE.color,
      on_opacity: zone.on?.opacity ?? DEFAULT_ON_STYLE.opacity,
      off_opacity: zone.off?.opacity ?? DEFAULT_OFF_STYLE.opacity,
    };
    form.schema = [
      { name: "name", selector: { text: {} } },
      { name: "entity", selector: { entity: { filter: { domain: "binary_sensor" } } } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "on_color", selector: { text: { type: "color" } } },
          { name: "off_color", selector: { text: { type: "color" } } },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "on_opacity",
            selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
          },
          {
            name: "off_opacity",
            selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
          },
        ],
      },
    ];
    form.computeLabel = (schema) => {
      switch (schema.name) {
        case "name": return "Name";
        case "entity": return "Binary sensor entity";
        case "on_color": return "ON color";
        case "off_color": return "OFF color";
        case "on_opacity": return "ON opacity";
        case "off_opacity": return "OFF opacity";
        default: return "";
      }
    };
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const value = event.detail?.value ?? {};
      this.updateZone(index, (current) => ({
        ...current,
        name: value.name ?? "",
        entity: value.entity ?? "",
        on: {
          ...current.on,
          color: value.on_color ?? DEFAULT_ON_STYLE.color,
          opacity: Number(value.on_opacity ?? DEFAULT_ON_STYLE.opacity),
        },
        off: {
          ...current.off,
          color: value.off_color ?? DEFAULT_OFF_STYLE.color,
          opacity: Number(value.off_opacity ?? DEFAULT_OFF_STYLE.opacity),
        },
      }));
    });
    return form;
  }

  render() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.replaceChildren();

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .editor, .zones, .zone-card, .field, .preview, .fallback-form, .native-form-wrapper { display: grid; gap: 10px; }
      .editor { gap: 18px; }
      .field > span { color: var(--primary-text-color); font-size: 14px; font-weight: 500; }
      input {
        box-sizing: border-box; width: 100%; min-height: 42px; padding: 8px 12px;
        border: 1px solid var(--divider-color, #c7c7c7); border-radius: 8px;
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); font: inherit;
      }
      button {
        min-height: 40px; padding: 8px 14px; border: 0; border-radius: 8px;
        background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff);
        cursor: pointer; font: inherit; font-weight: 500;
      }
      button.secondary {
        background: transparent; color: var(--primary-color, #03a9f4);
        border: 1px solid var(--primary-color, #03a9f4);
      }
      button.danger {
        background: transparent; color: var(--error-color, #db4437);
        border: 1px solid var(--error-color, #db4437);
      }
      button:disabled { opacity: 0.45; cursor: default; }
      .section-title, .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .toolbar { justify-content: flex-start; flex-wrap: wrap; }
      .mode-status {
        padding: 8px 10px; border-radius: 8px; background: var(--secondary-background-color, #eee);
        color: var(--secondary-text-color, #727272); font-size: 13px;
      }
      .zone-card { padding: 12px; border: 1px solid var(--divider-color, #d0d0d0); border-radius: 10px; }
      .zone-card.selected { border-color: var(--primary-color, #03a9f4); box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4); }
      .native-form { display: block; }
      .zone-native-form { margin-top: 4px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .hint { margin: 0; color: var(--secondary-text-color, #727272); font-size: 13px; line-height: 1.45; }
      @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
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
      status.textContent = this._selectedVertexIndex === null ? "Editing shape" : `Vertex ${this._selectedVertexIndex + 1} selected`;
    } else {
      status.textContent = "Select a zone";
    }
    previewTitle.append(previewHeading, status);

    const canvas = document.createElement(CANVAS_TAG);
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.editorState = this.canvasState();
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
        this.createButton(
          "Undo point",
          () => {
            this._draftPoints = this._draftPoints.slice(0, -1);
            this.render();
          },
          { kind: "secondary", disabled: this._draftPoints.length === 0 },
        ),
        this.createButton("Close polygon", () => this.closeDrawing(), {
          disabled: this._draftPoints.length < 3,
        }),
        this.createButton("Cancel", () => this.cancelDrawing(), { kind: "danger" }),
      );
    } else if (this._mode === "edit") {
      const zone = this._config.zones.find((item) => item.id === this._selectedZoneId);
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
        this.createButton("Delete vertex", () => this.deleteSelectedVertex(), {
          kind: "danger",
          disabled:
            this._selectedVertexIndex === null ||
            !zone ||
            (zone.points?.length ?? 0) <= 3,
        }),
      );
    }
    if (toolbar.childElementCount) preview.append(toolbar);

    if (this._mode === "edit") {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Drag a blue vertex to move it. Click a small white midpoint to insert a new vertex. Select a vertex by clicking/dragging it, then use Delete vertex if the polygon has more than three points.";
      preview.append(hint);
    }
    editor.append(preview);

    const zones = document.createElement("div");
    zones.className = "zones";
    const zoneTitle = document.createElement("div");
    zoneTitle.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "Zones";
    const add = this.createButton("Add zone", () => this.startDrawing(), {
      disabled: this._mode === "draw",
    });
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
      const edit = this.createButton("Edit shape", () => this.selectZone(zone.id), { kind: "secondary" });
      const remove = this.createButton(
        "Delete",
        () => {
          if (this._selectedZoneId === zone.id) {
            this._selectedZoneId = null;
            this._selectedVertexIndex = null;
            this._mode = "select";
          }
          this.updateConfig({ zones: this._config.zones.filter((_, i) => i !== index) }, true);
        },
        { kind: "danger" },
      );
      actions.append(edit, remove);
      header.append(name, actions);
      zoneCard.append(header, this.createZoneForm(zone, index));

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "The entity picker is limited to binary_sensor entities. Shape coordinates remain normalized and are saved only after pointer release.";
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
    description: "Display a floorplan with state-driven polygon zones.",
    preview: true,
    documentationURL: "https://github.com/xtimmy86x/ha-floorplan-zone-card",
  });
}

console.info(
  `%c FLOORPLAN-ZONE-CARD %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;",
);
