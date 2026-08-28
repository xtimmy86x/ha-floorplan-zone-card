# Changelog

## 0.1.1 - 2026-08-28

### Changed

- Redesigned the Home Assistant visual editor for narrow configuration dialogs.
- Added container-query based responsive layouts so forms react to the editor column width instead of the browser viewport.
- Removed horizontal form overflow in auto-zoom, state styling, labels, and SVG-object controls.
- Added a collapsible Floorplan workspace that opens automatically for drawing, shape editing, label placement, and custom auto-zoom area selection.
- Added collapsible zone cards with compact entity/geometry summaries.
- Grouped drawn and SVG-object creation into one Add zone panel.
- Made state-rule controls stack cleanly in narrow editors while retaining the wider desktop layout when space is available.

## 0.1.0 - 2026-08-28

First public release of Floorplan Zone Card.

### Highlights

- Visual Home Assistant dashboard editor; no hand-written SVG overlays or custom CSS required.
- Floorplan images from Home Assistant media/image selectors, `/local/` paths, and direct URLs.
- Two zone geometries: manually drawn polygons and existing SVG objects selected by `id`.
- SVG object support for `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `g`, and internal `use` references, including parent transforms.
- Exact entity-state styling with configurable color and opacity.
- Pulse and blink effects plus active border highlighting.
- Fallback and unavailable/unknown styling.
- Zone labels with name, custom text, or live entity state; configurable typography, opacity, background and position.
- Home Assistant `tap_action`, `hold_action`, and `double_tap_action`.
- Synchronized 1x-5x zoom, wheel zoom, pinch zoom and pan.
- High-quality zoom rendering that avoids compositor-only raster scaling.
- State-triggered auto-zoom to an existing zone or custom area with previous/reset/keep exit behavior.
- Polygon shape editing with draggable vertices, midpoint insertion and vertex deletion.
- Responsive editor validation and backward compatibility for legacy binary on/off styles.
- Native SVG-object overlays aligned using the source SVG `viewBox` and `preserveAspectRatio`.

### Validation

- Node.js core regression suite.
- Distribution build consistency check.
- HACS plugin validation.
