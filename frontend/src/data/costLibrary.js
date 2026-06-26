/**
 * costLibrary.js — Brief 90 (Brief B): NRM2 cost-rate library + project defaults.
 *
 * Read ONLY through `utils/costReads.js` (Bible Rule 11). The structure mirrors
 * the Applemore Feasibility Cost Plan: a Headline 6-line benchmark per
 * intervention type, a Detailed NRM2 elemental template per type, and
 * project-level on-cost + energy-price defaults.
 *
 * ⚠️ RATES PENDING APPLEMORE (Brief 90 Part 2 blocker): the per-intervention-type
 * rate seeds (`INTERVENTION_TYPES`) are EMPTY — the Applemore Leisure Centre
 * Feasibility Cost Plan spreadsheet is not yet in the repo, and we do not
 * fabricate cost rates (CLAUDE.md Rule 2). The cost layer is fully functional via
 * direct £ entry (Headline mode) using these project defaults; when Applemore
 * lands at `docs/reference/applemore_cost_plan.xlsm`, seed `INTERVENTION_TYPES`
 * with the lifted rates + detailed templates and migration will prefill them.
 *
 * Project-level defaults below ARE real — taken from the Brief B design note
 * (Chris-provided), not invented.
 */

/** The six NRM2-aligned Headline cost lines (Applemore "Summary Interventions"). */
export const HEADLINE_LINES = Object.freeze([
  { key: 'design_engineering',        label: 'Design & engineering',        derived: true  },
  { key: 'equipment',                 label: 'Main equipment',              derived: false },
  { key: 'installation_commissioning',label: 'Installation & commissioning',derived: false },
  { key: 'additional_measures',       label: 'Additional measures',         derived: false },
  { key: 'project_delivery',          label: 'Project delivery',            derived: true  },
  { key: 'contingency',               label: 'Contingency (risk + inflation)', derived: true },
])

/** Project-level defaults — design note (UK 2026). Overridable per project. */
export const PROJECT_COST_DEFAULTS = Object.freeze({
  design_fees_pct: 12,        // consultant fee budget, % of works (Lines 2–4)
  prelims_pct: 10,
  ohp_pct: 8,
  contingency_pct: 15,
  inflation_pct: 5,
  electricity_price_per_kWh: 0.30,
  gas_price_per_kWh: 0.08,
  // Split of the consultant fee budget across Line 1 (design) vs Line 5 (delivery).
  design_share_of_fee: 0.70,  // Line 1 = 70% of fee budget
  delivery_share_of_fee: 0.30,// Line 5 = 30% of fee budget
})

/**
 * Per-intervention-type rate seeds. EMPTY pending Applemore (see header). When
 * seeded, each entry:
 *   { headline_default: { equipment, installation_commissioning, additional_measures },
 *     detailed_template: { ...NRM2 elemental tree... } }
 * Keyed by a normalised intervention type/theme (e.g. 'systems', 'lighting').
 */
export const INTERVENTION_TYPES = Object.freeze({})

/** NRM2 Building-Works categories (0–8) — for the Detailed-mode tree (future). */
export const NRM2_BUILDING_WORKS = Object.freeze([
  ['0', 'Facilitating works'], ['1', 'Substructure'], ['2', 'Superstructure'],
  ['3', 'Internal finishes'], ['4', 'Fittings, furnishings & equipment'],
  ['5', 'Services'], ['6', 'Prefabricated buildings & units'],
  ['7', 'Works to existing buildings'], ['8', 'External works'],
])

/** NRM2 on-cost categories (9–14) applied to Building Works. */
export const NRM2_ONCOSTS = Object.freeze([
  ['9',  "Main contractor's preliminaries", 'prelims_pct'],
  ['10', "Main contractor's overheads & profit", 'ohp_pct'],
  ['11', 'Design fees (consultants)', 'design_fees_pct'],
  ['12', 'Other development / project costs', null],
  ['13', 'Risks', 'contingency_pct'],
  ['14', 'Inflation', 'inflation_pct'],
])
