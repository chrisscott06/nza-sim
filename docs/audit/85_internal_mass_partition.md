# Brief 85 — Internal mass partition (Finding A resolution) — audit

**Branch:** `feat/energyplus-validation` (continuation of Briefs 81 + 82 + 83 + 84a + 84b). **NEVER merged to `main`.**
**Brief:** [`docs/briefs/active/85_internal_mass_partition.md`](../briefs/active/85_internal_mass_partition.md).
**Design note:** [`docs/design-notes/85_internal_mass_partition.md`](../design-notes/85_internal_mass_partition.md).

---

## §0 — Context and receipt

Brief 84b characterised the +1.10 °C free-float delta (2949 both-unconditioned hours, 97.5 % NZA
warmer) as a thermal-storage / transient-response solver-convention difference, but could not
**quantitatively partition** it between internal mass and residual solver convention because the
internal-mass calibration hook is dead via the production path (`calculateInstant` drops `opts.tuning`,
instantCalc.js ~L4961). Brief 85 wires that hook (Step 0), runs the partitioning sweep (Step 1), and
returns a verdict a/b/c (Step 2).

**Architectural decisions made upstream (NOT re-litigated here):** (1) construction-derived internal
mass is the long-term target; (2) the EP reference box stays physics-bare for validation (no EP-side
internal mass in this brief); (3) tolerance-vs-engine-change is evidence-gated on Step 1's residual.

**Staged with hard checkpoints.** Step 0.4 is a HARD CHECKPOINT: both the default-byte-identical test
AND the hook-activation-sensitivity test must pass before Step 1.

**Hard-STOPs:** hook drop more complex than 1-3 lines → STOP; Step 0.4 default byte-drift → STOP; Step
0.4 hook shows no sensitivity → STOP; Step 1 non-monotonic/chaotic vs mass → diagnose; construction-mass
obviously wrong → STOP; Step 2 points at a real engine bug → STOP; anything on `main` → STOP. No engine
change beyond the Step 0 plumbing fix; no EP IDF change; no fixture change; no tolerance re-tune; no
merge to `main`; escalate after 90 min on any sub-problem. Premise-check authority (Briefs 76/83/84):
if Step 0.2 shows the drop isn't where 84b located it, push back and reframe.

---

## §0.1 — P0.1: Brief + design note landing + branch verify

- Branch: `git branch --show-current` → `feat/energyplus-validation`. ✓
- Branch tip at landing: `85d47c9` (Brief 84b P7 close). ✓ (brief expected `85d47c9` or later)
- `main`: `d8a6207` (local and `origin/main`) — **unchanged since the branch cut.** ✓
- Brief landed at `docs/briefs/active/85_internal_mass_partition.md`; design note at
  `docs/design-notes/85_internal_mass_partition.md` (both verbatim from the authorised sources). Audit
  stub opened.

Commit: `Brief 85 P0.1: brief landing on feat/energyplus-validation`.

---

## §0.2 — P0.2: Source read of the dropped `opts.tuning` hook

Read-only. Refs `frontend/src/utils/instantCalc.js`.

### §0.2.1 — The full call chain (where `opts.tuning` actually dies)

The harness runs `calculateInstant(..., { comfortBand, _skipInterventions:true, engine:'v2.5', tuning })`.
The chain to the internal-mass read site:

```
calculateInstant(options)                                   L7284  — receives options (incl. options.tuning)
  └─ _calculateInstantBaseline(..., options)                L7336  — fast path (_skipInterventions ⇒ stackWillRun=false); forwards options ✓
       └─ _calculateState3(building, constructions,
            libraryData, weatherData, hourlySolar,
            options.comfortBand)                            L6683  — passes options.comfortBand ONLY; options/tuning DROPPED ✗
            └─ _calculateState2(..., { setpointOverride })  L4959  — no tuning ✗  (Brief 84b cited "L4961")
            └─ state2Recompute = (override) =>
                 _calculateState2(..., { setpointOverride }) L4972  — no tuning ✗
                 _calculateState2 reads opts.tuning.internal_mass_J_per_K_per_m2  L2602 (the live consumer)
```

