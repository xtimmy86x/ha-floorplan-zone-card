# 0.1.0-dev.12 implementation notes

Fix: align existing SVG-object zones exactly with the SVG floorplan image.

Implemented:
- SVG-object zones no longer render through a nested 1000 x 1000 SVG viewport;
- the native SVG-object overlay is now a CSS-sized sibling of the floorplan image;
- the overlay uses the source SVG `viewBox` and `preserveAspectRatio` directly on the same rendered rectangle as the image;
- the normalized 0..1000 overlay remains separate for manually drawn polygon zones and editor geometry;
- native SVG zones are stacked above the normalized overlay while the SVG root remains pointer-transparent, preserving background pan/draw behavior;
- action/pan pointer capture for SVG-object zones is handled by the native SVG overlay;
- SVG bounds continue to be measured relative to the actual rendered floorplan rectangle, keeping labels and auto-zoom aligned;
- no configuration migration is required for existing polygon or SVG-object zones.

Validation:
- `npm run check`;
- `npm run build`;
- source/distribution identity check;
- regression assertion that the SVG-object layer is no longer nested in the normalized 1000 x 1000 viewport.
