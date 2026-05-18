# Brief 33 — Building Envelope: Revert, Fix Trickle Vent C_d, Lock the Scope

> **Repo front matter (Brief 33 Part 1 commit 2026-05-18):**
> **Progress:** Part 1 in flight (this commit) — revert `balanced_mechanical` + `mech_extract_lps_per_room` from the Building module; Bridgewater migrated to `single_sided`. Parts 2 (geometry-aware C_d) and 3 (CLAUDE.md "Module scopes") to follow as separate commits.
> **Authorised:** 2026-05-18 by Chris, with Part 2 single-sided restriction-factor specification (`Q = 0.025 · A · v_wind · min(1.0, C_d / 0.6)`) given in chat at the same time.

---

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Closes Brief 32.
**Date opened:** 2026-05-18
**Target outcome:** The Building module's permanent vent calculation uses a realistic, geometry-aware C_d. The `balanced_mechanical` mistake from Brief 32 Part 2 is reverted. The Building module's scope is stated unambiguously in CLAUDE.md so the same confusion cannot recur.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md.
3. Read STATUS.md as currently on disk; confirm last entry is Brief 32 Part 2 (commit `341eeff`).
4. Confirm working tree clean: `git status --short`.
5. Confirm `origin/main == local main`: `git fetch origin && git log origin/main..main && git log main..origin/main` both return empty.
6. Do not begin Part 1 until all five checks pass.

---

## Scope statement — the only thing this brief does

The Building module computes envelope-only heat balance: conduction through walls/roof/floor/glazing, thermal bridging, solar gains through glazing, infiltration through the q50-rated envelope, and heat loss through permanent (always-open) envelope openings. It uses a user-defined comfort band to express heating and cooling demand.

The Building module does not contain occupancy, lighting, equipment, HVAC, mechanical ventilation, operable windows, thermostats, system efficiencies, or controls.

Permanent vents are passive holes in the envelope (trickle vents, louvres, fixed grilles). They are wind-driven. The flow through them is calculated from area, geometry-derived C_d, and weather. They have no relationship to any mechanical system.

This brief does three things and only three things:

1. Revert the `balanced_mechanical` flow_mode and `mech_extract_lps_per_room` field that were added to the Building module in Brief 32 Part 2. They are systems concepts and don't belong here.
2. Replace the hard-coded global C_d (currently 0.6) with a per-opening derivation from geometry and resistance features. Bridgewater's trickle vents (15 × 1300 mm slot, mesh, flap) end up with a realistic C_d around 0.25.
3. Add an explicit Building module scope statement to CLAUDE.md so future briefs cannot accidentally import non-envelope concepts.

No safety machinery, no architectural contract systems, no deliverable reports. Just the three above.

---

## Principles

1. **No pre-assumed numerical targets.** The engine produces what the physics produces. We report the number and check it is physically defensible (is the flow plausible for 1.76 m² of slot vents in a UK climate at mean wind speed?). We do not calibrate to a target.
2. **Each commit updates STATUS.md in the same commit.** Per CLAUDE.md Process Rule 7.

---

## Parts

### Part 1 — Revert `balanced_mechanical` from the Building module

**Goal:** Remove the systems concept introduced in Brief 32 Part 2.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — remove the `balanced_mechanical` branch in the permanent-vent dispatch; remove any references to `mech_extract_lps_per_room`
- `frontend/src/context/ProjectContext.jsx` — remove `mech_extract_lps_per_room` from `DEFAULT_PARAMS.openings`; restrict `flow_mode` allowed values to `'cross'` and `'single_sided'`
- `frontend/src/components/modules/building/BuildingDefinition.jsx` — restrict the dropdown to two options; remove the conditional extract-rate input field
- `scripts/33_bridgewater_single_sided_migration.py` (new) — idempotent migration setting Bridgewater's permanent vents to `flow_mode: 'single_sided'`; run it
- `docs/audit/29_permanent_vent_methodology.md` — strip the balanced-mechanical section; update intro to state explicitly that mechanical ventilation is out of scope for this document
- `docs/audit/32_vent_fix_verification.md` — strip the Case C section

**Steps:**

1.1 Grep for `balanced_mechanical`, `mech_extract`, `mech_extract_lps_per_room` across `frontend/`, `nza_engine/`, `api/`, `scripts/`, `docs/`. List the matches.

1.2 Remove every reference in code. The flow_mode dispatch in `_calculateEnvelopeOnly` becomes a two-branch dispatch (`cross` and `single_sided`) with a default of `single_sided` when the value is missing or invalid.

1.3 Restrict the UI dropdown to two options. Remove the conditional extract-rate input field.

1.4 Author `scripts/33_bridgewater_single_sided_migration.py`. Set Bridgewater's `permanent_openings[*].flow_mode` to `'single_sided'`. Idempotent. Run it. Confirm persistence.

