# Brief 74 — Energy Flows auxiliary + Heat Balance mech vent loss ribbon

**Author:** Claude Chat (architect)
**Authorised by:** Chris (1 June 2026, post-Brief-73 close walkthrough)
**Provisional number:** 74. Renumbering rolls: the previously-planned interventions diagnostic harness becomes Brief 76; door bug stays Brief 75; WWHR becomes Brief 77.
**Design note (canonical):** https://www.notion.so/372d645e05cc814cb837dde20a22a161 — "Brief 74 design note: Energy Flows auxiliary + Heat Balance mech vent loss ribbon". Where this brief and the note disagree, the note wins.
**Lineage:** Closes the two remaining gaps from Brief 73's walkthrough (items 7/8 deferred-acknowledged + the freshly-surfaced mech vent loss ribbon). Builds on Brief 72's auxiliary engine layer and Brief 73's Sankey edits; modifies neither.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and first paragraph back. State tip of `main` SHA (expected: Brief 73 close commit).
2. **STATUS.md is fresh** (reconciled at Brief 73 P11). Land this brief on disk at `docs/briefs/active/74_sankey_topology_gaps.md` as Part 1's first commit. Open audit stub `docs/audit/74_sankey_topology_gaps.md`.
3. **Capture the current anchor.** Run Bridgewater clean, record full anchor table. Expected starting point per Brief 73 close: EUI ~133.6 kWh/m²·yr, Σ electricity ~346.4 MWh, Σ gas ~204.7 MWh, vent fan total ~42 MWh, Heat Balance Σ gains ~488 MWh, Σ losses ~472 MWh, auxiliary electricity ~78 MWh.
4. **Diagnose before fixing; audit before fixing.** Both findings need source-reading before any code change. Parts 2 and 4.
5. **Ports unchanged.** Frontend 5176/5178, backend 8002, `go.bat`.
6. **Browser verification is Code's job per the Bible.** Code self-verifies via MCP browser tools. Chris does the close walkthrough.

---

## Scope

Two Sankey-topology gaps, bundled per Chris's request:

1. **Energy Flows Sankey missing Auxiliary row.** `_calculateState3` doesn't emit `systems_flow`, so the Energy Flows Sankey can't render Auxiliary (or any v40-emitted system data). This is the deferred-acknowledged gap from Brief 73 items 7/8.
2. **Heat Balance Sankey shows no mech ventilation as a loss path.** OUT-Losses side renders fabric + infiltration + permanent vents + cooling, but mechanical ventilation (extract heat carried out, only partially recovered by MVHR) is absent. This is a freshly-surfaced finding from the Brief 73 walkthrough — the heat balance has been structurally incomplete since before Brief 73.

**Out of scope:** any Sankey redesign beyond adding the missing ribbons; DHW load-shape toggle bug (Brief 72 P9 follow-on, stubbed); door bug (Brief 75); interventions diagnostic harness (Brief 76); WWHR (Brief 77); lighting room-vs-communal split; any engine demand recalculation.

---

## Principles

1. **Diagnose before fix.** Both findings get a source-read part before any code change.
2. **Visualisation only, never engine.** The mech vent heat loss is already computed by the engine (otherwise heating demand would be wrong). The ribbon reads from an existing value; do NOT add a new heat-loss term to the engine or modify any demand calculation. Same applies to `systems_flow` — port the data shape, don't change what the engine computes.
3. **No double-counting.** The Sankey IN-Gains and OUT-Losses must continue to balance (currently +16 MWh balanced per Brief 73 P11). Adding the mech vent loss ribbon must be accompanied by confirming the gain side already includes whatever offset (or that the existing residual was hiding the imbalance). Net (gains − losses) should remain approximately balanced; if it improves substantially that's evidence the ribbon was a missing real loss.
4. **Same gain/loss = same colour everywhere.** Mech vent loss colour: reuse the existing ventilation colour token from the systems palette (`Sankey: Mech vent` already appears in Energy Flows Sankey image 2 in a teal — read the actual hex from `balanceColours.js` or wherever vent's loss colour lives, don't pick a new one).
5. **Boundary discipline.** `systems_flow` is a render data shape, not an engine field. Port the emission, don't reshape the engine.
6. **Anchor: capture, don't hardcode.** Bridgewater's Heat Balance Σ losses will rise in Part 5 when the mech vent ribbon lands. That's the canonical new anchor. Don't tweak anything to preserve the old number.
7. **No quiet scope expansion.** Anything else surfaced is a Tier-3 note for a future brief.

