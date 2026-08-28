# 0.1.0-dev.10 implementation notes

Fix: preserve floorplan image quality while zooming.

Implemented:
- raster floorplans are resized at the requested CSS zoom size instead of scaling a pre-rasterized 100% transform texture;
- pan remains transform-based, while zoom is represented by render-layer width/height;
- removed permanent `will-change: transform` promotion from the floorplan render layer;
- the canvas keeps the source image aspect ratio using the image's intrinsic dimensions;
- SVG zones, normalized coordinates, pointer math, pinch/wheel zoom and auto-zoom keep the existing view model;
- editor vertex/draft handle radii stay screen-sized while zooming;
- HTML zone labels stay screen-sized naturally and no longer need inverse transform scaling;
- auto-zoom animates translation and render-layer dimensions together;
- no YAML migration or configuration change is required.

Validation:
- `npm run check`;
- `npm run build`;
- source/distribution bundle identity check;
- regression assertion that raster zoom no longer uses `scale()` on the shared render layer.
