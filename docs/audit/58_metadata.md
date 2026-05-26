# Brief 58 A1 — Metadata audit + canonical comfort_band design (read-only)

**Brief:** [`active/58_demand_honesty.md`](../briefs/active/58_demand_honesty.md)
**Date:** 2026-05-26
**Status:** A1 deliverable. HARD STOP for Chris's sign-off on §4 before A2 lands.

This audit walks every consumer of `comfort_band`, GIA / floor area, and `num_rooms` / `num_bedrooms` on the **verification DB** (port 8003, Bridgewater clean 128.20). It then proposes the canonical comfort_band resolution design, locates the EUI denominator (the surface Part A3 retargets), and states the first-principles invariant that `reported_gia == geometry_gia ⇒ 128.20 unchanged`.

Engine-code edits are **not in this part**. A1 is read-only audit + design proposal.

---

## §1 — comfort_band consumer map

### §1.1 Persistence — 4 nominal sources, ONE canonical origin

| # | Source | Bridgewater value | Role |
|---|---|---|---|
| 1 | **`projects.comfort_band_lower_c` / `_upper_c`** (DB columns) | `21.0` / `24.0` | **Canonical persistence.** The Brief 26 state contract. |
| 2 | API response — top-level `{ comfort_band_lower_c, comfort_band_upper_c }` | `21.0` / `24.0` | DB columns serialised by `api/routers/projects.py:807-861`. |
| 3 | `ProjectContext.comfortBand` React state — `{ lower_c, upper_c }` | `{ lower_c: 21, upper_c: 24 }` | Loaded from (2) at `ProjectContext.jsx:956-957`. Initialised to `{ 20, 26 }` at L780. |
| 4 | `building_config.comfort_band` JSON key | **`null` on Bridgewater** | Optional, **NOT canonical**. Most projects don't carry this — it only appears when something writes it back to the JSON (e.g. the e462a21 stopgap composes it onto the building object before calling the engine). |

**Source-of-truth statement:** (1) → (2) → (3). (4) is a side-effect artefact of the engine accepting it as a fallback. Retiring (4) doesn't lose data — DB and context carry the same value.

### §1.2 Frontend consumers (every call site that reads or threads comfort_band)

| Location | What it does | Pattern |
|---|---|---|
| `frontend/src/components/modules/SystemsModule.jsx:142` | Destructures `comfortBand` from context. | Read |
| `SystemsModule.jsx:162` | `const cb = comfortBand ?? { lower_c: 20, upper_c: 26 }` — defensive fallback | **Hand-thread A** |
| `SystemsModule.jsx:164` | `calculateInstant({ ...params, comfort_band: cb }, …)` — mutates building | **Hand-thread A.1** |
| `SystemsModule.jsx:170` | `{ mode: 'full', comfortBand: cb, …, _skipInterventions: true }` — also in options | **Hand-thread A.2** |
| `InterventionsModule.jsx:72` | Destructures `comfortBand` from context. | Read |
| `InterventionsModule.jsx:164` | Same `cb ?? …` defensive fallback | **Hand-thread B (the e462a21 stopgap)** |
| `InterventionsModule.jsx:167` | `calculateInstant({ ...paramsForEngine, comfort_band: cb }, …)` | **Hand-thread B.1** |
| `InterventionsModule.jsx:169` | `{ mode: 'full', comfortBand: cb, engine: 'v2.5' }` | **Hand-thread B.2** |
| `IMResultsModule.jsx:76, 96-103` | Same `cb ?? {20, 26}` defensive fallback + thread BOTH building.comfort_band and options.comfortBand | **Hand-thread C** |
| `gains/canvas/useStateComparison.js:51, 69-85` | Same `cb ?? {20, 26}` + thread BOTH | **Hand-thread D** |
| `BuildingDefinition.jsx:607-747` | Threads to children for the Building right-column editor. | Read (UI) |
| `buildingSections.jsx:873-903` | Comfort-band number inputs (lower/upper) — `mutate('comfort_band.lower_c', …)` | **Edit surface** |
| `LoadShapeView.jsx:116, 242-243` | Reads from context for chart band overlay | Read |
| `PatchedProjectContextProvider.jsx:85-101` | Intervention preview overlay: applies `comfort_band.{lower,upper}` patches on top of context value | Read + patch-overlay |
| `interventions/EditorNav.jsx:124, 128` | Routes patches with `comfort_band` path prefix to the `building` section nav | Patch routing only |

