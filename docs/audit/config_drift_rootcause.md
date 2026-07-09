# Audit: systems_config Drift — Root Cause, Blast Radius, Fix Faithfulness

**Read-only Tier-2 audit. Changes no engine/config/assembler code, runs no migration.**
Branch `chris/audit-config-drift`, cut off `chris/fix-systems-config-drift` (PR #7, intentionally
open) so the derive-on-read fix (`nza_engine/systems_from_v40.py`) is present to audit.

> ## Plain-English summary (quotable)
>
> **What happened.** NZA-Sim describes a building's heating, cooling, ventilation and hot-water
> systems in a rich config called `systems_config_v40` — the one the app's editor writes and the
> instant engine reads. When we introduced that richer model (19 May 2026, "Brief 40"), the
> EnergyPlus "Run simulation" path was not moved across with it: it kept reading an **older, simpler
> copy of the systems** that the editor had stopped updating. So EnergyPlus could simulate the
> building's *previous* systems while the app showed the *current* ones.
>
> **Since when, and who's affected.** The gap existed for **~7 weeks** (19 May → 9 Jul 2026), until
> we fixed it (Brief 98-pre-b). Of the four projects in the database, **two had drifted** — most
> importantly **Bridgewater Hotel**, whose EnergyPlus copy said *gas heating + extract-only
> ventilation* while the truth is *VRF heat pumps + heat-recovery ventilation*.
>
> **Did it produce a wrong answer for a client? No.** Every full systems-level EnergyPlus run in the
> database predates the richer model (so its inputs were correct at the time), and the only run after
> the change was an envelope-only check that doesn't use the systems config at all. **The risk was
> real but never realised** — no stale EnergyPlus result was ever put in front of anyone.
>
> **Is it fixed? Yes — fully.** The core problem (EnergyPlus simulating the wrong *type* of heating,
> cooling or ventilation) was fixed by **Brief 98-pre-b**. The audit's four secondary fields were then
> chased through two more steps: an interim note (Brief 98-pre-c) mis-read which engine sourced them
> and briefly withdrew the fix — **that interim note was wrong** and is superseded below. Definitive
> read-only traces (Brief 98-pre-d) proved NZA-Sim's *displayed* engine reads **v40** for both hot water
> and lighting, and that two of the four fields were genuine EnergyPlus-side gaps: EnergyPlus was using
> a stale lighting-control setting (~20% low on lighting) and a default hot-water heat-pump efficiency
> instead of v40's. **Brief 98-pre-d fixed both in the EnergyPlus derive** (no NZA-Sim change); the
> other two were latent/no-effect. EnergyPlus now matches the displayed engine across all four. The
> Bridgewater hot-water configuration is unambiguous — v40 (gas + ASHP) is what the app shows and what
> EnergyPlus now simulates.
>
> _(Full evidence below. The interim 98-pre-c CORRECTION section near the end is retained for the record
> but is itself superseded by the FINAL section — read the FINAL.)_

Three questions:
1. When and why did the two configs diverge?
2. What's the blast radius across projects, and were past EnergyPlus results stale?
3. Is the 98-pre-b derive faithful across ALL fields, not just heating/cooling?

---

## P1 — Divergence history (Question 1)

### The three configs and when each entered
| Config | Introduced | Role |
|---|---|---|
| simple `systems_config` (DB column) | **Brief 04** `443564e` (project CRUD) | original flat systems shape; written by `PUT /{id}/systems`, project create/update/clone |
| `systems_config_v25` (in building_config) | **Brief 28f** `9ebe0ac`; assembler enabled-gate read added **Brief 28-IM** `2967014` | per-service `enabled` gates the EP assembler reads (`epjson_assembler.py:1418-1421`) |
| `systems_config_v40` (in building_config) | **Brief 40** `94d7288`/`18d52b7`/`e0dd1af` (2026-05-19) | rich per-service arrays; **the UI's write target and NZA-Sim's read source** from Brief 40 on |

