# 0.1.0-dev.6 notes

## Feature

`feat(auto-zoom): add state-triggered floorplan focus rules`

- Adds ordered `auto_zoom` rules with exact raw Home Assistant state matching.
- Focus an existing zone using its automatically calculated bounding box.
- Or draw a normalized custom focus rectangle directly in the visual editor.
- Automatically calculates the required zoom (1x-5x) with padding.
- Smooth animated focus transition.
- Does not continuously force the view while a rule remains active.
- Supports `previous`, `reset`, and `keep` exit behavior.
- First matching valid rule wins; rules can be reordered in the editor.
- Existing zone/state/action/zoom configuration remains backward compatible.
- Auto focus never rewrites zone coordinates.
