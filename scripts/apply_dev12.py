from pathlib import Path
import json

SOURCE_PATH = Path("src/ha-floorplan-zone-card.js")
TEST_PATH = Path("tests/core.test.mjs")
PACKAGE_PATH = Path("package.json")

source = SOURCE_PATH.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    source = source.replace(old, new, 1)


replace_once(
    'const VERSION = "0.1.0-dev.11";',
    'const VERSION = "0.1.0-dev.12";',
    "version",
)

replace_once(
    '''      .floorplan-overlay { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .svg-source-layer { overflow:visible; pointer-events:none; }''',
    '''      .floorplan-overlay { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .svg-source-layer { position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }''',
    "SVG overlay CSS",
)

replace_once(
    '''  createSvgSourceLayer(overlay) {
    if (!this._svgSource) return null;
    const layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add("svg-source-layer");
    layer.setAttribute("x", "0");
    layer.setAttribute("y", "0");
    layer.setAttribute("width", String(SVG_SIZE));
    layer.setAttribute("height", String(SVG_SIZE));
    layer.setAttribute("viewBox", this._svgSource.viewBox);
    layer.setAttribute("preserveAspectRatio", this._svgSource.preserveAspectRatio);
    layer.setAttribute("pointer-events", "none");
    overlay.append(layer);
    return layer;
  }''',
    '''  createSvgSourceLayer(transform) {
    if (!this._svgSource) return null;
    const layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add("svg-source-layer");
    // This SVG is a CSS-sized sibling of the floorplan image, not a nested
    // 1000x1000 viewport. Using the source viewBox and preserveAspectRatio on
    // the exact same rendered rectangle makes the browser apply the same
    // source-to-screen matrix to both the original SVG image and its zones.
    layer.setAttribute("viewBox", this._svgSource.viewBox);
    layer.setAttribute("preserveAspectRatio", this._svgSource.preserveAspectRatio);
    layer.setAttribute("pointer-events", "none");
    transform.append(layer);
    return layer;
  }''',
    "source SVG layer",
)

replace_once(
    '''    const sourceSvgLayer = this.createSvgSourceLayer(svg);''',
    '''    const sourceSvgLayer = this.createSvgSourceLayer(transform);''',
    "source SVG layer placement",
)

replace_once(
    '''          this.beginZoneGesture(event, zone, svg, polygon);''',
    '''          this.beginZoneGesture(
            event,
            zone,
            svgObjectZone && sourceSvgLayer ? sourceSvgLayer : svg,
            polygon,
          );''',
    "SVG zone gesture surface",
)

replace_once(
    '''    svg.addEventListener("pointercancel", (event) => {
      if (!interactive) this.finishZoneGesture(event, true);
      this.finishBackgroundPan(event, true);
    });

    if (interactive && mode === "edit") {''',
    '''    svg.addEventListener("pointercancel", (event) => {
      if (!interactive) this.finishZoneGesture(event, true);
      this.finishBackgroundPan(event, true);
    });

    // SVG-object zones live in a separate native-viewBox overlay. Capture and
    // finish their action/pan gestures on that overlay while empty areas pass
    // through to the normalized editor overlay beneath it.
    if (sourceSvgLayer) {
      sourceSvgLayer.addEventListener("pointermove", (event) => {
        if (!interactive) this.moveZoneGesture(event);
      });
      sourceSvgLayer.addEventListener("pointerup", (event) => {
        if (!interactive) this.finishZoneGesture(event, false);
      });
      sourceSvgLayer.addEventListener("pointercancel", (event) => {
        if (!interactive) this.finishZoneGesture(event, true);
      });
    }

    if (interactive && mode === "edit") {''',
    "SVG gesture listeners",
)

replace_once(
    '''    if (labelsLayer?.parentElement === transform) transform.insertBefore(svg, labelsLayer);
    else transform.append(svg);''',
    '''    if (labelsLayer?.parentElement === transform) {
      transform.insertBefore(svg, labelsLayer);
      // Keep native SVG-object zones above the normalized polygon overlay so
      // their painted geometry can receive pointer events. The source SVG root
      // itself remains pointer-events:none, so empty space still reaches the
      // normalized overlay for drawing and background panning.
      if (sourceSvgLayer?.parentElement === transform) {
        transform.insertBefore(sourceSvgLayer, labelsLayer);
      }
    } else {
      transform.append(svg);
      if (sourceSvgLayer?.parentElement === transform) transform.append(sourceSvgLayer);
    }''',
    "SVG overlay stacking",
)

SOURCE_PATH.write_text(source)

package = json.loads(PACKAGE_PATH.read_text())
package["version"] = "0.1.0-dev.12"
PACKAGE_PATH.write_text(json.dumps(package, indent=2) + "\n")

tests = TEST_PATH.read_text()
marker = 'test("SVG object overlay uses the floorplan viewport directly"'
if marker not in tests:
    tests += r'''


test("SVG object overlay uses the floorplan viewport directly", async () => {
  const source = await readFile(new URL("../src/ha-floorplan-zone-card.js", import.meta.url), "utf8");
  assert.match(source, /\.svg-source-layer \{ position:absolute; inset:0; width:100%; height:100%/);
  assert.match(source, /const sourceSvgLayer = this\.createSvgSourceLayer\(transform\);/);
  assert.doesNotMatch(source, /createSvgSourceLayer\(svg\)/);
  assert.doesNotMatch(source, /layer\.setAttribute\("width", String\(SVG_SIZE\)\)/);
  assert.doesNotMatch(source, /layer\.setAttribute\("height", String\(SVG_SIZE\)\)/);
  assert.match(source, /layer\.setAttribute\("viewBox", this\._svgSource\.viewBox\)/);
  assert.match(source, /layer\.setAttribute\("preserveAspectRatio", this\._svgSource\.preserveAspectRatio\)/);
});
'''
    TEST_PATH.write_text(tests)

Path("DEV12_NOTES.md").write_text('''# 0.1.0-dev.12 implementation notes

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
''')