**Pattern audit:** 4 distinct call sites (Systems, Interventions, IMResults, useStateComparison) each:
1. Defensive `cb ?? { lower_c: 20, upper_c: 26 }` (introduces an undocumented {20, 26} fallback chain).
2. Threads it TWICE — once as `building.comfort_band` (mutating the building) AND once as `options.comfortBand`.

This 2-channel threading is the surface the e462a21 stopgap codified. **It's the bug, not the fix.**

### §1.3 Engine consumers (instantCalc.js + systemsEngine.js)

| Location | Reads from | Notes |
|---|---|---|
| `instantCalc.js:5666, 5679, 5711` | `options.comfortBand ?? building.comfort_band ?? { lower_c: 20, upper_c: 26 }` | **The two-channel + hardcoded-fallback chain.** Three call sites inside `calculateInstant`. |
| `instantCalc.js:772, 2292, 4211` | Internal helpers `_calculateEnvelopeOnly` / `_calculateState2` / `_calculateState3` all take `comfortBand` as a positional parameter. | After dispatch, the engine threads the resolved object. |
| `instantCalc.js:786-793, 988, 1122, 1491-92, 1688, 1702, 1729, 1889, 2308-11, 2429, 2655, 2849, 3052-3, 3258, 3471, 3601` | Read `comfortBand.lower_c` / `.upper_c` directly. | Setpoint anchoring (heating = lower, cooling = upper); under/over-heat hour counters; reconciliation output (`comfort_band_used`). |
| `systemsEngine.js:105-111` | `_resolveSetpoint(serviceLevel, service, comfortBand)` — defaults to `comfortBand.lower_c ?? 21` for heating, `.upper_c ?? 24` for cooling when service-level setpoint mode is `follow_comfort`. | The setpoint resolver. |
| `systemsEngine.js:185, 250-251, 685, 700, 737-738` | `_computeHeatingOrCooling` reads `comfortBand?.lower_c / .upper_c` for the comfort vs setpoint diagnostic. | Brief 42 service-level setpoint pattern. |

**Engine reads it from exactly TWO entry points:**
- `options.comfortBand` (preferred)
- `building.comfort_band` (fallback, used by the stopgap)
- `{20, 26}` (hardcoded ultimate fallback — the silent-failure mode that motivated the stopgap)

### §1.4 Edit surfaces (where the user changes comfort_band)

| Location | UI | Writes to |
|---|---|---|
| `buildingSections.jsx:885-905` (`ComfortBandFields`) | Two number inputs (Heating threshold, Cooling threshold) in the Building module's right column | `mutate('comfort_band.lower_c', …)` / `mutate('comfort_band.upper_c', …)` → `ProjectContext.setComfortBand` → `PATCH /api/projects/{id}` body `comfort_band_lower_c` / `_upper_c` (api/routers/projects.py:64-65, 277-294) |

There's **only one edit surface** and it goes directly through ProjectContext → API → DB columns. Good.

---

## §2 — GIA / floor area consumer map

### §2.1 What exists today

| Where | Variable | Source |
|---|---|---|
| `instantCalc.js:286-287, 1672, 3588, 4474, 5485, 5602, 6274` | `gia = length × width × num_floors` then surfaced as `result.metadata.gia_m2` and `result.heat_balance.metadata.gia_m2` | **Derived from geometry** every time the engine runs. No persisted `gia` field. |
| `instantCalc.js:286-656` (State 1 internals) and L2030, L2048 (gain-density helpers) | Same derived `gia` used for: per-m² densities (lighting, equipment, people), surface-area calculations, **AND** for the EUI denominator. | Currently **conflated**: one `gia` value drives both physics AND presentation. |

**There is no `reported_gia` field today.** This is the new input A3 introduces.

### §2.2 Frontend consumers (all read `gia_m2` from engine result)

These all read GIA from `result.metadata.gia_m2` (or `result.heat_balance.metadata.gia_m2`), so they don't care about the source. After A3 they'll all naturally pick up `reported_gia` if it routes through the same field — depending on the design choice (see §5).

- `building/BuildingDefinition.jsx:296, 339-340, 365, 399-400, 459, 506`
- `building/GainsLossesChart.jsx:133`
- `building/LiveResultsPanel.jsx:314` — displays GIA to the user
- `balance/HeatBalance.jsx:153, 340, 649`
- `gains/canvas/HeatBalanceView.jsx:70`
- `gains/canvas/MonthlyView.jsx:92-93`
- `gains/canvas/SummaryView.jsx:241, 303`
- `gains/EquipmentSection.jsx:84, 107`
- `gains/InternalGainsModule.jsx:575`
- `gains/LightingSection.jsx:79, 110`
- `gains/OccupancySection.jsx:127, 149`
- `gains/useAnnualGains.js:16, 39, 138`
- `consumption/ManualConsumptionInput.jsx:192`
- The Interventions unit-toggle helper (`visualiser/unitFmt.js`) reads it via `getGia(result)`.