### What Brief 40 did (2026-05-19) — the divergence origin
Brief 40 was a **deliberate** systems-model migration:
- `94d7288` Part 2 — new Systems **engine** (proportional split, setpoints, DHW tap-mix) reading v40.
- `18d52b7` Part 3 — Systems module **UI rebuilt** to edit v40 (`params.systems_config_v40.{service}[i]`).
- `e0dd1af` Part 5b — **wired v40 through to the engine + Live Results** (the NZA-Sim instant path).
- A one-time loader migration populated v40 from the prior config (refined later by Brief 42 `b852ffe`).

From Brief 40 on, **the Systems UI writes only v40.** The simple `systems_config` column and the
v25 gates are no longer the per-system editor's write target.

### The orphan — the EP `/api/simulate` path was never migrated
`api/routers/projects.py` (which contains `simulate_project`, the `/api/simulate` EnergyPlus path)
**never referenced `systems_config_v40` anywhere in its entire git history** until Brief 98-pre-b:

```
$ git log --oneline -S 'systems_config_v40' -- api/routers/projects.py
c83dc94  Brief 98-pre-b P2: /api/simulate reads from systems_config_v40 (single source)
```

`simulate_project` kept reading `project["systems_config"]` — the simple column the UI stopped
maintaining at Brief 40. It was the **sole physics consumer** of that column (the only other reads
are `_row_to_project` deserialisation at `:103` and the `PUT /systems` merge at `:482`).

### Deliberate migration, or accident? → **Accidental orphan, not a deliberate fallback.**
Evidence it was overlooked rather than intentionally kept:
- **No v40→simple sync exists anywhere** in the codebase's history — backend or frontend. The only
  v40→simple translation is the 98-pre-b derive itself. So nothing ever kept the simple column
  current after Brief 40.
- **No code or comment** marks the simple column as a deliberate EP fallback. The Brief 40 work
  migrated the *instant engine + Live Results* to v40 and simply did not touch the separate EP
  `/api/simulate` read path.
- v25 gates are the same story: still written by the roadmap/intervention engine
  (`roadmapEngine.js`) but **not** by the per-system Systems editor — so the assembler's enabled
  gates could also lag v40.

The migration of the instant engine was intentional; the EP path was left behind because Brief 40's
scope was the instant/Live-Results engine, and the EnergyPlus wrapper was a separate, un-migrated
consumer nobody re-pointed.

### How long was `/api/simulate` exposed to stale systems?
**~51 days (7 weeks):** Brief 40 (2026-05-19) → Brief 98-pre-b (2026-07-09). The *window of
possibility* opened at Brief 40; a given project actually went stale the moment its v40 was edited
without the simple column being re-written. Freshly-created projects never v40-edited could still
match. **P2 quantifies which projects actually drifted.**

**P1 verdict:** the drift originated at Brief 40 (2026-05-19) as an accidental orphaning of the
EnergyPlus `/api/simulate` read path when the systems model deliberately migrated to `v40` for the
instant engine and UI. `/api/simulate` read the un-maintained simple `systems_config` column (and
v25 gates) for ~7 weeks until Brief 98-pre-b re-pointed it at v40 via derive-on-read.

---

## P2 — Blast radius (Question 2)

Read-only comparison (`scripts/_audit_config_drift_blast.py` → `config_drift_blast.json`): for every
project, the dispatch the **stored** simple config would produce (what `/api/simulate` emitted
*before* 98-pre-b) vs the dispatch **`derive_systems_for_sim(v40)`** produces (what it emits now).
DB opened read-only (`data/nza_sim.db`, `mode=ro`).

### Per-project drift (4 projects)
| Project | has v40? | Drifted? | Differing services (stored → v40) |
|---|---|---|---|
| **Bridgewater Hotel** `12cf7cc4` | yes | **DRIFTED** | heating **gas → VRF** · ventilation **MEV → MVHR** |
| **ZZ TEST — do not use** `zztest00` | yes | **DRIFTED** | ventilation **MEV → MVHR** (heating/cooling/DHW match) |
| Bridgewater — Enhanced Fabric `5092bba3` | no | no | no v40 → derive falls back to stored, no drift possible |
| New Project `c17af731` | no | no | no v40 → derive falls back to stored, no drift possible |

