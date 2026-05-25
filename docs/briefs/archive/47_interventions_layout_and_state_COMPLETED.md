# Brief 47 — Interventions module: faithful state display + inputs-left / visualiser-right layout

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part brief. Builds directly on Brief 46.
**Date opened:** 2026-05-24
**Target outcome:** The Interventions module works the way every other module works — inputs on the left, a big live visualiser on the right, detail in draggable pop-outs that can be moved off-screen so the visualiser stays visible. An intervention faithfully shows its own state: reopen one and the controls show the saved values (not baseline), an always-visible change list says in plain English what it does, and the left nav + individual controls flag what's been changed. You can delete an intervention. The right-hand visualiser shows the impact through several point-in-time views (waterfall, before/after, and live physics sanity views) so you can engage your brain and check the physics as you edit.

After this brief lands: Chris builds an intervention, sees every change he makes flagged in the nav and on the control, watches the right-hand visualiser move as he drags, closes it, reopens it days later and it shows exactly what he set. The module is finally usable for real consultancy.

---

## BEFORE DOING ANYTHING

0. **Run the session-start documentation reconciliation pass (mandatory).** Per Process Rule 8:
   - `ls docs/briefs/active/` — should be empty (Brief 46 archived)
   - `cat docs/briefs/current.md`
   - `tail -50 STATUS.md`
   - `git log --oneline -20`
   - If any check fails, the first commit of the session is the cleanup commit.

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Module Scopes Interventions, and the verification disciplines.
3. Read the Notion design note: **NZA-Sim — Interventions module: inputs-left / visualiser-right + draggable pop-outs (Brief 47 design note)** (URL: https://www.notion.so/36ad645e05cc81e89a40c9fdc4792a71). This is the canonical reference. It captures the full design conversation with Chris on 24 May. If anything here disagrees with the design note, the design note wins.
4. Read the Brief 46 artefacts you are building on:
   - `frontend/src/context/InterventionCaptureContext.jsx`
   - `frontend/src/context/PatchedProjectContextProvider.jsx`
   - `frontend/src/hooks/useProjectMutation.js`
   - `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` (the V2 editor, now canonical name)
   - `frontend/src/components/modules/interventions/EditorNav.jsx`
   - `frontend/src/components/modules/interventions/EditorFooter.jsx`
   - `frontend/src/components/modules/interventions/PatchedInputBadge.jsx`
   - `frontend/src/components/modules/interventions/sections/*` (BuildingSection, InternalGainsSection, OperationSection, SystemsSection)
   - `frontend/src/components/modules/interventions/InterventionsModule.jsx`
   - `frontend/src/components/modules/interventions/InterventionStackView.jsx`
   - `frontend/src/components/modules/interventions/InterventionRow.jsx`
   - `frontend/src/components/modules/interventions/ComparisonView.jsx`
   - `frontend/src/components/modules/interventions/EUIWaterfall.jsx`
5. Read the components this brief reuses in the right-hand visualiser:
   - `frontend/src/components/shared/InteractiveProfileVisualiser/` (Brief 44)
   - the heat balance Sankey component used in Building/Systems
6. Read `docs/audit/29_open_issues.md` for current open issue numbers.
7. Confirm working tree clean: `git status --short`.
8. Confirm `origin/main == local main`.
9. **Part 1's first commit must include this brief file landed at `docs/briefs/active/47_interventions_layout_and_state.md`** per Process Rule 7. No code work begins until that commit lands.
10. Do not begin Part 1 until checks 0–9 pass.

---

## Scope statement

This brief restructures the Interventions module's UI and fixes the editor's state-display bugs. It builds on Brief 46's capture-context plumbing (which works) and does NOT change the patch model, the engine, or the project state schema.

**In scope:** the reopen bug, delete-intervention, the change list, nav/control change flags, the inputs-left/visualiser-right layout, draggable-off-screen pop-outs, and the point-in-time right-hand visualiser views (waterfall reuse, before/after, live physics sanity views reusing existing components).

**Explicitly OUT of scope (deferred):**
- Carbon-trajectory-over-time (BAU / individual / combined impact with target pathways like CRREM). This is a substantial new modelling piece — time axis, BAU projection, pathway data, forward projection — and gets its own follow-on brief.
- Save-to-library / any library feature. Cut entirely (see design note — within-project persistence + reopen-seeding makes it pointless).
- The demand-sensitivity audit (cooling setpoint + infiltration magnitude + envelope-only residual). Separate diagnostic brief, "audit don't presume."
- Multi-profile schedule editing (noted in Brief 46 as a follow-up).

This brief delivers five substantive Parts plus close.

---

## Operational mode

**NOT full plough-through.** Per the lesson from Brief 46 (four Parts ran before a control was touched in the browser, burying the inert-controls bug), this brief has a **mandatory browser-verification checkpoint after Part 2** — the "working and saving" parts — before the layout work begins. Chris reviews in the browser at that checkpoint. Parts 3–5 then run, with the walkthrough sign-off before the close.

Priority order is deliberate: **working-and-saving is verified before layout is built on top of it.**

---

## Principles

1. **No data model or engine changes.** Patch shape, intervention shape, project state schema, `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta` — all read-only references. Brief 46's capture context + read-overlay are the foundation; this brief extends their use, doesn't rewrite them.

2. **Faithful state display is the spine.** The editor must always show an intervention's true contents — on the controls (seed from saved patches on open), as a change list (plain English), and as flags (nav + control). A user must never again be unable to see what changed.

3. **The visualiser is the verification mechanism.** The big right-hand window exists so the human can sanity-check the physics in real time as they edit. It is not decoration — it's how Chris catches whether a change makes sense (as he did with the infiltration heat-balance check). Several views, switchable.

4. **Reuse existing visualisers.** The right-hand views reuse `InteractiveProfileVisualiser` (Brief 44), `EUIWaterfall` (Brief 45), and the heat balance Sankey — fed intervention-aware (baseline vs current) data. Do not build parallel visualisation components.

5. **The module law: inputs left, outputs right, detail in pop-ups.** This brief makes Interventions obey the law every other module follows. The stack + per-intervention inputs live left; the visualiser lives right; editing detail happens in pop-outs.

6. **Pop-outs draggable off-screen.** Every pop-out in the module — top-level editor, and nested schedule / internal-gains / system editors — must be draggable to a second monitor so the main visualiser stays visible while editing.

7. **Browser verification is real, not claimed.** Per the Brief 46 lesson: "browser verified" means a specific action was taken in the browser and observed. The Part 2 checkpoint and the Part 5 walkthrough are observed in the browser on Bridgewater, with what-was-seen reported. Build-passing is not verification. If Claude Code cannot drive the browser, it says so and Chris runs the checks.

8. **Bridgewater anchor.** Engine output is unchanged by this brief (UI only). At a clean Bridgewater state (heating 95/5, DHW 65/35, cooling Follow comfort) the baseline EUI must read ~121.7. Confirm at the Part 2 checkpoint and at close.

9. **Documentation hygiene per Process Rule 7.** Each Part one commit with STATUS + audit-doc updates.

---

## Parts

### Part 1 — Fix the reopen bug + add delete-intervention

**Goal:** Reopen a saved intervention and the controls show its saved values, not baseline. Delete an intervention from the stack.

**The reopen bug (root cause, from the design note):** Brief 46's read-overlay (`PatchedProjectContextProvider`) shows patched values during a live editing session — while `currentPatches` is in memory. But on reopen, the saved patches aren't loaded into the capture context as the starting `currentPatches`, so the overlay has nothing to overlay and controls render from raw baseline. The summary/numbers are right (engine applies saved patches) but the controls are wrong.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — on open, seed the capture context from the intervention's saved patches
- `frontend/src/context/InterventionCaptureContext.jsx` — accept an initial-patches seed
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` / `InterventionRow.jsx` — add delete affordance
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — delete handler
- `docs/audit/47_interventions_layout_and_state.md` (new)
- `docs/briefs/active/47_interventions_layout_and_state.md` — this brief
- `docs/briefs/current.md` — pointer

**Steps:**

1.1 **Seed capture context on open.** When `InterventionEditorPopout` opens for an existing intervention, initialise `currentPatches` from that intervention's saved patches (rather than empty). The read-overlay then renders every control at its patched value. New (blank) interventions still open with empty `currentPatches`.

1.2 **Verify the seed is a copy, not a reference.** Editing must not mutate the saved intervention until Save. Seed with a deep clone of the saved patches; Save commits `currentPatches` back; Cancel discards. Confirm Cancel after edits leaves the saved intervention untouched.

1.3 **Delete-intervention.** Add a delete affordance to each stack row (trash icon, consistent with the Brief 45 bin-for-delete convention). Confirm-before-delete (interventions can be expensive to rebuild). Deletes the whole intervention from the stack; engine reruns; remaining interventions' cumulatives recompute.

1.4 **Audit doc** § "Part 1 — reopen seed + delete" documents the seed mechanism and the delete flow.

**Commit message:**
```
Brief 47 Part 1: reopen-seed fix + delete-intervention

On opening an existing intervention, the capture context is seeded
with a deep clone of its saved patches, so the read-overlay renders
every control at its saved value (not baseline). Fixes the reopen
bug — controls now faithfully show the intervention's state.

Seed is a clone: editing doesn't mutate the saved intervention until
Save; Cancel discards cleanly.

Delete-intervention added to stack rows (trash icon, confirm-before-
delete). Engine reruns; cumulatives recompute.

No data model or engine changes.
```

STATUS + audit doc in same commit.

---

### Part 2 — Change list + nav/control change flags

**Goal:** An always-visible plain-English list of what the intervention does, with per-change revert. The left nav and individual controls flag what's been changed.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — mount the change list
- `frontend/src/components/modules/interventions/ChangeList.jsx` (new) — the plain-English list with revert
- `frontend/src/components/modules/interventions/EditorNav.jsx` — propagate change flags up the nav tree
- `frontend/src/components/modules/interventions/PatchedInputBadge.jsx` — already flags controls; confirm coverage
- `frontend/src/components/modules/interventions/patchCapture.js` — reuse `summarizePatch` / `summarizePatchListShort` for plain-English rendering
- `docs/audit/47_interventions_layout_and_state.md` — append "Part 2"

**Steps:**

2.1 **Change list component.** An always-visible panel (in the editor — placement settled in Part 3's layout, but functional here) listing every patch in plain English: "Air permeability: 4.64 → 25.0", "External wall: cavity_wall_enhanced → ...", "South overhang: 0 → 0.5m". Reuse the existing `summarizePatch` plain-English renderer. Each row has a revert control.

2.2 **Live revert.** Clicking revert on a change removes that patch from `currentPatches` immediately — the control returns to baseline, the nav/control flags clear for it, the visualiser/footer updates in the same render cycle. (Confirmed with Chris: revert is live, from the list.)

2.3 **Nav-level flags.** Extend the change marker UP the nav tree: a patched control flags its sub-item (e.g. "Air permeability") AND its parent section (e.g. "Building") in the left nav. Scanning the nav shows which sections/sub-sections contain changes without opening them. Treatment: a coloured dot / badge (exact styling per the frontend-design tokens; "like a red" per Chris — use the accent/warning token, not a literal hard red if it clashes with the palette).

2.4 **Control-level flags.** Confirm `PatchedInputBadge` (Brief 46) marks every patched control across all four section types. Where coverage is missing, extend it. The control flag + the nav flag share the same visual language.

2.5 **Three-ways-to-see check.** After Part 2, an intervention's changes are visible three ways: the change list (plain-English summary), the nav flags (which areas), the control flags (which inputs). Confirm all three agree for a multi-patch intervention.

2.6 **Audit doc** § "Part 2 — change list + flags."

**=== MANDATORY BROWSER-VERIFICATION CHECKPOINT (Chris) — before any Part 3 work ===**

On Bridgewater, in the editor, Chris confirms (Claude Code surfaces here; if it can drive the browser it reports what it observed, otherwise Chris runs them):
1. Build an intervention with 3–4 changes across different sections (e.g. q50, an overhang, a heating share, an occupancy change). Each change flags its control AND its nav section/sub-item.
2. The change list shows all 3–4 in plain English.
3. Revert one from the list → control returns to baseline, flags clear, footer/visualiser updates live.
4. Save, close, **reopen** → controls show the saved values (the reopen bug is fixed), change list shows them, nav flags show them.
5. Cancel after an edit → saved intervention untouched.
6. Delete an intervention → it goes, cumulatives recompute.
7. Bridgewater baseline EUI at clean state reads ~121.7.

**If all pass → proceed to Part 3. If anything fails → diagnose and fix before Part 3.** Working-and-saving is verified before layout is built on it.

**Commit message:**
```
Brief 47 Part 2: change list + nav/control change flags

ChangeList: always-visible plain-English list of every patch
(reuses summarizePatch). Per-change live revert — removes the patch,
control returns to baseline, flags clear, visualiser updates same
render cycle.

Nav flags: change markers propagate up the nav tree — patched control
flags its sub-item and parent section, so the left nav shows which
areas contain changes without opening them.

Control flags: PatchedInputBadge coverage confirmed/extended across
all four section types.

Three complementary ways to see an intervention's changes: the list,
the nav flags, the control flags.

Awaits Chris's browser-verification checkpoint before Part 3.
```

STATUS + audit doc in same commit.

---

### Part 3 — Layout restructure: stack to left pane, inputs-left / visualiser-right, draggable-off-screen pop-outs

**Goal:** The module obeys the law — stack + inputs on the left, big visualiser on the right, editing pop-outs draggable off-screen.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — main layout
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` — stack relocates to left pane, reorderable in place
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — confirm draggable-off-screen; nested pop-outs likewise
- the nested pop-outs (schedule editor, internal gains, system editor) — confirm each is draggable off-screen
- `docs/audit/47_interventions_layout_and_state.md` — append "Part 3"

**Steps:**

3.1 **Stack to left pane.** The intervention stack (Baseline + interventions + Add) moves into a left panel. Reorderable in place (drag to reorder), and the effect of reordering is visible as it happens (marginals recompute). Per-intervention actions in the left pane: select (opens editor), delete, clone (clone optional/low-priority — implement if cheap, defer if it complicates).

3.2 **Visualiser on the right.** The right side becomes the big visualiser surface (built out in Part 4). In Part 3, wire the right pane to host the visualiser and confirm it updates as stack selection / reorder / toggle changes.

3.3 **Editing pop-outs draggable off-screen.** The editor pop-out (and the nested schedule / IG / system editors) must be draggable to a second monitor — position persisted, can sit fully off the main window so the right-hand visualiser stays visible. Confirm the nested pop-outs don't z-index-trap behind the parent (the Brief 46 Q1 concern — resolve it here if it fires).

3.4 **No library button anywhere.** Confirm removed (per design note).

3.5 **Audit doc** § "Part 3 — layout."

**Browser verification (Claude Code, or surfaced to Chris):** stack in left pane reorders live; selecting opens editor; editor drags off-screen and the right visualiser stays visible; nested schedule pop-out drags off-screen too.

**Commit message:**
```
Brief 47 Part 3: inputs-left / visualiser-right layout + draggable-off-screen pop-outs

Stack relocated to left pane — reorderable in place with live marginal
recompute. Per-intervention actions: select / delete / clone.

Right pane hosts the big visualiser surface (views built in Part 4).

Editor pop-out and all nested pop-outs (schedule / internal gains /
system editor) draggable off-screen to a second monitor; position
persisted; main visualiser stays visible while editing.

Module now obeys the law: inputs left, outputs right, detail in
draggable pop-ups. No library affordance anywhere.
```

STATUS + audit doc in same commit.

---

### Part 4 — Right-hand visualiser views (point-in-time)

**Goal:** The right-hand visualiser shows the impact through several switchable point-in-time views, reusing existing components, framed as change-against-baseline.

**Files touched:**
- `frontend/src/components/modules/interventions/visualiser/` (new dir) — view host + view switcher
- reuse `EUIWaterfall.jsx` (Brief 45), `InteractiveProfileVisualiser` (Brief 44), heat balance Sankey
- `frontend/src/components/modules/interventions/visualiser/BeforeAfterBars.jsx` (new) — cumulative-vs-baseline bars
- `docs/audit/47_interventions_layout_and_state.md` — append "Part 4"

**Steps:**

4.1 **View switcher.** The right pane has a switcher between views. Views this brief:
- **Waterfall** — per-intervention marginal impact across the stack (reuse `EUIWaterfall`). Baseline → marginal steps → final.
- **Before/after** — cumulative stack vs baseline as simple bars (new `BeforeAfterBars`, small). "Baseline X → final Y."
- **Physics sanity views** — heat demand, EUI, air changes, heat balance — reusing `InteractiveProfileVisualiser` + heat balance Sankey, fed baseline-vs-current data. These are the live sanity-check views (the ones that let Chris catch whether a change makes physical sense as he edits).

4.2 **Change-against-baseline framing.** Every view shows the comparison: two lines on the profile (baseline vs current), before/after bars, waterfall steps. The point is always "what does this change do relative to baseline."

4.3 **Live update.** As the user edits in a pop-out (which can be off-screen), the right-hand visualiser updates in the same render cycle. This is the core verification loop — confirm it holds across all views.

4.4 **Reuse, don't rebuild.** Waterfall, profile visualiser, heat balance Sankey are existing components. Only `BeforeAfterBars` is new, and it's small. If a reused component needs a small prop to accept baseline-vs-current data, add the prop — don't fork the component.

4.5 **Audit doc** § "Part 4 — visualiser views."

**Commit message:**
```
Brief 47 Part 4: right-hand visualiser — waterfall, before/after, physics sanity views

View switcher in the right pane:
- Waterfall (reuse EUIWaterfall) — per-intervention marginal impact
- Before/after (new BeforeAfterBars) — cumulative stack vs baseline
- Physics sanity views (reuse InteractiveProfileVisualiser + heat
  balance Sankey) — heat demand / EUI / air changes / heat balance,
  baseline-vs-current

All views framed as change-against-baseline. Live update as the user
edits (incl. from an off-screen pop-out) — the verification loop.

Reuse, not rebuild — only BeforeAfterBars is new. Existing components
fed intervention-aware data via props.

Carbon-trajectory-over-time + pathways explicitly deferred to a
follow-on brief.
```

STATUS + audit doc in same commit.

---

### Part 5 — Bridgewater walkthrough + close

**Goal:** Chris's walkthrough confirms the module is usable end-to-end. Brief 47 archived.

**Walkthrough checklist Chris runs (in the browser, on Bridgewater at clean ~121.7 state):**

**State display (the spine)**
1. Build an intervention with changes across Building + Internal Gains + Systems. Each change flags its control and its nav section/sub-item.
2. Change list shows all changes in plain English.
3. Revert one from the list → live update, flag clears.
4. Save, close, reopen → controls show saved values; change list + nav flags intact. (Reopen bug fixed.)
5. Delete an intervention → it goes, cumulatives recompute.

**Layout**
6. Stack in left pane; reorder it → marginals recompute live.
7. Select an intervention → editor opens.
8. Drag the editor pop-out off-screen (second monitor) → right-hand visualiser stays visible.
9. Open a schedule editor inside an intervention → it too drags off-screen, doesn't z-index-trap.

**Visualiser**
10. Right pane: switch to Waterfall → per-intervention impact across the stack.
11. Switch to Before/after → cumulative vs baseline bars.
12. Switch to a physics view (heat demand / EUI / air changes / heat balance) → baseline-vs-current.
13. Edit a value in the (off-screen) pop-out → the on-screen visualiser updates live. The verification loop works.

**Anchor**
14. Bridgewater baseline EUI at clean state reads ~121.7 (UI-only brief, engine unchanged).
15. Build the 3-intervention test (fabric / internal-gains-stress / plant-electrification) end-to-end using the new module — all three build, display, save, reopen, and the waterfall tells the story.

If all pass → close. If anything anomalous → log to 29_open_issues.md, diagnose, fix within Part 5, re-verify.

**Final report Chris pastes after close:** HEAD SHA; reopen bug fixed (reopen shows saved values); delete works; change list + nav/control flags working; layout (stack left, visualiser right, pop-outs off-screen); visualiser views (waterfall / before-after / physics); live-update loop confirmed; Bridgewater ~121.7 anchor held; 3-intervention test built end-to-end; issues closed; `docs/briefs/active/` empty; CLAUDE.md scope-drift check.

**Commit message:**
```
Brief 47 close: Interventions module usable — faithful state + inputs-left/visualiser-right

Reopen bug fixed: reopening an intervention shows its saved values on
the controls (seeded from saved patches). Change list (plain English,
live revert) + nav/control flags give three ways to see what an
intervention does. Delete-intervention added.

Layout: stack in left pane (reorderable live), big visualiser on the
right, editing pop-outs (incl. nested schedule/IG/system) draggable
off-screen so the visualiser stays visible. Module law applied.

Right-hand visualiser: waterfall + before/after + physics sanity
views (heat demand / EUI / air changes / heat balance), reusing
existing components, framed baseline-vs-current, live-updating.

UI only — engine unchanged, Bridgewater anchor ~121.7 held. Library
cut entirely. Carbon-trajectory-over-time deferred to follow-on brief.
```

---

## What MUST NOT happen

- No data model or engine changes. Patch shape, intervention shape, schema, engine functions — read-only.
- No library feature (cut entirely).
- No carbon-trajectory-over-time / pathways (deferred to own brief).
- No demand-sensitivity engine fixes (separate diagnostic brief — "audit don't presume").
- No new visualisation components except the small `BeforeAfterBars` — reuse waterfall / profile visualiser / heat balance Sankey.
- No skipping the Part 2 browser-verification checkpoint — it exists because Brief 46 buried a bug by not checking. Working-and-saving is verified before layout is built on it.
- No "browser verified" claims that mean "build passed" — verification is observed-in-browser, reported as observed, or Chris runs it.
- No partial commits — each Part one commit with STATUS + audit doc.
- No engine-number changes — Bridgewater clean baseline stays ~121.7.

---

## When to escalate

Pause and escalate to Chris ONLY if:
- The reopen-seed surfaces that saved patches aren't stored in a form that can re-seed the context (would indicate a Brief 46 persistence gap, not just a display gap) — diagnose before building on it.
- A nested pop-out can't be made draggable-off-screen without a SchedulePopout refactor deeper than expected (the Brief 46 Q1 concern resurfacing at scale).
- A reused visualiser component can't accept baseline-vs-current data without a fork (would suggest the component needs a small brief of its own).
- The Part 2 checkpoint fails in a way that suggests the read-overlay is fundamentally fragile rather than just un-seeded.
- Bridgewater clean baseline EUI drifts from ~121.7 (accidental engine change).
- Documentation hygiene slips.

Otherwise: Part 1 → Part 2 → **browser checkpoint** → Parts 3–4 → walkthrough → close.

---

## Notes for Claude Code on the discipline pattern

- Read everything first, especially the Notion design note (the full design conversation) and the Brief 46 artefacts you're building on.
- The Part 2 browser checkpoint is mandatory and real. Brief 46's inert-controls bug was buried because four Parts ran before a control was touched in a browser. Do not repeat that. Working-and-saving is verified before layout.
- Reuse, don't rebuild. The visualiser views are existing components fed intervention-aware data. Only BeforeAfterBars is new.
- The spine is faithful state display — controls, list, flags all showing the intervention's true contents. That's the thing that's been missing and the thing that makes the module trustworthy.
- Engine is unchanged. Bridgewater ~121.7 anchor is the falsifiability check.

Standing by for authorisation to begin Part 1.