### §2.3 The EUI denominator — exact location

The EUI `kwh_per_m2` is computed inside the engine. Let me pin the line for the A3 retarget:

- `instantCalc.js:5485` — `gia_m2: Math.round(gia)` (State 2 result `result.metadata`)
- `instantCalc.js:4449` — `const gia = state2Result.heat_balance?.metadata?.gia_m2 ?? state2Result.metadata?.gia_m2 ?? 0` — State 3 consumes State 2's gia for its own EUI computation
- The actual EUI = (total fuel kWh) / gia is computed at:
  - `instantCalc.js` around L5485 (State 2 `consumption.total.kwh_per_m2_yr`)
  - `instantCalc.js` around L4449+ (State 3 same)
  - State 3 also includes `consumption.total.kwh_per_m2_yr` and the equivalent shape for State 1.

**A3's retarget surface:** the single division site where `kwh_total / gia` is computed. Once that division reads `reported_gia` instead of the geometry-derived `gia`, the EUI denominator flips. All gain-density helpers (`per_m2` mode at L2030, L2048) and surface-area maths continue to use the geometry `gia`. **Two distinct names, two distinct values, never fused.**

---

## §3 — num_rooms / num_bedrooms consumer map

### §3.1 The naming gap

The brief uses `num_rooms`; the codebase uses **`num_bedrooms`**. They mean the same thing physically (count of rooms), but the field is named for hotel-bedroom context. Bridgewater carries `num_bedrooms: 134`.

**Design call for A4:** either rename `num_bedrooms` → `num_rooms` (touches many files; a Rule-14-class field rename), OR keep `num_bedrooms` as the persisted name and surface it as "Number of rooms" in the metadata page UI. Recommend the latter — minimises blast radius and the underlying field rename is out-of-scope housekeeping.

### §3.2 Current consumers (all read `params.num_bedrooms` from ProjectContext)

| Location | Role |
|---|---|
| `instantCalc.js:530, 2030, 2034, 2048, 5064, 5066, 5756, 5758` | Engine: scales `per_room` occupancy density, computes `avg_occupants = num_bedrooms × occupancy_rate × people_per_room` |
| `gains/OccupancySection.jsx:126, 130, 185` | Internal Gains UI: shows derived occupant count |
| `gains/useAnnualGains.js:143, 147` | Cache key for gains recompute |
| `ProjectContext.jsx:206, 850` | Default value (134) + load-from-DB pipe |
| `InformationModule.jsx:167` | Read-only summary card on the home/info page |
| `results/EnergyCarbonTab.jsx:311-313` | Banner when num_bedrooms > 50 with occupancy_rate = 1 |
| `pages/ProjectDashboard.jsx:237, 424` | Project dashboard summary string |
| `stateMode.js:55, 115` | Allowed-fields list for state-mode validation |

### §3.3 Where it lives today
`params.num_bedrooms` on the ProjectContext params object, loaded from `building_config.num_bedrooms` in the DB. Edited via the Information module (read-only summary in the current UI; the editable surface is the standard `mutate('num_bedrooms', …)` Building input).

### §3.4 A4 plan
Move the **editable surface** to the new metadata page. Keep the storage path (`params.num_bedrooms`) unchanged so all engine consumers continue working untouched. Label it "Number of rooms" in the metadata-page UI; keep the schema field name as `num_bedrooms` to avoid an out-of-scope rename. **All current consumers continue reading `params.num_bedrooms`; only the editing UI moves.**

---

## §4 — Canonical comfort_band resolution design (Chris signs off here)

### §4.1 Goals (from Brief 58 Principle 2)
1. **Resolve ONCE.** Comfort_band derived from the DB exactly once per project, exposed as a guaranteed-defined value.
2. **Read EVERYWHERE.** Every consumer reads from the same single source.
3. **Thread NOWHERE.** No call site repeats the value into the engine. `grep` for a fallback `comfort_band` chain across `frontend/src/components/modules/` should return empty after A2.
4. **Retire the e462a21 stopgap, do not extend it.** No fallback survives.

### §4.2 Three candidate designs

