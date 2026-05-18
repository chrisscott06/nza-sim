# Brief 29 — First-Principles Audit of NZA-Sim Calculation Engines

> **Archive front matter (Brief 31 Documentation Reconciliation 2026-05-18):**
> **Status:** COMPLETED — Parts 1 & 2 audited, escalation triggered, Issue #13 re-diagnosed as API binding bug (handled in Brief 30 Phase 1.0 commit `cc96815`). Parts 3–8 superseded by Brief 30.
> **Closed:** 2026-05-18
> **Naming note:** This is the First-Principles Audit. The earlier "Brief 29 — Building Module Completion" file shares the same brief number; archived separately as `29_Building_Module_Completion_v2_SUPERSEDED.md`.

---

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Replaces all other queued work until complete.
**Date opened:** 2026-05-17

---

## Why this brief exists

Three diagnostic exchanges across the recent Building module work have followed the same pattern:

1. A number visible on screen violates basic building physics.
2. The engine (or an AI assistant interpreting it) reaches for an exotic mechanism to explain the number — "lumped 2-node mass artefact," "T_zone swings below T_out via radiative loss to sky," "Static engine is just less accurate than Dynamic."
3. Chris pushes back from first principles.
4. After multiple turns, the real cause is found — usually a display omission, an unguarded code path, or a missing State 1 suppression — and the exotic mechanism turns out to have been invented.

The most recent instance: the Bridgewater envelope-only heating demand showed 384 MWh against a 252 MWh fabric loss total and 99 MWh of solar gains. The displayed numbers violate the physical constraint that demand must lie in `(loss − solar) ≤ demand ≤ loss` for a no-gain envelope-only case. The diagnostic eventually revealed a 202 MWh always-open "natural ventilation" term being integrated into the demand but not displayed anywhere on screen — because the display code iterated a fixed list of seven element keys and `natural_ventilation` was an array that nobody iterated. Two engines agreed on a wrong answer because they shared a wrong upstream input.

**The bug was found because the user has an undergraduate building-physics intuition and refused to accept it.** It was not found by any internal test. The reconciliation check that existed — "Heat Balance annual sum = Monthly sum" — passed with a ✓, because both displays were leaving the term out and agreeing with each other.

This is unsustainable. The class of test the codebase currently has does not catch the class of bug that is actually occurring. We need a from-first-principles audit of the entire calculation engine — both Static (`instantCalc.js`) and Dynamic (`epjson_assembler.py` + EnergyPlus + `sql_parser.py`) — across every module that ships heating, cooling, or energy numbers to the user.

This brief is that audit.

---

## Hard rules for this brief

Read these before doing anything. They are non-negotiable.

1. **No appeals to "expected values" the user has supplied.** Do not write "this number falls within Chris's expected band." The audit must be internally complete: every number derived from a heat balance you write on this brief.

2. **No exotic mechanisms.** The following phrases are banned in the audit writeup unless accompanied by a textbook citation (CIBSE Guide A, ASHRAE Handbook of Fundamentals, BS EN ISO 13790, Hens *Building Physics*, or equivalent) **with page number** and a number showing the mechanism contributes more than 2% of annual demand:
   - "Radiative loss to sky lowering zone air temperature"
   - "Lumped 2-node mass artefact inflating demand by 30–60%"
   - "T_zone swings below T_out on cold nights"
   - "Dynamic uses CTF and Static uses 2-node, so they're just different"
   - Any cousin of these.

   If you find yourself reaching for one of these to explain a gap, **stop**. The gap is more likely a bug than a recognised building physics phenomenon. If a number on screen cannot be defended from a one-page heat balance, the number is undefended and goes on the audit list.

3. **Every term in the demand integral must appear in the displayed loss/gain breakdown, in every layout (Rows, Stacked, Sankey, Summary, Monthly).** The reconciliation invariant the codebase needs is **"Σ displayed loss terms = Σ terms in the demand integral, to within ±1%."** Internal-consistency reconciliations (display A = display B) do not satisfy this. Add the integrand-vs-display check as part of this brief.

4. **Diagnose before you fix.** This applies recursively. If you find a divergence between integral and display, instrument the integrand and the displayed value at every aggregation step. Report the breakdown before proposing a fix. Per the development bible: *"If you're about to say 'I know exactly what's happening' — stop and ask yourself whether you actually have the evidence, or whether you're assuming. If you're assuming, add logging first."*

