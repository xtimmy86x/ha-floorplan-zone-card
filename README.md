# Floorplan Zone Card

A Home Assistant custom dashboard card for displaying a floorplan with simple polygon zones driven by entity state.

The goal is a configuration flow that does **not** require editing SVG files, writing YAML overlays, or maintaining custom CSS:

1. choose a floorplan image;
2. add a zone;
3. draw the zone directly on the floorplan;
4. select a `binary_sensor`;
5. choose ON/OFF colors and opacity;
6. save the card in the normal Home Assistant dashboard editor.

> [!IMPORTANT]
> This repository is at the first development milestone. The card and graphical editor are registered and functional, zones render from normalized coordinates, and the editor can create/configure placeholder zones. Point-and-click polygon drawing and native Home Assistant image upload are the next milestones.

## Current development scope

- Home Assistant custom card registration through `window.customCards`.
- Native graphical card editor through `getConfigElement()` and `config-changed`.
- Responsive image + SVG overlay renderer.
- Normalized polygon coordinates (`0..1`) so zones remain aligned while resizing.
- `binary_sensor` ON/OFF/unavailable styling.
- Basic visual zone settings for name, entity, colors, and opacity.
- Dependency-free browser bundle for a small first foundation.
- HACS-compatible `dist/ha-floorplan-zone-card.js` output.

## Example configuration

```yaml
type: custom:floorplan-zone-card
image: /local/floorplan.png
zones:
  - id: zone_1
    name: Machine room
    entity: binary_sensor.machine_room_alarm
    points:
      - x: 0.2
        y: 0.2
      - x: 0.8
        y: 0.2
      - x: 0.8
        y: 0.8
      - x: 0.2
        y: 0.8
    "on":
      color: "#ff3b30"
      opacity: 0.55
    "off":
      color: "#808080"
      opacity: 0.08
```

## Development

Requires Node.js 22 or newer. There are no runtime or build dependencies in the first milestone.

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
- [x] Live binary sensor styling
- [x] Basic zone properties

### Milestone 2 — graphical polygon editor

- [ ] Add-zone drawing mode
- [ ] Click points directly on the image
- [ ] Close/cancel polygon controls
- [ ] Select existing polygons
- [ ] Drag polygon vertices
- [ ] Delete/insert vertices
- [ ] Commit config changes on pointer release rather than every pointer move

### Milestone 3 — Home Assistant-native UX

- [ ] Native Home Assistant image upload/media selector
- [ ] Native entity selector restricted to `binary_sensor`
- [ ] Better color/opacity controls
- [ ] Undo/redo
- [ ] Mobile editor polish

## License

MIT