1.5 Update `docs/audit/29_permanent_vent_methodology.md`:
- Strip the balanced-mechanical section entirely.
- Replace the intro with: "This document covers passive envelope openings — trickle vents, louvres, fixed grilles, fixed holes in the envelope. These are wind-driven. Mechanical ventilation is not in scope; it is modelled in the Systems module."
- Two correlations remain: `cross` (wind-and-stack ΔP across opposite façades per CIBSE Guide A) and `single_sided` (empirical `0.025 · A · v_wind` per BS EN 16798-7 §6.4).

1.6 Update `docs/audit/32_vent_fix_verification.md`: strip Case C. Document reproduces Case A and Case B with current code outputs, no pre-assumed target numbers.

1.7 Build clean.

**Verification:**
- Grep returns zero matches for `balanced_mechanical` or `mech_extract` in code
- Bridgewater's `flow_mode === 'single_sided'`
- Dropdown shows two options
- Build clean
- Heat Balance permanent-vents number reflects the single_sided correlation with the current global C_d 0.6 (Part 2 fixes the C_d)

**Commit message:**
```
Brief 33 Part 1: Revert balanced_mechanical from Building module

Permanent vents are passive envelope openings, wind-driven only. The
balanced_mechanical flow_mode introduced in Brief 32 Part 2 was a
state-contract violation — it imported a systems concept (mechanical
extract rate) into the envelope module. Removed entirely.

Two flow modes remain: cross and single_sided. Both wind-driven, both
pure envelope physics. Bridgewater migrated to single_sided per its
actual envelope topology (cellular rooms, single-façade vents per room,
no cross-flow path internally).

Closes Brief 32 Part 2 corrective.
```

**STATUS.md update in same commit:** Brief 33 Part 1 entry. Note Brief 32 closes here. Report Bridgewater's new permanent-vents number with the current global C_d (Part 2 will fix that).

---

### Part 2 — Geometry-aware C_d for trickle vents

**Goal:** Replace the hard-coded global C_d (0.6) with a per-opening derivation based on geometry and resistance features. Trickle vents land at a realistic value (~0.25 for Bridgewater).

**Files touched:**
- `frontend/src/utils/openingCoefficients.js` (new) — host the C_d calculator
- `frontend/src/utils/instantCalc.js` — use `computeCd(opening)` in the permanent-vent flow calculation
- `frontend/src/context/ProjectContext.jsx` — extend the opening data model with `type` and `internal_resistance` fields
- `frontend/src/components/modules/building/BuildingDefinition.jsx` — UI for opening type and resistance features; display derived C_d read-only
- `scripts/33_bridgewater_opening_geometry_migration.py` (new) — set Bridgewater's trickle vents to `type: 'trickle_vent'`, `internal_resistance: ['mesh', 'flap']`, dimensions 15 × 1300 mm; run it
- `docs/audit/29_permanent_vent_methodology.md` — add the C_d section with lookup tables and worked examples

**Steps:**

2.1 Extend the opening data model:
- `type`: one of `'orifice'`, `'slot'`, `'louvre'`, `'trickle_vent'`, `'fixed_grille'`
- `internal_resistance`: array, allowed values `['mesh', 'flap', 'acoustic_baffle']`
- `width_mm`, `height_mm`: opening dimensions in mm (required for `slot` and `trickle_vent` types so aspect ratio can be computed)

For existing openings without these fields, apply sensible defaults during migration: square-ish openings default to `orifice`; long-thin defaults to `slot`; explicitly named "trickle" or matching trickle dimensions defaults to `trickle_vent` with `['mesh', 'flap']`. Bridgewater is set explicitly in step 2.5.

2.2 Author `frontend/src/utils/openingCoefficients.js`:

```javascript
// C_d derivation for passive envelope openings.
// Sources: CIBSE Guide A §4.6 and Table 4.20; AIVC Technical Note 32;
//          BS EN 16798-7.

function interpolate(x, x0, x1, y0, y1) {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
}

function baseCd(opening) {
  const { type, width_mm, height_mm } = opening;

  if (type === 'orifice') return 0.61;
  if (type === 'louvre') return 0.40;
  if (type === 'fixed_grille') return 0.40;

  if (type === 'slot' || type === 'trickle_vent') {
    if (!width_mm || !height_mm) {
      throw new Error(`Slot/trickle vent requires width_mm and height_mm`);
    }
    const longer = Math.max(width_mm, height_mm);
    const shorter = Math.min(width_mm, height_mm);
    const ar = longer / shorter;
    // CIBSE Guide A Table 4.20 interpolation
    if (ar <= 1) return 0.61;
    if (ar <= 5) return interpolate(ar, 1, 5, 0.61, 0.58);
    if (ar <= 10) return interpolate(ar, 5, 10, 0.58, 0.50);
    if (ar <= 50) return interpolate(ar, 10, 50, 0.50, 0.42);
    if (ar <= 100) return interpolate(ar, 50, 100, 0.42, 0.38);
    return 0.38;
  }

  throw new Error(`Unknown opening type: ${type}`);
}

const RESISTANCE_MULTIPLIERS = {
  mesh: 0.85,
  flap: 0.70,
  acoustic_baffle: 0.60,
};

export function computeCd(opening) {
  let cd = baseCd(opening);
  for (const r of (opening.internal_resistance || [])) {
    cd *= RESISTANCE_MULTIPLIERS[r] || 1.0;
  }
  return cd;
}
```