5. **Clean up before you build.** Per the bible: old loss expressions, commented-out integrals, dead aggregation paths, replaced helper functions — find them and delete them before adding instrumentation. Old loss code paths are a likely source of further hidden terms.

6. **Three strikes then escalate.** If you cannot defend a number from first principles after three attempts, stop. Write up what you tried, what's defensible, and what isn't. Escalate to Chris. Do not invent a fourth mechanism.

---

## Scope

Every module that ships a heating, cooling, energy, demand, or load number to the user is in scope.

- **State 1 — Building (envelope-only):** Static + Dynamic
- **State 2 — Internal Gains:** Static + Dynamic
- **State 2.5 — Operation (operable windows, set-back, free-cooling):** Static + Dynamic
- **State 3 — Systems (HVAC, ventilation, DHW, lighting, small power):** Static + Dynamic
- **Results & Scenarios:** any aggregated demand or load number
- **CRREM trajectory:** the modelled EUI input
- **Consumption module:** the modelled-vs-actual comparison

The Intervention Model (28-IM) is **explicitly in scope** because it produces baseline-vs-scenario differences, and if either baseline or scenario has a hidden term, the difference inherits the bug.

---

## Structure of the audit

For each module and each engine, produce a section in `docs/audit/29_first_principles_audit_FINDINGS.md` with the following structure. **Use this exact template. No deviations.**

```
## Module: [name]   Engine: [Static | Dynamic]

### Heat balance on this module (state the physics)
A one-page heat balance for what this module computes. Plain text or LaTeX-rendered.
Every term in the balance must be named, with units, and tied to a code symbol.

   ΣQ_in − ΣQ_out = ΔH_storage    (zone, hourly)
   
   ΣQ_in  = Q_solar_to_zone + Q_people + Q_lighting + Q_equipment + Q_heating
   ΣQ_out = Q_conduction_walls + Q_conduction_roof + Q_conduction_floor 
            + Q_conduction_glazing + Q_thermal_bridging 
            + Q_infiltration + Q_permanent_vent + Q_natural_vent + Q_cooling
   
   [etc — state every term]

### Code traversal
For each term in the balance above, the file:line where it appears in the integrand.
Include any term that is in the integrand but NOT in the balance — these are the bugs.

   Term                          | In balance? | File:line          | Annual MWh (Bridgewater)
   Q_conduction_walls            |     ✓       | instantCalc.js:884 | 20.0
   Q_natural_vent (operable)     |     ✗       | instantCalc.js:957 | 202.4   ← MISMATCH
   [etc]

### Display traversal
For each term in the integrand, where it appears in the displayed loss/gain breakdown.
Include any displayed term that is NOT in the integrand — these are also bugs.

   Term                          | Sankey? | Rows? | Stacked? | Summary? | Monthly?
   Q_conduction_walls            |   ✓     |   ✓   |    ✓     |    ✓     |    ✓
   Q_natural_vent (operable)     |   ✗     |   ✗   |    ✗     |    ✗     |    ✗   ← MISMATCH
   [etc]

### Reconciliation
   Σ integrand terms (annual)    = X MWh
   Σ displayed terms (annual)    = Y MWh
   Reported demand (annual)      = Z MWh
   
   If X ≠ Y to within 1%, that is a bug — name it.
   If Z is not derivable from X and the credited gains, that is a bug — name it.

### Defended numbers (Bridgewater)
Each headline number from this module, with the heat-balance derivation that supports it.
   
   Heating demand: 384 MWh
       = Σ losses (with all terms including operable openings) − utilised solar
       = 454 − 70 (88 MWh solar of which 70 lands in heating hours, post-utilisation)
       ≈ 384 MWh   ✓ matches
   
   If a number cannot be defended, write:   UNDEFENDED — investigate.

### Open issues found
A numbered list of every discrepancy, missing term, hidden display, double-count, 
or unit error found in this module/engine combination. No fixes here — just the list.

### Cross-engine consistency check
For the same Bridgewater config, do Static and Dynamic agree on this module's outputs 
to within a defensible tolerance? If not, state the tolerance, and state the physical 
mechanism for the disagreement with a number. Cannot use any of the banned phrases.
```

