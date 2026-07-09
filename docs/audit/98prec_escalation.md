# Brief 98-pre-c — STOP-and-write escalation (no code changed)

> ## ⛔ SUPERSEDED by Brief 98-pre-d (2026-07-09) — this escalation was WRONG
>
> This escalation traced the **legacy `calculateInstantDegreeDay`** (`instantCalc.js:5971+`, the
> `6050`/`6138` lines below), **not** the displayed engine. The displayed engine is `_calculateState3`
> (`instantCalc.js:4941`), and definitive read-only traces on live Bridgewater (Brief 98-pre-d) proved
> it reads **v40** for both DHW and lighting:
> - DHW: displayed `consumption.dhw` = electricity **42.2 MWh** + gas 157.4 MWh (ASHP present, not gas-only).
> - Lighting: displayed uses `effectiveSystemScalar(v40.lighting)` (`instantCalc.js:2418`) → v40 `control_factor 1.0` → **44.46 MWh**.
>
> So the conclusion below ("preserve-from-simple matches the instant engine; deriving from v40 would
> move the drift") is **false**. The audit's original **C1 (lighting_control) and C2 (ASHP DHW COP)
> were real EP-derive gaps** — EnergyPlus was 20% low on lighting and used COP 2.8 vs v40's 3.0.
> **Brief 98-pre-d fixed both** in `derive_systems_for_sim` (EP-derive only, no NZA-Sim change, anchors
> 132.6/126.0 unchanged). See the FINAL section of [`config_drift_rootcause.md`](config_drift_rootcause.md)
> and `scripts/_brief98pred_p2.py`. The text below is retained for the record only.

**Trigger (per the brief's Escalate clause):** _"A field the audit listed genuinely has no v40
source (report it — preserve-from-existing may be correct, but confirm) · deriving a field would need
… NZA-Sim changes."_ Both fire. **I have not touched `derive_systems_for_sim`, the assembler, or
NZA-Sim.** Anchors 132.6 / 126.0 unchanged (read-only investigation).

## The finding — the audit's premise is inverted for these four fields

Brief 98-pre-c asks me to derive `lighting_control`, `ashp_cop_dhw`, the DHW setpoints, and
`dhw_preheat` **from v40**, on the stated goal *"matching what NZA-Sim reads."* But **NZA-Sim's
instant engine — the engine that produces the 132.6/126.0 anchors and the displayed Results — does
not read v40 for these fields. It reads the flat/simple config.** So deriving them from v40 would
make EnergyPlus disagree with NZA-Sim's instant engine, i.e. **move the drift, not close it.**

### Evidence, field by field

**`lighting_control` — no v40 source in the instant engine.**
- The instant engine scales lighting by `lightingControlFactor(systems.lighting_control)`
  (`instantCalc.js:6050, 6766`).
- `systems.lighting_control` comes from the **flat simple field**: `ProjectContext.jsx:789`
  `lighting_control: raw.lighting_control ?? 'occupancy_sensing'`. **There is no v40 →
  `lighting_control` mapping anywhere in NZA-Sim** (grep: only the ProjectContext default + the
  `raw.` read).
- The EP assembler's `_lighting_control_factors` is **explicitly "kept in sync with" instantCalc's
  `lightingControlFactor`** (`instantCalc.js:86` comment). So the assembler's `lighting_control`
  corresponds to the instant engine's simple-field value — **`occupancy_sensing` (factor 0.80)**, not
  v40's `constant` (factor 1.0).
- **98-pre-b preserves `lighting_control = occupancy_sensing` → EP 0.80 = instant engine 0.80. They
  AGREE today.** Deriving from v40 → `constant` (1.0) would create a **20 % EP-vs-instant-engine
  disagreement** on lighting. The audit's C1 measured derive-vs-**v40**; the correct reference for
  "match NZA-Sim" is the instant engine, which uses 0.80. **C1 was measured against the wrong
  reference.**

**DHW (`ashp_cop_dhw`, `dhw_preheat`) — the instant engine models Bridgewater DHW as gas-only.**
- The instant engine reads `systems.dhw?.primary/secondary` + flat `systems.dhw_preheat`
  (`instantCalc.js:6138-6143`).
- Bridgewater's simple config has `systems.dhw = null` and `dhw_preheat = "none"` → **the instant
  engine models DHW as 100 % gas, no ASHP preheat at all.** (v40 has a 48 %-share `ambient_air` ASHP
  DHW at COP 3, which the instant engine never reads for the thermal/anchor path.)
- **98-pre-b's derive ALREADY adds an `ashp_dhw` secondary** (COP default 2.8) that the instant
  engine does **not** model. So 98-pre-b already introduced a small EP-vs-instant DHW divergence.
  Raising that ASHP COP to v40's 3 (the audit's C2) would **widen** the EP-vs-instant gap, because the
  instant engine has no ASHP DHW to match. C2's "false NZA-vs-EP disagreement" reasoning assumes the
  instant engine uses v40's COP 3 — it does not; it has no ASHP DHW.

**`dhw_setpoint` — no live effect.** The instant engine uses a module constant `DHW_SETPOINT`
(`instantCalc.js:6136`), not a config field; v40 `dhw_storage_setpoint_c = 60` already equals the
fixture's `dhw_setpoint = 60`. Latent either way.

### Root diagnosis
NZA-Sim has an **internal split**: its instant engine (demand/gain + DHW-thermal path → the anchors
and displayed EUI) reads the **flat simple fields** (`lighting_control`, `dhw_preheat`, `dhw_primary`);
v40 is read only by a **separate** systems-electricity path (`effectiveSystemScalar`,
`systemsEngine.js` `control_factor`). So *"match what NZA-Sim reads"* is ambiguous — the two NZA-Sim
paths read different sources for these fields. The EP assembler mirrors the **instant-engine** path
(by its own in-code contract), so to match it, these fields must be **preserved from the simple
config** — which is exactly what 98-pre-b does.

## Why I stopped instead of proceeding
Deriving these from v40 would satisfy the brief's letter (fields = v40) but **violate its goal** (EP
matches NZA-Sim): it would open a 20 % lighting gap and a wider DHW gap **against the anchor**. That
is precisely the "tune/diverge from the reference engine" failure the Bible forbids. Making the
fields coherently v40-sourced end-to-end would require **changing NZA-Sim's instant engine** to read
v40 for lighting/DHW — explicitly out of scope and forbidden by this brief's MUST-NOT.

