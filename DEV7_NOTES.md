# 0.1.0-dev.7 notes

## Visual state effects

Exact state rules now support two additional properties:

```yaml
effect: none | pulse | blink
highlight_border: true | false
```

- `pulse` smoothly fades the active fill while keeping the zone border stable.
- `blink` alternates the active fill for alarm-style feedback while keeping the border stable.
- `highlight_border: true` uses the active state's color for a thicker, non-scaling polygon border.
- `prefers-reduced-motion` disables pulse/blink animations while keeping the static active style and highlighted border.

Existing rules without these fields remain fully compatible and behave as `effect: none` plus `highlight_border: false`.

## Runtime update improvement

State-only Home Assistant updates now refresh polygon visual attributes in place instead of rerendering the entire floorplan when the image is already resolved. This prevents pulse/blink animations from restarting because unrelated Home Assistant entities update.

## Validation

- `npm run check` passes.
- `npm run build` passes.
- `src/ha-floorplan-zone-card.js` and `dist/ha-floorplan-zone-card.js` are byte-identical after build.
- State-rule normalization smoke tests cover new effects, invalid effect fallback, legacy rules, active state selection, fallback and unavailable state behavior.