---

## Order of work

Do the modules in this order. Do not skip ahead.

### Part 1 — Building module (envelope-only), Static engine

1. Read `_calculateEnvelopeOnly` end to end in `frontend/src/utils/instantCalc.js`. Make a list of every variable that contributes to `hourly_heat_loss_Wh` or any term that feeds the heating/cooling demand integral.
2. Read the loss-aggregation code that populates `losses_at_setpoint` (and any similar object). Make a list of every key it writes.
3. Read the display code in `HeatBalance.jsx`, `BalanceSankey.jsx`, `SummaryTab.jsx`, `Monthly.jsx`, and `Profiles.jsx`. List every loss key it iterates over.
4. Compare the three lists. **Any term in (1) but not in (2) or (3) is a hidden integrand term.** Any term in (2) or (3) but not in (1) is a display ghost.
5. **Additional Part 1 check — ventilation topology:** Confirm which flow correlation the permanent-vent and operable-opening paths use. Specifically: does the model assume cross-flow (windward-leeward ΔP across the building), single-sided (empirical 0.025·A·v per opening), or balanced mechanical (extract rate sets the flow)? Document the assumption. State whether the assumption is encoded in a per-opening data field or hard-coded engine-wide. If hard-coded, that is a Part 1 finding requiring a `flow_mode` field on operable_openings and permanent_vents. Also confirm the C_d value used and whether it varies with opening geometry (slot, orifice, louvre).
6. Write the template-conforming section for Static / Building. Defend the Bridgewater numbers numerically — including the corrected vent loss under the appropriate topology for Bridgewater (balanced mechanical, ~24 MWh, not cross-flow at ~120 MWh).

### Part 2 — Building module (envelope-only), Dynamic engine

1. Read `_build_state1_zone_objects`, `_build_openings_objects`, `_build_operable_openings_objects`, and `_build_envelope_objects` in `nza_engine/generators/epjson_assembler.py`. List every EnergyPlus object emitted in State 1 mode.
2. Read `_get_heat_balance_state1` in `nza_engine/parsers/sql_parser.py`. List every SQL meter and Output:Variable it extracts.
3. Compare to Static. Identify any term Dynamic emits that Static doesn't have, or vice versa. Reconcile.
4. For each EnergyPlus object that contributes to demand, check the State 1 gating. Specifically: is the object suppressed in envelope-only mode if it represents a State 2 / State 2.5 / State 3 concept? Document the gating logic for every such object.
5. **Additional Part 2 check — EnergyPlus ventilation object choice:** Which EnergyPlus object is emitted for permanent vents and operable openings — `ZoneVentilation:DesignFlowRate` (fixed rate, equivalent to balanced-mechanical), `ZoneVentilation:WindandStackOpenArea` (cross-flow), `AirflowNetwork:*` (full pressure network), or something else? The choice of object IS the topology assumption. Confirm it matches the topology declared in Static (Part 1, check 5). If they disagree, that disagreement is a Part 3 reconciliation finding. Confirm C_d value passed to the EP object matches the Static-side C_d.
6. Write the template-conforming section for Dynamic / Building.

### Part 3 — Cross-engine reconciliation, Building

Side-by-side: Static and Dynamic, Bridgewater, envelope-only, post-fix.

| Term | Static MWh | Dynamic MWh | Δ | Defensible mechanism (with citation) |

If there is any Δ that cannot be defended, it goes on the open-issues list.

### Part 4 — Internal Gains, Static + Dynamic

Same audit, same template. **Pay particular attention to:**
- Whether occupancy → derived lighting → derived equipment is implemented correctly: does the integrand use the occupancy-scaled lighting, or does it independently pick up the lighting profile? (Risk of double-counting.)
- Whether internal gains appear as a credit in the heating demand integral and as a load in the cooling demand integral. Walk both code paths.
- Whether sensible / latent splits are tracked correctly through to demand.

### Part 5 — Operation (State 2.5), Static + Dynamic

The operable openings live here in their proper home. After Brief 28-IM-AUDIT-01 Part 1 you'll know the door wasn't supposed to be in State 1 — but here it should be. Audit the State 2.5 emission and the State 2.5 demand integral. Make sure the door IS in the integrand AND the display in this mode.

### Part 6 — Systems (State 3), Static + Dynamic

