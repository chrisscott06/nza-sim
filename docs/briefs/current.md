# Current brief

**Brief 73 — Ventilation share rule + auxiliary visualisation + lighting baseline check.** Architect-authored at [`active/73_ventilation_auxiliary_lighting.md`](active/73_ventilation_auxiliary_lighting.md); 7 parts. First brief after Brief 72 close. Bundles three findings from the post-Brief-72 walkthrough — ventilation share rule (engine refuses fan electricity → 0 MWh), auxiliary not rendering on Heat Balance / Energy Flows Sankeys despite Brief 72 P5 rollups, lighting + small power post-recreation reconciliation. Build on Brief 72's auxiliary infrastructure (P5 rollups, P6 colour token) — consume, not modify.

**Anchor** (captured at Part 1, HEAD `3e21f3b`): Bridgewater clean = **EUI 185.2 kWh/m²·yr** (electricity 403.5 + gas 360.3 MWh). Diverges from brief's expected 163.5 because Chris's walkthrough authored 3 auxiliary profiles (External lighting 0% / Catering 6 W/m² @ 27% / Pumps 1 W/m² @ 100%); their +78.3 MWh electricity is the entire EUI shift. Heat demand 0 / Cool 330.6 / DHW 421.1 MWh. Per-system rollups returned empty — path-discovery is Part 2 territory. Full anchor table at [`docs/audit/73_ventilation_auxiliary_lighting.md`](../audit/73_ventilation_auxiliary_lighting.md) §1.

**Ventilation fan total**: null in the engine result (THE BUG — Part 2 diagnoses, Part 3 fixes).

**Sequencing:** P1 land + anchor (this commit) → P2 ventilation share diagnostic (read-only) → P3 ventilation share fix → P4 auxiliary viz diagnostic (read-only) → P5 auxiliary ribbon in Heat Balance + Energy Flows Sankeys + per-service breakdown → P6 lighting + small power reconciliation (read-only, outcome a/b/c) → P7 walkthrough + close [HARD STOP for Chris's browser pass]. Each Part = one commit.

## Recently closed

| Brief | Closed | Title | Archive |
|---|---|---|---|
| 72 | 2026-05-29 | Auxiliary loads, gain_fraction, DHW load-shape UI + DB recovery (OVERNIGHT) | [`archive/72_auxiliary_loads_dhw_shape_COMPLETED.md`](archive/72_auxiliary_loads_dhw_shape_COMPLETED.md) |
| 71 | 2026-05-28 | Interventions: Isolated vs Combined evaluation + theme grouping | [`archive/71_interventions_isolated_vs_combined_COMPLETED.md`](archive/71_interventions_isolated_vs_combined_COMPLETED.md) |

## Queued (not yet started)

- **Brief 70 Parts 2–4** — day-zoom + week-zoom + walkthrough close (Brief 70 Part 1 + adhoc polish landed; remainder pending).
- **Brief 74 (drafted, awaiting Brief 73 close)** — interventions diagnostic harness + tab redesign.
- **Brief 75 (renumber the door-bug placeholder)** — Operable door heat_loss=0 on Systems Heat Balance (engine-side natvent parity bug). Was queued as "Brief 73" in the door-bug placeholder; per Brief 73 brief text this renumbers to 75 on close.
- **Brief 76 (queued)** — WWHR (needs a DHW end-use split first).

## Out of scope (per Brief 73 brief text)

Door bug (→ Brief 75), interventions diagnostic harness + tab redesign (→ Brief 74), WWHR (→ Brief 76), lighting room-vs-communal split, Sankey redesign beyond adding the missing ribbon, any change to Brief 72's auxiliary engine layer.

## Pending housekeeping (catalogued, not picked up)

Carried forward from the pre-Brief-71 list:

1. **Issue #24 polish trio** (see [`docs/audit/29_open_issues.md`](../audit/29_open_issues.md)).
2. **Performance polish** (Brief 44 Part 5d follow-ups).
3. **Sankey per-system share enhancement** (Brief 45 Part 3 deferred).
4. **Cross-route EUI baseline reading harmonisation** (Brief 45 Part 4 finding).
5. **Other /systems hard-coded MWh sweeps** (~6 sites in SystemsModule.jsx).
6. **PatchedInputBadge per-input coverage** in InternalGainsModule + OperationModule (Brief 47 Part 4 deferred).
7. **Per-row collapse-state persistence** (Brief 47 Part 5c deferred).
8. **Breakdown panel Level 3 leave-one-out** (Brief 48 Part 3 deferred).

## Paused

[`archive/30_dynamic_engine_rebuild_PAUSED.md`](archive/30_dynamic_engine_rebuild_PAUSED.md) — eligible for resumption when the Static work cycle pauses.
[`archive/67_zone_temperature_trajectory_PAUSED.md`](archive/67_zone_temperature_trajectory_PAUSED.md) — Part B paused with three modelling judgements flagged for Chris.