---

## Parts (each = one commit unless noted)

**Part 1 — Precondition + anchor capture.**
Land brief on disk. Open audit stub. Run Bridgewater clean. Record full anchor in audit §1 (EUI, fuel splits, all per-service rollups, Heat Balance Σ gains + Σ losses + Net residual, Energy Flows Σ elec + Σ gas).
Commit: `Brief 74 P1: STATUS reconcile + Bridgewater anchor capture + brief landing`.

---

### Findings 1 — Energy Flows Sankey auxiliary

**Part 2 — `systems_flow` diagnostic (read-only).**
Read source to identify:
- Where does `systems_flow` get emitted in legacy / State 2 paths? Likely `instantCalc.js _calculateState2` or a sibling helper.
- Why doesn't `_calculateState3` emit it? Was it forgotten in the v40 migration, deliberately deferred, or structurally incompatible with State 3's shape?
- What does the Energy Flows Sankey component consume? Field paths, expected shape.
- What would the minimal `systems_flow` emission look like in `_calculateState3` to satisfy the Sankey consumer?

Report findings in `docs/audit/74_*.md` §2-diagnostic with file + line refs. **Do not change code.**
Commit: `Brief 74 P2: systems_flow port diagnostic (read-only)`.

**Part 3 — `systems_flow` port + Auxiliary row.**
Port the minimum `systems_flow` emission from State 2 (or equivalent) into `_calculateState3`. Add Auxiliary as a Demand-column entry, magnitude `internal_gains.auxiliary_kwh`, carrier = Electricity. Use the existing colour token from `gainColours.js auxiliary` (`#4B5563`) — already registered per Brief 72 P6.

**Gates:**
- (a) Energy Flows Sankey on Bridgewater renders the Auxiliary row in `#4B5563` on the Demand column.
- (b) Σ elec figure in the Sankey header has risen by the auxiliary electricity contribution.
- (c) Setting Catering load to 0 W/m² collapses the Auxiliary row visibly.
- (d) Anchor preserved for everything else: Heat / Cool / DHW / Vent / Lighting / Small Power demand and electricity totals unchanged from Part 1; only Σ elec shifts by the auxiliary contribution (which was already in the electricity total, just not rendered on this Sankey).
- (e) State 1 / State 2 / inline-legacy paths untouched (Rule 14 check — same applies to data-shape emissions, not just integration loops).

Commit: `Brief 74 P3: systems_flow port to State 3 + Energy Flows auxiliary row`.

---

### Findings 2 — Mech ventilation as a heat loss path

**Part 4 — Mech vent loss diagnostic (read-only).**
Read source to identify:
- Where does the engine compute mech ventilation heat loss? Likely `systemsEngine.js _computeVentilation` (per Brief 73 P2 diagnostic) or in the State-2 heat balance assembly that produces `heat_balance.annual.losses`.
- What field on the engine output represents mech vent heat loss? Is it aggregated (single number) or per-system (one per vent system)?
- Is it included in the current Heat Balance Sankey OUT-Losses computation but rendered at zero width, or is it missing from the data path entirely?
- What's the upstream component that hands losses to `HeatBalance.jsx` / `BalanceSankey.jsx`? Confirm where the new "Mech ventilation" entry should be inserted in the loss array.
- Independent reconciliation: compute the expected mech vent heat loss from first principles for Bridgewater (flow rate × ΔT × (1 − HRE) × hours, summed across three vent systems). Compare against whatever the engine reports. If they agree within ~5%, the engine number is trustworthy and the ribbon is genuinely visualisation-only. If they disagree, document the gap — STOP and escalate, do not attempt to fix engine demand calculations in this brief.

Report findings in `docs/audit/74_*.md` §4-diagnostic with file + line refs. **Do not change code.**
Commit: `Brief 74 P4: mech vent loss ribbon diagnostic (read-only)`.

**Part 5 — Mech vent loss ribbon in Heat Balance Sankey.**
Add "Mech ventilation" as an OUT-Losses ribbon on the Heat Balance Sankey. Magnitude reads from whatever field P4 identified. Position in the loss array adjacent to Infiltration (both are air-movement losses; group visually). Colour: reuse the existing vent colour token used elsewhere in the model (teal-ish, identified in P4).