**2 of 4 drifted — both projects that carry a v40.** The real client project (Bridgewater Hotel)
was wrong on **two** services: the simple config said **gas heating + MEV**, while v40 (what
NZA-Sim displays) is **VRF heating + MVHR**. A full-systems `/api/simulate` run on it from the
stored config would have modelled a materially different building. (The two v40-less projects can't
drift; note they also can't be read by NZA-Sim's v40 path — a separate, pre-existing matter, not
this drift.)

### Were any EP results actually produced against a stale building? → **No — the exposure was latent, not realised.**
`simulation_runs` in `nza_sim.db`, **61 runs total**, read-only:
- **60 runs are 2026-04-02 → pre-05-19 — they predate v40** (Brief 40 = 2026-05-19). At that time
  the simple config *was* the canonical source, so they were not stale-vs-v40. (Includes the
  2026-04-03 Bridgewater runs the 98-pre audit named — EUI 75.4/73.7/83.5, full mode, pre-v40:
  they correctly used the then-canonical simple config; not a drift artefact.)
- **Exactly 1 run after Brief 40**: Bridgewater, **2026-06-25 12:25:22** (run `2e9d639f`) — but its
  `simulation_mode = envelope-only`. Envelope-only (State 1) **forces ideal loads and bypasses the
  systems dispatch entirely** (`epjson_assembler.py:1405` `hvac_mode = "ideal_loads" if (state1 or
  state2)`), so it never read the drifted systems config (its snapshot carries no systems dispatch;
  heating/cooling = 0, a free-run envelope check).

So although Bridgewater's stored config was materially wrong from 2026-05-19 on, **no full-systems
EnergyPlus result was ever generated from a drifted config** between Brief 40 and Brief 98-pre-b.
The "Run EnergyPlus" button would have produced a stale gas+MEV Bridgewater — but no such run was
executed on a drifted project in that window. **No client-facing stale EP result exists in the DB.**

**P2 verdict:** blast radius = 2 of 4 projects drifted (Bridgewater Hotel materially, on heating +
ventilation; ZZ TEST on ventilation). Realised impact = **zero** — every full-systems EP run
predates v40, and the only post-migration run was envelope-only (systems-independent). The risk was
real and latent; it was never cashed into a wrong client number.

---

## P3 — Fix faithfulness across ALL fields (Question 3)

Every field the assembler reads from the simple config (`sc.get(...)` + nested `sc["systems"].*`),
classified under the current 98-pre-b derive: **(a)** correctly derived from v40, **(b)** correctly
preserved from the existing config (not a v40 concept), or **(c)** AT RISK — preserved-from-stored
where it should track v40, so it can carry a stale value. Verified against Bridgewater's real DB
config (v40 vs stored vs derived).

