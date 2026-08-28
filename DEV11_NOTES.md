# 0.1.0-dev.11 implementation notes

Feature: use existing SVG objects as floorplan zones.

Implemented:
- SVG floorplans are inspected for supported elements with `id` attributes;
- the editor can create a zone directly from an existing SVG object instead of drawing a polygon;
- supported source geometry includes path, rect, circle, ellipse, polygon, polyline, group, and internal use references;
- parent group transforms are preserved when the object geometry is cloned into the zone overlay;
- only geometry attributes are cloned: scripts, event handlers, styles, foreignObject content, external use references, and unrelated SVG markup are not injected;
- SVG zones use the same state styles, pulse/blink effects, active border, Home Assistant actions and labels as drawn zones;
- SVG object bounds are normalized and persisted so auto-zoom and automatic label centering work without changing the existing view model;
- source bounds are refreshed by the visual editor when the SVG is inspected;
- duplicate assignment of the same SVG object is prevented by the editor;
- missing/replaced source ids are reported as editor warnings;
- legacy polygon zones remain backward compatible and are normalized as `geometry: polygon`;
- SVG object inspection supports direct `.svg` paths and Home Assistant media-source images, subject to normal browser CORS rules for remote sources.

Validation:
- npm run check;
- npm run build;
- source/distribution identity check;
- normalization, SVG-bound auto-zoom/label and backward-compatibility tests.
