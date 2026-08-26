# Floorplan Zone Card

A Home Assistant custom dashboard card for displaying a zoomable floorplan with polygon zones driven by entity state.

![Floorplan Zone Card preview](images/preview.svg)

The goal is a configuration flow that does **not** require editing SVG files, writing YAML overlays, or maintaining custom CSS:

1. choose or upload a floorplan image;
2. add a zone;
3. draw the zone directly on the floorplan;
4. select any Home Assistant entity;
5. add as many exact state → visual-style rules as needed, including color, opacity, pulse/blink effects and border highlighting;
6. optionally configure Home Assistant actions for the zone;
7. zoom and pan the floorplan while keeping every zone aligned;
8. optionally add state-triggered auto-zoom rules that focus a zone or a custom area;
9. save the card in the normal Home Assistant dashboard editor.

> [!IMPORTANT]
> This repository is in active early development. The editor supports Home Assistant-native image/media, entity and action selectors, graphical polygon editing, unlimited exact-state styling rules with optional visual effects, per-zone interactions, and synchronized floorplan zoom/pan.

## Current development scope

- Home Assistant custom card registration through `window.customCards`.
- Native graphical card editor through `getConfigElement()` and `config-changed`.
- Home Assistant image/media selector with image upload support.
- Backward-compatible support for legacy image URL/path configurations.
- Home Assistant entity selector with no domain restriction.
- Unlimited exact raw-state style rules per zone, including color, opacity, pulse/blink effects and active-border highlighting.
- Separate fallback and unavailable/unknown styles.
- Backward-compatible migration of legacy binary `on` / `off` zone styles.
- Per-zone `tap_action`, `hold_action`, and `double_tap_action` using Home Assistant's standard action model.
- Standard `hass-action` dispatch for `more-info`, `toggle`, `perform-action`, `navigate`, `url`, `assist`, confirmation and other supported actions.
- Synchronized image + SVG zoom from `1x` to `5x`, with controls, mouse wheel and pinch gestures.
- Pan while zoomed by dragging empty floorplan space; dragging an actionable zone cancels its action and pans instead.
- Zoom state is UI-only and never changes the normalized polygon coordinates stored in the card configuration.
- State-triggered auto-zoom rules with exact raw-state matching.
- Auto-focus target can be an existing polygon zone or a custom rectangle drawn directly in the graphical editor.
- Ordered auto-zoom priority and configurable exit behavior: previous view, reset to 100%, or keep current view.
- Responsive image + SVG overlay renderer.
- Resolution of `media-source://` images through Home Assistant before rendering.
- Normalized polygon coordinates (`0..1`) so zones remain aligned while resizing.
- Point-and-click polygon drawing with close/cancel/undo controls.
- Existing-zone selection and draggable polygon vertices.
- Midpoint handles for inserting new vertices.
- Selected-vertex deletion while preserving the minimum three-point polygon.
- Vertex updates committed only on pointer release.
- HACS-compatible `dist/ha-floorplan-zone-card.js` output.

## State styles and visual effects

Each zone can use any Home Assistant entity. Rules compare against the entity's **raw state** (`hass.states[entity_id].state`) using exact string matching. Besides color and opacity, an exact state rule can enable a visual effect and highlight the polygon border while that state is active.

```yaml
entity: sensor.machine_state
states:
  - value: "idle"
    color: "#808080"
    opacity: 0.15
    effect: none
    highlight_border: false
  - value: "running"
    color: "#00c853"
    opacity: 0.45
    effect: none
    highlight_border: false
  - value: "warning"
    color: "#ffcc00"
    opacity: 0.55
    effect: pulse
    highlight_border: true
  - value: "alarm"
    color: "#ff0000"
    opacity: 0.65
    effect: blink
    highlight_border: true
default:
  color: "#808080"
  opacity: 0.10
unavailable:
  color: "#9e9e9e"
  opacity: 0.20
```

Supported effects are:

- `none` — static fill;
- `pulse` — smoothly fades the active fill in and out;
- `blink` — clearly alternates the active fill for alarm-style feedback.

