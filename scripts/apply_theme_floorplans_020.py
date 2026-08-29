from pathlib import Path
import json
import re

SOURCE = Path("src/ha-floorplan-zone-card.js")
TESTS = Path("tests/core.test.mjs")
PACKAGE = Path("package.json")
CHANGELOG = Path("CHANGELOG.md")
README = Path("README.md")

source = SOURCE.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    source = source.replace(old, new, 1)


def replace_regex(pattern: str, replacement: str, label: str, flags=0) -> None:
    global source
    source, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")


replace_once('const VERSION = "0.1.1";', 'const VERSION = "0.2.0";', "version")

# Theme-aware image helpers. Keep `image` as the canonical/default/light image.
needle = '''function imageContentId(image) {
  if (typeof image === "string") return image.trim();
  if (image && typeof image === "object" && typeof image.media_content_id === "string") {
    return image.media_content_id.trim();
  }
  return "";
}
'''
insert = needle + '''
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
'''
replace_once(needle, insert, "theme image helpers")

# Allow active SVG bounds to override the canonical saved bounds for theme-specific rendering.
replace_once(
'''function zoneFocusArea(zone) {
  if (zoneUsesSvgObject(zone) && svgBoundsValid(zone?.svg_bounds)) {
    return normalizeSvgBounds(zone.svg_bounds);
  }''',
'''function zoneFocusArea(zone, svgBoundsOverride = null) {
  if (zoneUsesSvgObject(zone) && svgBoundsValid(svgBoundsOverride)) {
    return normalizeSvgBounds(svgBoundsOverride);
  }
  if (zoneUsesSvgObject(zone) && svgBoundsValid(zone?.svg_bounds)) {
    return normalizeSvgBounds(zone.svg_bounds);
  }''',
"zone focus bounds override",
)

replace_once(
'''function autoZoomTargetArea(config, rule) {
  if (!rule) return null;
  if (rule.target === "area") {
    return focusAreaValid(rule.area) ? normalizeFocusArea(rule.area) : null;
  }
  const zone = (config?.zones ?? []).find((item) => item.id === rule.zone_id);
  return zoneFocusArea(zone);
}''',
'''function autoZoomTargetArea(config, rule, svgBoundsByZoneId = null) {
  if (!rule) return null;
  if (rule.target === "area") {
    return focusAreaValid(rule.area) ? normalizeFocusArea(rule.area) : null;
  }
  const zone = (config?.zones ?? []).find((item) => item.id === rule.zone_id);
  const activeBounds = zone?.id && svgBoundsByZoneId?.get
    ? svgBoundsByZoneId.get(zone.id)
    : null;
  return zoneFocusArea(zone, activeBounds);
}''',
"auto zoom active bounds",
)

replace_once(
'''function matchingAutoZoomRule(config, hass) {
  const rules = config?.auto_zoom ?? [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule?.entity || entityRawState(hass, rule.entity) !== rule.state) continue;
    const area = autoZoomTargetArea(config, rule);
    if (area) return { index, rule, area };
  }
  return null;
}''',
'''function matchingAutoZoomRule(config, hass, svgBoundsByZoneId = null) {
  const rules = config?.auto_zoom ?? [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule?.entity || entityRawState(hass, rule.entity) !== rule.state) continue;
    const area = autoZoomTargetArea(config, rule, svgBoundsByZoneId);
    if (area) return { index, rule, area };
  }
  return null;
}''',
"matching auto zoom active bounds",
)

# SVG dual-theme compatibility helpers.
parse_end = '''  return {
    document: parsed,
    root,
    elementsById,
    entries,
    viewBox,
    preserveAspectRatio: root.getAttribute("preserveAspectRatio") || "xMidYMid meet",
    aspectRatio,
  };
}
'''
compat_helpers = parse_end + '''
function svgViewBoxParts(descriptor) {
  return String(descriptor?.viewBox ?? "")
    .trim()
    .split(/[\\s,]+/)
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
'''
replace_once(parse_end, compat_helpers, "dual-theme SVG helpers")

# Canvas uses the current HA theme to select its active image.
replace_once(
'''  set hass(hass) {
    this._hass = hass;
    const key = imageContentId(this._config?.image);
    if (key && key === this._imageKey && this._resolvedImage) {
      this.updateZoneVisualStates();
      this.updateZoneLabels();
      return;
    }
    this.refreshImage();
  }''',
'''  set hass(hass) {
    this._hass = hass;
    const key = imageContentId(activeImageSource(this._config, this._hass));
    if (key && key === this._imageKey && this._resolvedImage) {
      this.updateZoneVisualStates();
      this.updateZoneLabels();
      return;
    }
    this.refreshImage();
  }''',
"canvas hass active image",
)