**Option A — Engine treats `options.comfortBand` as required.**
- ProjectContext stays the canonical runtime source.
- Every caller passes `options: { comfortBand }` exactly once (no defensive `?? {…}`, no building-mutation).
- Engine throws (loudly) if `options.comfortBand` is missing — the `{20, 26}` fallback is **deleted**.
- Engine no longer reads `building.comfort_band` — the L5666/L5679/L5711 chain becomes just `options.comfortBand` (and the engine validates on entry).
- **Lightest change.** Keeps explicit threading; just makes it singular + non-defensive.
- Grep check: counting per-call-site `comfortBand: comfortBand` lines stays > 0 (four call sites still pass it). That satisfies the brief's "thread nowhere" principle in spirit only — they're not _hand-threading_ a value out of multiple potential sources, they're forwarding the canonical one. **The brief's grep gate is for the `?? {…}` defensive pattern AND the `comfort_band: cb` building-mutation — those go to zero.**

**Option B — Wrapper hook (`useCalculateInstant`).**
- A new `useCalculateInstant()` hook returns a function that auto-injects `comfortBand` from ProjectContext.
- Callers replace `calculateInstant(...)` with `calc(...)`. The `comfortBand` lookup is INSIDE the hook.
- Engine still accepts `options.comfortBand` (so non-React callers — probe scripts, tests — work unchanged).
- Grep across React call sites: ZERO mentions of `comfortBand` in any module-level engine call.
- **More invasive** — touches every `useMemo([…, comfortBand])` dependency list, the hook needs care with stable identity so memo dependencies don't churn.

**Option C — Engine reads ProjectContext via prop drilling (NOT viable).**
- Engine is plain JS in `frontend/src/utils/instantCalc.js` and is also imported by Node probe scripts. It cannot use React hooks. Rejected.

### §4.3 Recommendation: **Option A**

**Why A over B:**
- A is mechanical and falsifiable: four call sites, identical refactor pattern, no new architectural piece.
- The brief's grep gate (`no call site hand-threads comfort_band`) is best interpreted as: no defensive fallback chain, no double-channel threading, no `{20, 26}` hardcode. Option A satisfies all three. The remaining `comfortBand: comfortBand` lines are forwards-not-resolutions and grep-distinguishable.
- The engine continues to work with probe scripts unchanged — they already pass `comfortBand` via options.
- B can land later if the residual `comfortBand: comfortBand` lines bother us in practice. Starting with A avoids the hook-identity tax.

**If Chris prefers B:** I'll plan A2 around a `useCalculateInstant` hook. Either way the engine-side changes are the same (delete the `?? building.comfort_band` and `?? { lower_c: 20, upper_c: 26 }` fallbacks, throw on missing). The difference is whether the React wrapping is a hook or just `options: { comfortBand }` everywhere.

### §4.4 Specifically what A2 will change (under Option A)

**Engine (`instantCalc.js`):**
- L5666, L5679, L5711: replace
  ```
  options.comfortBand ?? building.comfort_band ?? { lower_c: 20, upper_c: 26 }
  ```
  with
  ```
  options.comfortBand
  ```
  plus an entry-point assertion: `if (!options?.comfortBand?.lower_c || !options?.comfortBand?.upper_c) throw new Error('calculateInstant: options.comfortBand is required')`.

**Four React call sites:**
- `SystemsModule.jsx:162-172`
- `InterventionsModule.jsx:164-176` (THE e462a21 stopgap location)
- `IMResultsModule.jsx:96-103`
- `gains/canvas/useStateComparison.js:69-85`

Replace each with:
```js
calculateInstant(params, constructions, systems, libraryData,
                 weatherData, hourlySolar, scheduleProfiles,
                 { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: ... })
```
— `params` not `{...params, comfort_band: cb}`; `comfortBand` not `cb`; no `?? {…}`.

**`ProjectContext`** stays as-is. Its initial `{ 20, 26 }` default is overwritten on project load — guarantees-defined for callers.

### §4.5 What does NOT change in A2
- DB columns + API serialisation: unchanged.
- ProjectContext.comfortBand getter/setter: unchanged.
- The Building module's editing surface (`buildingSections.jsx:885-905`): unchanged.
- Engine physics: unchanged. The setpoint resolution at L2308-11 and the systemsEngine `_resolveSetpoint` continue to read `comfortBand.lower_c / upper_c` exactly as today.
- `params.comfort_band` JSON key: stops being read by the engine. The Patch system still tolerates it (intervention `comfort_band.lower_c` patches still flow through `ProjectContext.setComfortBand` → DB columns); we just stop _writing_ the JSON copy.

### §4.6 Anchor invariant
On verification DB Bridgewater (comfort 21-24), the **only** path from DB to engine becomes: `projects.comfort_band_{lower,upper}_c → API → ProjectContext.comfortBand → options.comfortBand → engine`. The value 21/24 lands identically. **Anchor 128.20 holds by construction.** A2's gate: `git diff` shows no engine-physics change, drift between Systems and Interventions routes is exactly 0.

