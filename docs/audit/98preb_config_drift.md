# Brief 98-pre-b — systems_config drift: write/read path map + fix decision

NZA-Sim's `instantCalc.js` is **not** touched. `--fixture` anchors byte-identical
(report_baseline_v1 126.0 / bridgewater_anchor_v2 132.6) at start and close.

## P1 — the three system configs, where each is written, what `/api/simulate` reads

A project carries **three** representations of "what systems this building has".
Only one (`systems_config_v40`) is edited by the current UI; the other two are
stale legacy that `/api/simulate` still reads.

| Config | Where stored | Written by | Read by |
|---|---|---|---|
| **`systems_config_v40`** (rich: per-service arrays w/ source, efficiency_metric, share_pct, enabled) | inside `building_config` JSON | **the Systems UI per-system editor** — `SystemEditorPopout.jsx` / `ServiceSectionHeader.jsx` → `params.systems_config_v40.{service}[i]` → building save | **NZA-Sim instant engine** (`systemsEngine.js`, `instantCalc.js`) |
| **`systems_config`** (simple: flat `hvac_type`/`cop_heating` + nested `systems.{service}.primary.system`) | own DB column `projects.systems_config` | `PUT /api/projects/{id}/systems` (`api/routers/projects.py:481-486`), project create (`:146`), update (`:269,292`), clone (`:387`) — **the current Systems UI never calls `PUT /{id}/systems`** (no frontend reference) | **`/api/simulate`** — `simulate_project` reads `project["systems_config"]` at **`api/routers/projects.py:573`**, passes it to `assemble_epjson(..., systems_config=...)` |
| **`systems_config_v25`** (per-service `enabled` flags) | inside `building_config` JSON | frontend roadmap/intervention engines (`roadmapEngine.js:103-168`); **not** the per-system Systems editor | the assembler's enabled gates — `epjson_assembler.py:1418-1421` `v25 = building_params.get("systems_config_v25")` → `heating_enabled/cooling_enabled/dhw_enabled` |

### What the assembler reads from the simple config (the interface to reproduce)
`epjson_assembler.py:1428-1559`, `hvac_mode == "detailed"` branch:
- **heating** — `systems.space_heating.primary.system` (fallback `hvac_type`) → dispatch is binary: `∈ {gas_boiler_heating, gas_boiler_combi}` → fuel coil, else → `generate_vrf_system`. eff = `efficiency_override` (fallback `cop_heating`).
- **cooling** — `systems.space_cooling.primary.system` (fallback `hvac_type`) → `none_cooling` (or `not cooling_enabled`) → no cooling, else VRF. eer = `cop_cooling`.
- **ventilation** — `systems.ventilation.primary.system` (fallback `ventilation_type`), `efficiency_override` (0-100) → mvhr_eff.
- **dhw** — `systems.dhw.primary.system` (fallback `dhw_primary`), eff, `dhw_setpoint`, ashp_cop, preheat.
- **mode** — `sc.get("mode")` must be `"detailed"` to emit real HVAC at all.
- **enabled gates** — from `systems_config_v25` (the third source), independent of the system keys.

### Where they diverge — the mechanism
The UI edits **v40**. The simple `systems_config` column and `systems_config_v25`
are only touched by legacy/other paths. So on any edited project, v40 moves and
the other two don't. `/api/simulate` reads the frozen simple copy + v25 gates →
**it simulates the systems the building had before editing, silently.** (98-pre
concrete case: v40 = VRF heating + VRF cooling; simple copy said gas heating + no
cooling → invalid-object fatal, and would otherwise have produced a gas-heated EP
baseline diffed against a VRF-heated NZA-Sim.)

## Decision — **derive-on-read** (Brief Decision 2)

At simulate time, `simulate_project` derives the simple `systems_config` **and**
the v25 enabled gates from `building_config.systems_config_v40`, and passes those
to `assemble_epjson` instead of the stored stale copies. v40 is the single source
of truth; the derived shapes are ephemeral (never persisted — truth flows one way).

**Why derive-on-read, not read-v40-directly:**
- The assembler already consumes the simple shape across 5 services and is **tested clean** (98-pre P3: VRF baseline 0 fatal). Reading v40 directly would mean rewriting that entire tested dispatch — high risk, regresses the proven path, no benefit.
- The simple shape is a small, well-defined interface (gas-vs-VRF, none-vs-VRF, mvhr-vs-mev, gas-vs-electric + a handful of efficiencies). A focused v40→simple translator is low-risk.
- **Auto-corrects every stale project** with no data migration: the sim derives fresh from v40 each run, so a stale stored `systems_config`/`v25` is simply never read for the physics. (Brief Decision 3 satisfied without a migration script.)

**The third source (`systems_config_v25`) — mapped, handled here, NOT a separate brief.**
The escalate clause asked whether cooling's third config source is real: it is
(`epjson_assembler.py:1418`). But it does **not** need its own fix — the same
derive-from-v40 mechanism produces consistent enabled gates (`enabled =
any(enabled system in that v40 service)`), injected into the per-sim
`building_params["systems_config_v25"]`. One source (v40), one derive, both the
system types and the enabled gates. No assembler change.

**v40 → simple key mapping (P2 implements):**
- heating source ∈ combustion {gas, natural_gas, lpg, oil, biomass, hydrogen} → `gas_boiler_heating`; else (ambient_air/ground/water/exhaust_air/electricity heat-pump) → `vrf_standard`. eff = primary `efficiency_metric`.
- cooling: any enabled cooling system → `vrf_standard` (eer = metric); else `none_cooling`.
- ventilation: primary `efficiency_metric.recovery_sensible_pct > 0` → `mvhr_standard` (eff = that %); else `mev_standard`.
- dhw: source combustion → `gas_boiler_dhw`; else electric/heat-pump DHW key. eff = metric.
- primary per service = highest-`share_pct` enabled system (simple assembler models one primary per service; proportional split stays NZA-Sim-only — documented simplification, unchanged behaviour).
- `mode` forced `"detailed"` for the main sim.

NZA-Sim untouched; anchors intact.
