# Brief 91 design note — Cost Plan Builder (replaces Brief 90's Headline UI)

*Markdown only. Internal. Audience: Chris, Will, Imi, Claude Chat, Claude Code.*

**Date:** 26 June 2026
**Status:** Design locked. Brief 91 writable from this note.
**Lineage:** Replaces Brief 90's HeadlineCostEditor UI with the proper cost plan tool. Reuses Brief 90's cost model, canonical reads, payback math, strategy capex aggregation — none of that is wasted. The replace is specifically the editor UI and the underlying intervention cost data shape: from "six named lines" to "groups of line items."

---

## What changed and why

Brief 90 shipped a HeadlineCostEditor that was six text inputs labelled with NRM2 names (Design & engineering / Equipment / Installation & commissioning / Additional measures / Project delivery / Contingency). A real QS would not use this. A real cost plan is a list of line items, each with a name, quantity, unit, rate, and extension — grouped into sections that subtotal — and that's what this brief delivers.

Chris's words (26 June 2026): *"If it's an air source heat pump system, it would have enabling works, you'd put one times boiler removal. The reference would be number, or it could be square metres, or it could be kilowatts, and then it's pounds per kilowatt. That's where I want to get to: have a really good quality, usable, reusable, and editable cost plan that opens up as a pop-up, as a library item, that then allows you to build up the costing. You can be as detailed as you want or as simple as you want, but you have the choice."*

The right cost build-up for an ASHP retrofit:

| Group | Line | Qty | Unit | £/unit | Extension |
|---|---|---:|---|---:|---:|
| **Enabling works** | Strip out & dispose existing gas boilers | 2 | nr | 1,200 | 2,400 |
| | Decommission gas supply | 1 | item | 800 | 800 |
| | *Subtotal* | | | | **3,200** |
| **Main equipment** | ASHP unit 60kW | 2 | nr | 18,000 | 36,000 |
| | Buffer vessel 500L | 1 | nr | 2,200 | 2,200 |
| | *Subtotal* | | | | **38,200** |
| **Installation** | Primary pipework alterations | 45 | m | 140 | 6,300 |
| | Controls upgrade | 1 | item | 4,500 | 4,500 |
| | Commissioning | 60 | hr | 85 | 5,100 |
| | *Subtotal* | | | | **15,900** |
| **Builder's work in connection** | Penetrations & making good | 1 | sum | 4,200 | 4,200 |
| | *Subtotal* | | | | **4,200** |
| | **Total (lines)** | | | | **61,500** |
| | + Design fees @ 12% | | | | 7,380 |
| | + Prelims @ 10% | | | | 6,150 |
| | + OHP @ 8% | | | | 4,920 |
| | + Contingency @ 15% | | | | 11,993 |
| | + Inflation @ 5% | | | | 3,998 |
| | **TOTAL** | | | | **95,941** |

That's a real cost plan. A QS reading it knows what it means. The user can add as many lines as they want, group them however they want, and the cost plan still reads cleanly.

## Data model

```js
intervention.cost = {
  groups: [
    {
      id: 'g_001',                       // stable UUID
      name: 'Enabling works',            // free text, user chooses
      nrm2_category: '0',                // optional metadata — '0', '1', '5'… or null
      collapsed: false,                  // UI state
      lines: [
        {
          id: 'l_001',
          name: 'Strip out & dispose existing gas boilers',
          quantity: 2,
          unit: 'nr',                    // see UNITS list
          rate: 1200,
          notes: '',                     // optional QS note
        },
        // … more lines
      ],
    },
    // … more groups
  ],
  on_costs: {
    design_fees_pct: 12,
    prelims_pct: 10,
    ohp_pct: 8,
    contingency_pct: 15,
    inflation_pct: 5,
  },
  template_origin: 'ashp_dhw_default',   // if started from a template; null if from scratch
  notes: '',                             // optional plan-level QS note
}
```

**Units list** (UI dropdown per line):

`nr` — count / number
`m` — linear metre
`m²` — square metre
`m³` — cubic metre
`kW` — kilowatts (capacity)
`kg` — kilograms
`hr` — labour hour
`item` — single item with no count semantic
`sum` — fixed lump sum (qty always 1)
`%` — percentage (rate applied to a base — likely not needed in v1, but reserve)

Rate field's label adapts to unit: "£/nr", "£/m²", "£/kW", etc. Makes the cost plan read like a real QS document.

## Computation

