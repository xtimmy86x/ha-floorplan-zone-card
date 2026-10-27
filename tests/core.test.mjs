import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function loadCore() {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  const registry = new Map();
  const context = vm.createContext({
    console: { ...console, info() {} },
    setTimeout,
    clearTimeout,
    HTMLElement: class HTMLElement {
      attachShadow() {
        this.shadowRoot = {};
      }
    },
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
        this.composed = Boolean(options.composed);
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
        this.bubbles = Boolean(options.bubbles);
        this.composed = Boolean(options.composed);
      }
    },
    customElements: {
      get(name) { return registry.get(name); },
      define(name, value) { registry.set(name, value); },
      whenDefined() { return Promise.resolve(); },
    },
    window: {},
  });

  const expose = `\n;globalThis.__core = {
    normalizeStateRule,
    normalizeLabel,
    polygonCentroid,
    zoneLabelPoint,
    zoneLabelLines,
    normalizeSvgBounds,
    svgBoundsValid,
    zoneUsesSvgObject,
    stateRuleValidation,
    normalizedConfig,
    stateStyle,
    resolvedZoneState,
    normalizePriority,
    normalizeEntityRule,
    autoZoomRuleValidation,
    viewForFocusArea,
    matchingAutoZoomRule,
    zoneFocusArea,
    effectiveAction,
    imageContentId,
    activeImageSource,
    activeFloorplanTheme,
    themeImageConfigKey,
    dualThemeSvgWarnings,
    FloorplanZoneCardEditor,
  };`;
  vm.runInContext(source + expose, context, { filename: "ha-floorplan-zone-card.js" });
  return context.__core;
}

const core = await loadCore();

test("normalizes state effects and border flags safely", () => {
  assert.deepEqual(
    structuredClone(core.normalizeStateRule({ value: 3, color: "#123456", opacity: 0.6, effect: "blink", highlight_border: true })),
    { value: "3", color: "#123456", opacity: 0.6, effect: "blink", highlight_border: true },
  );
  assert.equal(core.normalizeStateRule({ effect: "invalid" }).effect, "none");
  assert.equal(core.normalizeStateRule({ highlight_border: "yes" }).highlight_border, false);
});

test("detects duplicate, empty and reserved state rules", () => {
  const result = structuredClone(core.stateRuleValidation([
    { value: "alarm" },
    { value: "" },
    { value: "alarm" },
    { value: "unavailable" },
    { value: "unknown" },
  ]));
  assert.deepEqual(result.emptyIndexes, [1]);
  assert.deepEqual(result.duplicateIndexes, [0, 2]);
  assert.deepEqual(result.duplicateValues, ["alarm"]);
  assert.deepEqual(result.reservedIndexes, [3, 4]);
});

test("legacy on/off configuration is normalized with static effects", () => {
  const config = structuredClone(core.normalizedConfig({
    zones: [{
      id: "zone_1",
      entity: "binary_sensor.test",
      on: { color: "#ff0000", opacity: 0.7 },
      off: { color: "#000000", opacity: 0.1 },
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    }],
  }));
  assert.equal(config.zones[0].on, undefined);
  assert.equal(config.zones[0].off, undefined);
  assert.deepEqual(config.zones[0].states.map(({ value, effect, highlight_border }) => ({ value, effect, highlight_border })), [
    { value: "off", effect: "none", highlight_border: false },
    { value: "on", effect: "none", highlight_border: false },
  ]);
});

test("state styling uses first exact match and reserves unavailable states", () => {
  const zone = core.normalizedConfig({
    zones: [{
      id: "zone_1",
      entity: "sensor.mode",
      states: [
        { value: "alarm", color: "#111111", opacity: 0.2 },
        { value: "alarm", color: "#222222", opacity: 0.8 },
        { value: "unavailable", color: "#ff0000", opacity: 1 },
      ],
      unavailable: { color: "#999999", opacity: 0.3 },
    }],
  }).zones[0];

  const alarm = core.stateStyle({ states: { "sensor.mode": { state: "alarm" } } }, zone);
  assert.equal(alarm.color, "#111111");

  const unavailable = core.stateStyle({ states: { "sensor.mode": { state: "unavailable" } } }, zone);
  assert.equal(unavailable.color, "#999999");
});