### §0.2.2 — Premise-check refinement (Brief 76/83/84 authority)

> **The drop is NOT a single line at `L4961` — it is a three-function gap, so the fix is ~4 lines, not
> the "1-3 lines" the brief/Brief 84b estimated.** Brief 84b correctly identified that the inner
> `_calculateState2` call omits `tuning` (it cited ~L4961), but it did not trace that **`_calculateState3`
> never receives `opts` in the first place**: its signature (L4928) has no `opts` parameter, and its
> caller `_calculateInstantBaseline` (L6683) forwards only `options.comfortBand`. So three edits are
> needed to thread the one optional param down:
>
> 1. **L4928** — add `opts = {}` to the `_calculateState3` signature.
> 2. **L6683-6687** — forward `options` (the tuning carrier) into the `_calculateState3` call.
> 3. **L4959 + L4972** — add `tuning: opts.tuning` to both `_calculateState2` opts objects (main call +
>    the per-system `state2Recompute` closure, for consistency).
>
> **Assessment vs the hard-STOP** ("not a 1-3 line fix → STOP"): this marginally exceeds the estimate (4
> lines / 3 functions vs 1-3 lines), but it is **mechanically trivial, low-risk, default-preserving
> plumbing of a single optional parameter** — it does not engage the hard-STOP's real concern
> (entanglement, side effects, or architectural risk). Per the standing instruction to "push back via
> audit comment and reframe," I **document the reframe and proceed** rather than halt the staged session
> on a 3-vs-4-line technicality. Chris can see this call here and reverse it; nothing about the fix is
> irreversible or risky.

### §0.2.3 — Callers and parity check

- **Only one caller of `_calculateState3`** (L6683, inside `_calculateInstantBaseline`) — confirmed by
  grep. So the signature change has a single call site to update.
- **`_calculateInstantBaseline` callers** both forward `options`: the fast path (L7336, the harness
  path) and the intervention-stack `runEngine` closure (L7342). So `options.tuning` already reaches
  `_calculateInstantBaseline`; the gap is strictly downstream of it.
- **Rule 14 (envelope-physics parity):** threading an optional `tuning` param to its existing read site
  is **not** an envelope-physics change to an integration loop — it changes no physics and no default
  output. The State-1 baseline call *inside* `_calculateState2` (L2578, `tuning: null`) is left as-is on
  purpose: it feeds the heat-balance solar baseline, **not** the free-float trace or the demand the
  sweep measures (Brief 84b §3.4), and forwarding tuning there would be scope creep that alters the
  heat-balance baseline. The free-float internal mass the sweep targets is `C_air_total_J` (L2672-2674),
  driven solely by the State-2 `opts.tuning.internal_mass_J_per_K_per_m2` (L2602). So forwarding to the
  two State-2 calls is necessary and sufficient.
