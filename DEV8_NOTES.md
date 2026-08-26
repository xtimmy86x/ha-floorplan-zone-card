# 0.1.0-dev.8 notes

## Focus

Refactor, regression tests and editor polish without changing the dev.7 runtime feature set.

## Changes

- Added advisory validation for state rules:
  - empty raw-state values;
  - duplicate exact values, with the existing first-match precedence documented;
  - unreachable `unknown` / `unavailable` rules.
- Added advisory validation for incomplete auto-zoom rules.
- Centralized `unknown` / `unavailable` handling through `UNAVAILABLE_ENTITY_STATES`.
- Added a dependency-free Node.js test harness for core card logic.
- Added 8 regression tests for:
  - effect and border normalization;
  - state-rule validation;
  - legacy `on` / `off` migration;
  - first-match state precedence;
  - dedicated unavailable styling;
  - auto-zoom rule validation and priority;
  - focus-view limits;
  - implicit `more-info` tap behavior.
- `npm run check` now runs the test suite.
- Improved narrow/mobile editor layout for state rules and rule-card headers.
- State-style editor text explicitly notes that the graphical preview is live.

## Compatibility

No configuration migration is required. Runtime behavior from dev.7 is preserved.