**Three render sites to check** (Brief 73 P5-redux exposed this pattern — multiple sites consume the same data):
- `HeatBalance.jsx` flatten / loss loop
- `BalanceSankey.jsx` loss render loop
- `HeatBalanceView.jsx` `ChartTotalsBadge` Σ-losses tally
- Any per-loss legend / right-strip breakdown that enumerates losses

All four (or however many P4 finds) must include the new entry.

**Gates:**
- (a) Heat Balance Sankey on Bridgewater shows a Mech ventilation ribbon on the OUT-Losses side in vent teal.
- (b) Σ losses in the badge has risen vs Part 1 anchor by the mech vent heat loss contribution.
- (c) Net (gains − losses) residual: was +16 MWh balanced per Brief 73 close; should now be substantially smaller (closer to zero) if the mech vent loss was the missing term in the balance. If the residual becomes large-negative or flips sign meaningfully, that's evidence of double-counting — STOP and diagnose.
- (d) Disabling all three vent systems collapses the Mech ventilation ribbon to zero. Toggling bedroom_extract HRE from 0% to 75% reduces the ribbon by the proportional amount.
- (e) Anchor preserved for everything else: gains side unchanged, fabric loss ribbons unchanged, infiltration unchanged, permanent vents unchanged.

Commit: `Brief 74 P5: mech ventilation loss ribbon in Heat Balance Sankey`.

---

### Close

**Part 6 — Walkthrough + close. [HARD STOP for Chris's walkthrough]**

Code self-verifies both findings via MCP browser tools and logs results in audit §6. Then Chris's walkthrough at :5176:

1. Systems → Energy Flows Sankey: Auxiliary row visible in `#4B5563` on Demand column. ✓/✗
2. Σ elec on Energy Flows Sankey has risen by auxiliary contribution. ✓/✗
3. Setting Catering load to 0 collapses the Auxiliary row; restore. ✓/✗
4. Internal Gains → Heat Balance Sankey: Mech ventilation ribbon visible in vent teal on OUT-Losses side, adjacent to Infiltration. ✓/✗
5. Σ losses on Heat Balance has risen by mech vent contribution. ✓/✗
6. Net (gains − losses) residual is approximately balanced or closer to zero than pre-Brief-74. ✓/✗
7. Disabling all three vent systems collapses the Mech ventilation ribbon. ✓/✗
8. Toggling bedroom_extract HRE 0% → 75% reduces the ribbon proportionally; restore. ✓/✗
9. Heating system share validation still works (regression check — drag a heating share, warning fires). ✓/✗

If any item fails, treat as Tier-2 within the brief: short diagnostic, bounded fix, re-verify. Don't expand scope.

Commit: `Brief 74 P6: close + walkthrough + archive`. Archive `git mv docs/briefs/active/74_*.md docs/briefs/archive/74_*_COMPLETED.md`. Update STATUS.md. Repoint `current.md`.

---

## What MUST NOT happen

- Any change to engine demand calculations (heating, cooling, DHW, ventilation flow). The mech vent loss is a visualisation of an existing engine number, not a new term.
- Double-counting: the Net residual must not swing far negative when the loss ribbon is added. If it does, STOP — that means the gain side is already accounting for what we're now adding as a loss.
- A new colour token registered for either auxiliary (already in palettes per Brief 72 P6) or vent loss (already used in Energy Flows Sankey).
- The `systems_flow` port reshaping State 3's existing emissions. Pure addition.
- Heating/Cooling/DHW share validation being weakened.
- DHW volume default moved off 80 L/p/day.
- Any of the out-of-scope items (DHW load-shape, door, harness, WWHR, lighting split) sneaking in.
- Quiet scope expansion — Tier-3 notes go in audit §future.

---

## Escalation triggers

- **Part 4 finds the engine's mech vent heat loss disagrees with first-principles reconciliation by >5%** → STOP. That's a real engine bug, escalate as a separate brief, do not patch here.
- **Part 5 Net residual swings to large negative after adding the loss ribbon** → STOP, double-counting detected, diagnose before continuing.
- **`systems_flow` port turns out to require restructuring State 3's shape** → that's State 3 redesign territory, escalate.
- **Three approaches tried on any single failure** → escalate.

---

## Final report (at close)

Commit SHAs per part. Anchor table showing P1 (before) vs P5 (after both fixes). Net residual movement before vs after. Walkthrough ✓/✗ table. Any Tier-3 items.