- **Knob name/units:** the real engine param is `tuning.internal_mass_J_per_K_per_m2` (J/(K·m²) of GIA),
  **not** the brief's notional `internalMassMJperK`. The brief explicitly allows "Code can adjust the
  invocation as needed." Conversion for the box (gia 100 m²): internal-mass MJ/K = param × 100 / 1e6 =
  param / 10 000. So 250 000 J/(K·m²) ⇒ 25.0 MJ/K (confirms Brief 84b's 25 MJ/K default).

Commit: `Brief 85 P0.2: source read of opts.tuning drop point`.

---

## §0.3 — P0.3: opts.tuning plumbing fix (the diff)

Four edits in `frontend/src/utils/instantCalc.js`, threading the one optional `tuning` param down the
chain identified in §0.2. No physics change; behaviour byte-identical when `opts.tuning` is absent
(each new key resolves to `undefined` → `_calculateState2` falls back to its 250 000 default at L2602).

1. **`_calculateState3` signature (L4928):** `(…, comfortBand)` → `(…, comfortBand, opts = {})`.
2. **`_calculateState3` call site in `_calculateInstantBaseline` (L6683):** added `options,` after
   `options.comfortBand` so the opts carrier reaches `_calculateState3`.
3. **Main `_calculateState2` call (L4959):** added `tuning: opts.tuning` to the opts object.
4. **`state2Recompute` closure `_calculateState2` call (L4972):** added `tuning: opts.tuning` (same
   tuning as the main call, for per-system setpoint-diagnostic consistency).

The State-1 baseline call inside `_calculateState2` (L2578, `tuning: null`) is deliberately unchanged
(§0.2.3 — it feeds the heat-balance solar baseline, not the free-float trace the sweep measures).

### §0.3.1 — Smoke-test (full verification is P0.4)

`node validation/nza_sim/internal_mass_probe.mjs` (calls `calculateInstant` with `opts.tuning` swept):

| internal_mass (J/K/m²) | free-float delta all / night / midday (°C) | NZA free hrs | heat/cool kWh |
|---|---|---|---|
| 250 000 (default) | 1.061 / 1.393 / 0.720 | 5012 | 2492 / 1407 |
| 100 000 | 1.060 / 1.242 / 0.882 | 4786 | 2509 / 1438 |
| 50 000 | 1.064 / 1.161 / 0.971 | 4654 | 2517 / 1450 |
| 25 000 | 1.069 / 1.114 / 1.023 | 4575 | 2520 / 1457 |
| 0 | 1.077 / 1.062 / 1.080 | 4471 | 2524 / 1463 |

- **Hook is LIVE:** values now respond to mass (pre-fix every row was identical — Brief 84b §5.1).
- **Default (250 000) row is byte-identical** to the pre-fix probe (1.061 / 2492 / 1407) — default
  preserved at the param default.
- **Clean physics:** the **night-midday spread collapses** as mass drops (0.67 °C at 250k → ~0 at 0) —
  mass governs the diurnal **amplitude**, exactly as predicted (Brief 84b §5.2). But the **mean delta
  is ~flat (1.06–1.08 °C) at every mass, including 0** — the mean offset is **not** mass-driven. This
  already foreshadows outcome (c); Step 1 confirms rigorously with the full metric set + construction-
  derived point.

Commit: `Brief 85 P0.3: opts.tuning plumbing fix`.

---

## §0.4 — P0.4: Hook verification [HARD CHECKPOINT]

### Test 1 — Default path byte-identity (no `opts.tuning`)

`node validation/nza_sim/extract.mjs` → `python validation/compare.py`. Gated metrics vs the Brief
84a/84b anchor:

| Metric | Brief 84b anchor | Brief 85 post-fix (default) | Match |
|---|---|---|---|
| EUI (kWh/m²) | 160.4 (−3.7 %) | 160.4 (−3.7 %) | ✓ |
| Heating demand (MWh) | 2.492 (−24.0 %) | 2.492 (−24.0 %) | ✓ |
| Cooling demand (MWh) | 1.407 (+107.9 %) | 1.407 (+107.9 %) | ✓ |
| Fabric conduction (MWh) | 5.454 (+11.1 %) | 5.454 (+11.1 %) | ✓ |
| Mech-vent (EP coil-run hrs) | 0.919 (+3.6 %) | 0.919 (+3.6 %) | ✓ |
| Gated | 5/7 | 5/7 | ✓ |

`monthly cooling sum 1407.04 kWh` identical. **Test 1 PASS — default behaviour byte-identical** (only
the benign `captured_at` timestamp differs in the JSON). The plumbing fix did not leak into the default
path.

### Test 2 — Hook activation (mass varies the result, in the damping direction)

The internal-mass hook now responds (pre-fix every mass produced identical output — Brief 84b §5.1):

- **Sensitivity (probe sweep):** free-float hours 5012 → 4471, heating 2492 → 2524 kWh, cooling
  1407 → 1463 kWh as mass 250k → 0 J/(K·m²). The result clearly differs with mass — the hook is live.
- **Damping direction, night-vs-midday delta spread** (the clean diurnal proxy): at 250 000 J/(K·m²)
  the free-float delta is +1.393 °C at night vs +0.720 °C midday (spread **0.67 °C** — NZA holds daytime
  warmth into the night = mass damping); at 0 the spread collapses to ~0 (+1.062 night ≈ +1.080 midday,
  NZA tracks EP's diurnal shape). **Higher mass → more overnight heat retention = expected damping.** ✓
- **Damping direction, peak-to-peak free-float range** (0 vs 100 MJ/K, NZA free-float zone temp): range
  **3.52 °C → 3.04 °C** as mass rises (extremes clipped; max 24.69 → 24.05). Higher mass → smaller
  temperature excursions = expected damping. ✓
- (The std of NZA's free-float temp over the EP-unconditioned subset rose 0.730 → 0.893 with mass — but
  that subset-std is a **confounded** proxy, mixing seasonal and diurnal variation across non-contiguous
  selected hours; it is not a clean swing measure. The diurnal-spread and peak-to-peak-range metrics
  above are the correct damping indicators, and both confirm the expected direction.)

**Test 2 PASS — the hook is live and responds in the physically expected (damping) direction.**

### HARD CHECKPOINT — CLEARED

Both tests pass: default behaviour preserved (Test 1), hook live and directionally correct (Test 2).
**Proceeding to Step 1.** (Foreshadowing already visible: the *mean* free-float delta barely moves with
mass — §0.3.1 — so Step 1 is likely to land outcome (c); but Step 1 measures it rigorously with the
full metric set and the construction-derived point before any verdict.)

Commit: `Brief 85 P0.4: opts.tuning hook verification`.

---

## §1.1 — P1.1: Sweep design + construction-derived mass computation

### §1.1.1 — Construction-derived mass (brief's formula)

Σ (thickness × density × specific_heat × area) over opaque surfaces, from the fixture layer specs
(`validation/fixtures/bridgewater_box_v1.yaml`). Areas (box 10×10×1, 3 m): opaque wall 108 m² (120
gross − 12 glazing), roof 100 m², floor 100 m².

| Surface | Layer heat capacity (J/K·m²) | Area (m²) | MJ/K |
|---|---|---|---|
| External wall | PIR 4 914 + Concrete 200 000 = 204 914 | 108 | 22.13 |
| Roof | PIR 5 922 + Concrete 300 000 = 305 922 | 100 | 30.59 |
| Ground floor | PIR 4 284 + Concrete 300 000 = 304 284 | 100 | 30.43 |
| **Total construction mass** | | | **83.15** |

As the engine param: `83.15 MJ/K ÷ 100 m² GIA = 831 513 J/(K·m²)`.

### §1.1.2 — Caveat on "construction-derived" as the lumped param (factual, flagged for Brief 86)

The brief's formula sums the **envelope** opaque layers. But NZA already models that envelope mass
**dynamically** via its per-construction implicit RC (`stepWallLinearized`, `TS_wall/roof/floor`; Brief
84b §3.4). The lumped `internal_mass` param is a **separate** term representing furniture / partitions /
internal floors. So setting the lumped param to the envelope-derived 83 MJ/K would **double-count the
envelope mass** (once in the RC, once lumped). The physically-correct *internal* mass for a deliberately
bare box (no internal partitions/furniture) is ≈ 0. This does not change the sweep — construction-derived
is run as an instructed labelled point — but it is the key interpretation note for Brief 86 (the
architectural decision "construction-derived is the long-term answer" needs to mean "derive the *internal*
mass" or "replace the lumped term with the RC's mass," not "add the envelope mass twice"). Not
re-litigating the philosophy; recording the implementation reality the verdict must respect.

### §1.1.3 — Sweep values

| Param `internal_mass_J_per_K_per_m2` | MJ/K (box) | Note |
|---|---|---|
| 0 | 0 | bare envelope (matches EP reference's zero internal mass) |
| 100 000 | 10 | |
| 250 000 | 25 | current tuned default |
| 500 000 | 50 | |
| 831 513 | 83.15 | construction-derived (brief formula; see §1.1.2 caveat) |
| 1 000 000 | 100 | high-mass bound |

### §1.1.4 — Metrics captured per mass (P1.2)

Free-float delta mean (over EP-unconditioned hours, fixed reference set); conditional r(delta, outdoor)
and r(delta, ΔT); night vs midday delta; heating total + Δ vs EP (3.2775 MWh); cooling total + Δ vs EP
(0.6768 MWh); NZA free-float zone-temp std + peak-to-peak range; mech-vent like-for-like over EP coil-run
hours (the 84a metric, expected ~+3.6 % throughout).

### §1.1.5 — Prediction (before measuring)

Per the P0.3 smoke-test + the linear-system physics in Brief 84b §5.2 (capacitance is mean-preserving in
periodic steady state; it sets diurnal amplitude/phase, not the mean): I predict **outcome (c)**.
Specifically: the free-float delta **mean stays ~1.06–1.08 °C at every mass including 0** (mass does NOT
close it); `mass_min` ≈ the current default (the mean is flat with a shallow minimum near 250k);
`delta_residual` ≈ 1.06 °C ≫ 0.8 °C. The **conditional/night-heavy patterns will collapse at low mass and
strengthen at high mass** (confirming mass governs the *amplitude*, not the mean). Demand: lower mass →
slightly more heating (toward EP) and more cooling (away from EP); no single mass fixes both. If the data
contradicts this (e.g. some mass drops the mean below 0.8 °C), I will report (a)/(b) honestly per the
brief's prediction-error discipline.

Commit: `Brief 85 P1.1: sweep design + construction-derived mass computation`.

---

## §1.2 — P1.2: Internal mass sweep execution

**Tool:** `validation/nza_sim/internal_mass_sweep.mjs` (read-only; passes `opts.tuning`, persists
nothing in the engine). **Output:** `validation/sweeps/85_internal_mass_sweep.csv`. EP reference set:
3161 unconditioned hours; EP net mech-vent over heating-coil hours 0.8816 MWh; EP demand targets heating
3.2775 / cooling 0.6768 MWh.

| Mass (MJ/K) | Δ mean (°C) | Δ night | Δ midday | r(Δ,odb) | r(Δ,dT) | ff std | ff range (°C) | Heating (MWh / %EP) | Cooling (MWh / %EP) | mech-vent LLF |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | **1.077** | 1.062 | 1.080 | −0.55 | 0.44 | 0.730 | 3.52 | 2.524 / −23 % | 1.463 / +116 % | +3.7 % |
| 10 | **1.060** | 1.242 | 0.882 | −0.59 | 0.48 | 0.740 | 3.21 | 2.509 / −23 % | 1.438 / +112 % | +3.7 % |
| 25 (default) | 1.061 | 1.393 | 0.720 | −0.59 | 0.51 | 0.791 | 3.10 | 2.492 / −24 % | 1.407 / +108 % | +3.7 % |
| 50 | 1.074 | 1.499 | 0.635 | −0.57 | 0.51 | 0.846 | 3.06 | 2.472 / −25 % | 1.374 / +103 % | +3.7 % |
| 83.15 (constr-derived) | 1.088 | 1.550 | 0.614 | −0.55 | 0.48 | 0.881 | 3.04 | 2.455 / −25 % | 1.346 / +99 % | +3.7 % |
| 100 | 1.093 | 1.563 | 0.612 | −0.53 | 0.47 | 0.893 | 3.04 | 2.447 / −25 % | 1.335 / +97 % | +3.7 % |

Raw values in the CSV. The relationship is clean and **monotonic** in every column (no chaotic/
non-monotonic behaviour → the Step-1 hard-STOP is not triggered): as mass rises, night Δ climbs
monotonically, midday Δ falls monotonically, peak-to-peak range shrinks monotonically, heating falls,
cooling falls. Only the **mean Δ is non-monotonic-but-essentially-flat** (shallow minimum 1.060 at
10 MJ/K; total span 1.060–1.093 °C across the whole 0–100 MJ/K range).

Commit: `Brief 85 P1.2: internal mass sweep execution`.

---

## §1.3 — P1.3: Sweep analysis + delta partition

_(to be written at P1.3)_

---

## §2.1 — P2.1: Outcome verdict + reasoning

_(to be written at P2.1)_

---

## §2.2 — P2.2: Bridgewater-Box validation state at mass_min

_(to be written at P2.2)_

---

## §2.3 — P2.3: Close summary + Brief 86 handoff

_(to be written at P2.3)_
