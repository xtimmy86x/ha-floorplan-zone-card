# 0.1.0-dev.5 implementation notes

Feature: synchronized floorplan zoom and pan.

Implemented:
- image and SVG zones share one transformed layer;
- zoom range 1x..5x;
- + / - / reset controls with current percentage;
- mouse-wheel zoom anchored under the pointer;
- pinch-to-zoom anchored at the pinch midpoint;
- pan by dragging empty floorplan space when zoomed;
- dragging an actionable zone while zoomed cancels its action and pans instead;
- tap/hold/double-tap remain active when no pan gesture is detected;
- editor zone actions remain disabled while editing geometry;
- zoom/pan state persists across editor/card rerenders but is not saved to YAML;
- polygon points remain normalized and are never rewritten by zoom/pan;
- vertex/midpoint/draft handle radii are compensated so they stay usable on screen while zooming;
- pinch cancels an in-progress uncommitted vertex drag safely.

Validation performed locally:
- `npm run check` passes;
- `npm run build` passes;
- `src/ha-floorplan-zone-card.js` and `dist/ha-floorplan-zone-card.js` are identical;
- deterministic zoom-anchor logic check passes;
- 100 randomized zoom-anchor/clamping checks pass;
- legacy on/off rule normalization and implicit more-info tap behavior remain intact.

Intended commits:
1. `feat(zoom): add synchronized floorplan zoom and pan`
2. `build: sync distribution bundle`
3. `chore: bump development version to dev.5`
4. `docs: document floorplan zoom and pan`