replace_once(
'''    if (!likelySvgSource(this._config?.image, url, this._config?.zones ?? [])) {''',
'''    const configuredImage = activeImageSource(this._config, this._hass);
    if (!likelySvgSource(configuredImage, url, this._config?.zones ?? [])) {''',
"SVG active image detection",
)
replace_once(
'''      const explicitlySvg = /\\.svg(?:$|[?#])/i.test(url) || /\\.svg(?:$|[?#])/i.test(imageContentId(this._config?.image));''',
'''      const explicitlySvg = /\\.svg(?:$|[?#])/i.test(url) || /\\.svg(?:$|[?#])/i.test(imageContentId(configuredImage));''',
"SVG explicit active image",
)

# Include active theme and per-zone bounds in the existing SVG source event.
replace_once(
'''        detail: {
          status: this._svgSourceStatus,
          error: this._svgSourceError,
          elements: entries,
        },''',
'''        detail: {
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
        },''',
"SVG event active bounds",
)

replace_once(
'''    const imageConfigured = Boolean(imageContentId(this._config?.image));''',
'''    const imageConfigured = Boolean(imageContentId(activeImageSource(this._config, this._hass)));''',
"canvas render active image",
)

# Labels use the geometry of the currently active SVG, not stale canonical bounds.
replace_once(
'''    for (const zone of this._config?.zones ?? []) {
      const label = normalizeLabel(zone.label);
      const hasGeometry = zoneUsesSvgObject(zone)
        ? svgBoundsValid(zone.svg_bounds)
        : Array.isArray(zone.points) && zone.points.length >= 3;
      if (!label.enabled || !hasGeometry) continue;
      const point = zoneLabelPoint(zone);''',
'''    for (const zone of this._config?.zones ?? []) {
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
      );''',
"theme-aware label bounds",
)

replace_once(
'''  async refreshImage() {
    const key = imageContentId(this._config?.image);
    const needsResolution = isMediaSourceContentId(key);''',
'''  async refreshImage() {
    const configuredImage = activeImageSource(this._config, this._hass);
    const key = imageContentId(configuredImage);
    const needsResolution = isMediaSourceContentId(key);''',
"refresh active image",
)
replace_once(
'''      const resolved = await resolveImageSource(this._hass, this._config?.image);''',
'''      const resolved = await resolveImageSource(this._hass, configuredImage);''',
"resolve active image",
)

# Runtime card: consume active SVG bounds so auto zoom follows the selected theme.
replace_once(
'''    this._activeAutoZoomIndex = null;
    this._autoZoomRestoreView = null;
  }''',
'''    this._activeAutoZoomIndex = null;
    this._autoZoomRestoreView = null;
    this._activeSvgBounds = new Map();
    this._activeImageKey = "";
  }''',
"card active SVG state",
)
replace_once(
'''    this._config = normalizedConfig(config);
    this._activeAutoZoomIndex = null;
    this._autoZoomRestoreView = null;
    this.render();''',
'''    this._config = normalizedConfig(config);
    this._activeAutoZoomIndex = null;
    this._autoZoomRestoreView = null;
    this._activeSvgBounds = new Map();
    this._activeImageKey = imageContentId(activeImageSource(this._config, this._hass));
    this.render();''',
"card config resets active bounds",
)
replace_once(
'''  set hass(hass) {
    this._hass = hass;
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (canvas) {
      canvas.hass = hass;
      this.evaluateAutoZoom(canvas);
    }
  }''',
'''  set hass(hass) {
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
  }''',
"card hass theme switching",
)
replace_once(
'''    const match = matchingAutoZoomRule(this._config, this._hass);''',
'''    const match = matchingAutoZoomRule(this._config, this._hass, this._activeSvgBounds);''',
"runtime active bounds auto zoom",
)

replace_once(
'''    const canvas = document.createElement(CANVAS_TAG);
    canvas.viewState = this._viewState;
    canvas.config = this._config;
    canvas.hass = this._hass;
    canvas.addEventListener("floorplan-view-changed", (event) => {
      this._viewState = normalizeViewState(event.detail?.viewState);
    });''',
'''    const canvas = document.createElement(CANVAS_TAG);
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
    canvas.hass = this._hass;''',
"card SVG bounds listener",
)

# Editor stores compatibility warnings and does not persist dark-theme bounds over canonical light bounds.
replace_once(
'''    this._workspaceOpen = false;
    this._expandedZoneIds = new Set();
  }''',
'''    this._workspaceOpen = false;
    this._expandedZoneIds = new Set();
    this._themeCompatibilityWarnings = [];
    this._themeCompatibilityKey = "";
    this._themeCompatibilityToken = 0;
  }''',
"editor theme state",
)
replace_once(
'''  setConfig(config) {
    const previousImage = imageContentId(this._config?.image);
    this._config = normalizedConfig(config);
    if (previousImage !== imageContentId(this._config?.image)) {''',
'''  setConfig(config) {
    const previousImages = themeImageConfigKey(this._config);
    this._config = normalizedConfig(config);
    if (previousImages !== themeImageConfigKey(this._config)) {''',
"editor dual image config change",
)
replace_once(
'''    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (canvas) canvas.hass = hass;
    this.shadowRoot?.querySelectorAll("ha-form").forEach((form) => { form.hass = hass; });
  }''',
'''    this.refreshThemeCompatibility();
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    const canvas = this.shadowRoot?.querySelector(CANVAS_TAG);
    if (canvas) canvas.hass = hass;
    this.shadowRoot?.querySelectorAll("ha-form").forEach((form) => { form.hass = hass; });
    this.refreshThemeCompatibility();
  }''',
"editor compatibility refresh hooks",
)

