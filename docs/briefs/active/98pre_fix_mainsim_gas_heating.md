# Brief 98-pre: Fix Main-Sim Gas Heating — Unblock the EnergyPlus Baseline

**Prerequisite for Brief 98 P0 (paused) and the whole Results-page comparison.**
**Grounding evidence:** `docs/audit/98p0_nza_vs_mainsim.md` (the P0 finding — read it).
**Canonical:** the two Brief 98 design notes (NZA-Sim product page). Bible rule: specifics with citation, or silence.

## The finding (from P0, evidenced)
The main `/api/simulate` EnergyPlus fatals at input processing for any gas-heated building. `nza_engine/generators/hvac_heating_boiler.py` (lines 5, 81, 116) emits **`ZoneHVAC:Baseboard:Convective:Gas`** — an object that **does not exist in the EnergyPlus 25.2.0 schema** (verified against `Energy+.schema.epJSON`; valid siblings are `:Water` and `:Electric` only). Result: 1 Fatal, 1 Severe, terminated in 0.02 s. Every gas-heated project is blocked; the NZA-vs-EP comparison cannot proceed.

## Two independent jobs
1. **Fix the invalid object (unconditional).** Regardless of this building's config, the generator emits an object EnergyPlus rejects. Gas space heating must be modelled with a valid object.
2. **Verify the fixture's heating config (investigate first).** `report_baseline_v1` carries `hvac_type = "gas_boiler_heating"` and `space_heating.primary = "gas_boiler_heating"`. This **contradicts the HIEX plant spec** (Bridgewater heating = Toshiba VRF, electric; gas = DHW only via Andrews calorifiers). So either the config is wrong, or the building genuinely has gas space heating. Determine which from the source before deciding what "correct baseline" even means.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the finding + both jobs.
2. Branch `chris/fix-mainsim-gas-heating` off fresh `main`. Land this brief at `docs/briefs/active/98pre_fix_mainsim_gas_heating.md` as the first commit.
3. Read CLAUDE.md, STATUS.md, the P0 audit, both design notes.
4. **NZA-Sim's instant engine is NOT touched** — this is the EnergyPlus generator only. `--fixture` anchor byte-identical (126.0 on report_baseline_v1 / 132.6 on bridgewater_anchor_v2) at start and close.

## Goal
Make the main `/api/simulate` EnergyPlus produce a clean baseline for `report_baseline_v1`: fix the invalid gas-heating object, and resolve whether the fixture's heating should be gas or VRF. End state: a complete EP run (0 fatal), so Brief 98 P0's residual table can finally be produced.

## Scope
**IN:** determine the correct heating system for the fixture from source · fix `hvac_heating_boiler.py` to emit a valid EP object · if the config is wrong, correct it in a documented, principled way · prove a clean `/api/simulate` run on report_baseline_v1 · report the EP baseline breakdown.
**OUT:** NZA-Sim engine changes · the 0.5 ACH infiltration fix (still measure-first, later) · any Results UI · the residual table itself (that resumes as Brief 98 P0 once this unblocks) · fixing other unrelated generators unless they also fatal.

## Decisions already agreed
1. The invalid object gets fixed properly — no stub, no silent skip. Gas space heating → the physically correct EP model: `ZoneHVAC:Baseboard:Convective:Water` on a hot-water loop fed by `Boiler:HotWater` (fuel = NaturalGas), OR `Coil:Heating:Fuel` on an air loop. Implementer picks the one that fits the existing `nza_engine` plant-loop scaffolding; document the choice.
2. **Config-truth first.** If investigation shows Bridgewater heating is VRF (per HIEX), the fixture's `gas_boiler_heating` is a wrong default — correct the heating config to route through the VRF object that already runs, AND still fix the generator (so gas heating works for buildings that genuinely use it).
3. Characterisation discipline holds: fixing the generator so the sim *runs* is in scope; tuning its *outputs* toward NZA-Sim is not.

## Parts

### P1 — Land brief + establish the correct heating config
1. Land brief; confirm anchors.
2. Investigate: what heating system does Bridgewater actually have? Cross-check `report_baseline_v1` / source project `12cf7cc4` against the HIEX spec (VRF heating, gas DHW). Report: is `gas_boiler_heating` correct plant, or a wrong default?
3. Commit: `Brief 98-pre P1: heating config investigation — gas vs VRF`.
**Falsifiable:** a clear finding in the audit doc — the building's real heating system, cited, with the decision on whether the fixture config needs correcting.

### P2 — Fix the invalid gas-heating object
1. Rewrite `hvac_heating_boiler.py` to emit a valid EP heating object per Decision 1 (hot-water baseboard + `Boiler:HotWater`, or fuel coil). Wire the plant loop correctly (loop, pump, sizing) so EnergyPlus accepts it.
2. If P1 found the fixture config wrong (VRF, not gas): also correct the fixture/config so report_baseline_v1's heating routes through VRF — documented, with the source justification. The generator fix still lands (for genuinely gas-heated buildings).
3. Commit: `Brief 98-pre P2: valid EP gas-heating object [+ fixture heating config corrected]`.
**Falsifiable:** the emitted object type validates against `Energy+.schema.epJSON`; the specific object name is stated in the commit/audit.

### P3 — Prove a clean baseline run + close
1. Run `/api/simulate` on report_baseline_v1. **0 fatal.** Severe warnings listed with dispositions. Confirm EP version 25-2-0.
2. Record the main-EP baseline breakdown (EUI, heating, cooling, DHW, mech-vent, gas, elec, monthly) in the audit doc — this is the EP column Brief 98 P0 was blocked on.
3. `--fixture` anchor byte-identical (NZA-Sim untouched). STATUS, archive brief, current.md, push, PR open — NOT merged.
4. Commit: `Brief 98-pre P3: clean main-EP baseline on report_baseline_v1`.
**Falsifiable:** `.err` fatal count = 0; EP baseline breakdown captured; both anchors byte-identical.

## MUST NOT
Touch NZA-Sim's `instantCalc.js` or its outputs · tune EP outputs toward NZA-Sim · fix the 0.5 ACH default here (still measure-first) · build any Results UI · fake or stub the heating object to "get past" the fatal · correct the fixture config without a cited source justification.

## Escalate (stop-and-write)
The correct heating config can't be determined from source (VRF vs gas ambiguous) → report both readings, don't guess · the boiler plant loop won't validate after 3 attempts → report the `.err` + options · a SECOND unrelated fatal appears once this one clears (document it; it may need its own fix) · fixing the object would require changing NZA-Sim-side data.

## Independent review (mandatory — engine data-flow)
Claude Chat reads on GitHub: the heating-config investigation, the new generated object vs the EP schema, the plant-loop wiring, the clean `.err`, and confirmation NZA-Sim was untouched. The agent that fixed it doesn't grade it.

## Close
Archive · STATUS · current.md · PR open · then Brief 98 P0 resumes — the residual table it was blocked on can now be built against a running EP baseline.