Audit:
- HVAC efficiency chain (COP, distribution losses, control losses)
- Ventilation (MVHR / MEV) heat recovery and parasitic fan energy
- DHW (storage losses, distribution, primary fuel)
- Lighting and small power as electrical end-uses
- Conversion from demand → delivered energy → primary energy → carbon

Every conversion factor must be traceable to a library item or a published source.

### Part 7 — Results, Scenarios, CRREM, Consumption

These are aggregators. Their job is to faithfully sum what the upstream modules say. Audit:
- That nothing is added that wasn't in an upstream module
- That nothing is dropped between upstream module and aggregator
- That unit conversions (Wh → kWh → MWh → kWh/m²·yr) are consistent

### Part 8 — Intervention Model (28-IM)

Audit:
- That a "baseline" run and a "scenario" run differ only by the variables the intervention is meant to change
- That the difference (Δ) reported on screen is exactly `scenario − baseline` from the same demand integral, not a separate calculation
- That cost / payback calculations use the same Δ

---

## Permanent ventilation — a worked example to lock the method

Permanent ventilation (always-open louvres, trickle vents) emerged as a 120.8 MWh line on Bridgewater. The vent geometry: trickle vents above each window, **~15 mm × 1.2–1.3 m slots** (aspect ratio ~80:1), totalling ~1.00 m² on the NE façade and ~0.76 m² on the SW façade. Internal arrangement: cellular rooms separated by corridors with no cross-flow path; each room has continuous mechanical extract (bathroom/en-suite).

The 120.8 MWh figure is **probably overstated by a factor of 5 or more** because the engine is likely modelling cross-flow wind-and-stack ventilation across a façade-summed area with a generous discharge coefficient — a model appropriate for an open-plan naturally-ventilated building, not a cellular hotel with mechanical extract. There are two distinct issues, both of which the audit must surface:

1. **Discharge coefficient is wrong for slot geometry.** A 15 mm × 1.2 m slot with aspect ratio ~80:1 has C_d in the range 0.35–0.40 per CIBSE Guide A Table 4.20 and Liddament's *A Guide to Energy Efficient Ventilation* (AIVC Technical Note 32, 1996). Engines often default to C_d = 0.61 (sharp-edged orifice) or 0.65 (general opening). Using 0.61 instead of 0.40 overstates flow by ~50%.

2. **Topology assumption is wrong for the building.** Cross-flow wind-and-stack correlations assume vents on opposite façades are connected by an open internal air path. Bridgewater has cellular rooms with closed corridors. The actual topology is **single-sided rooms balanced by mechanical extract**, in which the ventilation rate is set by the extract fan, not by wind pressure across the vent. The vent is just the makeup-air path.

The combined effect of these two issues: cross-flow with C_d = 0.65 produces ~5 m³/s and ~120 MWh annual loss. Single-sided with C_d = 0.40 produces ~1.5 m³/s and ~30–40 MWh. **Mechanically-balanced with the actual extract design rate (~6–10 l/s per room × 134 rooms ≈ 0.8–1.3 m³/s) produces 15–25 MWh annual loss.** That's the right answer for this building.

Use this worked example as the canonical reference. If Static or Dynamic disagrees with this method, that disagreement is a bug.

### Step 0 — topology check (do this BEFORE any flow calculation)

Identify the building's ventilation topology. This determines which correlation to apply. Get it wrong and the answer is wrong by a factor of 3–8.

- **Cross-flow**: vents on opposite façades connected by an open internal air path (atrium, open-plan office, full-height stack). Use wind-and-stack with combined ΔP between façades.
- **Single-sided**: vents on one façade only, no opening on the opposite side of the room. Use the empirical single-sided correlation `Q̇ ≈ 0.025 · A · v_wind` (per BS EN 16798-7 §6.4, Etheridge & Sandberg *Building Ventilation: Theory and Measurement* 1996).
- **Balanced mechanical**: continuous mechanical extract (or supply) sets the room air-change rate; the vent is the makeup path. Use the extract design flow as the ventilation rate; check the vent area is large enough to deliver it without excessive pressure drop (typical maximum room depression ~5–10 Pa).

For Bridgewater: each guest room has a trickle vent above the window and a continuously-running bathroom extract. **Topology is balanced mechanical.** The trickle vent does not drive the ventilation rate; it permits makeup air at low pressure drop. Cross-flow correlations are not applicable.

