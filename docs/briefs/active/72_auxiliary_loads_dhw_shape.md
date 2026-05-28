# Brief 72 — Auxiliary loads, gain_fraction, and DHW load-shape UI

**Author:** Claude Chat (architect)
**Authorised by:** Chris (28 May 2026)
**Provisional number:** 72 (71 = Interventions Isolated vs Combined, in use). Code: if 72 is taken, claim the next free number and tell Chris before Part 1.
**Design note (canonical):** https://www.notion.so/36ed645e05cc81ac89b9d5bc14355a39 — "Brief 72 design note: Auxiliary loads + gain_fraction + DHW load shape". Where this brief and the note disagree, the note wins.
**Lineage:** This brief supersedes and replaces the never-shipped "Brief 60 Part B / Part D" addendum (`60_addendum_partB_partD.md`). All design decisions in that addendum are carried forward verbatim except the anchor number (see Principle 5 below). Brief 60 itself is closed; this is a fresh, standalone brief, not an append.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and this first paragraph back to Chris, and state the commit SHA at the tip of `main` you are starting from. If you cannot point to this brief on disk at `docs/briefs/active/72_auxiliary_loads_dhw_shape.md` after Part 1's first commit, STOP.
2. **STATUS.md reconciliation is a precondition, not optional.** `STATUS.md` is stale (last completed entry Brief 23, 2026-05-06) per CLAUDE.md Rule 8. The FIRST commit of this brief reconciles `STATUS.md` against current state (Briefs 24–71). This is also where you **capture the current Bridgewater baseline anchor** (Principle 5).
3. **Land the brief on disk** at `docs/briefs/active/72_auxiliary_loads_dhw_shape.md` as part of Part 1's first commit. Open the audit stub `docs/audit/72_auxiliary_loads_dhw_shape.md`.
4. **Diagnose before fixing; audit before fixing.** This is mostly additive feature work, but the engine wiring in Part 3 touches a shared multiplier — read the gains layer and confirm the boundary before writing.
5. **Ports.** Frontend `5176`/`5178`, backend `8002`, started via `go.bat`. Verify you are on the nza-sim app before any browser check (the 5173 wrong-port incident).

---

## Scope

Surface two pieces of modelling capability that the engine either already supports or needs a small additive extension for, and which have no UI today, AND fix two baseline correctness issues uncovered during Brief 71 walkthrough that block trusting any of it:

- **Auxiliary loads** — a fourth internal-gains section (External lighting, Catering, Pumps, Small power, Lifts, Custom), parallel to Occupancy / Lighting / Equipment.
- **`gain_fraction`** — promote to a first-class, editable field on lighting / equipment / auxiliary gain profiles, defaulting to 1.0 so existing behaviour is byte-identical.
- **DHW load shape** — a single UI control (flat vs follow-occupancy) for the `dhw_load_shape` field that has shipped end-to-end in the engine since Brief 58 but was never given a control.
- **Occupancy headcount unification** — retire the `people_per_room` duplicate, route gains + DHW + ventilation through one headcount, add `num_bedrooms` to patch capture. Without this, the DHW load-shape UI ships one toggle away from a number that doesn't respond to occupancy changes.
- **Occupancy / Calc-trail discriminator** — settle Code's H1/H2/H3 hypotheses for the +825-kWh / 0.0-Δ disagreement before touching the gains layer. H3 = no-op finding (proceed); H2 = bounded fix here; H1 = STOP and split out.

**Out of scope (do NOT ship here):** BMS as a distinct load (folds into Small power); IT/server rooms (waits for per-zone modelling); EV chargers (waits for a project need); occupancy `gain_fraction` (occupancy gain is already sensible/latent-split — adding a fraction on top double-controls; documented asymmetry, revisit later); the three queued register fixes (B1 carbon factors, U1 shading floor, U2 Jan-1-Monday — separate "register fixes" brief, explicitly NOT bundled here); the interventions diagnostic harness + tab redesign (Brief 74, drafted but waits until this brief closes); WWHR (Brief 76, needs a DHW end-use split first).

---

## Principles