2.3 In `instantCalc.js`, replace the hard-coded `0.6` in the permanent-vent flow calculation with a call to `computeCd(opening)`. Per-opening, not global.

2.4 UI: in the Permanent Openings panel, per opening:
- Type dropdown (5 options)
- Internal resistance checkboxes (mesh, flap, acoustic baffle)
- Derived C_d displayed read-only, two decimal places, with a tooltip showing the inputs ("base 0.42 from slot AR 87:1; × 0.85 mesh; × 0.70 flap → 0.25")

2.5 Author `scripts/33_bridgewater_opening_geometry_migration.py`. Set Bridgewater's permanent vents to `type: 'trickle_vent'`, `internal_resistance: ['mesh', 'flap']`, `width_mm: 15`, `height_mm: 1300`. Idempotent. Run it.

2.6 Update `docs/audit/29_permanent_vent_methodology.md`: add a C_d section containing the lookup tables (base C_d by type and aspect ratio; resistance multipliers) and worked examples including the Bridgewater trickle vent case.

2.7 Build clean. Run Bridgewater. Capture the resulting permanent vent loss number and the Σ losses total.

**Verification:**
- `computeCd` returns ~0.25 for Bridgewater's trickle vent (15 × 1300 mm, AR ~87, mesh, flap)
- The hard-coded `0.6` is gone from `instantCalc.js` (grep verifies)
- UI shows derived C_d with provenance tooltip
- Build clean
- The new permanent-vent number is reported with full provenance (mode = single_sided; C_d = 0.25 from geometry + resistance; flow correlation = 0.025 · A · v_wind)
- No comparison to any prior expected value

**Sanity check (not a target):**
The single_sided correlation at Bridgewater with C_d ~0.25 and mean UK wind ~4 m/s should produce a flow rate in the order of 0.05–0.20 m³/s, which integrated across heating-direction hours gives an annual heat loss in roughly the single-digit to low-double-digit MWh range. If the result is wildly outside this (e.g. <0.5 MWh or >50 MWh) the physics is not behaving as expected and we investigate from inputs and formula, not from a target.

**Commit message:**
```
Brief 33 Part 2: Geometry-aware C_d for passive envelope openings

Per-opening C_d derived from type (orifice/slot/louvre/trickle/grille),
aspect ratio (CIBSE Guide A Table 4.20 interpolation), and resistance
features (mesh ×0.85, flap ×0.70, acoustic baffle ×0.60). Replaces the
hard-coded global C_d of 0.6.

Methodology: CIBSE Guide A §4.6 Table 4.20; AIVC Technical Note 32;
BS EN 16798-7.

Bridgewater trickle vents (15 × 1300 mm slot, mesh + flap)
→ C_d ≈ 0.25.

UI: type dropdown, resistance checkboxes, derived C_d displayed
read-only with provenance tooltip.

Closes Brief 29 Issue #3.
```

**STATUS.md update in same commit:** Report Bridgewater's new C_d, new permanent-vent number, new Σ losses total, new heating demand. Report each with its provenance. No comparison to prior expected values.

---

### Part 3 — Lock the Building module scope in CLAUDE.md

**Goal:** Prevent the kind of scope confusion that led to `balanced_mechanical` being added in the first place. Make the Building module's scope unambiguous in the rules that govern future Claude Code sessions.

**Files touched:**
- `CLAUDE.md`

**Steps:**

3.1 In CLAUDE.md, add a new section titled "Module scopes" between the existing "Non-negotiable technical rules" and "Process rules" sections. Initially this section contains only the Building module scope (other modules added when they are reworked):