### Step 1 — Flow rate from area (use only when Step 0 says cross-flow or single-sided)

For a sharp-edged opening with flow driven by wind pressure and stack effect:

```
Q̇ [m³/s] = C_d · A · √(2 · ΔP / ρ)
```

Where:
- `C_d` = discharge coefficient — **shape-dependent**:
  - Sharp-edged orifice: 0.61
  - General louvred opening: 0.65
  - **Long narrow slot (aspect ratio > 10:1, e.g. trickle vent): 0.35–0.40** (CIBSE Guide A §4.6 and Table 4.20; AIVC Technical Note 32)
  - Use the geometry-appropriate value. The engine using 0.61 or 0.65 for trickle-vent slot geometry overstates flow by ~50%.
- `A` = total opening area [m²]
- `ΔP` = pressure differential [Pa], the sum of stack and wind components
- `ρ` = air density ≈ 1.20 kg/m³ at 20 °C

Stack pressure (buoyancy-driven, vertically separated openings):

```
ΔP_stack = ρ · g · h · (T_in − T_out) / T_in
```

Where `h` is the vertical separation between high and low openings [m], `T` in Kelvin, `g = 9.81 m/s²`.

Wind pressure on a façade:

```
ΔP_wind = 0.5 · ρ · C_p · v²
```

Where `C_p` is the wind pressure coefficient (typically +0.7 windward, −0.3 leeward for a low-rise rectangular building per CIBSE Guide A Table 4.7), `v` is the local mean wind speed [m/s] at building height.

Combined: ΔP_total = √(ΔP_stack² + ΔP_wind²) for orthogonal driving forces, or sum if collinear.

### Step 2 — Heat loss from flow rate

```
Q̇_heat [W] = ρ · c_p · Q̇ · (T_in − T_out)
```

Where `c_p ≈ 1005 J/kg·K` for dry air. Annual integral over heating-direction hours gives MWh.

### Step 3 — Reference check (Bridgewater, comparing the three topology cases)

**Common parameters:** 1.76 m² total vent area, building ~16 m tall, mean winter ΔT ≈ 12 K, mean wind speed ~4 m/s, 134 rooms, EPW-derived heating-direction hours.