---

## §5 — EUI denominator location (A3's surface)

A3 introduces `reported_gia` and routes the EUI denominator through it. The physics stays on the geometry-derived `gia`.

**The two roles after A3:**

| Role | Source | Used at |
|---|---|---|
| `geometry_floor_area` (physics) | `length × width × num_floors` — derived | All per-m² gain densities (`per_m2` basis lookup), surface-area calculations, State 1 envelope physics, State 2 demand integration. **NEVER touches the per-m² presentation EUI.** |
| `reported_gia` (presentation) | New `params.reported_gia` field, defaults to current geometry value on load | The single division site where `kwh_total / gia → consumption.total.kwh_per_m2_yr`. Carbon `kgco2_per_m2` likewise. |

**Exact lines to retarget in A3** (read-only here, listed so A3 doesn't need to re-audit):
- State 2 result assembly: `instantCalc.js:5485` (`gia_m2: Math.round(gia)` and the EUI division immediately around it)
- State 3 result assembly: around `instantCalc.js:4449` (where State 3 reads State 2's `gia_m2`, then divides totals)
- The `metadata.gia_m2` surfaced on the result becomes `reported_gia` (the presentation value); `geometry_gia_m2` is added alongside for transparency / A4's divergence flag.

**A3's gate (falsifiable):**
- `reported_gia == geometry_gia ⇒ Bridgewater EUI == 128.20 exactly`.
- `reported_gia = 1.1 × geometry ⇒ EUI == 128.20 / 1.1 = 116.55 exactly`.
- Absolute kWh totals (`heating_demand_mwh`, `total_delivered_mwh`, all per-service / per-fuel) **unchanged** at either setting.

**A4's divergence flag:** trip when `|reported_gia − geometry_gia| / geometry_gia > 0.10`. Show both numbers in the metadata page UI.

---

## §6 — Open questions for Chris (escalation surface)

1. **Option A vs B for the comfort_band resolution.** §4.3 recommends A; B is also workable. Confirm A or pick B.
2. **`num_bedrooms` rename.** §3.1 / §3.4 recommend keeping the schema field name and only relabelling the UI. Confirm; or call for the rename and I'll add it as a follow-on housekeeping brief.
3. **Notion design note.** I cannot read Notion `367d645e-05cc-81af-93d7-fc57bfc45faf` from this environment. The brief text quoted §1 of the design rationale. If the Notion entries add constraints beyond the brief (e.g. a specific naming convention for `reported_gia` vs `geometry_gia`, or a strong preference for B over A), please surface them before A2.
4. **`building_config.comfort_band` JSON key — what to do with it on the way out.** A2 stops the engine from reading it. Three options for its existence on existing project JSON:
   - **(i)** Leave it alone (orphan key, harmless after A2). Lowest risk.
   - **(ii)** A2 also strips it on save (one-shot migration).
   - **(iii)** A2 also strips it AND lands a schema-migration to clear it from every existing project.
   - Recommend **(i)** — the key is already null on Bridgewater; only projects that have been written through the stopgap path carry it; harmless once unread. Confirm.

---

## §7 — Summary table (consumers + verdict)

| Surface | comfort_band | GIA | num_rooms |
|---|---|---|---|
| **Canonical persistence** | DB cols (Brief 26) | derived from geometry | `building_config.num_bedrooms` |
| **Runtime source** | `ProjectContext.comfortBand` | engine `result.metadata.gia_m2` | `params.num_bedrooms` |
| **Distinct edit surface** | Building → Comfort band fields | (none — derived) | Building → num_bedrooms input |
| **A2 / A3 / A4 changes** | A2: engine reads only `options.comfortBand`; 4 call sites de-defensive | A3: split `reported_gia` (presentation) vs `geometry_gia` (physics); EUI denominator → `reported_gia` | A4: editing surface moves to metadata page; storage field unchanged |
| **128.20 invariant** | Holds — DB→context→engine path delivers 21/24 unchanged | Holds — `reported_gia` defaults to `geometry_gia` on load | Holds — storage unchanged |

---

## §8 — A1 close + HARD STOP

A1 is read-only. No engine code changed. No call-site code changed. Only documentation added:
- `docs/audit/58_metadata.md` (this file)
- `docs/briefs/active/58_demand_honesty.md` (the brief itself, landed)

**Awaiting Chris's sign-off on §4 (Option A vs B) and §6 (open questions) before A2 lands.**