When `highlight_border: true`, the active state's color is also used for a thicker polygon border. The border remains visible while the fill pulses or blinks, so the affected area stays easy to locate. SVG `vector-effect: non-scaling-stroke` keeps the highlighted border visually consistent while zooming.

Animations honor the browser/operating-system `prefers-reduced-motion` setting. In reduced-motion mode the zone keeps its active static color and border without blinking or pulsing.

Rules are evaluated in this order:

1. missing, `unknown`, or `unavailable` entity state → `unavailable` style;
2. first exact matching entry in `states` → that rule's style;
3. no matching rule → `default` fallback style.

The visual editor provides **Add state** and **Delete** controls and does not impose a limit on the number of state rules. Each row also includes an **Effect** selector and a **Highlight border** flag.

Newly drawn zones start with `off` and `on` rules as a convenience for binary entities, but they can be edited, removed, or replaced with any values.

## Zone actions

Every zone can use the standard Home Assistant interaction model:

```yaml
tap_action:
  action: toggle
hold_action:
  action: more-info
double_tap_action:
  action: perform-action
  perform_action: script.machine_reset
  confirmation: true
```

The graphical editor uses Home Assistant's native `ui_action` selector, so action-specific fields such as targets, data, navigation paths, URLs, Assist options and confirmations are handled by Home Assistant itself.

If a zone has an entity and no explicit `tap_action`, tapping it defaults to `more-info`. Hold and double tap default to `none`.

Actions are only active on the normal dashboard. While the floorplan is being edited, pointer interaction is reserved for selecting zones and moving/inserting vertices and never triggers zone actions.

## Zoom and pan

Zoom is applied to a single transform layer containing both the floorplan image and the SVG zone overlay. The polygon coordinates are **not recalculated or rewritten**, so a zone remains aligned at every zoom level.

Available controls:

- **+ / −** buttons in the top-right corner;
- mouse wheel zoom centered on the pointer;
- pinch-to-zoom on touch devices;
- drag empty floorplan space to pan when zoomed;
- drag an actionable zone to pan instead of triggering its action;
- **↺ Reset** to return to `100%`.

The zoom range is currently fixed at `1x` to `5x` with `0.25x` button/wheel steps. Zoom and pan are intentionally **ephemeral UI state**: they are preserved while the card/editor rerenders, but they are not written to YAML and do not modify `points`.

The editor uses the same zoom model, making it possible to zoom into a small area before moving or inserting polygon vertices.

## Auto zoom / focus rules

Auto-zoom rules can move the user's attention to a specific part of the floorplan when an entity reaches an exact raw Home Assistant state. Rules are configured entirely in the graphical editor.

Each rule contains:

- a Home Assistant entity;
- the exact raw state that activates the rule;
- a focus target: **Existing zone** or **Custom area**;
- an exit behavior for when the state no longer matches.

Example using an existing zone:

```yaml
auto_zoom:
  - entity: binary_sensor.machine_3_alarm
    state: "on"
    target: zone
    zone_id: zone_3
    exit_behavior: previous
```

The card calculates the polygon bounding box automatically and chooses the zoom needed to fit it, including a small margin. The configured zone points are never modified.

A custom area can instead be drawn directly on the floorplan from **Select area** / **Redraw area**:

```yaml
auto_zoom:
  - entity: sensor.machine_state
    state: "fault"
    target: area
    area:
      x: 0.42
      y: 0.18
      width: 0.24
      height: 0.31
    exit_behavior: reset
```

Custom focus rectangles use normalized `0..1` coordinates, just like polygon zones, so they remain correct at any dashboard size.

Exit behaviors are:

- `previous`: return to the view that was active before auto focus;
- `reset`: return to `100%`;
- `keep`: leave the floorplan at its current view.

Rules are evaluated from top to bottom. If multiple conditions match, the first valid rule has priority. The editor provides **↑ / ↓** controls to reorder them.