```
group_subtotal(group)       = Σ (line.quantity × line.rate) for line in group.lines
lines_total(plan)            = Σ group_subtotal(group) for group in plan.groups

design_fees                  = lines_total × on_costs.design_fees_pct / 100
prelims                      = lines_total × on_costs.prelims_pct      / 100
ohp                          = lines_total × on_costs.ohp_pct          / 100
subtotal_with_works          = lines_total + design_fees + prelims + ohp
contingency                  = subtotal_with_works × on_costs.contingency_pct / 100
inflation                    = subtotal_with_works × on_costs.inflation_pct   / 100

total_cost                   = subtotal_with_works + contingency + inflation
```

On-costs follow the NRM2 application sequence: fees/prelims/OHP applied to works, then contingency/inflation applied to the subtotal-with-works (compounding correctly). This is what a real cost plan does. Bible Rule 11: every read of project-level default % goes through `readProjectDefault` (Brief 90's canonical helper) — never inlined.

## UI behaviour

### Editor surface

Per-intervention cost editor opens as a modal/panel on the Library page (existing Brief 87 pencil-edit affordance, but the cost panel is bigger). Width takes meaningful space — this is a data tool, not a sidebar form.

The editor IS the cost plan, displayed as a hierarchical table:

```
▼ [Group name]                                          [subtotal]  [⋮ menu]
    [Line name]       [qty]    [unit ▾]   [rate]        [extension] [×]
    [Line name]       [qty]    [unit ▾]   [rate]        [extension] [×]
    + Add line
▼ [Group name]                                          [subtotal]  [⋮ menu]
    …

+ Add group

──────────────────────────────────────────────────────────────────────────
Subtotal (lines)                                                    [sum]

On-costs
    Design fees           [pct ▾%]  (override per intervention)    [£]
    Prelims               [pct ▾%]                                  [£]
    OHP                   [pct ▾%]                                  [£]
    Contingency           [pct ▾%]                                  [£]
    Inflation             [pct ▾%]                                  [£]
──────────────────────────────────────────────────────────────────────────
TOTAL                                                              [£]
```

### Interactions

- **Add group:** button at bottom of group list. Inserts a new empty group, focuses its name field.
- **Add line:** "+ Add line" affordance inside each group. Inserts a new line at the bottom of that group, focuses the name field.
- **Edit any cell:** click. Number cells (qty, rate) parse as numbers, blank → 0.
- **Delete line:** × at end of row. Confirmation only if line has content.
- **Delete group:** ⋮ menu → Delete. Confirmation required if group has lines.
- **Reorder lines within a group:** drag handle on left of row.
- **Reorder groups:** drag handle on group header.
- **Collapse group:** click group name or ▼/▶ chevron. Persists in `group.collapsed`.
- **On-cost percentages:** each shows the project default (greyed) by default, click to override per intervention. Override stores on `intervention.cost.on_costs.{key}`; clearing the field reverts to project default.
- **NRM2 category:** ⋮ menu on group → "Set NRM2 category" → picker (Cat 0–8, or "none"). Optional, doesn't affect compute. For export to QS spreadsheets and for grouping in a future "consolidated cost plan view".

### Keyboard discipline

This is what makes the tool feel like a spreadsheet, not a form:

- **Tab:** advances field to next field on same row, then wraps to next row's first field
- **Shift+Tab:** previous field
- **Enter on last cell of a row:** adds a new line in the same group, focuses its name
- **Cmd/Ctrl+Enter anywhere:** adds a new group, focuses its name
- **Up/Down arrows in number fields:** increment/decrement (with shift for ×10)
- **Esc on a field:** revert to previous value, exit edit

If keyboard discipline doesn't work right, no QS will use this. It needs to feel like Excel.

### Templates

A small "Apply template…" button at the top of the cost panel. Clicking opens a picker:

```
Apply template

┌─────────────────────────────────────────────────────────┐
│ Search templates…                                        │
├─────────────────────────────────────────────────────────┤
│ 📋 ASHP DHW retrofit (Applemore baseline)              │
│    4 groups, 18 lines · last edited 12 Mar             │
├─────────────────────────────────────────────────────────┤
│ 📋 MVHR per zone                                        │
│    3 groups, 11 lines · last edited 4 Apr               │
├─────────────────────────────────────────────────────────┤
│ 📋 LED retrofit (corridor)                              │
│    2 groups, 6 lines · last edited 28 Feb              │
└─────────────────────────────────────────────────────────┘

[ Save current as template… ]                  [ Cancel ]
```

Applying a template **replaces** the current cost plan with the template's groups/lines/rates (with confirmation if the current plan has content). User then edits to suit. The `template_origin` field records which template was the starting point.

"Save current as template…" prompts for a template name and saves the current plan structure to the project's template library.

**Library scope for v1: per-project.** Templates live on the project (project.cost_template_library = [{ id, name, groups, on_costs, created_at, updated_at }]). Cross-project library is a future migration — the data model doesn't change, it just moves to a different storage tier.

## What stays from Brief 90

- **The cost model math** in `costModel.js` — `computeAnnualOperationalSaving`, `computeSimplePayback`, `computePoundsPerTonne`, `PAYBACK_CLAMP_YEARS`. None of these change.
- **The canonical-read helpers** in `costReads.js` — `readProjectDefault`, `readEnergyPrice`. Both stay; `readRateForIntervention` becomes a template lookup helper in the new world.
- **Project-level defaults** (`PROJECT_COST_DEFAULTS` in `costLibrary.js`) — fees 12% / prelims 10% / OHP 8% / contingency 15% / inflation 5% / elec £0.30 / gas £0.08. All stay.
- **Strategy capex aggregation** in `StrategyView` — sum across enabled interventions' total cost. Sum changes shape (it sums groups → lines → on-costs), the aggregation pattern stays.
- **Per-intervention card population** — £/tonne CO₂ and Simple payback cards on the Isolated view stay. Only their input (the cost total) changes shape; the cards themselves are unchanged.
- **Bible Rule 11** — extended further. Every read of cost rates, project defaults, energy prices, and template library goes through the canonical helpers.

## What changes from Brief 90

- **HeadlineCostEditor.jsx** → replaced by **CostPlanEditor.jsx** (new, much larger component).
- **`intervention.cost.headline`** (object with 6 keys) → **`intervention.cost.groups`** (array of group objects with lines).
- **`intervention.cost.detailed`** (placeholder shell, never used) → removed; the new structure handles all depths.
- **`computeHeadlineTotal`, `deriveHeadlineLines`** → removed; replaced by `computeCostPlanTotal(cost)` which walks groups/lines.
- **Mode flag `cost.mode`** → removed; there's only one mode, with variable depth.
- **`INTERVENTION_TYPES` in costLibrary.js** → becomes the seed source for the v1 template library; Applemore-derived templates land here.

## Migration from Brief 90's data

Brief 90 only shipped a demo cost on the DHW intervention (£215k from worked example). Migration is straightforward:

- For any `intervention.cost` with the old shape (`mode: 'headline'` + `headline: {…}`), convert to one group "Cost plan" containing one line per non-zero headline entry:
  - "Equipment" / "Installation & commissioning" / "Additional measures" lines as before, qty=1 unit='sum' rate=value
  - Derived lines (design_engineering, project_delivery, contingency) get folded back into on_costs based on the project defaults at migration time
- For interventions with no cost (the typical case post-Brief-90), `cost = null` or empty `groups: []`. No migration needed.

A one-time migration function runs at project load; subsequent loads use the new shape directly.

## What stays out of scope

- **Cross-project shared template libraries.** v1 per-project. Future migration to a workspace-level library.
- **Rate database with regional adjustment.** v1 takes Applemore as the template rate source; project-by-project edits handle regional variation. BCIS integration / regional factors / temporal escalation are future briefs.
- **Cost plan export to Excel / NRM2 XML.** v1 displays on screen; export is a future brief once the data model has bedded in.
- **Multi-rate library merging.** v1 has the project's library, period. Sharing/merging is future.
- **Cost confidence indicators.** v1 single-number cost. Confidence framing (high/med/low per line or per plan) is future.
- **Quantity surveyor approval workflow.** v1 trust-based; sign-off workflow is future.
- **NPV / lifecycle cost analysis.** Brief 90 deferred this; Brief 91 keeps it deferred. Simple payback only for v1.
- **Cost plan versions / history.** v1 the cost plan is whatever it is right now; version history is future.

## Decision log

**26 June 2026:** Chris's review of Brief 90's Headline UI: "It's NAF." Replace with a proper line-item cost plan builder. Groups with subtotals confirmed. On-costs locked as fixed footer (NRM2 standard). NRM2 category on group is optional metadata, not enforced structure. Per-project template library for v1; cross-project a future migration. Keyboard discipline mandatory — the tool must feel like a spreadsheet for QS users. Applemore spreadsheet (when dropped) becomes the seed source for v1's template library, one template per major intervention type. The Detailed-mode placeholder from Brief 90 is removed entirely — the new model handles all depths through a single editor.

*Brief 91 is the final piece of the interventions module rework's metrics layer. After it ships, the cost plan is something a real QS would actually use, and the £ side of every intervention card is defensible against a hand-drawn cost plan. Combined with Brief 89 (CRREM lifetime carbon, shipped), every intervention carries: kWh / EUI delta + lifetime carbon + cost + £/tonne + payback. Strategy carries the full picture for client deliverables.*
