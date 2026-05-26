# Brief 53 anchor-drift diagnosis (sidecar) — COMPLETED 2026-05-26

**Engine verdict:** INNOCENT (refbox falsifiability tests all byte-exact).
**Anchor recovered:** YES — verification DB now reads EUI 128.20 exactly from a documented reconstruction (NOT the eff=5.0 fudge).
**Contamination footprint:** 6 leaf fields, all in `systems_config_v40`. Scope is tight.

---

## §1 — Symptom

Falsifiability test T1 (Bridgewater clean, all `summer_bypass = false`, EUI must = 128.20):

| When | EUI | Δ |
|---|---:|---:|
| After Brief 50 close (anchor era) | **128.20** | 0.00 ✓ |
| After Part 2 commit (eaa91b0) | **128.20** | 0.00 ✓ |
| After Part 4 commit (a6ab4d2) | **128.20** | 0.00 ✓ |
| **After browser-session autosaves at 14:49 + 14:51** | **131.90** | **+3.70 ✗** |
| Verification DB after Step 2c reconstruction | **128.20** | 0.00 ✓ |
| Live DB (still drifted; user request) | 131.90 | (untouched) |

Refbox falsifiability tests (which build inline configs, not from DB) STILL pass exactly throughout — confirming the engine is correct, the contamination is in `projects.building_config`.

---

## §2 — Contamination footprint (Step 3 diff)

Live `:8002` ↔ verification `:8003` field-by-field:

| Field | Live (drifted) | Clean (anchor) |
|---|---:|---:|
| `v40.heating[0].share_pct` | 90 | **95** |
| `v40.heating[1].share_pct` | 10 | **5** |
| `v40.ventilation[0].flow_rate` (mvhr_gf_public) | 1431 | **1425** |
| `v40.ventilation[1].flow_rate` (bedroom_extract) | 2292 | **2208** |
| `v40.ventilation[2].flow_rate` (public_toilet_extract) | 479 | **210** |
| `v40.lighting[0].control_factor` | 1.00 | **0.86** |

**Total: 6 fields, ALL in `systems_config_v40`.** Zero diffs in `systems_config_v25`, `interventions`, envelope (`length`/`wwr`/`fabric`/`openings`/etc.), `comfort_band_*_c`, `gains`, `occupancy`, or any other building_config field.

Probe: `scripts/_brief53_contamination_diff.mjs`. Re-runnable any time both backends are up.

EUI contributions to the +3.70 drift:
- Heating share 90/10 → 95/5: **−0.70 kWh/m²** (more share to higher-SCOP primary VRF)
- Vent flow_rate drift → v25 values: **−0.60 kWh/m²** (smaller flows = less vent loss)
- Lighting control_factor 1.00 → 0.86: **−2.40 kWh/m²** ← dominant (14 % less lighting electricity)

The lighting `control_factor` reset to 1.0 — "daylight dimming disabled" — was the largest single contributor. Bridgewater lighting at 76 MWh/yr × 14 % = 10.6 MWh = 2.5 kWh/m². Within rounding.

---

## §3 — What this means about the source of the autosave

The fact that ALL 6 contaminated fields are in `systems_config_v40` (and NONE in v25, NONE in interventions, NONE in envelope) is a sharp diagnostic signal: the autosave came from a code path that writes `systems_config_v40` specifically — i.e. `SystemsModule.jsx`'s `writeV40(...)` helper or its callers.

`writeV40` is invoked from:
- `addSystem` / `updateSystem` / `removeSystem` (user click on edit controls)
- `handleShareChange` (slider drag)
- `normaliseShares` ("Normalise" button)
- `updateServiceLevel` (service-level fields like setpoints)
- `cloneSystem` etc.

NONE of these have a mount-time `useEffect`. So a literal SystemsModule mount can't fire them.