A matching rule is applied when it becomes the active rule (and also on initial card load when the state is already active). It is **not** continuously reapplied on every Home Assistant update, so the user may manually zoom or pan after the automatic focus without fighting the card.

## Backward compatibility

Legacy binary configurations remain supported. Existing zones like:

```yaml
on:
  color: "#ff3b30"
  opacity: 0.55
off:
  color: "#808080"
  opacity: 0.08
```

are normalized internally to `states` rules. Existing state rules that do not contain the new fields behave as `effect: none` and `highlight_border: false`, so no manual migration is required.

## Example configuration

The visual editor writes this configuration automatically:

```yaml
type: custom:floorplan-zone-card
image:
  media_content_id: media-source://image_upload/xxxxxxxx
  media_content_type: image/png
auto_zoom:
  - entity: binary_sensor.machine_room_alarm
    state: "on"
    target: zone
    zone_id: zone_1
    exit_behavior: previous
zones:
  - id: zone_1
    name: Machine room
    entity: sensor.machine_state
    points:
      - x: 0.2
        y: 0.2
      - x: 0.8
        y: 0.2
      - x: 0.8
        y: 0.8
      - x: 0.2
        y: 0.8
    states:
      - value: "idle"
        color: "#808080"
        opacity: 0.15
        effect: none
        highlight_border: false
      - value: "running"
        color: "#00c853"
        opacity: 0.45
        effect: none
        highlight_border: false
      - value: "alarm"
        color: "#ff0000"
        opacity: 0.65
        effect: blink
        highlight_border: true
    default:
      color: "#808080"
      opacity: 0.10
    unavailable:
      color: "#9e9e9e"
      opacity: 0.20
    tap_action:
      action: more-info
    hold_action:
      action: perform-action
      perform_action: script.machine_details
```

Existing configurations using a direct URL or Home Assistant `/local/` path remain supported:

```yaml
image: /local/floorplan.png
```

## Shape editing

When a zone is in **Edit shape** mode:

- drag a blue vertex to move it;
- click a small white midpoint handle to insert a new vertex on that edge;
- the last moved/inserted vertex becomes selected;
- use **Delete vertex** to remove it when the polygon has more than three points;
- coordinates are saved only when the pointer is released;
- zoom with the controls, wheel, or pinch and drag empty space to pan without changing the saved coordinates.

## Development

Requires Node.js 22 or newer. There are no runtime or build dependencies in the current development version.

```bash
npm run check
npm run build
```

The production file is written to:

```text
dist/ha-floorplan-zone-card.js
```

## Roadmap

### Milestone 1 — foundation

- [x] Card registration
- [x] Graphical config editor registration
- [x] Image + SVG overlay
- [x] Normalized polygon model
- [x] Live entity-state styling
- [x] Basic zone properties

### Milestone 2 — graphical polygon editor

- [x] Add-zone drawing mode
- [x] Click points directly on the image
- [x] Close/cancel polygon controls
- [x] Undo last point while drawing
- [x] Select existing polygons
- [x] Drag polygon vertices
- [x] Delete/insert vertices
- [x] Commit config changes on pointer release rather than every pointer move

### Milestone 3 — Home Assistant-native UX

- [x] Native Home Assistant image upload/media selector
- [x] Native unrestricted entity selector
- [x] Unlimited exact-state color/opacity rules
- [x] Per-state pulse/blink effects
- [x] Per-state active-border highlighting
- [x] Fallback and unavailable styles
- [x] Native Home Assistant zone action selectors
- [x] Runtime tap / hold / double tap actions
- [x] Synchronized image + zone zoom controls
- [x] Mouse-wheel and pinch zoom
- [x] Pan while zoomed without rewriting polygon coordinates
- [x] State-triggered auto zoom to existing zones
- [x] Graphical custom auto-focus area selection
- [x] Auto-zoom priority and exit behavior
- [ ] Undo/redo for saved shape edits
- [ ] Mobile editor polish
- [ ] Runtime UX testing on a real Home Assistant dashboard

### Later

- [ ] Numeric range rules (for example `< 20`, `20–40`, `> 40`)

## License

MIT