1. **Auxiliary is a gain with a fuel carrier, living in the gains layer.** The chain `envelope → gains → demand → systems → fuel` is preserved; nothing inverts. Internal Gains is the editing surface.
2. **Same gain = same colour everywhere.** Auxiliary's colour token (`#4B5563`, "boring dark grey", Chris's call — not violet) lands in BOTH `gainColours.js` AND `balanceColours.js INTERNAL_COLOURS` in the same commit.
3. **`gain_fraction` and `daylight_factor` are orthogonal and must never be merged.** `daylight_factor` reduces the *load* (electricity drops when daylight is available). `gain_fraction` describes how much of the *remaining load* becomes zone heat. No helper or refactor may collapse the two. Three-way regression is mandatory (B.8 #7 in the design note).
4. **Boundary discipline (the recurring bug family).** `electricity_kwh` is the carrier; `gain_kwh = electricity_kwh × gain_fraction` is the heat side. Name and keep them distinct — do not let a single variable stand for both. This is exactly the boundary-mismatch class that produced the Diagnostic 248% bug and Issue #23.
5. **Anchor: capture, don't hardcode.** The superseded addendum cited Bridgewater EUI `110.30` (per-m², late-May). The model has moved since (current baseline shows ~**536.3 MWh** total). Do NOT hardcode either number. In the STATUS.md/anchor commit, **record the current Bridgewater baseline EUI from a clean engine run** and use THAT as the anchor gate for every "anchor preserved" check below. Never tweak the engine to hit a target number.
6. **`gain_fraction` defaults to 1.0** on lighting and equipment — so with no auxiliary profiles and no fraction edits, the post-brief model is numerically identical to pre-brief. That equality is the primary gate.
7. **Single source of truth for occupant headcount.** When `basis = people/room`, headcount = `num_bedrooms × density`. When `basis = per_m2`, headcount = `density × gia_m2`. **The `people_per_room` field is retired** — it was an architectural duplicate (set to a phantom 1.5 in Bridgewater that Chris never authored) that decoupled DHW from occupancy. The unified headcount flows into occupancy gains (sensible + latent), DHW headcount math, and ventilation flow.
8. **Capture parity.** Every engine-read field on `building.*` that an intervention could conceivably target MUST be captured by `patchCapture.js`. The `num_bedrooms` capture gap is the immediate fix; while there, audit and close any other gaps the audit surfaces. Boundary discipline applied to the patch capture layer.

---

## Parts (each = one commit unless noted)

> Full schema, code shapes, file paths, and line references live in the design note (the carried-forward addendum). This brief lists the parts as commits with their gates; Code reads the note for the exact code.

**Part 1 — Precondition + anchor capture.**
Reconcile `STATUS.md` (Briefs 24–71). Run Bridgewater clean, record baseline EUI as the anchor in the audit stub. Land this brief on disk. Open audit stub.
Commit: `Brief 72 P1: STATUS reconcile + Bridgewater anchor capture + brief landing`.

**Part 2 — Occupancy / Calc-trail discriminator (read-only, NO fix).**
Per Code's audit landing at `286f57c`, three mutually-exclusive hypotheses survive static analysis for the Occupancy 4 / Calc-trail-zero / +825-kWh disagreement: H1 (engine cross-wire — `stackResult.baseline` and `interventions[0].result` share a reference), H2 (BreakdownTable's read helpers miss the field producing the +0.20 kWh/m² delta), H3 (Bridgewater's persisted state already has occupancy = 4; "Occupancy 4" intervention is a no-op patch).

Run the §4.1 discriminator: drop a one-line `window.__lastStackResult = stackResult` on a throwaway branch, then a 5-line console dump returning (a) reference equality `baseline === interventions[0].result`, (b) the four demand numbers (heat, cool, DHW, electricity) for both, (c) the per-m² EUI for both. Report results in `docs/audit/72_*.md` §discriminator.

**Decision rules:**
- **H3 confirmed** (no-op patch) → no Calc-trail bug, fold the finding into the audit and proceed to Part 3.
- **H2 confirmed** (BreakdownTable reads miss the field) → bounded fix inside `BreakdownTable.jsx`. Land it as P2b, then proceed to Part 3. Anchor unchanged.
- **H1 confirmed** (engine cross-wire) → STOP. Surface to Chris. This is a Tier-3 escalation outside Brief 72 scope; we'll split it into its own brief before touching the gains layer.

Commit (discriminator + audit): `Brief 72 P2: Occupancy/Calc-trail discriminator (H1/H2/H3 settled)`. If P2b runs, separate commit: `Brief 72 P2b: BreakdownTable read fix (H2)`.

**Part 3 — Occupancy headcount unification.**
Single source of truth in the engine for occupant headcount. When `basis = people/room`, headcount = `num_bedrooms × density`; when `basis = per_m2`, headcount = `density × gia_m2`. This headcount drives occupancy gains (sensible + latent), DHW headcount math (replacing the current `people_per_room` read), and ventilation flow calculations.

**Retire `people_per_room`:**
- Remove the field from `DEFAULT_GAINS.occupancy` in `ProjectContext.jsx`.
- Remove the UI control from `OccupancySection.jsx` (the "People per room = 1.5" field visible in screenshots).
- Remove all engine reads of `people_per_room` — `systemsEngine.js` DHW math, `useAnnualGains.js` legacy avg-occupants path, anywhere else `grep -rn "people_per_room"` finds it.
- Patch migration: existing projects with `people_per_room` saved → drop the field; if any project had `people_per_room ≠ 1.5` (an actual edited value), log a warning to console listing the affected project IDs so Chris can re-set `density` consciously.

**Add `num_bedrooms` to `patchCapture.js`** (Code's side finding) plus audit any other `building.*` field the engine reads but capture misses. Document audit findings in `docs/audit/72_*.md` §capture-parity.

**Gates (all must pass):**
- (a) Bridgewater baseline with no interventions: EUI ± 0 from Part 1 anchor (assuming engine was already reading `density × num_bedrooms` and ignoring the phantom 1.5). If EUI moves, that itself is a finding — the engine WAS reading 1.5 — and the new value is the canonical Bridgewater baseline going forward. Document the movement from first principles; do NOT adjust to match the old anchor.
- (b) Density 3 → 4 on Bridgewater: DHW demand moves proportionally (138 × 3 × 80 L → 138 × 4 × 80 L = +33% on DHW headcount → ~+70 MWh on DHW). Sign must be right; magnitude within ~5% of arithmetic prediction.
- (c) "Occupancy 4" intervention, applied via patch: DHW demand moves to match (b). If it doesn't, capture is still broken.

Commit: `Brief 72 P3: occupancy headcount unification + num_bedrooms capture`.

**Part 4 — Schema (auxiliary loads + gain_fraction).**
`ProjectContext.jsx DEFAULT_GAINS`: add `gain_fraction: 1.0` to lighting + equipment profile defaults; add `auxiliary` top-level (empty `profiles: []`). Migration helper for existing projects lacking the fields.
Gate: anchor unchanged (P3 number — which may or may not equal P1 number depending on what P3 surfaced).
Commit: `Brief 72 P4: gain_fraction + auxiliary loads schema (+migration)`.

**Part 5 — Engine wiring.**
`useAnnualGains.js`: emit per-profile `auxiliary_kwh` + `auxiliary_gain_kwh`; apply `gain_kwh = electricity_kwh × gain_fraction` for lighting/equipment/auxiliary; electricity → fuel totals unchanged, gain → existing `internal_gain_kwh` heat-balance path.
**Rule 14 check (mandatory, state it in the commit message):** confirm whether `gain_fraction` enters any `instantCalc.js` State 1 / State 2 / inline-legacy integration loop. If yes, all three states change in this commit. Most likely contained to the gains layer (Rule 14 N/A) — but Code must explicitly confirm which case applies; silent divergence is the failure mode.
Gate: anchor unchanged with `gain_fraction = 1.0` everywhere (B.8 #1); catering @0.50 splits correctly (B.8 #2).
Commit: `Brief 72 P5: gain_fraction engine wiring + auxiliary rollups`.

**Part 6 — Colour token.**
`gainColours.js` (`auxiliary: '#4B5563'` + label) AND `balanceColours.js INTERNAL_COLOURS` (`auxiliary: '#4B5563'`), same commit. `GAINS_ACCENT` untouched.
Commit: `Brief 72 P6: auxiliary colour token (same hex in both palettes)`.

**Part 7 — Auxiliary section UI. [HARD STOP for Chris's walkthrough]**
New `AuxiliarySection.jsx` (modelled on `EquipmentSection.jsx`, no `standby_factor`), with six-item preset picker (defaults per design-note B.3: external lighting 0.00, catering 0.50, pumps 1.00, small power 1.00, lifts 0.85, custom 1.00). Inline `Heat gain: NN%` control per profile row. Mount in `InternalGainsModule.jsx` below Equipment.
Gate: walkthrough items 1–6, 10, 11 (design note B.9).
Commit: `Brief 72 P7: Auxiliary loads section + preset picker`.

**Part 8 — gain_fraction editor on existing sections. [HARD STOP for Chris's walkthrough]**
Inline `Heat gain: NN%` editor on LightingSection + EquipmentSection headers. 0–100 integer percent, tooltip per design note B.2.
Gate: walkthrough items 7, 8; the three-way daylight/gain_fraction non-collapse regression (B.8 #7); lighting anchor byte-equal at `gain_fraction = 1.0` (B.8 #8).
Commit: `Brief 72 P8: gain_fraction inline editor on lighting + equipment`.

**Part 9 — DHW load-shape UI.**
`ServiceSectionHeader.jsx` `DHWServiceFields`: add a `LabeledSelect` mirroring `dhw_demand_basis` (flat / follow_occupancy), with the "annual demand identical, only hourly distribution differs" caption. DHW volume basis stays per-person-per-day at the current default of **80 L/p/day** — Chris has explicitly chosen to leave this unchanged so the effect is visible against a known baseline.
Gate: design note D.4 walkthrough (default flat; follow-occupancy persists across reload; `consumption.brief40.dhw.hourly_kwh` reshapes; annual total unchanged).
Commit: `Brief 72 P9: DHW load shape UI surface`.

**Part 10 — Intervention patch capture.**
`interventions/patchCapture.js`: four gain_fraction/auxiliary regex rows (design note B.7) + the DHW load-shape row (design note D.2). (`num_bedrooms` capture already landed in P3.)
Gate: each field change captured as an intervention without warnings (B.8 #4, D.3 #4).
Commit: `Brief 72 P10: intervention capture for gain_fraction, auxiliary, DHW load shape`.

**Part 11 — Full walkthrough + close.**
Run the complete B.9 + D.4 walkthroughs at `:5178` on Bridgewater, plus the P3 gates re-verified end-to-end (Density change moves DHW; Occupancy intervention does too). Chris signs off. Final report. No code commit beyond any walkthrough-surfaced fixes.

---

## Walkthrough (run at close, `:5178`, Bridgewater)

Use the design note's B.9 (11 items) and D.4 (5 items) verbatim, plus the P3 gates from the headcount unification. Headline gates:
- Internal Gains shows a fourth section "Auxiliary loads" in dark grey `#4B5563`. ✓/✗
- Add → six-item preset picker; Catering seeds `gain_fraction = 50%`. ✓/✗
- Editing a gain_fraction moves the heat balance proportionally; electricity unchanged. ✓/✗
- External lighting @0% raises electricity, heat balance unchanged. ✓/✗
- Lighting/Equipment now show `Heat gain: NN%`; daylight factor still independent. ✓/✗
- Sankey auxiliary node renders `#4B5563`, identical to the header. ✓/✗
- Toggling an auxiliary profile zeros electricity AND gain in the same tick. ✓/✗
- DHW load-shape select present, default flat, follow-occupancy reshapes hourly but not annual. ✓/✗
- Anchor (P1 / P3 number) holds with no auxiliary profiles + gain_fraction 1.0. ✓/✗
- **Internal Gains → Occupancy: the "People per room" field is GONE.** ✓/✗
- **Density 3 → 4 on Bridgewater moves DHW demand from ~210 MWh to ~280 MWh** (proportional to the headcount ratio). ✓/✗
- **Applying an "Occupancy 4" intervention via the Interventions module produces the same DHW change** (capture round-trips correctly). ✓/✗

---

## What MUST NOT happen

- `gain_fraction` and `daylight_factor` merged or routed through a shared helper.
- A single variable carrying both electricity and gain (boundary mismatch).
- Auxiliary colour landing in only one of the two palette files.
- The anchor "preserved" by adjusting the engine to hit a number rather than by leaving the path untouched.
- Occupancy gaining a `gain_fraction` field (out of scope — double-controls latent split).
- The DHW volume default being changed off 80 L/p/day (Chris wants the visible effect).
- Any of the three deferred load types (BMS/IT/EV) or the three register fixes sneaking in.
- Quiet scope expansion — if something new surfaces, it's a Tier-3 note for a later brief, not an extra commit here.
- `people_per_room` being kept as a "convenience" or "sensitivity lever" — it is being retired by design. Adding a multiplier-on-top later is a deliberate Brief 74+ decision, not an in-flight rescue.
- A second occupant headcount being introduced anywhere — gains, DHW, ventilation MUST all read the same unified value.
- The H1 (engine cross-wire) hypothesis being "patched" inside Brief 72 if it confirms. That's a Tier-3 split-out, not a P2b.

---

## Escalation triggers

- Anchor moves at any part and you cannot reconcile it → STOP, short diagnostic to Chris (Tier 2), do not commit. **Exception:** if the P3 anchor moves vs P1 because the engine WAS reading the phantom `people_per_room = 1.5`, that is the expected, documentable rebaseline; capture the new number as the canonical anchor and proceed, with the movement explained from first principles in the audit.
- **P2 discriminator returns H1 (engine cross-wire)** → STOP. Tier 3 escalation, separate brief. Do NOT attempt P2b or P3 until that brief lands.
- `gain_fraction` turns out to enter an `instantCalc.js` integration loop (Rule 14 fires) → land all three states together; if that balloons, escalate to Chris before proceeding.
- P3 reveals more than just the `num_bedrooms` capture gap (e.g. five+ engine-read building.* fields are uncaptured) → STOP, surface, decide whether to expand P3 or split the capture-parity work into its own brief.
- Three approaches tried on any single failure without resolution → escalate, don't keep iterating.
- Anything that would require touching the systems→fuel inversion or the demand engine itself → STOP; that's beyond this brief's gains-layer scope.

---

## Final report (at close)

Commit SHAs per part; the captured anchor number and confirmation it held at every gate; the Rule 14 determination (contained vs three-state) with evidence; walkthrough ✓/✗ table; any Tier-3 items surfaced for future briefs.