test("auto zoom validation catches incomplete and stale rules", () => {
  const config = { zones: [{ id: "zone_1" }] };
  assert.deepEqual(structuredClone(core.autoZoomRuleValidation(config, { target: "zone", entity: "", state: "", zone_id: "" })), [
    "Choose an entity.",
    "Enter the exact trigger state.",
    "Select a zone to focus.",
  ]);
  assert.deepEqual(structuredClone(core.autoZoomRuleValidation(config, { target: "zone", entity: "sensor.a", state: "on", zone_id: "missing" })), [
    "The selected focus zone no longer exists.",
  ]);
  assert.deepEqual(structuredClone(core.autoZoomRuleValidation(config, { target: "area", entity: "sensor.a", state: "on" })), [
    "Draw a valid custom focus area.",
  ]);
});

test("auto zoom keeps rule order as priority", () => {
  const config = core.normalizedConfig({
    zones: [
      { id: "zone_1", points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.1, y: 0.3 }] },
      { id: "zone_2", points: [{ x: 0.6, y: 0.6 }, { x: 0.9, y: 0.6 }, { x: 0.6, y: 0.9 }] },
    ],
    auto_zoom: [
      { entity: "binary_sensor.a", state: "on", target: "zone", zone_id: "zone_1" },
      { entity: "binary_sensor.b", state: "on", target: "zone", zone_id: "zone_2" },
    ],
  });
  const hass = { states: {
    "binary_sensor.a": { state: "on" },
    "binary_sensor.b": { state: "on" },
  } };
  const match = core.matchingAutoZoomRule(config, hass);
  assert.equal(match.index, 0);
  assert.equal(match.rule.zone_id, "zone_1");
});

test("focus view stays bounded and respects zoom limits", () => {
  const view = structuredClone(core.viewForFocusArea({ x: 0.9, y: 0.9, width: 0.05, height: 0.05 }));
  assert.equal(view.scale, 5);
  assert.ok(view.centerX <= 0.9);
  assert.ok(view.centerY <= 0.9);
  assert.ok(view.centerX >= 0.1);
  assert.ok(view.centerY >= 0.1);
});

test("legacy zones keep implicit more-info tap action", () => {
  const action = structuredClone(core.effectiveAction({ entity: "sensor.example" }, "tap_action"));
  assert.deepEqual(action, { action: "more-info" });
});


test("normalizes labels with safe defaults and bounded styling", () => {
  const label = structuredClone(core.normalizeLabel({
    enabled: true,
    content: "name_state",
    position_mode: "custom",
    position: { x: 1.4, y: -0.2 },
    color: "#123456",
    size: 120,
    weight: 700,
    opacity: 1.4,
    background: true,
    background_color: "#111111",
    background_opacity: -1,
  }));
  assert.equal(label.enabled, true);
  assert.equal(label.content, "name_state");
  assert.deepEqual(label.position, { x: 1, y: 0 });
  assert.equal(label.size, 72);
  assert.equal(label.weight, 700);
  assert.equal(label.opacity, 1);
  assert.equal(label.background, true);
  assert.equal(label.background_opacity, 0);

  const fallback = structuredClone(core.normalizeLabel({ content: "bad", weight: 999 }));
  assert.equal(fallback.enabled, false);
  assert.equal(fallback.content, "name");
  assert.equal(fallback.position_mode, "auto");
  assert.equal(fallback.weight, 600);
});

test("automatic labels use polygon centroid while custom labels keep their point", () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const centroid = structuredClone(core.polygonCentroid(points));
  assert.ok(Math.abs(centroid.x - 1 / 3) < 1e-9);
  assert.ok(Math.abs(centroid.y - 1 / 3) < 1e-9);

  const automatic = structuredClone(core.zoneLabelPoint({ points, label: { enabled: true } }));
  assert.ok(Math.abs(automatic.x - 1 / 3) < 1e-9);
  assert.ok(Math.abs(automatic.y - 1 / 3) < 1e-9);

  const custom = structuredClone(core.zoneLabelPoint({
    points,
    label: { enabled: true, position_mode: "custom", position: { x: 0.8, y: 0.2 } },
  }));
  assert.deepEqual(custom, { x: 0.8, y: 0.2 });
});

test("name plus state labels include Home Assistant units", () => {
  const lines = structuredClone(core.zoneLabelLines({
    states: {
      "sensor.temperature": {
        state: "23.4",
        attributes: { unit_of_measurement: "°C" },
      },
    },
  }, {
    id: "zone_1",
    name: "Boiler room",
    entity: "sensor.temperature",
    label: { enabled: true, content: "name_state" },
  }));
  assert.deepEqual(lines, ["Boiler room", "23.4 °C"]);
});