# Insert compatibility methods before usedSvgElementIds.
needle_method = '''  usedSvgElementIds(excludeZoneId = null) {'''
methods = '''  async refreshThemeCompatibility() {
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

''' + needle_method
replace_once(needle_method, methods, "editor compatibility methods")

# Only persist SVG bounds as canonical when editing the light/default floorplan or when no dark floorplan exists.
replace_once(
'''    if (boundsChanged) {
      this._config = { ...this._config, zones };
      this.emitConfigChanged();
    }''',
'''    if (
      boundsChanged &&
      (activeFloorplanTheme(this._config, this._hass) === "light" || !imageContentId(this._config?.image_dark))
    ) {
      this._config = { ...this._config, zones };
      this.emitConfigChanged();
    }''',
"canonical SVG bounds persistence",
)

# Replace card form with dual light/dark selectors and legacy URL support.
new_card_form = '''  createCardForm() {
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
'''
replace_regex(
    r'  createCardForm\(\) \{.*?\n  \}\n\n  createZoneMetadataForm\(zone, index\) \{',
    new_card_form + '\n  createZoneMetadataForm(zone, index) {',
    "dual floorplan editor form",
    flags=re.S,
)

# Render compatibility warnings and active theme indicator.
replace_once(
'''    const editor = document.createElement("div");
    editor.className = "editor";
    editor.append(this.createCardForm());''',
'''    const editor = document.createElement("div");
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
    }''',
"render dual theme warnings",
)
replace_once(
'''    workspaceHint.textContent = "Open only when you need to draw, edit, position labels, or select focus areas.";''',
'''    const themeLabel = activeFloorplanTheme(this._config, this._hass) === "dark"
      ? "Dark floorplan"
      : "Light / default floorplan";
    workspaceHint.textContent = `${themeLabel} · Open only when you need to draw, edit, position labels, or select focus areas.`;''',
"workspace active theme indicator",
)

# Package version.
package = json.loads(PACKAGE.read_text())
package["version"] = "0.2.0"
PACKAGE.write_text(json.dumps(package, indent=2) + "\n")

# Tests: expose theme helpers, update UI version check, and add regressions.
tests = TESTS.read_text()
tests = tests.replace(
'''    effectiveAction,\n  };`;''',
'''    effectiveAction,\n    imageContentId,\n    activeImageSource,\n    activeFloorplanTheme,\n    themeImageConfigKey,\n    dualThemeSvgWarnings,\n  };`;''',
)
tests = tests.replace('assert.match(source, /const VERSION = "0\\.1\\.1"/);', 'assert.match(source, /const VERSION = "0\\.2\\.0"/);')
if 'test("theme-aware floorplans select the expected source"' not in tests:
    tests += r'''


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
'''
TESTS.write_text(tests)

# Changelog.
changelog = CHANGELOG.read_text()
entry = '''# Changelog

## 0.2.0 - 2026-08-29

### Added

- Theme-aware floorplans with separate light/default and optional dark images.
- Automatic floorplan switching when Home Assistant changes between light and dark mode, without reloading the dashboard.
- Dark floorplan support for the same media selector objects, `/local/` paths, direct URLs, and `media-source://` values supported by the default image.
- SVG-object compatibility checks across light and dark SVG floorplans, including missing object IDs and differing `viewBox` dimensions.
- Active-theme SVG bounds for labels and auto-zoom so SVG-object zones follow the currently displayed floorplan geometry.

### Changed

- Floorplan image and SVG source resolution now follow the active Home Assistant theme.
- The visual editor exposes dedicated Light / default and optional Dark floorplan selectors and shows the currently active floorplan theme in the workspace.

'''
if changelog.startswith("# Changelog\n") and "## 0.2.0" not in changelog:
    changelog = entry + changelog[len("# Changelog\n\n"):]
CHANGELOG.write_text(changelog)

# README documentation.
readme = README.read_text()
if "## Theme-aware floorplans" not in readme:
    readme += '''

## Theme-aware floorplans

Starting with 0.2.0, the card can use different floorplan images for Home Assistant light and dark themes. The existing `image` option remains the default/light floorplan, while `image_dark` is optional:

```yaml
type: custom:floorplan-zone-card
image: /local/floorplan_light.svg
image_dark: /local/floorplan_dark.svg
```

The card switches automatically when Home Assistant changes theme. If `image_dark` is not configured, `image` is used for both themes.

Both fields support the Home Assistant media/image selector, `/local/` paths, direct URLs, and media-source values. For SVG-object zones, keep the same object IDs in both SVG files (for example `id="E-20"`). The editor warns when a configured SVG zone is missing from one theme or when the two SVG files use different `viewBox` dimensions.
'''
README.write_text(readme)

SOURCE.write_text(source)
