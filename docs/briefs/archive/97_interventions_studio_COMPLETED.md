# Brief 97: Interventions Studio — Module Redesign + RICS Cost Editor (Pop-Out)

**Canonical design note (wins over this brief):** Notion — "Design note: Interventions Studio — module redesign + cost editor as pop-out (supersedes Brief 91 UX-freeze)" on the NZA-Sim product page.
**Supersedes:** Brief 91 (`91_cost_plan_builder.md`) and the 91b stub/editor drafts. This brief CARRIES 91's cost-editor content verbatim (below) but overrides its two fixed choices: editor is a **pop-out** (not inline) and the module layout **is redesigned** (91's UX-freeze clause does not apply).

## UNATTENDED MODE
Chris is asleep. No human gates tonight. Any escalation trigger → STOP that thread, write to `docs/report/97_OVERNIGHT_FINDINGS.md`, continue other independent threads if safe. All UI verification via MCP browser tools on **ZZ TEST — do not use**; never Chris's live projects. Commit + push after every Part; the morning state must be git-reconstructable.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote title + Goal.
2. **Precondition:** on `chris/cost-plan-editor` branch, cut from post-96 `main`. If a `91b_*` brief is landed in `active/`, `git rm` it (superseded) in Part 1. If any 91b code work was already committed on this branch, report what — do NOT build on top of it blind.
3. Land THIS brief at `docs/briefs/active/97_interventions_studio.md` as Part 1's first commit.
4. Read CLAUDE.md, STATUS.md, the design note content (mirrored below). Session-start reconciliation.
5. Baseline: `--fixture` anchor byte-identical at start and close (this brief touches zero physics).

## Goal
Turn the Interventions module from a grey-scroll into a designed, tabbed workspace, and replace the transitional headline cost card with the full RICS/NRM2 cost editor built as a pop-out window. By morning: Library isolated view is tabbed with semantic colour; Strategy view shares the visual system with a cleaned-up validate panel; the cost editor pops out, does hierarchical line-item build-ups seeded from HIEX rates, and the old headline editor + transitional dual-path are gone from main.

