# Brief 72 P9 — DHW load-shape toggle doesn't switch behaviour

**Status:** stub, awaits a small Brief 72 follow-on. Surfaced during Brief 73 walkthrough (2026-06-01).

**Reporter:** Chris (Brief 73 walkthrough at `:5176`).

**Symptom:** the DHW "Load shape" select (Brief 72 P9 commit `76883e3`) lets the user toggle between `flat` and `follow_occupancy`, but the visible result on the DHW Sankey / per-service breakdown / hourly DHW profile does not change when the user toggles the value.

**P9 wiring:**

- UI: `frontend/src/components/modules/systems/ServiceSectionHeader.jsx` `DHWServiceFields` — `LabeledSelect` calls `onUpdateServiceLevel({ dhw_load_shape: v })`.
- Engine read: `frontend/src/utils/systemsEngine.js:497–520` in `_computeDhw` reads `serviceLevel?.dhw_load_shape === 'follow_occupancy'`.

**Two candidate root causes — needs short investigation:**

1. **B4 fallback condition defeating `follow_occupancy`.** Engine at `systemsEngine.js:505–520` falls back to `flat` when `presenceHourly` is missing OR all-zero. For Bridgewater post-Principle-7 (Brief 72 P3) the occupancy schedule presence series IS populated, so this fallback shouldn't fire — but a quick verification is needed to confirm `state2Result.occupancy_summary.presence_hourly` is non-zero and is reaching `_computeDhw`.

2. **v40 service-level setter not persisting `dhw_load_shape` correctly.** The `LabeledSelect` writes via `onUpdateServiceLevel({ dhw_load_shape: v })`. This routes through whatever the parent component's `onUpdateServiceLevel` prop does. If the v40 patch capture / service-level setter doesn't include `dhw_load_shape` in its allowlist (or routes it to a different field), the engine reads `undefined` and falls through to `flat`. Verification: edit the toggle, save, reload, inspect `building.systems_config_v40.dhw_load_shape` in the persisted project JSON — does it round-trip?

**Investigation plan (~30 min):**

1. Add a console.log at `systemsEngine.js:505` printing `load_shape` + `presenceHourly?.length` + `presenceHourly?.[8]` (a midday non-zero hour). Toggle the UI, watch the console.
2. If load_shape reads as `flat` even after the UI is set to `follow_occupancy`, drill into the v40 setter: log the patch path written from `onUpdateServiceLevel`. Confirm the path lands at `building.systems_config_v40.dhw_load_shape` not some other field.
3. If load_shape reads as `follow_occupancy` but DHW per-hour distribution still looks flat, check the engine's downstream consumer of the weight vector — `total_tap_litres_per_day × weights` distribution. Maybe the weights aren't being used for the right output series.

**Out of scope (Brief 73):** Brief 73 covers ventilation share + auxiliary visualisation + lighting baseline. The DHW load-shape toggle is Brief 72 P9 territory.

**Brief format when ready:** small ~3-Part brief — diagnostic (read-only), fix, walkthrough. Should land cleanly without DB or schema changes (engine + UI surface only).
