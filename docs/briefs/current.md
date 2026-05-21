# Current brief

**Active:** [`active/45_ux_polish.md`](active/45_ux_polish.md) — Brief 45 Interventions + Systems UX polish. Four substantive Parts plus close. UI polish on the stable Brief 41/42/43/44 foundation; no engine or data model changes. Plough-through authorisation; walkthrough sign-off after Part 3 before Part 4 close.

Brief 44 (Visualisation + reactivity audit and rebuild) closed 2026-05-21 — see [`archive/44_visualisation_audit_COMPLETED.md`](archive/44_visualisation_audit_COMPLETED.md) and STATUS.md.

**Paused (held in archive):** [`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — Phase 0 + Phase 1.0 complete (commits `8003577` + `cc96815`). Phase 1.1 onwards PAUSED. Dynamic backend code frozen at HEAD `54407e3` (post Brief 31), not deleted. Eligible for resumption when Static work cycle pauses.

This pointer file is updated each time a brief in `active/` closes or a new brief opens.

## Pending candidates for Brief 47 (housekeeping bundle)

Logged from Brief 44 close. Awaiting Chris's authorisation:

1. **Issue #24 polish trio** ([`docs/audit/29_open_issues.md`](../audit/29_open_issues.md)):
   - `heat_gas_share` defensive guard (`instantCalc.js:4474` — when `fuel_mwh > 0` but transient zero, fallback sets gas share to 1; tighten to (0,0) instead of (0,1)).
   - Inline-legacy 'full' code path consolidation (Brief 39 audit `docs/audit/39_calculation_flow_map.md` Option (a); known three-location parity debt).
   - LiveResultsPanel heating denominator inconsistency (28.8 / 90.1 vs Diagnostic's 28.8 / 28.8 — same boundary-mismatch family, presentational rather than numeric).

2. **Performance polish** (Brief 44 Part 5d follow-ups):
   - React.memo on `consumption`-driven children (Sankey, Profiles, Live Results) — ~5 % additional cost reduction.
   - Patches-empty intervention short-circuit (skip `runEngine(cfg)` when `intervention.patches.length === 0`) — closes the /interventions 6,101 ms outlier.
   - Reference stability on engine output — return `consumption` with reference-equality when values are byte-identical, unlocking React.memo skip-renders without per-child deep-equality.

Both bundles target the same engine + UI surfaces; bundling lets a single brief reason coherently about boundary semantics + memo discipline.

## Recent brief sequencing (last ~7 days)

See STATUS.md for full Brief 44 close-out. Prior closed briefs (Brief 42 / Brief 43 / Brief 41 / etc.) catalogued in `docs/briefs/archive/`.
