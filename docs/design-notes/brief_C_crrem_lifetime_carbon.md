# Brief C design note — CRREM lifetime carbon (populates Brief A's placeholders)

*Markdown only. Internal. Audience: Chris, Will, Imi, Claude Chat, Claude Code.*

**Date:** June 2026
**Status:** Design locked. Brief C writable from this note.
**Lineage:** Follows the Interventions Module Rework design note (June 2026). Brief A landed the UX scaffolding with placeholder cards for Lifetime Carbon, £/tonne CO₂, and the CRREM trajectory chart. Brief C populates the Lifetime Carbon side. Brief B (cost model, NRM2-aligned) follows after to populate the £ side. Brief 88 landed the canonical EUI read principle; Brief C extends the same one-canonical-read discipline to carbon factors and CRREM trajectory.

---

## What Brief C does

Three things, in increasing complexity:

1. **Computes per-intervention lifetime carbon saved against the CRREM decarbonisation trajectory**, with fuel-switching handled correctly year-by-year (lifetime gas emissions avoided minus lifetime electricity emissions added, where the electricity factor falls over the period).
2. **Renders the CRREM stranding diagram on the Strategy view** — the canonical chart format used in client reports. Two-y-axis (GHG intensity + energy intensity), 2020-2050, with target curve, asset performance curve, red-circle misalignment year marker, current-year diamond marker, and excess-emissions shaded area.
3. **Populates Brief A's placeholder cards on the per-intervention Isolated view** — "Lifetime carbon saved" (tCO₂e), and contributes the carbon half of "£ per tonne CO₂" (the £ half waits for Brief B).

Once Brief C closes, every intervention has a defensible lifetime-carbon number against an industry-standard reference, and the Strategy view shows the canonical stranding diagram that clients will see in deliverables.

## CRREM methodology — explicit, fuel-switching aware

**Principle:** Lifetime carbon saved = cumulative annual operational carbon savings across the analysis period, with each year's emissions computed against that year's fuel-specific carbon factor.

**The general formula per intervention, per year *y*:**

`Δ_y = Σ_fuel (baseline_kWh_fuel - post_kWh_fuel) × carbon_factor_y_fuel`

where `carbon_factor_y_fuel` is the appropriate factor for that fuel in year *y* (electricity follows the CRREM grid decarbonisation trajectory; gas stays roughly constant per DESNZ).

**Lifetime carbon saved:**