| # | Field (assembler line) | Class | Evidence / note |
|---|---|---|---|
| 1 | `systems.space_heating.primary` (1429) | **a** | derived: source→gas/VRF, metric→eff |
| 2 | `systems.space_cooling.primary` (1434) | **a** | derived: enabled→VRF, else none_cooling |
| 3 | `systems.ventilation.primary` (1510) | **a** | derived: recovery%>0→MVHR eff, else MEV |
| 4 | `systems.dhw.primary` (1530) | **a** | derived: gas_boiler_dhw + eff from v40 |
| 5 | v25 heating/cooling/dhw `enabled` (1418) | **a** | derived: any-enabled-in-v40-service |
| 6 | `dhw_preheat` / `systems.dhw.secondary` (1533/1531) | **a→c** | derived ADDS `ashp_dhw` when v40 has a heat-pump DHW entry (Bridgewater: none→ashp_dhw ✓). **(c) asymmetry:** it does NOT clear a stale `ashp_dhw` when v40 has no heat-pump DHW — latent (no project triggers it now) |
| 7 | `lighting_power_density` (1242) | **b** | Internal-Gains concept, not v40 → preserved (correct; the LPD-collapse bug fixed in 98-pre-b) |
| 8 | `equipment_power_density` (1243) | **b** | Internal-Gains concept → preserved (correct) |
| 9 | `mode` (1405) | **b** | preserved-or-`detailed`; main sim runs detailed |
| 10 | `dhw_preheat_setpoint` (1555) | **b** | ASHP preheat target; no direct v40 field; preserved (low risk) |
| 11 | flat `hvac_type`/`cop_heating`/`cop_cooling`/`ventilation_type`/`mvhr_efficiency`/`dhw_primary`/`dhw_efficiency` (1430-1535) | **b\*** | pure fallbacks — never read because the nested `systems.*` path (set from v40) takes precedence. Stale values remain but are **unreachable**. Hygiene note, not a live defect |
| 12 | **`lighting_control` (1254)** | **🔴 c** | v40 `lighting.control_mechanism = "constant"` (→ factor 1.0); derive **preserves stored `occupancy_sensing` (→ factor 0.80)**. Sim scales LPD ×0.80 → **~20 % lighting under-count vs v40's intent.** Not derived from v40 |
| 13 | **`ashp_cop_dhw` (1538)** | **🔴 c** | v40 heat-pump DHW `efficiency_metric = 3`; derive sets `secondary={system:ashp_dhw}` with **no COP** → assembler default **2.8**. ~7 % COP error on the 48 %-share ASHP DHW |
| 14 | **`dhw_setpoint` (1554)** | **🟠 c** | v40 service-level `dhw_storage_setpoint_c = 60` (Brief 42); derive **preserves stored 60** — matches today (magnitude 0) but latent: edit v40's setpoint and the sim keeps the stored value |
| 15 | `ventilation_control` (1266) | **🟠 c (minor)** | v40 `ventilation.control_mechanism = "scheduled"` (always_on) ≈ stored `continuous`; functionally equal today, but not mapped from v40 |

**Also (assembler limitation, not a derive defect):** v40 DHW is a **52 % gas / 48 % ASHP split**;
the simple assembler has no proportional DHW model, so the derive represents it as gas-primary +
series ASHP-preheat. Documented in the derive; correcting it is "changing what the systems are"
(out of 98-pre-b scope) — noted for completeness.

### P3 verdict — the derive is faithful on the PRIMARY dispatch, NOT on four secondary fields
- **Faithful (a):** heating/cooling/ventilation/DHW **system type**, per-service **enabled gates**,
  space-heating/cooling/vent/DHW-primary **efficiencies**, ASHP-preheat **presence**. These are the
  fields that caused the original drift — all now track v40.
- **Correctly preserved (b):** LPD, EPD, mode, preheat setpoint (not v40 concepts).
- **AT RISK (c) — four findings, two with real magnitude today:**
  - **C1 `lighting_control`** — ~20 % lighting error (v40 `constant` vs derive `occupancy_sensing`). 🔴
  - **C2 `ashp_cop_dhw`** — ~7 % ASHP-DHW COP error (v40 3 vs derive default 2.8). 🔴
  - **C3 `dhw_setpoint`** (+ tap/cold service-level setpoints) — latent; matches today, will drift on v40 edit. 🟠
  - **C4 stale `dhw_preheat` not cleared** when v40 has no heat-pump DHW — latent. 🟠

These are the **same class as the LPD bug 98-pre-b caught mid-build** (a field not correctly synced
from v40), but in secondary DHW/control fields rather than the primary dispatch. **They gate calling
the drift "fully closed."** Each is fixable in the derive (map v40 `control_mechanism` → lighting/vent
control; map the heat-pump DHW `efficiency_metric` → ASHP COP; map v40 service-level DHW setpoints;
clear a stale preheat when v40 lacks one) — **a follow-up fix brief**, per this audit's stop-and-write
rule (no fixes here).

---

## Verdict

**The systems-config drift is NOT yet fully closed by Brief 98-pre-b.**

- **Root cause (Q1):** an accidental orphan — Brief 40 (2026-05-19) deliberately migrated the systems model to `v40` for the instant engine + UI, but left the EnergyPlus `/api/simulate` read path reading the un-maintained simple `systems_config` column. ~7 weeks of exposure.
- **Blast radius (Q2):** 2 of 4 projects drifted (Bridgewater Hotel materially: heating + ventilation). **No realised stale EP result** — all full-systems runs predate v40; the only later run was envelope-only.
- **Fix faithfulness (Q3):** the **primary dispatch is faithful** (system types, enabled gates, space efficiencies — the fields that caused the drift now track v40). But **four secondary fields remain preserved-from-stored instead of derived-from-v40** — `lighting_control` (~20 % lighting), `ashp_cop_dhw` (~7 % ASHP-DHW), the v40 service-level DHW setpoints (latent), and stale-preheat clearing (latent).