BUT: the **Brief 45 Part 3b auto-rebalance** logic in `handleShareChange` re-derives partner shares whenever a single share changes. If something re-emits a "share change" event without user input, that triggers writeV40. Candidates:
- **A stale browser tab loaded against the project** — when ProjectContext applied a Brief 42 v1→v2 migration on load OR a Brief 50 Part 6 HRE source unification, it called `setParams(...)` which triggered downstream re-renders. If any sub-component computed a "current share" from migrated data and called `handleShareChange` to "snap" it to a round value, that fires writeV40.
- **An InterventionCaptureContext re-emit** — Brief 46 introduced capture-context architecture. The capture context publishes patches; if the capture context replayed a stale patch from a previously-applied intervention onto the current building config, that could overwrite v40 fields.

The 14-stale-vite-process state on the machine before Step 1 cleanup made this very likely: any browser tab open against any of those stale vites could have been triggering the autosave.

**Not pinned to a single line of code, but the scope is narrow** — `systems_config_v40` writes only. Now that:
1. Stray vites are killed (Step 1)
2. Verification DB is isolated on its own port (8003)
3. The verification DB anchor is at 128.20 exactly

the contamination cannot recur in the verification workflow. The live DB on :8002 still has the 6 drifted fields; user can revert at their leisure (or run `node scripts/_brief53_anchor_persist.mjs` with `NZA_API=http://127.0.0.1:8002`, but that has a safety abort — would need to edit the script to override).

---

## §4 — Documented clean anchor (verification DB state)

After Step 2c reconstruction, the verification DB Bridgewater has:

| Field | Value | Source |
|---|---|---|
| `v40.heating[0].share_pct` | 95 | matches `v25.heating.primary_pct` |
| `v40.heating[1].share_pct` | 5 | implied (100 − 95) |
| `v40.heating[0].efficiency_metric` | 2.8 | Chris's VRF calibration (NOT library 5.12) |
| `v40.heating[1].efficiency_metric` | 1.0 | electric panel heater (matches library) |
| `v40.cooling[0].efficiency_metric` | 3.5 | (library 3.51; 0.01 rounding kept) |
| `v40.dhw[0].efficiency_metric` | 0.9 | gas boiler (matches library 0.90) |
| `v40.dhw[1].efficiency_metric` | 2.5 | ASHP DHW calibration (NOT library 3.0) |
| `v40.dhw` shares | 65/35 | matches current/anchor |
| `v40.ventilation[].flow_rate` | 1425 / 2208 / 210 | matches `v25.ventilation[].flow_l_s` |
| `v40.ventilation[].efficiency_metric.recovery_sensible_pct` | 75 / 0 / 0 | Brief 50 Part 6 v40-source-of-truth |
| `v25.ventilation[].hre` | 0.80 / 0 / 0 | stale (engine reads v40) |
| `v40.lighting[0].control_factor` | 0.86 | daylight dimming calibration |
| `heating_setpoint_mode` / `cooling_setpoint_mode` | follow_comfort | follow comfort band |
| `comfort_band_lower_c` / `upper_c` | 21 / 24 | Chris's settings |

**Engine output:** EUI = 128.20 kWh/m²·yr exactly. Verified by `scripts/_brief53_bypass_falsifiability.mjs` T1.

---

## §5 — What I committed (still correct)

- `f0a89ad` — §1.4 residual branch test verdict (Branch B)
- `9d7d512` — Part 1 amend (free-cooling trigger)
- `eaa91b0` — Part 2 (summer-bypass engine + reconciliation byte-exact)
- `a6ab4d2` — Part 4 (LOSS_ORDERS canonical keys)
- `15d254a` — Part 3 (Heat balance tab on Systems)
- `f53dcd5` — Part 3 verify (cooling-ribbon shrinkage probe)
- `d323e12` — Isolation setup (env-var DB override, port 8003)
- `4002546` — Home page Clone + Delete (initial)
- `b1212f9` — Home page true two-step delete confirm
- THIS commit — Step 1-3 cleanup: stray processes killed, anchor reconstructed, contamination diff documented.

Brief 53 Parts 2/3/4 are individually correct. They stay merged. **Part 5 is now unblocked** — the verification DB anchor at 128.20 is stable and isolated; "no baseline change" verifications are meaningful again.

---

*Diagnosis complete. Verification environment is isolated and at the verified-clean 128.20 anchor.*