`Σ Δ_y for y = 2025 to 2050` (or to the end of the intervention's lifetime, whichever is shorter)

### The fuel-switching case (worked example)

A heat pump retrofit shifts the building from gas to electricity. The intervention saves a lot of gas (high constant carbon factor) and adds some electricity (declining carbon factor). The math:

- 2025: `(100,000 × 0.183) - (30,000 × 0.190) = 18,300 - 5,700 = 12,600 kgCO₂e saved`
- 2050: `(100,000 × 0.183) - (30,000 × 0.025) = 18,300 - 750 = 17,550 kgCO₂e saved`
- Cumulative 2025-2050: sum across 26 years with electricity factor on its CRREM trajectory

The saving grows over the period because the electricity grid decarbonises but gas doesn't. **Heat pumps look better in lifetime carbon terms than they do in year-1 terms.** That's a critical insight the tool needs to surface — it's how net-zero pathway decisions get made.

### The non-fuel-switching case

Simpler. An LED retrofit reduces electricity directly: `Δ_y = electricity_saved_kWh × electricity_factor_y`. The saving shrinks each year as the grid decarbonises (smaller carbon factor on the saved kWh). An LED retrofit looks much better in 2025 than in 2045 — the carbon value of saved electricity erodes.

A fabric insulation retrofit on a gas-heated building reduces gas directly: `Δ_y = gas_saved_kWh × gas_factor_y`. Roughly constant each year because gas doesn't decarbonise. Fabric work on gas-heated buildings retains its carbon value over time.

**Both visible in the lifetime card.** Rank order between interventions can change depending on which fuel they're decarbonising — that's a feature, not a confusion. The tool surfaces the long-game decision.

### Carbon factor data sources

- **UK electricity grid**: CRREM trajectory, UK country curve. Already in the codebase per Code's confirmation. Other countries to follow in a future brief.
- **UK natural gas**: DESNZ standard, 0.183 kgCO₂e/kWh (approximately constant 2025-2050).
- **Other fuels** (biomass, district heat, etc.): out of scope for v1. Brief C handles electricity + gas; future briefs extend.

If for any reason the UK CRREM dataset isn't accessible at Brief C time (shouldn't happen per Code's confirmation, but as a safety net): use a flat 0.190 → 0.025 linear decarbonisation between 2025 and 2050. Chris shares the proper data later if needed. The chart and math work either way; only the curve values change.

## The CRREM stranding diagram (Strategy view)

This is the canonical chart format used in client reports. Two y-axes, x-axis 2020-2050, multiple chart elements layered. **Match the report style closely.** See: `Zeal team draft report` slide 13 (HIEX Bridgwater CRREM Study, section 2.5) for the visual reference Chris has standardised on.

### Chart structure

**Two-axis chart**, x-axis 2020-2050:

- **Left y-axis: GHG intensity** (kgCO₂e/m²·yr), range 0 to ~60 (auto-scale)
- **Right y-axis: Energy intensity** (kWh/m²·yr), range 0 to ~300 (auto-scale)

Two parallel charts displayed vertically — GHG intensity on top, energy intensity below — sharing the x-axis. Each shows the same five elements per its own metric:

1. **Decarbonisation target curve** — dark navy line, country-and-property-type-specific CRREM target. UK Hotel 1.5°C pathway for hotels; other property types follow CRREM categories.
2. **Asset performance curve** — lighter blue line. The strategy's projected trajectory from current year to 2050. Starts at current EUI/carbon intensity, extrapolates based on grid decarbonisation (and any in-strategy fuel-switching/efficiency changes that have been scheduled with year markers — future enhancement; v1 assumes the strategy's final state is reached in year 1).
3. **Red circle at misalignment year** — the year asset performance crosses target. Labelled with "CRREM misalignment" in the legend. This is the headline stranding-risk year.
4. **Past performance diamond** — current year position marker, labelled (e.g. "2025 Performance" or "2024 Performance" depending on data). Shown as a filled diamond.
5. **Excess emissions shaded area** — the area between asset performance and target, post-misalignment, shown as a translucent blue fill. Visualises cumulative gap.

### Strategy headline (above or alongside the chart)

The strategy's CRREM-relevant numbers, prominent:

- **Current EUI**: e.g. ~180 kWh/m²·yr
- **CRREM EUI target**: e.g. 95 kWh/m²·yr (current-year value from the target curve)
- **Energy misalignment year**: e.g. ~2027 (when asset performance exceeds target)
- **Carbon misalignment year**: e.g. 2032 (when GHG intensity exceeds target — usually later than energy misalignment because grid decarbonisation buys time)
- **Lifetime carbon saved by 2050** (the strategy total, tCO₂e)
- **Strategy headline year** (when the strategy hits CRREM target, if at all — could be "Never" for under-ambitious strategies)

### Compare to baseline

The strategy view shows the strategy's trajectory. A toggle/comparison option overlays the **baseline trajectory** (no interventions) on the same chart so the user sees how much closer to target the strategy gets the building. Same shape, two asset performance lines instead of one, two red circles (baseline misalignment vs strategy misalignment), two excess-emissions areas.

This is the most important chart in any client deliverable. It has to be right and it has to look like the report.

## The per-intervention Isolated view (simpler version)

On the per-intervention view, the four headline cards include Lifetime Carbon Saved. Below the cards, a small CRREM trajectory chart shows:

