# Floorplan Zone Card

A Home Assistant custom dashboard card for displaying a zoomable floorplan with polygon zones driven by entity state.

![Floorplan Zone Card preview](images/preview.svg)

The goal is a configuration flow that does **not** require editing SVG files, writing YAML overlays, or maintaining custom CSS:

1. choose or upload a floorplan image;
2. add a zone;
3. draw the zone directly on the floorplan;
4. select any Home Assistant entity;
5. add as many exact state → color/opacity rules as needed;
6. optionally configure Home Assistant actions for the zone;
7. zoom and pan the floorplan while keeping every zone aligned;
8. save the card in the normal Home Assistant dashboard editor.

> [!IMPORTANT]
> This repository is in active early development. The editor supports Home Assistant-native image/media, entity and action selectors, graphical polygon editing, unlimited exact-state styling rules, per-zone interactions, and synchronized floorplan zoom/pan.

## Current development scope

- Home Assistant custom card registration through `window.customCards`.
- Native graphical card editor through `getConfigElement()` and `config-changed`.
- Home Assistant image/media selector with image upload support.
- Backward-compatible support for legacy image URL/path configurations.
- Home Assistant entity selector with no domain restriction.
- Unlimited exact raw-state color/opacity rules per zone.
- Separate fallback and unavailable/unknown styles.
- Backward-compatible migration of legacy binary `on` / `off` zone styles.
- Per-zone `tap_action`, `hold_action`, and `double_tap_action` using Home Assistant's standard action model.
- Standard `hass-action` dispatch for `more-info`, `toggle`, `perform-action`, `navigate`, `url`, `assist`, confirmation and other supported actions.
- Synchronized image + SVG zoom from `1x` to `5x`, with controls, mouse wheel and pinch gestures.
- Pan while zoomed by dragging empty floorplan space; dragging an actionable zone cancels its action and pans instead.
- Zoom state is UI-only and never changes the normalized polygon coordinates stored in the card configuration.
- Responsive image + SVG overlay renderer.
- Resolution of `media-source://` images through Home Assistant before rendering.
- Normalized polygon coordinates (`0..1`) so zones remain aligned while resizing.
- Point-and-click polygon drawing with close/cancel/undo controls.
- Existing-zone selection and draggable polygon vertices.
- Midpoint handles for inserting new vertices.
- Selected-vertex deletion while preserving the minimum three-point polygon.
- Vertex updates committed only on pointer release.
- HACS-compatible `dist/ha-floorplan-zone-card.js` output.

## State color rules

Each zone can use any Home Assistant entity. Rules compare against the entity's **raw state** (`hass.states[entity_id].state`) using exact string matching.

```yaml
entity: sensor.machine_state
states:
  - value: "0"
    color: "#808080"
    opacity: 0.15
  - value: "1"
    color: "#00c853"
    opacity: 0.45
  - value: "2"
    color: "#ffcc00"
    opacity: 0.55
  - value: "3"
    color: "#ff0000"
    opacity: 0.65
default:
  color: "#808080"
  opacity: 0.10
unavailable:
  color: "#9e9e9e"
  opacity: 0.20
```

Rules are evaluated in this order:

1. missing, `unknown`, or `unavailable` entity state → `unavailable` style;
2. first exact matching entry in `states` → that rule's style;
3. no matching rule → `default` fallback style.

The visual editor provides **Add state** and **Delete** controls and does not impose a limit on the number of state rules.

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

are normalized internally to `states` rules. No manual migration is required.

## Example configuration

The visual editor writes this configuration automatically:

```yaml
type: custom:floorplan-zone-card
image:
  media_content_id: media-source://image_upload/xxxxxxxx
  media_content_type: image/png
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
      - value: "running"
        color: "#00c853"
        opacity: 0.45
      - value: "alarm"
        color: "#ff0000"
        opacity: 0.65
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
- [x] Fallback and unavailable styles
- [x] Native Home Assistant zone action selectors
- [x] Runtime tap / hold / double tap actions
- [x] Synchronized image + zone zoom controls
- [x] Mouse-wheel and pinch zoom
- [x] Pan while zoomed without rewriting polygon coordinates
- [ ] Undo/redo for saved shape edits
- [ ] Mobile editor polish
- [ ] Runtime UX testing on a real Home Assistant dashboard

### Later

- [ ] Numeric range rules (for example `< 20`, `20–40`, `> 40`)

## License

MIT
