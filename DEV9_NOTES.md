# 0.1.0-dev.9

## Zone labels

- Added optional per-zone labels.
- Content modes: zone name, custom text, or zone name + live entity state.
- Home Assistant `unit_of_measurement` is appended to state labels when available.
- Added automatic polygon-centroid positioning and custom normalized positioning.
- Custom positions can be set by clicking the floorplan or dragging the label in the editor.
- Added text color, font size, font weight, opacity, optional background color and background opacity controls.
- Labels are rendered independently from SVG state animations, so pulse/blink never affects label readability.
- Label screen size is counter-scaled during floorplan zoom while its anchor remains synchronized with pan/zoom/auto-focus.
- Labels do not intercept dashboard zone actions.

## Compatibility and tests

- Existing zones default to labels disabled.
- Added regression tests for label normalization, centroid/custom positioning and live state/unit content.
- Core suite now contains 11 tests.