## Recommendation (for Chris + the architect — no code changed pending decision)
1. **Preferred — accept 98-pre-b as the correct closure and correct the audit.** The audit's C1–C4
   used v40 as the truth reference where NZA-Sim's instant engine actually uses the simple fields. EP
   already matches the instant engine on `lighting_control` (0.80 = 0.80). The residual "drift" in
   these four fields is an **upstream NZA-Sim instant-engine inconsistency** (it reads simple flat
   fields, not v40), **not** an EP-derive drift. Re-scope 98-pre-c to a documentation correction.
2. **Alternative — fix upstream first.** A separate NZA-Sim brief makes the instant engine read v40
   for `lighting_control` + DHW (closing NZA-Sim's own split), **then** derive EP from v40 to match.
   Bigger; touches `instantCalc.js` (forbidden here); also shifts the 132.6/126.0 anchors, so it is a
   deliberate physics change, not a config fix.
3. **Also flag:** 98-pre-b's derive adds an ASHP-DHW preheat the instant engine lacks — worth deciding
   the canonical DHW reference (v40 52/48 split vs instant-engine gas-only) before any further DHW
   derive work. This predates 98-pre-c.

**Bottom line:** 98-pre-c as written should not proceed — it would introduce EP-vs-anchor divergence
on exactly the measures (interventions 1.3/1.4 lighting/DHW) the brief wants to protect. The four
fields need the architect to fix the *reference ambiguity* first. Awaiting decision; derive untouched.