## Scope
**IN:** Library isolated view → tabs (Impact/Carbon/Demand/Cost) + semantic colour · Strategy view restyle + validate-panel cleanup · RICS cost editor as pop-out (91's content, below) · lossless migration off the headline model · delete headline editor + `computeCostPlanTotal` transitional dual-path · HIEX-seeded cost templates · the 3.3 "EP-checked" flag rename rider.
**OUT:** engine/physics (`instantCalc.js` untouched) · re-architecting the Brief 94 decoupling or Brief 95 EP machinery (restyle only) · multi-strategy · report-export changes · NPV.

## Design decisions already agreed
1. **Isolated view = tabs**, not scroll: **Impact · Carbon · Demand · Cost**. One thing at a time.
2. **Semantic colour** everywhere numbers live: green = saving/positive, red = increase/negative, bold = headings & totals, consistent cost treatment. Kill uniform grey. Keep the existing module accent.
3. **Cost editor = pop-out window** (same pattern as intervention/system editors), NOT inline in PerInterventionView.
4. **Cost math = Brief 91's NRM2 model** (verbatim below), seeded from **HIEX benchmark rates** (Brief 96). Applemore is dead.
5. EP "not yet run" empty-state messaging (already correct) is preserved; the validate panel is restyled, not re-plumbed.

## Principles
- Restyle ≠ re-architect. The decoupling (94) and EP backend (95) keep their logic; 97 changes presentation.
- Reuse the Brief 94 reorder pattern (y-only hit-testing, cursor-at-release, pending spinner) for any drag in the cost editor — do not reinvent.
- One Part = one commit. Semantic-colour tokens defined once, reused.

---

## PART 1: Land brief, supersede 91b, flag-rename rider
1. Land this brief; `git rm` any superseded `91b_*` brief file in active/ (keep `91_cost_plan_builder.md` in archive as the content source — do not delete).
2. **Rider (Brief 96 review):** in the report export, rename flag "EP-validated ✓" → "EP-checked — see Table 3" wherever NZA/EP EUI divergence >25% (currently 3.3 setpoints). Isolated change.
3. Commit: `Brief 97 P1: brief landed, 91b superseded, 3.3 flag rename`.

## PART 2: Semantic colour system + shared tokens
1. Define a small semantic-value helper/token set: `saving` (green), `increase` (red), `heading`/`total` (bold navy), `cost` (consistent treatment), `muted` (the current grey, now used sparingly for labels only).
2. Apply as the foundation both views build on. Numbers that represent a delta pick colour by sign; headings and totals go bold; grey is demoted to axis/label text only.
3. Commit: `Brief 97 P2: semantic colour tokens`.
**Falsifiable (ZZ TEST):** a saving renders green, an increase red, totals bold — screenshot Library + Strategy showing colour, not a grey wall.

## PART 3: Library isolated view → tabs
1. Replace the scroll with a tab strip: **Impact · Carbon · Demand · Cost** (match the Strategy right-panel tab pattern already in the tool).
2. **Impact:** the four headline cards (lifetime carbon, £/tCO₂e, kWh saved/EUI Δ, payback) — now with semantic colour.
3. **Carbon:** the trajectory chart alone, breathing.
4. **Demand:** the demand-by-service Δ table — green/red by sign, bold totals.
5. **Cost:** a summary of the intervention's cost plan (total + tier + confidence) with an **"Edit cost plan →" button that opens the pop-out** (Part 5). No inline editing here.
6. Preserve the EP empty-state messaging in Impact where a config hasn't been run.
7. Commit: `Brief 97 P3: isolated view tabbed (Impact/Carbon/Demand/Cost)`.
**Falsifiable (ZZ TEST):** no vertical scroll to see any metric; tabs switch; each tab shows one focused view; DHW-ASHP selected → Cost tab shows its plan total.

## PART 4: Cost data model + lossless migration (Brief 91 content)
*(Verbatim from Brief 91 P1–P3 — the data layer, already partly on main; complete and verify it.)*
1. Cost plan = ordered **groups** → ordered **line items**. Line item: `{ description, qty, unit, rate, on_cost_pct? }`; unit ∈ {nr, m², m, kW, l/s, day, item, %}. Group total = Σ lines; on-cost lines compute as % of a referenced subtotal. Plan total = Σ groups. Low/central/high carried per line where the source gives a range.
2. **Migrate-on-read:** the transitional headline shape (Design & engineering / Main equipment / Installation / Additional / Project delivery / Contingency) → grouped model, lossless, idempotent, old shape never rewritten.
3. Commit: `Brief 97 P4: cost data model + lossless headline migration (idempotent)`.
**Falsifiable:** fixture test — the current ZZ TEST headline plan (£215,040) migrates to grouped model summing to £215,040 ±£1; load-twice migrates once.

## PART 5: RICS cost editor — POP-OUT (Brief 91 content, rehomed)
*(Brief 91 P4's editor, built as a pop-out window instead of inline.)*
1. Pop-out window (same launch pattern as the intervention/system editors). Hierarchical table: groups with drag-reorder (Brief 94 pattern) and collapse; line items with drag-reorder within a group; **unit-adaptive rate label** (£/m², £/nr, £/kW, £/day … follows the row's unit); on-cost override cells; ⋮ row menus (duplicate, delete, move).
2. Live totals: line → group → plan, semantic-coloured, updating as you type.
3. **Delete the old `HeadlineCostEditor` and its mount in PerInterventionView; strip BOTH transitional `computeCostPlanTotal` blocks** ("removed in P4" markers). This lifts the Brief 91b quarantine.
4. **Worked-example acceptance (from Brief 91):** an ASHP plan built from line items — 4 × ASHP @ £14k equipment, install days @ day-rate, pipework, electrical, on-costs — totals to the region of the spec's **£95,941** central. And the HIEX **1.4 DHW ASHP** seeded plan (~£105k) renders/edits/re-totals correctly.
5. Commit: `Brief 97 P5: RICS cost editor as pop-out; headline editor + dual-path deleted`.
**Falsifiable (ZZ TEST):** pop-out opens; build the ASHP example from scratch → total lands right; grep confirms zero `HeadlineCostEditor` refs and no transitional block remains; `--fixture` anchor still byte-identical.

## PART 6: Keyboard discipline (Brief 91 P5 content)
1. Tab/Shift-Tab across the dynamic table; Enter → new line in group; Cmd/Ctrl+Enter → new group; ↑↓ increment/decrement focused number; Esc → revert the field.
2. **Known risk (from Brief 91):** this fights React/DOM defaults. Per behaviour: if it resists past 3 attempts, STOP that one behaviour, document in OVERNIGHT_FINDINGS, move on. A missing keystroke does not block the editor.
3. Commit: `Brief 97 P6: cost editor keyboard discipline (best-effort, documented)`.

## PART 7: HIEX-seeded templates + "fill from defaults"
1. Derive type-default rates from the HIEX benchmark lines (per category: £/kW, £/m², £/nr, £/(l/s), day-rates, on-cost %s), sources carried as strings.
2. "Fill % lines from defaults" and new-line rate suggestions draw from these. Template save/apply (Brief 91 P6 — data helpers already exist).
3. Commit: `Brief 97 P7: HIEX type-default rates + template save/apply`.

## PART 8: Strategy view restyle + validate-panel cleanup
1. Apply the semantic colour system + shared visual language to the Strategy list and headline metrics row.
2. Restyle the "Validate with EnergyPlus" panel: the checkbox stack becomes a clean selection UI (grouped, readable run-count line, clear Run affordance). **Logic untouched** — same routes, same hash/cache behaviour from Brief 95; presentation only.
3. Commit: `Brief 97 P8: strategy view restyle + validate panel cleanup`.
**Falsifiable (ZZ TEST):** Strategy reads as designed (colour, hierarchy); validate panel still computes correct run counts and Run still starts a batch.

## PART 9: Close
1. `--fixture` anchor byte-identical to P1. Any drift → do not close, escalate.
2. STATUS.md; archive this brief + the superseded 91/91b set; current.md; push; open PR to main — NOT merged.
3. `97_OVERNIGHT_FINDINGS.md`: what completed, any keyboard behaviours dropped, screenshots of the before/after, anything for Chris to sanity-check.

## MUST NOT
Engine/physics edits · re-architect 94 decoupling or 95 EP logic (restyle only) · leave the headline editor or transitional dual-path on main · hand-edit Chris's live projects (ZZ TEST only) · invent cost rates (HIEX/91 only) · merge unattended · block on browser gates (stop-and-write instead).

## Escalate (stop-and-write)
Keyboard 3-strikes per behaviour · migration meets a cost shape the fixture doesn't cover · any acceptance total off the 91/HIEX central by >2% · `--fixture` anchor drift · the pop-out pattern can't be reused cleanly from the existing editors.

## Independent review (mandatory — data-layer deletion + cost math)
Morning, Claude Chat reads on GitHub: the migration + its fixture test, the headline-editor/dual-path deletion diff (nothing else lost), the cost-total math (line→group→plan, on-costs), the pop-out reuse vs the existing editor pattern, and both invariants. The agent that built it does not grade it.

## Close
Archive · STATUS · current.md · PR open · Chris walkthrough on ZZ TEST: tabbed isolated view (no scroll) · semantic colour reads right · open cost pop-out · build the ASHP plan · template round-trip · Strategy restyle · validate panel still runs.
