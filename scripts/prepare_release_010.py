from pathlib import Path
import json

VERSION = "0.1.0"

src_path = Path("src/ha-floorplan-zone-card.js")
src = src_path.read_text()
old_version = 'const VERSION = "0.1.0-dev.12";'
new_version = f'const VERSION = "{VERSION}";'
if src.count(old_version) != 1:
    raise SystemExit("Expected dev.12 source version exactly once")
src_path.write_text(src.replace(old_version, new_version, 1))

package_path = Path("package.json")
package = json.loads(package_path.read_text())
if package.get("version") != "0.1.0-dev.12":
    raise SystemExit(f"Unexpected package version: {package.get('version')}")
package["version"] = VERSION
package_path.write_text(json.dumps(package, indent=2) + "\n")

readme_path = Path("README.md")
readme = readme_path.read_text()
old_intro = '''> [!IMPORTANT]\n> This repository is in active early development. The editor supports Home Assistant-native image/media, entity and action selectors, graphical polygon editing, direct SVG-object zones, unlimited exact-state styling rules with optional visual effects, configurable zone labels, per-zone interactions, and synchronized floorplan zoom/pan.\n\n## Current development scope\n'''
new_intro = '''> [!NOTE]\n> **0.1.0 is the first public release.** The card is configured through Home Assistant's visual dashboard editor and supports both manually drawn polygon zones and existing SVG objects as interactive zones.\n\n## Installation\n\n### HACS\n\n1. Open **HACS → Dashboard**.\n2. Add `https://github.com/xtimmy86x/ha-floorplan-zone-card` as a **custom repository** with category **Dashboard**.\n3. Install **Floorplan Zone Card**.\n4. Reload the browser if Home Assistant asks you to. HACS manages the dashboard resource automatically.\n\n### Manual installation\n\n1. Download `ha-floorplan-zone-card.js` from the latest GitHub release.\n2. Copy it to `/config/www/ha-floorplan-zone-card.js`.\n3. In **Settings → Dashboards → Resources**, add `/local/ha-floorplan-zone-card.js` as a **JavaScript module**.\n4. Reload the browser.\n\nThen add **Floorplan Zone Card** from the normal dashboard card picker and configure it visually.\n\n## Features\n'''
if readme.count(old_intro) != 1:
    raise SystemExit("README release intro block not found exactly once")
readme = readme.replace(old_intro, new_intro, 1)
old_dev = "Requires Node.js 22 or newer. There are no runtime or build dependencies in the current development version."
new_dev = "Development requires Node.js 22 or newer. The card itself has no runtime dependencies."
if readme.count(old_dev) != 1:
    raise SystemExit("README development sentence not found exactly once")
readme = readme.replace(old_dev, new_dev, 1)
readme_path.write_text(readme)

changelog = '''# Changelog\n\n## 0.1.0 - 2026-08-28\n\nFirst public release of Floorplan Zone Card.\n\n### Highlights\n\n- Visual Home Assistant dashboard editor; no hand-written SVG overlays or custom CSS required.\n- Floorplan images from Home Assistant media/image selectors, `/local/` paths, and direct URLs.\n- Two zone geometries: manually drawn polygons and existing SVG objects selected by `id`.\n- SVG object support for `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `g`, and internal `use` references, including parent transforms.\n- Exact entity-state styling with configurable color and opacity.\n- Pulse and blink effects plus active border highlighting.\n- Fallback and unavailable/unknown styling.\n- Zone labels with name, custom text, or live entity state; configurable typography, opacity, background and position.\n- Home Assistant `tap_action`, `hold_action`, and `double_tap_action`.\n- Synchronized 1x-5x zoom, wheel zoom, pinch zoom and pan.\n- High-quality zoom rendering that avoids compositor-only raster scaling.\n- State-triggered auto-zoom to an existing zone or custom area with previous/reset/keep exit behavior.\n- Polygon shape editing with draggable vertices, midpoint insertion and vertex deletion.\n- Responsive editor validation and backward compatibility for legacy binary on/off styles.\n- Native SVG-object overlays aligned using the source SVG `viewBox` and `preserveAspectRatio`.\n\n### Validation\n\n- Node.js core regression suite.\n- Distribution build consistency check.\n- HACS plugin validation.\n'''
Path("CHANGELOG.md").write_text(changelog)
