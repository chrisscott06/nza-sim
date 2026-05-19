# Brief 38 — Systems Sankey polish

> **Repo front matter (Brief 38 Part 1 commit 2026-05-19):**
> **Status:** ACTIVE — chat-form authorisation 2026-05-19 by Chris. Brief file folded into Part 1's commit per the Brief 37 pattern.
> **Progress:** Part 1 in flight (this commit).

---

**Author:** Claude Code (executor) drafting from chat-form spec; Chris Scott (architect) co-designed in chat exchange 2026-05-19.
**Authorised by:** Chris Scott (chat-form, same exchange).
**Status:** Active.
**Date opened:** 2026-05-19.
**Target outcome:** Systems Sankey reads cleanly:
- Energy carrier blocks visually match the combined width of the flows landing on them (not d3-sankey's auto-sized larger blocks), with prominent total labels.
- Unserved demand renders as a short red dotted stub + faint "No system configured" placeholder in the System column; doesn't flow across to Waste.
- Waste node receives genuine heat-rejection flows from served systems (vent extract non-recovered, gas flue losses, cooling condenser rejection) — the Waste column finally communicates something.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly the Module scopes section.
3. Read STATUS.md as currently on disk; confirm last entry is Brief 37 close (`ec3a883`).
4. Confirm working tree clean: `git status --short` (the 11 pre-existing untracked files stay untracked).
5. Confirm `origin/main == local main`: both ahead and behind are empty.
6. Do not begin Part 1 until all five checks pass.

---

## Scope statement

Touches the Systems module's Sankey rendering (`frontend/src/components/modules/systems/SystemSankey.jsx`) and the engine helper that emits `systems_flow` (most likely in `frontend/src/utils/instantCalc.js` — Part 3 needs to add waste-heat links to that data structure).

Per CLAUDE.md "Module scopes": Sankey rendering is a Systems-module UI concern. The waste-heat data piping IS engine work (computing the non-recovered portion of vent extract, gas flue losses, cooling condenser rejection) but it consumes existing engine outputs (`vent_systems` HRE, fuel-mix efficiencies, cooling COPs) — no new physics, just new edges in the graph the engine emits.

No Dynamic-side changes. No physics changes.

---

## Operational mode

Ploughing through Parts 1, 2, 3 without per-Part sign-off pauses. Final walkthrough sign-off by Chris after Part 3 before brief close.

---

## Parts

### Part 1 — Energy carrier sizing + prominent totals

**Goal:** Carrier blocks (Electricity, Gas, others if any) sized to match the combined visual width of incoming flows, not d3-sankey's auto-computed proportional size. Prominent total label outside the block.

**Approach:**
- Let d3-sankey lay out the graph as today (it auto-sizes nodes by flow totals).
- Post-process the layout: identify carrier-type nodes (by `node.type === 'energy_carrier'` or by ID prefix — TBD on inspection). Compute the desired height as a function of incoming flow count × uniform thickness + node padding. Override `node.y0` / `node.y1` to that height.
- Centre the carrier block vertically against the stack of incoming flows so the connections still land cleanly.
- Render a large bold MWh label next to (or above) the carrier block, replacing the small inline label.

**File:** `frontend/src/components/modules/systems/SystemSankey.jsx` only.

**Verification:**
- Carrier block heights visually match the combined flow heights landing on them.
- Total MWh label legible at the carrier block (target font-size: ~14-16 px, bold).
- Build clean.

**Commit message:**
```
Brief 38 Part 1: Carrier-block sizing matches flow stack

Energy carrier blocks (Electricity, Gas) post-processed after d3-sankey
layout so their visual height matches the combined width of the flows
landing on them, rather than d3-sankey's auto-sized proportional
height. Prominent total-MWh label sits beside the block.

Brief 38 itself lands in this commit (chat-form authorisation; brief
file folded into Part 1 per the Brief 37 pattern).
```

STATUS.md update in same commit.

---

### Part 2 — Unserved demand placeholder

**Goal:** When a system is OFF, the demand doesn't flow across to Waste. Instead: a short red dotted stub goes from the Demand node into the System column, and a faint placeholder reads "No system configured" in the System column slot. The Energy carrier + Waste columns stay clean.

**Approach:**
- Detect unserved demand: in `buildGraph`, identify any demand node whose only outgoing link is the existing "unserved" dashed-red flow to a waste/exhaust node.
- Drop those long unserved links from the rendered graph.
- For each such demand, inject a synthetic placeholder node into the System column (faint grey rectangle, dashed border, text "No system configured" or "(off)").
- Inject a short red dotted link from Demand → placeholder.

**File:** `frontend/src/components/modules/systems/SystemSankey.jsx` only (graph construction stays local; engine output unchanged).

**Verification:**
- Heating: OFF state on Bridgewater (current test case) — no dashed red flow across the diagram. Short red dotted stub. Faint placeholder in the System column for Heating's row.
- Other served systems unaffected.
- Build clean.

**Commit message:**
```
Brief 38 Part 2: Unserved demand placeholder, no cross-diagram flow

When a system is OFF (e.g. Heating: OFF), the Sankey no longer renders
a dashed red flow all the way to Waste. Instead: short red dotted
stub from the Demand node into the System column + faint "No system
configured" placeholder where the system would sit.

Cleaner reading; doesn't pollute the Waste column with system-off
artefacts.
```

STATUS.md update in same commit.

---

### Part 3 — Waste-heat flows from served systems

**Goal:** Surface genuine heat rejection on the Waste node. Three sources in scope (per chat-form decision):
- Ventilation extract (non-recovered): `vent_heat_loss × (1 − HRE)` per ventilation system.
- Gas flue losses (DHW + Heating gas-served): `input_energy × (1 − efficiency)` for any gas-served service.
- Cooling condenser rejection: `cooling_delivered + cooling_electricity` (heat pulled from the zone + electrical work input both reject through the condenser).

Deferred: heat-pump defrost, DHW standing losses.

**Approach:**
- Engine side (`instantCalc.js` — most likely the `systems_flow` builder): add new link entries with `style: 'waste'` from each served system → the Waste node. Link `value_kWh` is the computed waste quantity per the formulas above.
- Sankey rendering side: no special handling — links with `style: 'waste'` already render light-grey-solid per the existing `LINK_COLORS.waste` token.

**Files:** `frontend/src/utils/instantCalc.js` (systems_flow builder) + `frontend/src/components/modules/systems/SystemSankey.jsx` (only if rendering tweaks needed; expected to be minimal).

**Verification:**
- Waste node receives three measurable link sources on Bridgewater:
  - mvhr_gf_public extract (non-recovered) — depends on MVHR HRE
  - bedroom_extract / public_toilet_extract (no HRE — full extract heat → waste)
  - DHW gas flue (0.40 × DHW gas input, given ~92% boiler efficiency)
  - Cooling condenser rejection (cooling demand + electrical input)
- Flue + condenser numbers physically defensible per first principles (within ~10% of hand calc).
- Sanity check on Bridgewater: total waste flows out of Waste node should be in the order of 30-80 MWh — let the engine produce what it produces; investigate if wildly outside.
- Build clean.

**Commit message:**
```
Brief 38 Part 3: Waste-heat flows from served systems

Sankey's Waste node now receives genuine heat-rejection flows, not
just unserved-system artefacts (which moved to a per-demand placeholder
in Part 2).

Three sources in scope:
  - Ventilation extract (non-recovered): vent_heat_loss × (1 − HRE)
    per ventilation system. Bridgewater's MVHR shows recovered heat
    elsewhere; the non-recovered portion lands here. MEV / extract-only
    systems contribute their full extract heat.
  - Gas flue losses (DHW + Heating gas-served): input × (1 − efficiency)
    for any service whose primary fuel is gas.
  - Cooling condenser rejection: cooling_delivered + cooling_electricity.
    Both the heat pulled from the zone and the electrical work input
    leave the building through the condenser.

Deferred to future work: heat-pump defrost losses, DHW standing
losses (smaller magnitudes; nice-to-have).

No physics changes — the values come from existing engine outputs
(vent_systems HRE, fuel-mix efficiencies, cooling COPs). Only new
edges in the systems_flow graph.
```

STATUS.md update + brief archive in same commit (close-out).

---

## Final report (paste in chat after Part 3)

1. New origin/main HEAD SHA.
2. Confirmation that the three changes are live on Bridgewater:
   - Carrier block heights match the flow stack
   - Heating: OFF renders as short red dotted stub + placeholder (no cross-diagram waste flow)
   - Waste column receives MVHR extract / MEV extract / DHW flue / cooling condenser rejection flows
3. Bridgewater Σ waste flow (Sankey-derived) in MWh.
4. Confirmation that the served-system energy numbers (heating, cooling, DHW, fans, lighting, small power) are unchanged from the Brief 37 close baseline (no physics changes).

---

## What MUST NOT happen in this brief

- No physics changes. Engine math unchanged; only new edges in the systems_flow graph (Part 3).
- No Dynamic-side changes.
- No changes to per-service colour tokens (Brief 37 Part 1 set them; this brief doesn't touch them).
- No new audit findings logged in `29_open_issues.md` unless something surfaces during verification (in which case it's a separate logged finding, not folded into Brief 38).

---

## When to escalate

Pause and escalate ONLY if:
- Part 1's d3-sankey post-process produces visual artefacts (e.g. flows landing outside the carrier block; carrier block overlapping demands).
- Part 2's unserved detection misclassifies a served-but-minimally-flowing system as unserved.
- Part 3's waste-heat values come out wildly different from hand-calc (>50% off) — suggests an engine-output assumption is wrong, not a small bug.
- The legacy `D4D4D4` waste link style doesn't read clearly when there are multiple waste flows (may need a per-source colour gradient on the waste links).

Otherwise plough through Parts 1, 2, 3. Final report at the end of Part 3.

## Status

Part 1 in flight (this commit). Brief file folded into Part 1 per chat-form authorisation.
