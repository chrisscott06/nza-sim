# Brief 28f — State 3: Systems (heating, cooling, DHW, mechanical ventilation)

**Status:** Scope captured 2026-05-14 (after Brief 28c ship). Part 1 (contract update v2.4 → v2.5) shipped 2026-05-15 with Chris's approval + four additions: V1 scalar efficiency, dual-function library items, DHW circulation pump as flat field, `energy_use` per-fuel × per-service × per-system output shape. **Part 2 (engine skeleton + byte-identity test) is the next step.**

**Predecessor:** Brief 28c (State 2 loss recompute on its own zone-T trace).
**Successor (queued):** Brief 28e (State 2.5 operable windows + doors).

---

## What State 3 is, in one paragraph

State 3 takes the State 2 zone trace (gains-warmed, free-running) and applies a building's HVAC + DHW + mechanical-ventilation systems to turn free-running demand into delivered energy by fuel. It's the first state where the building's fuel bills become inspectable. State 3 is **building-level**, not zone-level: one set of systems serves the whole building, with optional primary/secondary splits by percentage. It's also library-driven: every efficiency / SFP / HRE number comes from a `system_template` library item, never hardcoded.

---

## In scope

| System | Scope |
|---|---|
| **Heating** | Primary system (required) + optional secondary system, with `primary_pct` / `secondary_pct` split that sums to 100%. Each system has a library-driven seasonal efficiency / SCOP. Heat demand from State 2's heating-demand integral is divided per split and divided by efficiency to give delivered fuel kWh per system. |
| **Cooling** | Same shape as heating: primary + optional secondary with % split, library-driven SEER / SCOP_cool. Cooling demand from State 2's cooling-demand integral is divided per split and divided by COP. |
| **DHW** | Two systems with `system_a_pct` / `system_b_pct` split (no "primary vs secondary" framing — DHW is often dual-fuel by design, e.g. gas + electric immersion). Plus a separate **DHW circulation pump baseload** input (W continuous) that adds a constant 8760-hour electrical load. |
| **Mechanical ventilation** | Multiple independent systems (not just one). Each system has per-system: flow rate (l/s or ACH), SFP (W per l/s), HRE (heat recovery effectiveness, 0..1), schedule (profile ID, reuses existing schedule infrastructure). Sum across systems gives total fan energy + total heating offset from HRE. |

### Validation discipline (per Chris's standing instruction)

- **Hand-calc against spreadsheet** for each system. For Bridgewater: pick worked numbers from the operational data, compute by hand, match within ±2%.
- **Byte-identity across states for shared physics.** State 3 output for solar gains, internal gains, free-running T_op, conduction losses MUST equal State 2 outputs byte-for-byte. Same physics, same numbers.
- **Sensitivity tests pass.** A1 (double length), A2 (rotate 90°) on State 3 → outputs scale + redistribute consistently with State 2.

---

## Out of scope (explicitly NOT in 28f)

| Excluded | Reason / where it lands instead |
|---|---|
| Per-zone systems | Building-level only in 28f. Multi-zone is a much bigger refactor — not now. |
| Distribution losses | Not in scope. Library-driven efficiency is end-to-end (covers distribution implicitly per CIBSE TM54 convention). |
| Pumps beyond DHW circulation | No primary heating pumps, no cooling pumps, no zone valves. The DHW circulation pump is the only auxiliary load explicitly modelled. |
| Air curtain | Lands with **Brief 28e** (State 2.5 doors) — air curtain is door-attached. |
| Renewables (PV, solar thermal, wind) | Not in 28f. Future brief. |

---

## Files most affected (preliminary)

- `frontend/src/utils/instantCalc.js::_calculateState3` (new function, mirrors `_calculateState2` entry pattern)
- `frontend/src/components/modules/systems/` (UI for the three system groups)
- `frontend/src/contexts/ProjectContext.jsx` (systems_config shape)
- Library: existing `system_template` items — verify schema covers all the inputs above. Likely need to add HRE field if not present.
- `nza_engine/assemblers/systems.py` (EP side mirror for cross-validation against EnergyPlus)
- `docs/state_contracts.md` (State 3 contract)

---

## Halt gates

**Halt for review BEFORE starting State 3 build** (per Chris's standing instruction). Confirm scope, validation discipline, and out-of-scope list with Chris before any code work.

**Halt during build** if:
- Library schema doesn't cover an input (e.g. HRE missing) — flag and ask, don't extend library schema unilaterally.
- Hand-calc disagrees with engine by >5% on any system — stop, investigate.
- State 2 byte-identity breaks (e.g. solar gains drift) — stop, regression.

---

## Sketch of the work split (to be confirmed at brief activation)

| Part | Scope | Halt gate |
|---|---|---|
| Part 1 | State 3 contract update (`docs/state_contracts.md`) — output shapes, contract guarantees. | Chris approves contract before code. **DONE 2026-05-15** (v2.5 shipped with Chris's five clarifications + four additions a/b/c/d). |
| Part 2 | Engine: `_calculateState3` skeleton; consumes `_calculateState2` output verbatim, adds an empty system-overlay pass. Byte-identity test passes (no systems = no change). **HALT before any actual energy-use calculation.** | Build clean. State 2 byte-identity holds. Library-strict halt test passes. |
| Part 3 | Heating + cooling primary + secondary with % split. Hand-calc vs spreadsheet on Bridgewater. | ±2% hand-calc match. |
| Part 4 | DHW two-system split + circulation pump baseload. Hand-calc on Bridgewater DHW demand. | ±2% hand-calc match. |
| Part 5 | Mechanical ventilation: per-system flow/SFP/HRE/schedule. Hand-calc on fan energy + HRE offset. | ±2% hand-calc match. |
| Part 6 | UI: three system groups in Systems module. | Browser verification 1440×900. |
| Part 7 | Sensitivity tests (A1, A2) + close-out doc. | A1/A2 pass + Brief 28c-style validation evidence captured. |

(This split is provisional — finalise at brief activation.)

---

## What's next after 28f

- **Brief 28e (State 2.5 operable windows + doors).** Already scoped. Queued after 28f.
- **Brief 28b Parts 2 / 4 / 5** remain DEFERRED — return when use case demands.

---

## File pointers (read these before starting)

- `docs/briefs/active/28c_state_2_loss_recompute.md` — immediate predecessor, validation-evidence template
- `docs/briefs/active/28b_physics_overhaul.md` — Part 3 v3 ship doc, sets validation discipline
- `docs/validation/bridgewater_state1_engine_outputs_2026_05_post_part3_v3.md` — canonical State 1 baseline
- `docs/state_contracts.md` — current state contract
- `frontend/src/utils/instantCalc.js::_calculateState2` — pattern to mirror for State 3 entry
- Existing systems UI / templates — confirm shapes before touching