```markdown
## Module scopes

These statements define what each module computes and what it does not.
They are the canonical scope contract for the module. A brief or feature
that asks for behaviour outside the stated scope is asking for the wrong
module and must be flagged before work begins.

### Building module — State 1 envelope-only

**Computes:**
- Conduction losses through opaque envelope (walls, roof, ground floor)
- Conduction losses through glazing
- Thermal bridging losses (linear and point)
- Solar gains through glazing
- Infiltration heat loss through the q50-rated envelope leakage area
- Permanent vent heat loss through always-open passive openings
  (trickle vents, louvres, fixed grilles, holes in the envelope)
- Heating and cooling demand to maintain a user-defined comfort band

**Does not compute and does not contain:**
- Occupancy, people, occupancy schedules
- Lighting, equipment, plug loads
- HVAC of any kind (no IdealLoads, no VRF, no heat pumps, no boilers,
  no chillers, no fan coils, no terminal units)
- Mechanical ventilation of any kind (no MVHR, no MEV, no extract fans,
  no supply fans, no extract rates, no heat recovery)
- Operable windows or doors (anything with a control schedule or
  temperature-responsive operation)
- DHW
- Controls, thermostats, deadbands, setbacks
- System efficiencies, COPs, SCOPs, MVHR effectiveness, distribution
  losses
- Delivered energy, primary energy, or carbon

**Notes on permanent vents specifically:**
Permanent vents are passive openings in the envelope. They are always
open. They are driven by wind (and stack where vertical separation
exists). They have no schedule. They have no control. They have no
relationship to any mechanical system in the building. If a building
has a bathroom extract fan, that fan is modelled in the Systems module
— not by changing how the trickle vent calculates flow.

**Notes on the comfort band:**
The setpoint used in heating/cooling demand calculation is a
user-defined comfort band, not a system setpoint. It is a constraint
on what the building needs from a hypothetical system, not a property
of an actual system. The Building module asks: "given this envelope,
what demand would a system need to satisfy to hold this comfort band?"
The system itself does not exist in this module.

If a calculation requires any input from the "does not compute and does
not contain" list, that calculation is in the wrong module. Move it or
remove it. Do not import non-envelope concepts into the Building
module's data model, calculations, or UI.
```

3.2 In CLAUDE.md, add to the existing "Process rules" section:

```markdown
10. **Briefs touching a module must state the module's scope at the top.**
    Any brief that modifies a module's data model, engine, or UI must
    include a scope statement (one paragraph) confirming the brief's
    work fits within that module's scope per the "Module scopes"
    section. If a brief asks for work outside the stated scope, stop
    and flag — the brief belongs to a different module or needs to be
    rescoped.
```

3.3 Build clean (CLAUDE.md is not code, but verify no other files were touched accidentally).

**Verification:**
- CLAUDE.md contains the new "Module scopes" section with the Building module scope statement
- CLAUDE.md "Process rules" now includes rule 10
- No code files modified in this commit

**Commit message:**
```
Brief 33 Part 3: Lock Building module scope in CLAUDE.md

Add "Module scopes" section to CLAUDE.md defining what the Building
module computes and what it does not. The Building module is
envelope-only: no systems, no operation, no mechanical anything.
Permanent vents are passive wind-driven openings.

Add Process Rule 10: briefs touching a module must include a scope
statement confirming the work fits the module.

Prevents recurrence of the kind of scope confusion that led to
balanced_mechanical being added to the Building module in Brief 32
Part 2.
```

**STATUS.md update in same commit:** Brief 33 closes here. Building module is bulletproof envelope-only. Next brief (Internal Gains rework) starts from a clean foundation.

---

## Final report (paste in chat after Part 3)

1. New origin/main HEAD SHA
2. Bridgewater permanent vent details:
   - Type, dimensions, internal resistance
   - Base C_d
   - Resistance multipliers applied
   - Final C_d
   - Flow mode
   - Resulting annual permanent vent heat loss (MWh)
3. Bridgewater envelope-only headline numbers post-Brief-33:
   - Total fabric loss (Σ losses)
   - Total solar gain
   - Heating demand to maintain comfort band
   - Cooling demand
4. Confirmation that grep returns no matches for `balanced_mechanical` or `mech_extract` anywhere in code
5. Confirmation that CLAUDE.md "Module scopes" section is in place

---

## What MUST NOT happen in this brief

- No reintroduction of `balanced_mechanical` or any mechanical-system concept into the Building module
- No comparison of the new Bridgewater permanent vent number to any prior expected value
- No calibration of the engine to a target
- No touches to `sql_parser.py`, `epjson_assembler.py`, or the simulation API endpoints (Dynamic remains paused)
- No new architectural systems, contract assertions, or safety machinery beyond the CLAUDE.md scope statement in Part 3
- No new modules

## When to escalate

- If the new permanent vent number is wildly outside the plausibility range stated in Part 2's sanity check (single-digit to low-double-digit MWh) — investigate from inputs and physics, do not adjust to fit
- If the C_d calculator produces a value outside 0.15–0.65 for any canonical opening — pause and report
- If at any point a non-envelope concept appears in the Building module — pause and escalate per CLAUDE.md Rule 14… [no, there is no Rule 14 — the safety is the scope statement in CLAUDE.md "Module scopes" plus Process Rule 10]

## Standing by for authorisation to begin Part 1.