**Case A — Cross-flow with default C_d (the engine's current likely model):**
- C_d = 0.65, ΔP_total ≈ 12 Pa
- Q̇ ≈ 0.65 × 1.76 × √(2 × 12 / 1.20) ≈ 5.1 m³/s
- Annual heat loss ~ 110–130 MWh
- **This matches the engine's 120.8 MWh output and is wrong for this building.**

**Case B — Single-sided with slot C_d (a partial correction):**
- Using `Q̇ ≈ 0.025 · A · v_wind`: 0.025 × 1.76 × 4 = 0.18 m³/s
- With C_d correction for slot geometry (factor ~0.6 reduction vs sharp-edged baseline): ~0.11 m³/s
- Annual heat loss ~ 4–8 MWh
- **Too low — does not account for mechanical extract.**

**Case C — Balanced mechanical (the right model for Bridgewater):**
- 134 rooms × 8 l/s typical hotel extract = 1.07 m³/s mechanical extract rate
- This sets the makeup rate. Air enters through the trickle vent at this rate (driven by the room being slightly negative).
- Heat loss: ρ · c_p · Q̇ · ΔT_mean × heating hours = 1.20 × 1005 × 1.07 × 12 × 5500 / 3.6e9 ≈ **24 MWh annual**
- **This is the defensible number.**

The engine is reporting Case A (120.8 MWh). Reality for Bridgewater is Case C (~24 MWh). **The engine is overestimating permanent vent loss by a factor of ~5.**

This is not a small finding. Vent loss is currently the *largest* single loss term in the Bridgewater envelope-only Sankey (120.8 MWh out of 252 MWh total). Correcting it would reduce fabric losses to ~155 MWh, which puts Static heating demand in the 90–140 MWh range — much closer to physical intuition for a 4,322 m² hotel with modern U-values and 99 MWh of solar gain.

**Action: implement the topology-aware method as a stand-alone test in the audit. Both engines must:**
1. Declare which topology mode they assume per vent / per zone.
2. Use the appropriate correlation for that mode.
3. Use the geometry-appropriate C_d.
4. Reproduce the hand-calculated number for the declared topology to within 20%.

If either engine has no concept of topology mode and applies cross-flow universally, **that is the audit finding** — and the fix is a data-model change adding a `flow_mode` field (`cross | single_sided | balanced_mechanical`) per opening, plus engine logic to pick the correct correlation.

The Excel-based human-verification spreadsheet Chris referenced needs a new tab for permanent vent losses using this exact method. Add a placeholder note in the audit output that the spreadsheet update is queued.

---

## Deliverables

By the end of this brief, the following exist:

1. `docs/audit/29_first_principles_audit_FINDINGS.md` — one section per module/engine using the template. The complete output.
2. `docs/audit/29_open_issues.md` — a numbered list of every discrepancy found. Each issue: title, module, engine, current value, expected value, root-cause hypothesis, severity (1–3).
3. `docs/audit/29_permanent_vent_methodology.md` — the locked methodology above, copied verbatim, with the worked Bridgewater example reproduced from actual code output (not the rough numbers in this brief).
4. A new reconciliation test added to the codebase: **integrand-vs-display invariant** — at every save/run, the sum of all loss terms in `losses_at_setpoint` (plus any sibling arrays like `natural_ventilation`) equals the sum of all terms that enter the demand integral, to within 1%. Fail loudly if not.
5. Updated `STATUS.md` reflecting Brief 29 outcome.
6. Updated `CLAUDE.md` if any new non-negotiable rules emerge.
7. A short note appended to the NZA Development Bible (in Notion) capturing the lessons from this session — see the "Lessons learned" table.

## What MUST NOT be done in this brief

- No fixes during the audit pass. Findings only. Fixes are a separate brief that follows.
- No removal of the existing `25602f8` door fix (that one is sound — it's a known bug, already diagnosed, already corrected). But verify it's still in place.
- No changes to UI chrome or any of the POL-M2 / POL-M3 polish work.
- No new modules. This is an audit of what exists.

## When to escalate to Chris

- If you find more than 5 open issues at severity 2 or higher in a single module.
- If the audit reveals that a previously closed brief (26, 27, 28-IM) needs material rework.
- If you find a structural issue with how the engines share inputs — i.e. a class of bug rather than an instance.
- If the methodology in the permanent-vent worked example does not match either engine's implementation by more than 20%.

---

## Lesson for the Development Bible (append to the Notion lessons table)

```
| Lesson | Source | Date |
| Internal display consistency tests are not sufficient — the codebase 
  requires an integrand-vs-display invariant that asserts every term entering 
  the demand integral appears in the displayed loss/gain breakdown. Without 
  this, two engines can agree on a wrong answer by sharing a hidden input. 
  | NZA-Sim Brief 28e door bug | May 2026 |
| When a displayed number violates basic building physics, do NOT reach for an 
  exotic mechanism (sky radiation, lumped-mass artefact) to explain it. The 
  gap is almost always a hidden integrand term or a display omission. Diagnose 
  before defending. | NZA-Sim Brief 28e door bug | May 2026 |
| State suppression must be implemented at the integrand level AND at the 
  display level, with a shared gating helper. The Brief 28e gate added 
  operable openings to one engine without the State 1 suppression that other 
  paths had, because the gating was implemented ad-hoc rather than via a 
  shared helper. | NZA-Sim Brief 28e door bug | May 2026 |
| The choice of physical correlation (cross-flow vs single-sided vs balanced 
  mechanical for ventilation; lumped vs distributed for mass; steady-state vs 
  transient) must be appropriate to the building's actual topology. Defaults 
  that suit one building type (open-plan offices with cross-ventilation) will 
  overestimate or underestimate by factors of 3–8 for others (cellular hotels 
  with mechanical extract). Every model assumption must be traceable to an 
  explicit "this assumes..." declaration that a domain expert can check. 
  | NZA-Sim Brief 29 audit | May 2026 |
```

---

## Sign-off

Chris signs off Part 1 (Building Static) before Part 2 begins.
Chris signs off Parts 1–3 (Building both engines) before Parts 4+ begin.
This is to avoid running the same class of bug through six more modules before noticing.

**Standing by for authorisation to begin Part 1.**