**Recommendation:** before any EnergyPlus number goes into a client-facing report, land a short **follow-up fix brief** that extends `derive_systems_for_sim` to derive those four fields from v40 (map v40 `control_mechanism` → lighting/ventilation control; map the heat-pump DHW `efficiency_metric` → ASHP COP; map v40 service-level DHW setpoints; clear a stale `dhw_preheat` when v40 has no heat-pump DHW). None require assembler or NZA-Sim changes. After that, the read path is provably faithful across **all** fields, and Brief 98 P0's residual table can be trusted.

**98-pre-b remains correct and mergeable as-is** — it closes the dangerous part (wrong system *type*) and is strictly better than the drift it replaced. The four (c) findings are refinements, not regressions.

---

## ⛔ SUPERSEDED — the CORRECTION below (Brief 98-pre-c) is itself WRONG; read the FINAL section

The 98-pre-c CORRECTION section that follows traced the wrong function — the **legacy
`calculateInstantDegreeDay`** (`instantCalc.js:5971+`, the `6050`/`6138` lines it cites) — which does
**not** produce the displayed numbers or the anchors. The **displayed** engine is `_calculateState3`
(`instantCalc.js:4941`), and it reads **v40** for both DHW and lighting. So this CORRECTION's premise
("the instant engine reads the simple config", "deriving from v40 would move the drift", "DHW is
gas-only") is false. It is retained below only for the record. **The definitive resolution is the
FINAL section at the very bottom.**

## ⚠️ CORRECTION (Brief 98-pre-c, 2026-07-09) — the Q3 recommendation above was WRONG

The recommendation to derive the four secondary fields from v40 was investigated for Brief 98-pre-c and **retracted**. It rests on a false premise: that v40 is the reference these fields must match. It is not — **NZA-Sim's *instant engine* (the engine behind the 132.6/126.0 anchors and the displayed Results) does not read v40 for these fields; it reads the flat/simple config.** Deriving them from v40 would make EnergyPlus **disagree** with NZA-Sim's instant engine, i.e. *move* the drift, not close it. Full evidence: [`98prec_escalation.md`](98prec_escalation.md).

- **`lighting_control`** — instantCalc reads `systems.lighting_control` (`instantCalc.js:6050`) from the **simple field** `raw.lighting_control` (`ProjectContext.jsx:789`); no v40→lighting_control mapping exists in NZA-Sim. The EP assembler is *explicitly kept in sync* with instantCalc's factor (`instantCalc.js:86`), so 98-pre-b's preserved `occupancy_sensing` (0.80) **already matches** the instant engine. Deriving v40's `constant` (1.0) would open a **20 % EP-vs-anchor gap**. C1 measured derive-vs-v40; the correct reference is the instant engine.
- **DHW (`ashp_cop_dhw`)** — instantCalc reads DHW from `systems.dhw` + flat `dhw_preheat` (`instantCalc.js:6138-6143`); Bridgewater's simple config has `dhw.secondary = null` / `dhw_preheat = "none"`, so **the instant engine models DHW as gas-only** and never reads v40's ASHP COP 3. Raising the EP ASHP COP to 3 would *widen* the EP-vs-anchor gap. (98-pre-b already adds an ASHP preheat secondary the instant engine lacks — a pre-existing DHW-reference question, see below.)
- **DHW setpoints / stale-preheat** — latent; no live effect today.

**Corrected verdict:** the *dangerous* drift (wrong system **type** — gas vs VRF, none vs VRF, MEV vs MVHR) is **fully closed** by 98-pre-b, and the EP derive **already matches NZA-Sim's instant engine** on the four secondary fields (by preserving them from the simple config, which is what the instant engine reads). The residual "(c)" items are **not an EP-derive defect** — they are an **upstream NZA-Sim inconsistency**: the instant engine reads the simple flat fields for lighting/DHW while a separate systems-electricity path reads v40. Reconciling that is an `instantCalc.js` change (a deliberate physics change that would move the anchors), not a config-derive fix. **Brief 98-pre-c is therefore closed as this documentation correction — no derive change.** 98-pre-b is the correct closure; the drift is genuinely closed for the purpose that matters (EP matches the displayed engine).

**Open question for Chris (not Code's to answer) — flagged before Brief 98 P0 / the report:** which config is the intended source of truth for **Bridgewater's DHW** — the simple fields (gas-only) or v40 (52 % gas / 48 % ASHP at COP 3)? NZA-Sim currently holds *both* (instant engine = gas-only; systems-electricity path = v40 split). The report's DHW baseline depends on the answer. This is a "what is the building" decision, not a plumbing bug.

**98-pre-b remains correct and mergeable as-is** — it closes the dangerous part (wrong system *type*) and is strictly better than the drift it replaced.

---

## ✅ FINAL (Brief 98-pre-d, 2026-07-09) — definitive traces + both real gaps fixed

Supersedes the 98-pre-c CORRECTION above. Definitive **read-only** traces of the **displayed** engine
`_calculateState3` (`instantCalc.js:4941`) on the **live Bridgewater** project settle it:

- **DHW — displayed reads v40.** `_calculateState3` → `computeSystemsDelivered(v40)` → `dhw =
  dhw_v40_block ?? dhw_v25` (`instantCalc.js:5176`). Live displayed `consumption.dhw` = **electricity
  42.2 MWh + gas 157.4 MWh** (heat-pump 60% of demand share) — the ASHP **is** present, not gas-only.
- **Lighting — displayed reads v40.** `_calculateState3` scales lighting by
  `effectiveSystemScalar(building.systems_config_v40.lighting)` (`instantCalc.js:2418`, uses v40
  `control_factor`). Live v40 lighting `control_factor 1.0` → displayed **44.46 MWh** (full LPD).

Against that reference, two of the four fields were **genuine EnergyPlus-derive gaps** (the audit's
original C1/C2 were right; 98-pre-c wrongly retracted them). **Brief 98-pre-d fixed both in
`derive_systems_for_sim` — EP-derive only, no `instantCalc.js`/assembler change, anchors 132.6/126.0
byte-identical:**

| Field | Was (98-pre-b) | Displayed (v40) | 98-pre-d fix | Proof |
|---|---|---|---|---|
| **C1 `lighting_control`** | preserved stale `occupancy_sensing` → factor **0.80** (~20% low) | v40 `constant` → **1.0** | map v40 `control_mechanism` → `lighting_control` | emitted `Lights.watts_per_floor_area` = LPD×1.0 (not ×0.80); EP 0 fatal |
| **C2 ASHP DHW COP** | default **2.8** | v40 **3.0** | derive `secondary.efficiency_override` from v40 heat-pump DHW `efficiency_metric` | emitted `DHW_ASHP_Preheat.heater_thermal_efficiency` = 3.0 |
| C3 DHW setpoints | preserved (=60) | v40 =60 | latent — matches; no change needed | — |
| C4 stale `dhw_preheat` | symmetric add/clear | — | latent — no project triggers | — |

Tests: `scripts/_brief98pred_p2.py` (6 lighting mappings + 3 COPs + symmetry + EP run 0 fatal).
Residual note: v40's `daylight_dimming` `control_factor` is 0.70 while the assembler/instantCalc string
table uses 0.60 — a pre-existing NZA-Sim internal table difference (both string paths use 0.60), not
Bridgewater-relevant (constant), left as-is.

**FINAL verdict:** the config drift is **fully closed**. `/api/simulate` now matches NZA-Sim's displayed
engine across system type (98-pre-b), enabled gates (98-pre-b), lighting control and ASHP DHW COP
(98-pre-d). Bridgewater's DHW is unambiguously v40 (gas + ASHP) in both engines. Brief 98 P0's residual
table can be built on a baseline faithful across every audited field.
