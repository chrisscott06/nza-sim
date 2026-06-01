# Brief 77 — Per-system ventilation loss rendering (Heat Balance)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, post-Brief-76 walkthrough)
**Provisional number:** 77. Numbering rolls: door bug becomes Brief 78; interventions diagnostic harness becomes Brief 79; WWHR becomes Brief 80; EnergyPlus validation harness becomes Brief 81.
**Design note (canonical):** https://www.notion.so/372d645e05cc813596f2c49b422c1e46 — "Brief 77 design note: Per-system ventilation loss rendering". Where this brief and the note disagree, the note wins.
**Lineage:** Follow-on to Brief 76. Brief 76 fixed the engine so `losses_at_setpoint.ventilation[]` is populated with three entries on Bridgewater. Brief 74 P5's double-count guard then collapsed those three entries into a single aggregated "Mech ventilation 326.2 MWh" ribbon in the Heat Balance display. Chris wants the three per-system ribbons back (visible in his pre-Brief-74 client report) across all Heat Balance view modes.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and first paragraph. State tip of `main` SHA (expected: Brief 76 close commit `ccc2e72`).
2. **STATUS.md** — confirm reconciled at Brief 76 close.
3. **Land brief on disk** at `docs/briefs/active/77_per_system_vent_rendering.md` as P1's first commit. Open audit stub at `docs/audit/77_per_system_vent_rendering.md`.
4. **Capture pre-fix anchor.** Bridgewater Heat Balance: confirm single aggregated "Mech ventilation 326.2 MWh" ribbon visible in Sankey view, confirm `losses_at_setpoint.ventilation[]` contains three entries summing to ~326 MWh.

---

## Scope

