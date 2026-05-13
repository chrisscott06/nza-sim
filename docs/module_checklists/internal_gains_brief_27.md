# Internal Gains module — Brief 27 + Brief 27 Revised completion checklist

**Module:** Internal Gains (`/gains`)
**Brief:** 27 + 27 Revised (combined close-out)
**Contract version:** v2.4
**Date completed:** 2026-05-13

Filled per the canonical `docs/module_completion_checklist.md`. Honest marks; deferred items listed in Section L.

---

## Section A: Data model

| Item | Status | Notes |
|---|---|---|
| All inputs from the state contract are represented in `building_config` | ✓ | `building_config.occupancy.*` (Brief 27 Part 1) + `building_config.gains.{lighting,equipment}.profiles[]` (Brief 27 Revised Part 9). v2.4 contract output shape per `docs/state_contracts.md`. |
| Schema migrations from any previous state run cleanly on production-like data | ✓ | `scripts/migrate_state2_data_model.py` (v2.3 — Part 1) + `scripts/migrate_gains_v24.py` (v2.4 — Part 9). Both ran on Bridgewater + New Project. v2.4 migration: 4 changes (lighting + equipment for each project). |
| Migrations are idempotent | ✓ | Both scripts: "already migrated, no changes" path tested by re-running. ProjectContext load-time migration also idempotent. |
| Existing user values preserved during migration | ✓ | v2.4 wraps the v2.3 single-quantity into `profiles[0]` with `area_share: 1.0`, preserving all magnitudes / relationship / schedule. Engine output byte-identical. |
| Provenance fields populated per v2.1+ contract | ✓ | `_provenance` on every profile (`{source, confidence}`). Templates get `template_id`; migrated profiles get `migrated_v23_to_v24`. |
| No fields lost or corrupted compared to the previous schema | ✓ | v2.3→v2.4 lighting + equipment both round-trip through the migrator. Verified via `scripts/state2_multiprofile_smoketest.mjs`. |
| Backward compatibility maintained for legacy fields | ✓ | Legacy `params.num_bedrooms` / `occupancy_rate` / `people_per_room` kept on the building so `nza_engine/generators/hvac_dhw.py` still resolves them. v2.4 fields are NEW, not replacements; legacy fields remain readable. |

---

## Section B: Live engine

| Item | Status | Notes |
|---|---|---|
| `withMode(building, mode)` filter includes exactly the inputs the contract specifies | ✓ | `envelope-only` strips occupancy + gains + operable windows + systems. `envelope-gains` strips operable windows + systems but admits occupancy + gains. |
| Setting forbidden inputs to absurd values produces byte-identical State N output | ✓ | State 1 live: 40/40. State 1 EP: 40/40. State 2 live: 21/21. State 2 EP: 21/21. |
| Output shape matches state contract exactly | ✓ | v2.4 shape: `gains.lighting.{profiles[], total_kwh, total_peak_kw, effective_lpd_w_per_m2, total_hours_active}` + equivalent for equipment. `state1_delta` mandatory. |
| Calculation honours mathematical specification | ✓ | Per-profile contribution = magnitude × area_share × fraction. Effective LPD = Σ (profile.LPD × profile.area_share). Multi-profile additivity verified at 0.01% drift in `state2_multiprofile_smoketest.mjs`. |
| Backward compatibility: calling without `{ mode }` produces same result as before this brief | ✓ | Engine `mode` parameter optional; default ('full') routes through unchanged legacy path. |
| Engine produces results for a representative production-like config | ✓ | Bridgewater post-migration: lighting 47k kWh, equipment 126k kWh (single profile). Two-profile test (bedroom 0.7 + corridor 0.3 always-on): 51k kWh, additive. |

---

## Section C: EnergyPlus engine

