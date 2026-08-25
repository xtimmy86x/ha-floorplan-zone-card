const CARD_TYPE = "floorplan-zone-card";
const CARD_TAG = "floorplan-zone-card";
const EDITOR_TAG = "floorplan-zone-card-editor";
const CANVAS_TAG = "floorplan-zone-canvas";
const VERSION = "0.1.0-dev.0";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_SIZE = 1000;

const DEFAULT_ON_STYLE = Object.freeze({ color: "#ff3b30", opacity: 0.55 });
const DEFAULT_OFF_STYLE = Object.freeze({ color: "#808080", opacity: 0.08 });
const DEFAULT_UNAVAILABLE_STYLE = Object.freeze({ color: "#9e9e9e", opacity: 0.2 });
const DEFAULT_STROKE = Object.freeze({ color: "#ffffff", width: 2 });

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultZone(index) {
  return {
    id: `zone_${index}`,
    name: `Zone ${index}`,
    entity: "",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ],
    on: { ...DEFAULT_ON_STYLE },
    off: { ...DEFAULT_OFF_STYLE },
    unavailable: { ...DEFAULT_UNAVAILABLE_STYLE },
    stroke: { ...DEFAULT_STROKE },
  };
}

function normalizedConfig(config) {
  return {
    ...deepClone(config),
    zones: Array.isArray(config.zones) ? deepClone(config.zones) : [],
  };
}

function stateStyle(hass, zone) {
  const state = zone.entity ? hass?.states?.[zone.entity]?.state : undefined;

  if (state === "on") return zone.on ?? DEFAULT_ON_STYLE;
  if (state === "off") return zone.off ?? DEFAULT_OFF_STYLE;
  return zone.unavailable ?? DEFAULT_UNAVAILABLE_STYLE;
}

class FloorplanZoneCanvas extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { zones: [] };
    this._hass = undefined;
    this._interactive = false;
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

  set interactive(value) {
    this._interactive = Boolean(value);
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.replaceChildren();

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
      polygon { vector-effect: non-scaling-stroke; transition: fill 160ms ease, fill-opacity 160ms ease; }
      .empty-message {
        position: absolute; inset: 0; display: grid; place-items: center; padding: 24px;
        box-sizing: border-box; text-align: center; color: var(--secondary-text-color, #727272);
        font-size: 14px;
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
      message.textContent = "Choose a floorplan image in the card editor.";
      container.append(message);
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Floorplan zones");

    for (const zone of this._config?.zones ?? []) {
      if (!Array.isArray(zone.points) || zone.points.length < 3) continue;

      const polygon = document.createElementNS(SVG_NS, "polygon");
      const points = zone.points
        .map((point) => `${Number(point.x) * SVG_SIZE},${Number(point.y) * SVG_SIZE}`)
        .join(" ");
      const zoneStyle = stateStyle(this._hass, zone);

      polygon.setAttribute("points", points);
      polygon.setAttribute("fill", zoneStyle.color ?? DEFAULT_UNAVAILABLE_STYLE.color);
      polygon.setAttribute("fill-opacity", String(zoneStyle.opacity ?? DEFAULT_UNAVAILABLE_STYLE.opacity));
      polygon.setAttribute("stroke", zone.stroke?.color ?? "transparent");
      polygon.setAttribute("stroke-width", String(zone.stroke?.width ?? 0));
      polygon.style.pointerEvents = this._interactive ? "auto" : "none";

      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = zone.name || zone.entity || zone.id || "Zone";
      polygon.append(title);
      svg.append(polygon);
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
  }

  setConfig(config) {
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

  updatePreview() {
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (!canvas) return;
    canvas.config = this._config;
    canvas.hass = this._hass;
  }

  updateConfig(patch, rerender = false) {
    this._config = { ...this._config, ...patch };
    this.emitConfigChanged();
    if (rerender) {
      this.render();
    } else {
      this.updatePreview();
    }
  }

  updateZone(index, updater) {
    const zones = deepClone(this._config?.zones ?? []);
    zones[index] = updater(zones[index]);
    this.updateConfig({ zones });
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
      button.danger {
        background: transparent; color: var(--error-color, #db4437);
        border: 1px solid var(--error-color, #db4437);
      }
      .section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .zone-card { padding: 12px; border: 1px solid var(--divider-color, #d0d0d0); border-radius: 10px; }
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
    imageHint.textContent = "First milestone: URL/path input. Native Home Assistant image upload is planned next.";
    editor.append(imageHint);

    const preview = document.createElement("div");
    preview.className = "preview";
    const previewTitle = document.createElement("strong");
    previewTitle.textContent = "Preview";
    const canvas = document.createElement(CANVAS_TAG);
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.interactive = true;
    preview.append(previewTitle, canvas);
    editor.append(preview);

    const zones = document.createElement("div");
    zones.className = "zones";
    const zoneTitle = document.createElement("div");
    zoneTitle.className = "section-title";
    const heading = document.createElement("strong");
    heading.textContent = "Zones";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add zone";
    add.addEventListener("click", () => {
      const next = [...(this._config.zones ?? []), createDefaultZone((this._config.zones?.length ?? 0) + 1)];
      this.updateConfig({ zones: next }, true);
    });
    zoneTitle.append(heading, add);
    zones.append(zoneTitle);

    if ((this._config.zones?.length ?? 0) === 0) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Add a zone to create the first polygon placeholder.";
      zones.append(hint);
    }

    for (const [index, zone] of (this._config.zones ?? []).entries()) {
      const zoneCard = document.createElement("section");
      zoneCard.className = "zone-card";

      const header = document.createElement("div");
      header.className = "section-title";
      const name = document.createElement("strong");
      name.textContent = zone.name || `Zone ${index + 1}`;
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        this.updateConfig({ zones: this._config.zones.filter((_, i) => i !== index) }, true);
      });
      header.append(name, remove);
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
      hint.textContent = "This commit creates a default rectangle. Point-and-click drawing and draggable vertices are the next milestone.";
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