- The building's baseline trajectory (no interventions) as the lighter line
- The post-intervention trajectory as a slightly bolder line
- The CRREM target as the dark line
- The **lifetime saving** as the shaded area between baseline and post-intervention trajectories

Smaller than the Strategy view's full stranding diagram. Single y-axis (carbon, since that's the lifetime-carbon-saved metric). No misalignment red circle (that's a strategy-level concept). Just the area between the two lines that represents the intervention's contribution.

The card itself shows the total: "Lifetime carbon saved: X tCO₂e by 2050".

## Per-intervention lifetime inputs

Each Library entry needs:

- **Intervention lifetime** (years). Default per intervention type:
  - Heat pump systems: 15-20 years
  - Fabric insulation: 40-50 years
  - LED + lighting controls: 10-15 years
  - Setpoint changes / occupancy changes / control strategy: instantaneous (no embodied lifetime; saving lasts as long as the setting holds; treat as analysis horizon, 25 years)
  - BMS upgrades: 15-20 years
- **Optional**: replacement cycle if intervention will be re-invested during the analysis period. Out of scope for v1 — assume single deployment, no replacement.

These defaults seed each new Library entry; user can override per intervention.

## CRREM data scope — single project-level pick

CRREM provides decarbonisation curves per:
- **Country** (UK, France, Germany, etc.)
- **Property type** (residential, hotel, office, retail, etc.)
- **Pathway** (1.5°C, 2°C, 4°C)

A project picks one combination once. All interventions in the Library and all strategies use the same project-level curve. Multi-curve comparison (e.g. show 1.5°C and 2°C side by side) is a future enhancement; v1 single-pathway only.

## What stays as-is

- **The engine.** No changes to `instantCalc.js`, `interventionsEngine.js`, or `systemsEngine.js`. Brief C consumes the engine's existing output (per-fuel kWh annual values) and applies carbon factors and CRREM trajectories on top.
- **Brief A's UX scaffolding.** Library/Strategy split, two-section per-intervention view, drag-and-drop reorder, Heat Balance compare. All untouched. Brief C only populates the placeholders.
- **The canonical-read principle from Brief 88.** Carbon factors and CRREM trajectories will follow the same pattern: one canonical exposure point, all consumers read through a single helper. Already named in design as `engineReads.js` extension or new `carbonReads.js` — TBC by Code in Brief C Part 2.

## What's deliberately out of scope

- **Embodied carbon.** Brief C is operational only. Embodied is a future brief (likely separate per Chris's prior steer "We may want to come back to EC but not now").
- **Multi-pathway comparison.** Single pathway per project for v1.
- **Multi-country support.** UK only for v1. Code has UK datasets per confirmation; other countries are a future cleanup brief.
- **Time-staged interventions.** v1 assumes a strategy's final state is reached in year 1. Phased rollout (e.g. "heat pump installed in 2028") is a future enhancement.
- **Carbon pricing.** £ per tonne CO₂ saved is Brief B's cost layer — Brief C provides the tonnes; Brief B provides the £.

## Decision log

**26 June 2026:** Chris confirms Brief C scope. CRREM stranding diagram on Strategy view matches the report style exactly (two-axis, target + performance + misalignment circle + current-year diamond + excess-emissions area). Per-intervention view shows simpler version (baseline trajectory + post-intervention trajectory + lifetime saving as shaded area). UK CRREM datasets in codebase already; flat-rate placeholder as safety net only. Fuel-switching methodology explicit and worked-example documented. Single pathway per project for v1; multi-pathway and multi-country future briefs. Embodied carbon explicitly deferred. Cost (Brief B) follows after Brief C closes.

*Next step: Brief C drafted as paired markdown brief alongside this design note. Brief C goes to Claude Code on the same feature branch as Brief A and Brief 88 (`chris/interventions-rework-ux`), or a new branch off `main` after that branch's PR merges — Code's call based on what's cleanest given current branch state.*