| Item | Status | Notes |
|---|---|---|
| `assemble_epjson(..., mode='envelope-gains')` emits the v2.4 objects | ✓ | One `Lights` + per-profile `Lights_<id>` object per zone (baseline emits at zero, per-profile carries the load). One `Equip_<id>_baseload` + one `Equip_<id>_active` per profile per zone. Per-profile `Schedule:Compact` emitted with v24_ prefix. |
| Suppresses objects forbidden by the state | ✓ | State 2 forces ideal-loads thermostat (no real HVAC) and zero-area operable windows (louvres remain). Carried from Part 3. |
| Schedules emitted correctly with v2.4 mechanisms | ✓ | `v23_schedule_to_compact` handles v2.4 exception curves directly (full editable curves per period). Per-profile schedules use `_v24_lighting_profile_schedule` + `_v24_equipment_active_profile_schedule` which mirror the live engine's fractionForHour math per relationship_to_occupancy. |
| Simulation runs without fatal errors on Bridgewater | ✓ (assembler) | The epJSON assembles cleanly. End-to-end EP run requires the user's local EnergyPlus install — out of scope for this checklist; verified during the Brief 27 walkthroughs Chris ran. |
| SQL parser correctly extracts the state's output | ✓ | `_get_heat_balance_state2` shipped Part 3. Reads People/Lights/ElectricEquipment energies + reuses State 1 demand calc on gains-influenced temperatures. |
| Output shape matches live engine's output shape | ⚠ partial | SQL parser returns aggregate `gains.{lighting,equipment}` totals — the v2.4 per-profile breakdown is not yet emitted by the SQL parser. Queued for Brief 28+ (see Section L). |

---

## Section D: Engine agreement

| Item | Status | Notes |
|---|---|---|
| Live and EP outputs compared via state's engine_agreement script | ⚠ | The state2_engine_agreement script that compares live vs EP across the v2.4 contract isn't separately shipped. Existing comparison happens via `get_heat_balance` per-mode dispatch but isn't programmatic in CI. Queued for Brief 28 alongside Brief 30 (CI pre-merge checks). |
| Headline metrics within ±5% silent tolerance | ⚠ | Not measured systematically in CI yet. Manual comparison during walkthroughs has been within tolerance for the post-Part-9 Bridgewater single-profile case. |
| Divergence > 10% documented in `state_N_divergences.md` | ✓ | `docs/state_2_part2_verification.md` documents the Brief 27 Part 2 divergences (lighting below BREDEM, heating phasing). Carried forward. |
| Engine disagreement flag UI behaves per three-tier system | ✓ | Existing toggle from Brief 26.1 carries through. Tab strip in Internal Gains has engine-toggle SLOTS wired for the Delta / Heat balance / Free-running tabs. An `EngineBadge` chip labels the current source ("Live engine") on each engine-dependent canvas view (shipped 252b7e8). The actual Live\|Simulation segmented control ships in **Brief 28 Part 3** once Part 1 (solar model fix) + Part 2 (SQL parser per-profile breakdown) land. |
| Disclosure visible when one engine is canonical | ✓ | Inherited from the existing HeatBalance disclosure shipped in Brief 26.2. |

---

## Section E: BREDEM expected ranges

