# Brief 92 — Auxiliary on/off toggle in Systems

**Branch:** `chris/interventions-rework-ux` (continued — rides in the combined PR alongside the auxiliary
Monthly-chart wiring fix `b6f71d5`, which is its Internal-Gains-side sibling).
**Authorised by:** Chris (2026-07-06 — "Go for it").
**Module scope (Systems):** electrical end-use accounting. Auxiliary is an Internal-Gains-defined
electrical load (like lighting / small power); Systems gets a thin on/off that gates its electricity +
heat gain. No new physics — reuses the existing `effectiveSystemScalar` mechanism. In scope.

## Goal
Auxiliary loads currently show up in the Systems electricity total but have **no on/off** there, unlike
Lighting and Small power. Give auxiliary the identical toggle: a `systems_config_v40.auxiliary` thin
service whose `enabled` flag, when off, zeros auxiliary's **electricity AND heat gain** in parallel (via
the shared `effectiveSystemScalar` → 0). Single master toggle, matching how Lighting/Small power work
(not per-profile).

## Why it's safe
The engine already couples the v40 scalar to both gain + electricity (instantCalc.js:2418-2443). Auxiliary
absent from `systems_config_v40` → `effectiveSystemScalar(undefined)` returns 1.0 → auxiliary ON (current
behaviour). So existing projects are unaffected until the user toggles; no anchor change.

## Parts (one commit)
1. **DEFAULT_PARAMS** (`context/ProjectContext.jsx`): add `systems_config_v40.auxiliary = [{ … enabled:true,
   share_pct:100, control_factor:1 }]`, mirroring the lighting/small_power thin-entry shape.
2. **Load-injection** (`_applyProject`): unconditional + idempotent — if a loaded `systems_config_v40` has
   no `auxiliary` array, inject the default (so the toggle appears for existing projects). Mirrors the
   Brief 73 P3 ventilation `share_pct` strip precedent — **no schema-version bump** (purely additive).
3. **Engine** (`utils/instantCalc.js` ~2418): `auxScalar = effectiveSystemScalar(systems_config_v40.auxiliary)`
   applied to `Q_auxiliary`, `Q_auxiliary_electricity`, and `auxiliary_per_profile` — same pattern as
   lighting/small_power. Replaces the "auxiliary has no v40 scalar" comment.
4. **Systems UI** (`components/modules/SystemsModule.jsx`): add `'auxiliary'` to `SERVICES_IN_ORDER`,
   `SERVICE_LABEL_BY_KEY`, the `open` sections state, and the diagnostic `SERVICE_LABELS` + loop (~1986/1992).
   The existing accordion + `SystemSummaryRow` dot-toggle wiring renders it with zero new UI code.

## Verification
- **Node:** injection idempotent (absent → default injected; present → unchanged); `effectiveSystemScalar`
  on a disabled auxiliary entry → 0 → auxiliary electricity + gain zero.
- **Build clean.**
- **Chris (HMR):** toggle Auxiliary off in Systems → auxiliary electricity drops out of the Σ electricity /
  fuel split, and (with the b6f71d5 Monthly wiring) its heat-gain band disappears from Internal Gains
  Monthly. Toggle on → returns. (Code can't bind port 5176 — Chris's dev server holds it.)

## Out of scope
- Per-profile auxiliary toggles (single master toggle only, matching lighting/small power).
- Auxiliary "add system" template library (the default entry's toggle is the deliverable).
- Any change to how auxiliary loads are *defined* (that stays in Internal Gains).