Restore per-system ventilation loss rendering across all three Heat Balance view modes (Sankey, Rows, Stacked). When `losses_at_setpoint.ventilation[]` is non-empty, render one ribbon/row per entry (each labelled per the system's v40 `label` field). When empty, fall back to the aggregated `losses.mech_ventilation` rendering. **Never both** — mutual exclusion preserves the Brief 74 P5 double-count guard's intent while restoring visual fidelity.

**Out of scope:** any change to engine output schema; per-system display for other loss types (infiltration, permanent vents, fabric); MVHR recovery as IN-side ribbon (still Brief 75 P4 territory, deferred); door bug; harness; WWHR; EnergyPlus integration.

---

## Principles

1. **Three views, same data, same rendering shape.** Sankey, Rows, Stacked must all show the same three ribbons/bars. If the data has three entries, the display has three entries. No view-mode-specific exceptions.
2. **Mutual exclusion preserves Brief 74 P5's guard intent.** Per-system XOR aggregate. Never both. The guard was added to prevent double-counting; this brief replaces it with a more precise condition (per-system if available, aggregate as fallback).
3. **v40 label wins.** Per the Brief 50 / Brief 59 pattern, the system's v40 `label` is the user-facing name (e.g. "MVHR GF Public", "Bedroom Extract", "Public Toilet Extract" — or whatever Chris has typed). Don't surface internal ids like `vent_mvhr_gf_public`.
4. **Anchor: capture, document.** Σ losses on Heat Balance must remain at 326 MWh ±1 MWh post-fix — what changes is the breakdown, not the total. If the total moves, double-counting has slipped in.
5. **No engine changes.** This is pure display work. Engine output is correct as Brief 76 left it.

---

## Parts (each = one commit unless noted)

**Part 1 — Precondition + anchor capture.**
Land brief on disk. Open audit stub. Run Bridgewater clean. Record full pre-fix anchor in audit §1:
- Heat Balance Sankey view: confirm aggregated "Mech ventilation 326.2 MWh" ribbon present.
- Heat Balance Rows view: confirm aggregated row.
- Heat Balance Stacked view: confirm aggregated segment.
- `losses_at_setpoint.ventilation[]` JSON dump: three entries with system labels and per-system `heat_loss_kwh` summing to ~326 MWh.
- Σ losses, Σ gains, Net residual.

Commit: `Brief 77 P1: pre-fix anchor + brief landing`.

---

**Part 2 — Diagnostic read (read-only).**

Read source. Identify and report in audit §2 with file + line refs:

- **Brief 74 P5's guard at `HeatBalance.jsx:194-195`.** Current logic, exact condition that suppresses per-system. Confirm it gates on aggregate-non-zero.
- **Three render sites that need updating** (Brief 73 P5-redux pattern — multiple render sites consume the same data):
  - `HeatBalance.jsx` flatten/loop for Rows view
  - `BalanceSankey.jsx` loss render loop for Sankey view
  - `HeatBalanceView.jsx` (or wherever Stacked view renders) — find the equivalent loss enumeration
  - `ChartTotalsBadge` Σ-losses tally (if it independently sums losses)
- **Per-system data shape.** What fields does each `losses_at_setpoint.ventilation[i]` entry have? Specifically: `name`, `label`, `heat_loss_kwh`, anything else relevant for rendering.

Report findings. **Do not change code.**

Commit: `Brief 77 P2: per-system rendering diagnostic (read-only)`.

---

**Part 3 — Replace guard with mutual-exclusion logic.**

Per P2's findings, edit each render site to apply this logic:

```
if losses_at_setpoint.ventilation is non-empty AND sum of per-system heat_loss_kwh > 0:
    render one entry per system, using v40 label
    do NOT render aggregate losses.mech_ventilation
else:
    render aggregate losses.mech_ventilation (existing behaviour, fallback for engine paths that don't emit per-system)
```

All three view modes (Sankey, Rows, Stacked) get the same logic. The ΣTotalsBadge or equivalent sums per-system entries when present.

**Gates:**
- (a) Heat Balance Sankey view shows three OUT-side ribbons labelled per Bridgewater's three vent systems, summing to ~326 MWh. Aggregate "Mech ventilation" pseudo-entry no longer rendered.
- (b) Heat Balance Rows view shows three rows for the three vent systems with the same labels and magnitudes.
- (c) Heat Balance Stacked view shows three segments for the three vent systems.
- (d) Σ losses on all three views matches Part 1 anchor (~326 MWh ±1 MWh). Net residual unchanged.
- (e) Toggling all three vent systems OFF: all per-system ribbons collapse, aggregate fallback ribbon does NOT appear (because aggregate is also zero). Σ losses drops by ~326 MWh.
- (f) Toggling just `mvhr_gf_public` OFF: only that system's ribbon disappears; other two remain.

Commit: `Brief 77 P3: per-system ventilation rendering across Sankey/Rows/Stacked`.

---

**Part 4 — Walkthrough + close. [HARD STOP for Chris's walkthrough]**

Code self-verifies via MCP browser tools and logs in audit §4. Then Chris's walkthrough at `:5176`:

1. Internal Gains → Heat Balance → **Sankey** view: three labelled vent ribbons on OUT side, summing to ~326 MWh. ✓/✗
2. Heat Balance → **Rows** view: three vent rows visible with same labels. ✓/✗
3. Heat Balance → **Stacked** view: three vent segments visible. ✓/✗
4. Labels match Bridgewater's three vent systems (whatever Chris has named them in v40 — MVHR GF Public / Bedroom Extract / Public Toilet Extract or similar). ✓/✗
5. Σ losses on each view: ~326 MWh (unchanged from Part 1 anchor). ✓/✗
6. Toggle `mvhr_gf_public` off: its ribbon disappears across all three views; heating demand rises modestly (less recovery, more loss to compensate). Restore. ✓/✗
7. Toggle all three vent systems off: all three ribbons disappear, NO aggregate ribbon appears as fallback, Σ losses drops by ~326 MWh. Restore. ✓/✗
8. Brief 76 anchor preserved: EUI ~143.5 kWh/m²·yr, heating demand ~98 MWh, mech vent total ~326 MWh. ✓/✗
9. Brief 73 regression check: ventilation share validation still absent (no Σ chip, no Normalise button). ✓/✗
10. Brief 74 regression check: auxiliary row still visible on Energy Flows Sankey. ✓/✗

If any item fails, treat as Tier-2 within the brief: short diagnostic, bounded fix, re-verify. Don't expand scope.

Commit: `Brief 77 P4: close + walkthrough + archive`.
Archive: `git mv docs/briefs/active/77_*.md docs/briefs/archive/77_*_COMPLETED.md`. Update STATUS.md. Repoint `current.md` to placeholder.

---

## What MUST NOT happen

- Both per-system AND aggregate rendered simultaneously (double-count). The whole point of the mutual-exclusion logic.
- Engine output schema changing. This is display only.
- Σ losses changing in magnitude. Only the breakdown changes.
- A new colour token registered for vent loss. Use whatever colour the existing aggregate vent loss ribbon uses (`emerald-700` per Brief 74 P5).
- View-mode-specific divergence — if Sankey shows three and Rows shows one aggregate, that's a bug.
- Brief 74 P5's guard removed entirely without replacement. The guard's intent (no double-count) must be preserved by the mutual-exclusion logic.
- Internal system IDs (`vent_mvhr_gf_public` etc.) being surfaced as user-facing labels. Use the v40 `label` field per the Brief 50/59 pattern.
- Per-system display for any OTHER loss type sneaking in (infiltration, permanent vents, fabric). Out of scope.
- The aggregated `losses.mech_ventilation` field being deleted from engine output. It stays as fallback for engine paths that don't emit per-system.
- Quiet scope expansion.

---

## Escalation triggers

- **P2 finds the three render sites don't share consistent data flow** (e.g. Sankey reads `losses_at_setpoint.ventilation[]` but Rows reads something else entirely) → STOP, document architecture before changing code. May need a small refactor brief instead.
- **P3 mutual-exclusion logic causes Σ losses drift > 1 MWh** → STOP, double-counting has slipped in.
- **Three approaches tried on any single failure** → escalate.
- **Anchor moves anywhere unexpected** → STOP, short diagnostic.

---

## Final report (at close)

Commit SHAs per part. Pre-fix vs post-fix anchor comparison (only the rendering changed; Σ stayed). Walkthrough ✓/✗ table. Any Tier-3 items.