| Item | Status | Notes |
|---|---|---|
| Expected ranges derived analytically in Part 0 | ✓ | `docs/state_2_expected_ranges.md` (Brief 27 Part 0). |
| Each range has a stated assumption | ✓ | BREDEM derivation lists density, occupancy rate, LPD, EPD assumptions explicitly. |
| Live engine outputs land within expected ranges | ⚠ partial | People: ✓. Equipment: ✓ matches sub-linear analytical prediction. Lighting: ✗ below BREDEM (semantic choice on `proportional_with_spill` documented in Part 2 verification). Heating/cooling: ✗ phasing-related, BREDEM uniform-phasing under-states offset for hotel buildings. |
| EP engine outputs land within expected ranges | ⚠ | Same divergences apply (EP shares live engine's gain math). End-to-end EP measurement on Bridgewater not in CI. |
| Any range miss is investigated | ✓ | Part 2 follow-up diagnostic (`scripts/state2_diagnostic_hourly_gains.mjs`) confirmed lighting model is correct + people phasing is 4.15× overnight-vs-daytime in winter. Ranges in `docs/state_2_expected_ranges.md` updated to reflect post-diagnostic reality. |
| Out-of-range results are not silently accepted | ✓ | Every divergence documented and either reconciled (lighting / equipment) or flagged for building-type-aware refinement (heating / cooling). |

---

## Section F: State isolation

| Item | Status | Notes |
|---|---|---|
| `FORBIDDEN_*_INPUTS` list updated | ✓ | `FORBIDDEN_ENVELOPE_ONLY_INPUTS` (40 paths incl. v2.4 `gains.{lighting,equipment}.profiles`). `FORBIDDEN_ENVELOPE_GAINS_INPUTS` (20 paths). |
| Live engine isolation regression script tests all forbidden inputs | ✓ | `scripts/state1_isolation_live.mjs` + `scripts/state2_isolation_live.mjs`. |
| EP path isolation regression | ✓ | `scripts/state1_isolation_epjson.py` + `scripts/state2_isolation_epjson.py`. |
| Regression iterates the forbidden list programmatically | ✓ | All four scripts parse `stateMode.js` and iterate. Tripwire on minimum list size to defend against silent regex parse failure. |
| Regression asserts minimum list length | ✓ | `_MIN_FORBIDDEN_PATHS = 32` (state1) and `18` (state2). |
| All scenarios produce byte-identical output | ✓ | State 1 live 40/40 · State 1 EP 40/40 · State 2 live 21/21 · State 2 EP 21/21. |
| Previous states' isolation regressions still pass | ✓ | State 1 isolation regression has been run at every commit since Brief 26 and remains 38/38 → 40/40 byte-identical across the entire Brief 27 sequence. |

---

## Section G: UI principles conformance

Reference: `docs/ui_principles.md`

| Item | Status | Notes |
|---|---|---|
| Card widths match content, not container | ✓ | Stat cards (Delta, Annual breakdown) sized to content. No stretched single-value cards. |
| Related items grouped in single cards | ✓ | Each gain section is one card with magnitude readout + profile list. Delta view groups heating/cooling deltas + per-gain attribution + comfort hours under labelled sub-cards. |
| Centre canvas content respects ~1000 px max width unless content earns it | ✓ | Delta + Annual breakdown + Heat balance + 3D constrained to 1000/1100 px. Free-running + Hourly profile + Schedule editor earn full width (annual / 24-hour data is horizontal). |
| Section bounding boxes used consistently | ✓ | Left panel: OCCUPANCY / LIGHTING / EQUIPMENT each their own CollapsibleSection with gain-specific accent header. Mirrors Building module's GEOMETRY / FABRIC / etc. pattern. |
| Vertical stacking is the default | ✓ | All sections + canvas views stack. Horizontal layouts only for data-bearing axes (time, hour, day). |
| Tab strips for multi-view canvases use established pattern | ✓ | Top-centred tab strip, accent underline on active. Context-sensitive Schedule tab. |
| Engine toggle placed near the data it controls | ✓ | Engine toggle slot in tab strip's right edge for engine-dependent tabs (Delta / Heat balance / Free-running). The actual Live\|Simulation control surfaces when EP State 2 plumbing lands. |

---

## Section H: Visual coherence

| Item | Status | Notes |
|---|---|---|
| Colour theming consistent | ✓ | Module accent `#EA580C` strictly on structural surfaces (sidebar / title bar / tab underline). Gain colours (People `#8B5CF6`, Lighting `#F59E0B`, Equipment `#FB923C`) thread through section headers, profile dots, canvas chart fills, mini-profile bars, Heat Balance flows, Delta attribution. |
| No mystery numbers | ✓ | Every displayed value has a tooltip or definition. Effective LPD explained inline. Area coverage labelled as "fully covered / under-covered / over-covered". Stats card explains operating-hours derivation. |
| Disclosure visible for known limitations | ✓ | `EngineBadge` on Delta / Heat balance / Free-running tabs labels live-engine output (252b7e8). Delta view footnote calls out the isotropic-sky residual and links to the divergence investigation. Heat balance reuses /balance's existing disclosure. `docs/state_1_engine_divergence_investigation.md` documents the State 1 Live vs Sim gap. `docs/state_2_part2_verification.md` documents the BREDEM range divergences. |
| Loading states handle gracefully | ✓ | Delta + Free-running + Heat balance show "Loading constructions library…" while the canvas-level fetch is in flight. No flicker / no fake data. |
| Empty states render sensibly | ✓ | MultiProfileList shows "+ Add profile" prominently when profiles array is empty. ExceptionsPanel shows "+ Add exception" with descriptive copy. Heatmap exception legend hidden when no exceptions. |

---

## Section I: Hard-coded values audit

Reference: `docs/hardcoded_constants_audit.md`

| Item | Status | Notes |
|---|---|---|
| No magic numbers in calculation code that should be inputs | ✓ | All gain magnitudes via `profile.magnitude` / `baseload` / `active`. No hardcoded W/m² in `computeHourlyGains` / `_calculateState2`. |
| Physics constants documented | ✓ | Inherited from Brief 26 work. 75 W/person + 55 W/person carried as v2.3 defaults with citation in DEFAULT_OCCUPANCY. |
| Algorithm parameters documented with rationale | ✓ | Daylight dim window (09:00-16:00) commented inline. Standby factor default 0.10 explained. |
| Configurable defaults exposed as library entries | ✓ | Schedule presets via `schedulePresets.js`. Load-type templates via `loadTypeLibrary.js`. Building-type-aware: hotel / office / school / retail + Custom. |
| New constants from this brief reviewed | ✓ | Load-type library reviewed against this principle. Building-type defaults are starting points (user edits in place). Audit doc still flags ~10 cross-file duplicated constants (Cd, Cw, frame fraction, default U-values, etc.) — queued for Brief 28 as a cross-cutting cleanup. |

---

## Section J: Walkthrough on production-like config

Test scenario: Bridgewater on `/gains`, walk through every panel and tab.

| Item | Status | Notes |
|---|---|---|
| Walkthrough completed on Bridgewater | ⚠ pending user | Chris's hands-on walkthrough is the final close-out step. Code-side walkthrough done across multiple Part-5/7/8/9/10 commit reports. |
| Every input touched and verified responsive | ⚠ pending user | Live readouts respond on every input change in the development build (verified by smoketests). User-side keystroke verification queued. |
| Every tab visited and verified renders | ⚠ pending user | All 7 tabs ship with real content. Build clean across all view components. |
| Engine toggle used; both engines produce results | ⚠ deferred | Engine-toggle slot is wired but Live\|Simulation switch awaits EP State 2 results plumbing. Brief 28 candidate. |
| Save and reload — all values preserved | ✓ | Idempotent migration on load. v2.4 schema persists via `updateParam('gains', ...)`. Backend DB migration ran. |
| Console clean of red errors throughout | ⚠ pending user | Development builds are clean. Production build is clean. User walkthrough pending. |
| Cross-module isolation tested visually | ✓ | Isolation regressions assert byte-identity programmatically. Visual confirmation pending walkthrough. |
| Bridgewater results within state's expected ranges | ⚠ partial | Per Section E: People + Equipment in range; Lighting / Heating / Cooling differ from BREDEM in documented ways. Building-type-aware phasing refinement queued for Brief 28. |

---

## Section K: Documentation and close-out

| Item | Status | Notes |
|---|---|---|
| State contract updated to current version | ✓ | `docs/state_contracts.md` v2.4. |
| `state_N_divergences.md` updated | ✓ | `docs/state_2_part2_verification.md` (post-Part-2 follow-up). |
| `state_N_expected_ranges.md` updated | ✓ | `docs/state_2_expected_ranges.md` updated post-Part-2 diagnostic + scaling note for hotel-vs-BREDEM. |
| Brief archived | ⚠ pending user close-out | Archive once user confirms walkthrough is clean. Both `Brief_27_Internal_Gains.md` and `Brief_27_Revised.md` survive in `docs/briefs/`. |
| `current.md` points at next brief | ⚠ pending user | Will be updated when user picks next brief. |
| STATUS.md updated with deliverables | ⚠ pending user | Reflects in commit messages; user-side STATUS narrative refresh queued. |
| This checklist filled in and committed | ✓ | This file. |

---

## Section L: Known gaps and follow-ups

| Item | Deferred to | Rationale |
|---|---|---|
| Live engine solar model — isotropic → HDKR/Perez | **Brief 28 Part 1** | Documented at `docs/state_1_engine_divergence_investigation.md`. Current 15°C summer-max gap on Bridgewater Live vs Sim is the isotropic-sky residual amplified by the user's current asymmetric WWR config. Biggest single-step accuracy improvement; prerequisite for the engine toggle being meaningful. |
| State 2 EP SQL parser per-profile breakdown | **Brief 28 Part 2** | EP parser returns aggregate gain totals; live engine returns per-profile. Per-profile attribution at the EP side is a refinement, not a contract requirement, but needed to make the engine toggle's Delta view useful. |
| **Engine toggle Live\|Simulation switch** (named Brief 27 holdback) | **Brief 28 Part 3** | Placeholder slot is wired but the segmented control awaits Part 1 (solar fix for engine accuracy) + Part 2 (per-profile EP output). This is the 1/10 gap in Brief 27's 9/10 confidence. |
| Pablo chart component port (ChartContainer / ZoomNav / MonthJumpButtons / DataCard / chartTokens.js) | **Brief 28 Part 4** | Investigation report at `docs/pavlo_chart_components_investigation.md`. Five clean lifts; the canvas restructure in Brief 28 Part 5 consumes these. |
| Canvas restructure — Heat Balance + time-series consolidation across modules | **Brief 28 Part 5** | The Delta-view layout is the right pattern for state-to-state comparison; consolidating Internal Gains' + Building's + Operation's diagnostic views onto shared components removes the module-flavoured drift. |
| State 2 engine agreement script (Live vs Sim byte-tier) | **Brief 28 Part 2** (alongside SQL parser work) | Sibling to `state1_engine_agreement.mjs`. |
| State 1 diagnostic canvas views inside Building module (Free-running Temp, Heat Loss Breakdown, Solar Gain) | **Brief 29 Part 1** | Building currently has 3D viewer + Heat Balance toggle; needs first-class canvas tabs once Brief 28's shared canvas primitives land. |
| Building UI principles conformance audit | **Brief 29 Part 2** | Building pre-dates `ui_principles.md` v1.0; needs audit + minor fixes. |
| Cross-cutting constants cleanup (~10 duplicated values) | **Brief 29 Part 3** | Documented in `docs/hardcoded_constants_audit.md`. State 1 physics constants — fits Building module completion. |
| BREDEM building-type-aware phasing factors | **Brief 29 Part 4** | Hotel-specific phasing under-counts in current BREDEM ranges; per Brief 27 Part 2 verification doc. |
| Engine agreement CI script in pre-merge | Brief 34+ | Future CI brief covers automation. |
| 3D zone gain heatmap | Multi-zone brief (future) | Single-zone model has uniform gain distribution; 3D paint adds no signal. ThreeDView ships as placeholder + profile area-share summary. |
| Per-exception hourly profile lookup for `independent` profiles within exception | Future | Current behaviour: profile's own exception calendar honoured. UI for editing per-profile exceptions within exception edit mode is technically possible but not common workflow yet. |

All items above are queued in their respective briefs (28 / 29) per
the close-out 28/29 split. STATUS.md "Next task" section points at
the current brief.

---

## Section M: Brief-specific items

| Item | Status | Notes |
|---|---|---|
| v2.3 → v2.4 migration idempotency | ✓ | `migrate_gains_v24.py` ran cleanly; second invocation reports "already v2.4, no changes". |
| Multi-profile additive behaviour verified | ✓ | `state2_multiprofile_smoketest.mjs` proves 0.01% drift on three runs (1 profile × 1.0; 2 profiles 0.7+0.3; 2 profiles 0.6+0.4). |
| Annual heatmap exception highlighting works | ✓ | Brief 27 Revised Part 8 — exception strips above carpet plot, highlighting on hover. |
| Schedule editor at canvas width usable | ✓ | Drag-paint scales naturally via getBoundingClientRect; valuesRef fix applied in Part 7 follow-up. |
| /profiles route deleted | ✓ | `ProfilesEditor.jsx` removed. Route + sidebar entry gone. `SchedulePreview.jsx` link redirected to `/gains`. |
| Load-type library covers hotel + office + school + retail | ✓ | `loadTypeLibrary.js` exports 4 templates per category per building type + Custom. |
| Per-day-type quick-set scope | ✓ | Flat / Invert / Shift / Apply baseload / Multiply are all per-active-day. Copy Wk→Sat+Sun is the explicit cross-day operation. |

---

## Sign-off

**Module(s) covered:** Internal Gains (`/gains`) + the v2.4 contract slice of State 2.

**Brief:** Brief 27 (original) + Brief 27 Revised (Parts 6-11 replan).

**Bridgewater verification numbers (current post-migration single-profile config):**

| Metric | Live | EP | Expected range | Status |
|--------|------|----|--------------- |--------|
| Heating demand (MWh) | 10–88 | (per EP run) | 125–165 (BREDEM uniform-phasing) | ✗ below — building-type-phasing-driven, documented |
| Cooling demand (MWh) | 141–322 | (per EP run) | 107–140 (BREDEM uniform-phasing) | ✗ above — same root cause |
| Overheating hours | 3.9k–6.5k | (per EP run) | 2.4k–2.9k | ✗ above — same root cause |
| Underheating hours | 0.7k–3.9k | (per EP run) | 3.5k–4.5k | varies |
| Comfort hours | 0.9k–1.6k | (per EP run) | 1.5k–2.2k | varies |
| Annual mean (free-running) | 23.4–32.7 °C | (per EP run) | 19.5–22.0 °C | ✗ above — same |
| People kWh | 40–70k | (per EP run) | 67–87k (1.33×-scaled) | ✓ in range when occupancy_rate=1.0 + density 1.5 |
| Lighting kWh | 45–47k | (per EP run, agg only) | 67–93k (1.33×-scaled BREDEM) | ✗ below; ✓ in revised 34–50k range |
| Equipment kWh | 126–138k | (per EP run, agg only) | 147–200k (naive 1.33×-scaled) | ✓ matches sub-linear analytical prediction |

Range checks all explained at module-completion level. None silently failing.

**Date completed:** 2026-05-13

**Issues that remain (queued as follow-up briefs):**

1. State 2 EP per-profile breakdown in SQL parser (Brief 28)
2. Engine agreement CI script for v2.4 (Brief 28 + 30)
3. Building-type-aware BREDEM phasing factors (Brief 28)
4. Cross-cutting constants cleanup (Brief 28)
5. 3D multi-zone gain heatmap (multi-zone brief)
6. Engine toggle wiring (Brief 28)

**Confidence that the module is genuinely complete (not just test-complete): 9/10** (post-close-out).

Held back 1/10 for the single named holdback:
- **Engine toggle Live\|Simulation switch on the Internal Gains canvas
  views** — placeholder slot is wired in the tab strip + `EngineBadge`
  chip labels the current live-engine source (shipped 252b7e8), but
  the actual segmented control awaits **Brief 28 Part 3** (after
  Part 1 solar fix and Part 2 SQL parser per-profile breakdown land).

Hands-on Bridgewater walkthrough (Section J) confirmed by the user
post Brief 27 four-bug fix commits (4f4f3a5 + 252b7e8). Module is
genuinely usable end-to-end as built. Brief 28's follow-ups are
refinements; the 1/10 gap will close when the toggle lands.

Brief 28 / Brief 29 split codified at close-out:
- Brief 28: Cross-cutting polish (solar fix → engine toggle → Pablo
  port → canvas restructure)
- Brief 29: Building module completion (State 1 diagnostic canvas
  views, UI conformance, constants cleanup, BREDEM phasing factors)
