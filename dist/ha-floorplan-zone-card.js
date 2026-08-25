const CARD_TYPE = "floorplan-zone-card";
const CARD_TAG = "floorplan-zone-card";
const EDITOR_TAG = "floorplan-zone-card-editor";
const CANVAS_TAG = "floorplan-zone-canvas";
const VERSION = "0.1.0-dev.1";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_SIZE = 1000;

const DEFAULT_ON_STYLE = Object.freeze({ color: "#ff3b30", opacity: 0.55 });
const DEFAULT_OFF_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_UNAVAILABLE_STYLE = Object.freeze({ color: "#9e9e9e", opacity: 0.2 });
const DEFAULT_STROKE = Object.freeze({ color: "#ffffff", width: 2 });

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
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
      draftPoints: [],
    };
    this._drag = null;
  }

  set config(config) {
    this._config = config ?? { zones: [] };
    this.render();
  }

  get config() {
    return this._config;
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  get hass() {
    return this._hass;
  }

  set editorState(state) {
    this._editorState = {
      interactive: Boolean(state?.interactive),
      mode: state?.mode ?? "view",
      selectedZoneId: state?.selectedZoneId ?? null,
      draftPoints: Array.isArray(state?.draftPoints) ? state.draftPoints.map(normalizePoint) : [],
    };
    this.render();
  }

  connectedCallback() {
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
    const { polygon, handles, points, vertexIndex } = this._drag;
    points[vertexIndex] = normalizePoint(point);
    polygon.setAttribute("points", pointList(points));
    const handle = handles[vertexIndex];
    if (handle) {
      handle.setAttribute("cx", String(points[vertexIndex].x * SVG_SIZE));
      handle.setAttribute("cy", String(points[vertexIndex].y * SVG_SIZE));
    }
  }

  render() {
    if (!this.shadowRoot) return;
    this._drag = null;
    this.shadowRoot.replaceChildren();

    const interactive = this._editorState.interactive;
    const mode = this._editorState.mode;
    const selectedZoneId = this._editorState.selectedZoneId;
    const draftPoints = this._editorState.draftPoints;

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
      svg {
        position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible;
      }
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
    const image = this._config?.image?.trim?.() ?? "";

    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = this._config?.title || "Floorplan";
      container.append(img);
    } else {
      container.classList.add("empty");
      const message = document.createElement("div");
      message.className = "empty-message";
      message.textContent = interactive
        ? "Choose a floorplan image, then draw zones on this canvas."
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
        zone.points.forEach((point, vertexIndex) => {
          const handle = document.createElementNS(SVG_NS, "circle");
          handle.classList.add("vertex");
          handle.dataset.vertexIndex = String(vertexIndex);
          handle.setAttribute("cx", String(point.x * SVG_SIZE));
          handle.setAttribute("cy", String(point.y * SVG_SIZE));
          handle.setAttribute("r", "11");
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
        if (commit) {
          this.updateDragGeometry(this.pointerPoint(event, svg));
          this.dispatchEditorEvent("floorplan-vertex-commit", {
            zoneId: this._drag.zoneId,
            points: this._drag.points.map(normalizePoint),
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
    return { image: "", zones: [] };
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
    this._draftPoints = [];
  }

  setConfig(config) {
    this._config = normalizedConfig(config);
    if (
      this._selectedZoneId &&
      !this._config.zones.some((zone) => zone.id === this._selectedZoneId)
    ) {
      this._selectedZoneId = null;
      if (this._mode === "edit") this._mode = "select";
    }
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.updatePreview();
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

  updateZone(index, updater) {
    const zones = deepClone(this._config?.zones ?? []);
    zones[index] = updater(zones[index]);
    this.updateConfig({ zones });
  }

  selectZone(zoneId) {
    if (!this._config?.zones?.some((zone) => zone.id === zoneId)) return;
    this._selectedZoneId = zoneId;
    this._mode = "edit";
    this._draftPoints = [];
    this.render();
  }

  startDrawing() {
    this._mode = "draw";
    this._selectedZoneId = null;
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
    this._mode = "edit";
    this.emitConfigChanged();
    this.render();
  }

  commitVertices(zoneId, points) {
    const index = this._config.zones.findIndex((zone) => zone.id === zoneId);
    if (index < 0 || !Array.isArray(points) || points.length < 3) return;
    const zones = deepClone(this._config.zones);
    zones[index] = { ...zones[index], points: points.map(normalizePoint) };
    this._config = { ...this._config, zones };
    this.emitConfigChanged();
    this.updatePreview();
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
    input.value = value;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  createOpacityInput(value, onInput) {
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.05";
    input.value = String(value);
    input.addEventListener("input", () => onInput(Number(input.value)));
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

  render() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.replaceChildren();

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .editor, .zones, .zone-card, .field, .preview { display: grid; gap: 10px; }
      .editor { gap: 18px; }
      .field > span { color: var(--primary-text-color); font-size: 14px; font-weight: 500; }
      input {
        box-sizing: border-box; width: 100%; min-height: 42px; padding: 8px 12px;
        border: 1px solid var(--divider-color, #c7c7c7); border-radius: 8px;
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); font: inherit;
      }
      input[type="color"] { padding: 4px; }
      input[type="range"] { padding: 0; border: 0; }
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
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .hint { margin: 0; color: var(--secondary-text-color, #727272); font-size: 13px; line-height: 1.45; }
      @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    `;

    const editor = document.createElement("div");
    editor.className = "editor";

    const imageInput = this.createTextInput(this._config.image, "/local/floorplan.png", (value) => {
      this.updateConfig({ image: value });
    });
    editor.append(this.createField("Floorplan image URL", imageInput));

    const imageHint = document.createElement("p");
    imageHint.className = "hint";
    imageHint.textContent = "Image URL/path for now. Native Home Assistant image upload is planned for the next milestone.";
    editor.append(imageHint);

    const preview = document.createElement("div");
    preview.className = "preview";
    const previewTitle = document.createElement("div");
    previewTitle.className = "section-title";
    const previewHeading = document.createElement("strong");
    previewHeading.textContent = "Floorplan editor";
    const status = document.createElement("span");
    status.className = "mode-status";
    if (this._mode === "draw") status.textContent = `Drawing · ${this._draftPoints.length} point${this._draftPoints.length === 1 ? "" : "s"}`;
    else if (this._mode === "edit") status.textContent = "Editing shape";
    else status.textContent = "Select a zone";
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
      this.commitVertices(event.detail.zoneId, event.detail.points);
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
      toolbar.append(
        this.createButton(
          "Done editing",
          () => {
            this._mode = "select";
            this._selectedZoneId = null;
            this.render();
          },
          { kind: "secondary" },
        ),
      );
    }
    if (toolbar.childElementCount) preview.append(toolbar);
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
            this._mode = "select";
          }
          this.updateConfig({ zones: this._config.zones.filter((_, i) => i !== index) }, true);
        },
        { kind: "danger" },
      );
      actions.append(edit, remove);
      header.append(name, actions);
      zoneCard.append(header);

      const grid = document.createElement("div");
      grid.className = "grid";
      grid.append(
        this.createField(
          "Name",
          this.createTextInput(zone.name, "Zone name", (value) => {
            this.updateZone(index, (current) => ({ ...current, name: value }));
          }),
        ),
        this.createField(
          "Binary sensor entity",
          this.createTextInput(zone.entity, "binary_sensor.example", (value) => {
            this.updateZone(index, (current) => ({ ...current, entity: value }));
          }),
        ),
        this.createField(
          "ON color",
          this.createColorInput(zone.on?.color ?? DEFAULT_ON_STYLE.color, (value) => {
            this.updateZone(index, (current) => ({ ...current, on: { ...current.on, color: value } }));
          }),
        ),
        this.createField(
          "OFF color",
          this.createColorInput(zone.off?.color ?? DEFAULT_OFF_STYLE.color, (value) => {
            this.updateZone(index, (current) => ({ ...current, off: { ...current.off, color: value } }));
          }),
        ),
        this.createField(
          `ON opacity: ${(zone.on?.opacity ?? DEFAULT_ON_STYLE.opacity).toFixed(2)}`,
          this.createOpacityInput(zone.on?.opacity ?? DEFAULT_ON_STYLE.opacity, (value) => {
            this.updateZone(index, (current) => ({ ...current, on: { ...current.on, opacity: value } }));
          }),
        ),
        this.createField(
          `OFF opacity: ${(zone.off?.opacity ?? DEFAULT_OFF_STYLE.opacity).toFixed(2)}`,
          this.createOpacityInput(zone.off?.opacity ?? DEFAULT_OFF_STYLE.opacity, (value) => {
            this.updateZone(index, (current) => ({ ...current, off: { ...current.off, opacity: value } }));
          }),
        ),
      );

      zoneCard.append(grid);
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Use Edit shape or click the polygon, then drag any blue vertex. Coordinates are saved when you release the pointer.";
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