test("raster zoom uses layout sizing instead of transform scaling", async () => {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /will-change:transform/);
  assert.match(source, /transform\.style\.width = `\$\{scale \* 100\}%`/);
  assert.match(source, /transform\.style\.height = `\$\{scale \* 100\}%`/);
  assert.match(source, /transform\.style\.transform = `translate\(\$\{panX\}px, \$\{panY\}px\)`/);
  assert.doesNotMatch(source, /translate\(\$\{panX\}px, \$\{panY\}px\) scale\(\$\{scale\}\)/);
});


test("normalizes SVG object zones and uses their bounds for focus and labels", () => {
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
  const bounds = structuredClone(core.normalizeSvgBounds({ x: -1, y: 0.8, width: 2, height: 1 }));
  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0.8);
  assert.equal(bounds.width, 1);
  assert.ok(Math.abs(bounds.height - 0.2) < 1e-12);
  assert.equal(core.svgBoundsValid({ x: 0.2, y: 0.2, width: 0, height: 0.3 }), false);
});



test("SVG object overlay uses the floorplan viewport directly", async () => {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  assert.match(source, /\.svg-source-layer \{ position:absolute; inset:0; width:100%; height:100%/);
  assert.match(source, /const sourceSvgLayer = this\.createSvgSourceLayer\(transform\);/);
  assert.doesNotMatch(source, /createSvgSourceLayer\(svg\)/);
  assert.doesNotMatch(source, /layer\.setAttribute\("width", String\(SVG_SIZE\)\)/);
  assert.doesNotMatch(source, /layer\.setAttribute\("height", String\(SVG_SIZE\)\)/);
  assert.match(source, /layer\.setAttribute\("viewBox", this\._svgSource\.viewBox\)/);
  assert.match(source, /layer\.setAttribute\("preserveAspectRatio", this\._svgSource\.preserveAspectRatio\)/);
});



test("editor UI is container-responsive and collapsible", async () => {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  assert.match(source, /const VERSION = "0\.3\.0"/);
  assert.match(source, /container-type:inline-size/);
  assert.match(source, /@container \(min-width:600px\)/);
  assert.match(source, /this\._workspaceOpen = false/);
  assert.match(source, /workspace-body/);
  assert.match(source, /this\._expandedZoneIds = new Set\(\)/);
  assert.match(source, /zone-card-body/);
  assert.match(source, /Add zone/);
  assert.match(source, /Draw manually/);
  assert.doesNotMatch(source, /@media \(max-width:700px\)/);
});



test("theme-aware floorplans select the expected source", () => {
  const config = {
    image: "/local/light.svg",
    image_dark: "/local/dark.svg",
  };
  assert.equal(core.activeImageSource(config, { themes: { darkMode: false } }), "/local/light.svg");
  assert.equal(core.activeImageSource(config, { themes: { darkMode: true } }), "/local/dark.svg");
  assert.equal(core.activeFloorplanTheme(config, { themes: { darkMode: false } }), "light");
  assert.equal(core.activeFloorplanTheme(config, { themes: { darkMode: true } }), "dark");
});

test("dark mode falls back to the default floorplan when image_dark is absent", () => {
  const config = { image: "/local/default.svg" };
  assert.equal(core.activeImageSource(config, { themes: { darkMode: true } }), "/local/default.svg");
  assert.equal(core.activeFloorplanTheme(config, { themes: { darkMode: true } }), "light");
});

test("theme-aware floorplans support Home Assistant media selector objects", () => {
  const light = { media_content_id: "media-source://image_upload/light" };
  const dark = { media_content_id: "media-source://image_upload/dark" };
  const config = { image: light, image_dark: dark };
  assert.equal(core.activeImageSource(config, { themes: { darkMode: false } }), light);
  assert.equal(core.activeImageSource(config, { themes: { darkMode: true } }), dark);
  assert.equal(core.imageContentId(core.activeImageSource(config, { themes: { darkMode: true } })), "media-source://image_upload/dark");
  assert.equal(core.themeImageConfigKey(config), "media-source://image_upload/light|media-source://image_upload/dark");
});

test("dual SVG theme validation detects viewBox and missing object incompatibilities", () => {
  const lightDescriptor = {
    viewBox: "0 0 1600 900",
    elementsById: new Map([["E-20", {}], ["E-30", {}]]),
  };
  const darkDescriptor = {
    viewBox: "0 0 1920 1080",
    elementsById: new Map([["E-20", {}]]),
  };
  const warnings = core.dualThemeSvgWarnings(lightDescriptor, darkDescriptor, [
    { geometry: "svg", svg_element_id: "E-20" },
    { geometry: "svg", svg_element_id: "E-30" },
  ]);
  assert.ok(warnings.some((warning) => warning.includes("different viewBox")));
  assert.ok(warnings.some((warning) => warning === "Dark floorplan is missing SVG object #E-30."));
});

test("runtime source code reacts to Home Assistant darkMode changes", async () => {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  assert.match(source, /hass\?\.themes\?\.darkMode === true/);
  assert.match(source, /activeImageSource\(this\._config, this\._hass\)/);
  assert.match(source, /image_dark/);
  assert.match(source, /Dark floorplan \(optional\)/);
});

test("editor keeps inputs mounted when Home Assistant echoes state typing", () => {
  const editor = new core.FloorplanZoneCardEditor();
  let renders = 0;
  let previews = 0;
  editor.render = () => { renders += 1; };
  editor.updatePreview = () => { previews += 1; };

  editor.setConfig({
    title: "Original",
    zones: [{
      id: "zone_1",
      entity: "sensor.status",
      states: [{ value: "on", color: "#ff0000", opacity: 0.5 }],
    }],
    auto_zoom: [{ entity: "sensor.status", state: "on", target: "zone", zone_id: "zone_1" }],
  });
  assert.equal(renders, 1);

  // The dashboard sends the same config back synchronously after each edit.
  editor.dispatchEvent = (event) => {
    if (event.type === "config-changed") editor.setConfig(event.detail.config);
    return true;
  };

  for (const value of ["a", "al", "ala", "alar", "alarm"]) {
    editor.updateZone(0, (zone) => ({
      ...zone,
      states: [{ ...zone.states[0], value }],
    }));
  }

  assert.equal(editor._config.zones[0].states[0].value, "alarm");
  assert.equal(previews, 5);
  assert.equal(renders, 1, "echoes must not rebuild a focused state input");

  for (const value of ["w", "wa", "warn", "warning"]) {
    editor.updateAutoZoomRule(0, (rule) => ({ ...rule, state: value }));
  }
  assert.equal(editor._config.auto_zoom[0].state, "warning");
  assert.equal(renders, 1, "auto zoom text inputs must also keep focus");

  // Actual external changes still require a render.
  editor.setConfig({ ...structuredClone(editor._config), title: "External change" });
  assert.equal(renders, 2);
  assert.equal(editor._config.title, "External change");
});

test("normalizes multi-entity state rules without breaking existing zones", () => {
  const first = core.normalizedConfig({
    zones: [{
      id: "z1",
      entity: "binary_sensor.a",
      states: [{ value: "on", color: "#cc0000", opacity: 0.5 }],
      entity_rules: [
        { entity: " sensor.b ", state: "on", priority: 20, color: "#00ff00", opacity: 0.9, effect: "blink", highlight_border: true },
        { entity: "sensor.c", state: "warning", priority: 20.8, color: "#ffcc00", effect: "pulse" },
        { entity: "sensor.d", state: "on", priority: "bad", color: "", effect: "invalid" },
      ],
    }],
  }).zones[0];
  assert.equal(first.priority, 0);
  assert.equal(first.entity_rules.length, 3);
  assert.equal(first.entity_rules[0].entity, "sensor.b");
  assert.equal(first.entity_rules[0].priority, 20);
  assert.equal(first.entity_rules[0].effect, "blink");
  assert.equal(first.entity_rules[0].highlight_border, true);
  assert.equal(first.entity_rules[1].priority, 20);
  assert.equal(first.entity_rules[2].priority, 10);
  assert.equal(first.entity_rules[2].effect, "none");
  assert.equal(core.normalizePriority(999999), 1000);
  assert.equal(core.normalizePriority(-999999), -1000);
  assert.equal(core.normalizePriority(""), 0);
  assert.deepEqual(structuredClone(core.normalizedConfig({ zones: [{ id: "old", entity: "sensor.old" }] }).zones[0].entity_rules), []);
});

test("multiple matching entities use highest priority then configuration order", () => {
  const zone = core.normalizedConfig({
    zones: [{
      id: "z1",
      entity: "binary_sensor.primary",
      priority: 5,
      states: [{ value: "on", color: "#ff0000" }],
      entity_rules: [
        { entity: "binary_sensor.warning", state: "on", priority: 10, color: "#ffff00", effect: "pulse", highlight_border: false },
        { entity: "binary_sensor.alarm", state: "on", priority: 100, color: "#dd0000", effect: "blink", highlight_border: true },
      ],
      default: { color: "#aaaaaa", opacity: 0.1 },
      unavailable: { color: "#bbbbbb", opacity: 0.2 },
    }],
  }).zones[0];
  const hass = { states: {
    "binary_sensor.primary": { state: "on" },
    "binary_sensor.warning": { state: "on" },
    "binary_sensor.alarm": { state: "off" },
  } };

  assert.equal(core.stateStyle(hass, zone).color, "#ffff00");
  assert.equal(core.resolvedZoneState(hass, zone).entity, "binary_sensor.warning");
  hass.states["binary_sensor.alarm"].state = "on";
  assert.equal(core.stateStyle(hass, zone).color, "#dd0000");
  assert.equal(core.stateStyle(hass, zone).effect, "blink");
  assert.equal(core.stateStyle(hass, zone).highlight_border, true);
  hass.states["binary_sensor.alarm"].state = "off";
  hass.states["binary_sensor.warning"].state = "off";
  assert.equal(core.stateStyle(hass, zone).color, "#ff0000");

  zone.entity_rules[0].priority = 5;
  hass.states["binary_sensor.warning"].state = "on";
  assert.equal(core.stateStyle(hass, zone).color, "#ff0000", "primary wins an equal priority");
  zone.entity_rules[0].priority = 6;
  assert.equal(core.stateStyle(hass, zone).color, "#ffff00");
});

test("unavailable sources do not mask other available conditions or fallback", () => {
  const zone = core.normalizedConfig({
    zones: [{
      entity: "sensor.primary",
      states: [],
      default: { color: "#111111" },
      unavailable: { color: "#999999" },
      entity_rules: [
        { entity: "sensor.secondary", state: "warning", priority: 10, color: "#ffcc00" },
        { entity: "sensor.alarm", state: "on", priority: 20, color: "#ff0000" },
      ],
    }],
  }).zones[0];

  const hass = { states: {
    "sensor.primary": { state: "unavailable" },
    "sensor.secondary": { state: "normal" },
    "sensor.alarm": { state: "unknown" },
  } };
  assert.equal(core.stateStyle(hass, zone).color, "#111111");
  hass.states["sensor.secondary"].state = "warning";
  assert.equal(core.stateStyle(hass, zone).color, "#ffcc00");
  hass.states["sensor.secondary"].state = "unavailable";
  assert.equal(core.stateStyle(hass, zone).color, "#999999");
  hass.states["sensor.alarm"].state = "on";
  assert.equal(core.stateStyle(hass, zone).color, "#ff0000");

  const legacy = core.normalizedConfig({
    zones: [{ entity: "binary_sensor.legacy", states: [{ value: "on", color: "#00aa00" }] }],
  }).zones[0];
  assert.equal(core.stateStyle({ states: { "binary_sensor.legacy": { state: "on" } } }, legacy).color, "#00aa00");
});

test("additional entity rules keep effects and can be edited without full rerender", () => {
  const editor = new core.FloorplanZoneCardEditor();
  let renders = 0;
  editor.render = () => { renders += 1; };
  editor.updatePreview = () => {};
  editor.setConfig({ zones: [{ id: "zone_1", entity_rules: [{ entity: "sensor.a", state: "on", priority: 10 }] }] });
  editor.dispatchEvent = (event) => {
    if (event.type === "config-changed") editor.setConfig(event.detail.config);
    return true;
  };
  for (const state of ["a", "al", "ala", "alarm"]) {
    editor.updateZone(0, (zone) => ({
      ...zone,
      entity_rules: [{ ...zone.entity_rules[0], state }],
    }));
  }
  assert.equal(renders, 1);
  assert.equal(editor._config.zones[0].entity_rules[0].state, "alarm");
  const source = core.normalizedConfig(editor._config).zones[0];
  assert.equal(source.entity_rules[0].priority, 10);
});
