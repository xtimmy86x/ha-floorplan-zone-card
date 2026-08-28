from pathlib import Path
import json

SOURCE_PATH = Path("src/ha-floorplan-zone-card.js")
TEST_PATH = Path("tests/core.test.mjs")
PACKAGE_PATH = Path("package.json")
CHANGELOG_PATH = Path("CHANGELOG.md")

source = SOURCE_PATH.read_text()


def replace_once(old: str, new: str, label: str, start: int = 0) -> None:
    global source
    index = source.find(old, start)
    if index < 0:
        raise SystemExit(f"{label}: pattern not found")
    source = source[:index] + new + source[index + len(old):]


editor_start = source.index("class FloorplanZoneCardEditor extends HTMLElement")

replace_once('const VERSION = "0.1.0";', 'const VERSION = "0.1.1";', "version")

replace_once(
    '''    this._selectedSvgElementId = "";
    this._haFormReadyListener = null;''',
    '''    this._selectedSvgElementId = "";
    this._haFormReadyListener = null;
    this._workspaceOpen = false;
    this._expandedZoneIds = new Set();''',
    "editor UI state",
    editor_start,
)

replace_once(
    '''    const selectedZone = this._config.zones.find((zone) => zone.id === this._selectedZoneId);''',
    '''    const availableZoneIds = new Set(this._config.zones.map((zone) => zone.id));
    this._expandedZoneIds = new Set(
      [...this._expandedZoneIds].filter((zoneId) => availableZoneIds.has(zoneId)),
    );
    const selectedZone = this._config.zones.find((zone) => zone.id === this._selectedZoneId);''',
    "expanded zone cleanup",
    editor_start,
)

connected_index = source.index("  connectedCallback() {", editor_start)
source = source[:connected_index] + '''  workspaceForcedOpen() {
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

''' + source[connected_index:]

replace_once(
    '''    this._selectedVertexIndex = null;
    this._mode = "select";
    const used = this.usedSvgElementIds();''',
    '''    this._selectedVertexIndex = null;
    this._mode = "select";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zone.id);
    const used = this.usedSvgElementIds();''',
    "expand added SVG zone",
    editor_start,
)

replace_once(
    '''    this._mode = "focus-area";
    this._selectedZoneId = null;''',
    '''    this._mode = "focus-area";
    this._workspaceOpen = true;
    this._selectedZoneId = null;''',
    "open workspace for focus area",
    editor_start,
)

replace_once(
    '''    this._mode = zoneUsesSvgObject(zone) ? "select" : "edit";
    this._draftPoints = [];''',
    '''    this._mode = zoneUsesSvgObject(zone) ? "select" : "edit";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zoneId);
    this._draftPoints = [];''',
    "open selected zone",
    editor_start,
)

replace_once(
    '''    this._mode = "label-position";
    const index = this._config.zones.findIndex((item) => item.id === zoneId);''',
    '''    this._mode = "label-position";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zoneId);
    const index = this._config.zones.findIndex((item) => item.id === zoneId);''',
    "open workspace for label",
    editor_start,
)

replace_once(
    '''  startDrawing() {
    this._mode = "draw";
    this._focusRuleIndex = null;''',
    '''  startDrawing() {
    this._mode = "draw";
    this._workspaceOpen = true;
    this._focusRuleIndex = null;''',
    "open workspace for drawing",
    editor_start,
)

replace_once(
    '''    this._selectedVertexIndex = null;
    this._mode = "edit";
    this.emitConfigChanged();''',
    '''    this._selectedVertexIndex = null;
    this._mode = "edit";
    this._workspaceOpen = true;
    this._expandedZoneIds.add(zone.id);
    this.emitConfigChanged();''',
    "expand drawn zone",
    editor_start,
)

# Replace the editor-only CSS block.
css_start = source.index('    style.textContent = `', editor_start)
css_end_marker = '    `;\n\n    const editor = document.createElement("div");'
css_end = source.index(css_end_marker, css_start)
new_css = '''    style.textContent = `
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
'''
source = source[:css_start] + new_css + source[css_end:]

# Replace the floorplan editor workspace rendering block.
preview_start = source.index('    const preview = document.createElement("div");', editor_start)
preview_end_marker = '    editor.append(preview, this.createAutoZoomEditor());'
preview_end = source.index(preview_end_marker, preview_start) + len(preview_end_marker)
new_preview = '''    const workspace = document.createElement("section");
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
    workspaceHint.textContent = "Open only when you need to draw, edit, position labels, or select focus areas.";
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
    editor.append(workspace, this.createAutoZoomEditor());'''
source = source[:preview_start] + new_preview + source[preview_end:]

replace_once(
    'this.createField("When state no longer matches", this.createSelect(rule.exit_behavior, [',
    'this.createField("After condition ends", this.createSelect(rule.exit_behavior, [',
    "shorter auto zoom label",
    editor_start,
)

# Replace Zones rendering with a compact add-zone panel and collapsible zone cards.
zones_start = source.index('    const zones = document.createElement("div");', editor_start)
zones_end_marker = '    editor.append(zones);'
zones_end = source.index(zones_end_marker, zones_start) + len(zones_end_marker)
new_zones = '''    const zones = document.createElement("div");
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

    editor.append(zones);'''
source = source[:zones_start] + new_zones + source[zones_end:]

SOURCE_PATH.write_text(source)

package = json.loads(PACKAGE_PATH.read_text())
package["version"] = "0.1.1"
PACKAGE_PATH.write_text(json.dumps(package, indent=2) + "\n")

changelog = CHANGELOG_PATH.read_text()
entry = '''## 0.1.1 - 2026-08-28

### Changed

- Redesigned the Home Assistant visual editor for narrow configuration dialogs.
- Added container-query based responsive layouts so forms react to the editor column width instead of the browser viewport.
- Removed horizontal form overflow in auto-zoom, state styling, labels, and SVG-object controls.
- Added a collapsible Floorplan workspace that opens automatically for drawing, shape editing, label placement, and custom auto-zoom area selection.
- Added collapsible zone cards with compact entity/geometry summaries.
- Grouped drawn and SVG-object creation into one Add zone panel.
- Made state-rule controls stack cleanly in narrow editors while retaining the wider desktop layout when space is available.

'''
if "## 0.1.1 - 2026-08-28" not in changelog:
    changelog = changelog.replace("# Changelog\n\n", "# Changelog\n\n" + entry, 1)
    CHANGELOG_PATH.write_text(changelog)

tests = TEST_PATH.read_text()
marker = 'test("editor UI is container-responsive and collapsible"'
if marker not in tests:
    tests += r'''


test("editor UI is container-responsive and collapsible", async () => {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  assert.match(source, /const VERSION = "0\.1\.1"/);
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
'''
    TEST_PATH.write_text(tests)
