/**
 * costModel.js — Brief 91 (Cost Plan Builder): line-item cost plan computation +
 * the per-intervention cost data shape + lossless migration from Brief 90.
 *
 * Cost shape (design note):
 *   cost = {
 *     groups: [{ id, name, nrm2_category, collapsed, lines: [{ id, name, quantity, unit, rate, notes }] }],
 *     on_costs: { design_fees_pct, prelims_pct, ohp_pct, contingency_pct, inflation_pct },  // null = inherit project default
 *     template_origin: null | string,
 *     notes: '',
 *   }
 *
 * On-costs follow the NRM2 application sequence: fees/prelims/OHP on the works
 * (lines total), then contingency/inflation on the subtotal-with-works. Project
 * default %s via costReads (Bible Rule 11). No engine changes.
 *
 * Boundaries kept explicit (Bible): lines_total ≠ subtotal_with_works ≠ total.
 */
import { readProjectDefault, readEnergyPrice } from './costReads.js'

export const PAYBACK_CLAMP_YEARS = 999

/** UI unit list per line; rate label adapts ("£/nr", "£/kW", "£/(l/s)", "£/day", …).
 *  Brief 97 P4 adds l/s (ventilation flow) + day (labour day-rate) for the HIEX
 *  benchmark categories; the design-note originals are retained (superset). */
export const UNITS = ['nr', 'm', 'm²', 'm³', 'kW', 'l/s', 'day', 'kg', 'hr', 'item', 'sum', '%']

const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? 0 : Number(v)
const newId = (p) => `${p}_${(globalThis.crypto?.randomUUID?.() || `${p}${Math.round(performance.now())}x`).slice(0, 12)}`

export function newLine(partial = {}) {
  return { id: newId('l'), name: '', quantity: null, unit: 'nr', rate: null, notes: '', ...partial }
}
export function newGroup(partial = {}) {
  return { id: newId('g'), name: '', nrm2_category: null, collapsed: false, lines: [], ...partial }
}

/** Empty cost plan for a new intervention. on_costs null → inherit project defaults. */
export function emptyCost() {
  return {
    groups: [],
    on_costs: { design_fees_pct: null, prelims_pct: null, ohp_pct: null, contingency_pct: null, inflation_pct: null },
    template_origin: null,
    notes: '',
  }
}

// ── Brief 90 → Brief 91 migration (one-way, lossless) ────────────────────────

const B90_HEADLINE_LABELS = {
  design_engineering: 'Design & engineering',
  equipment: 'Main equipment',
  installation_commissioning: 'Installation & commissioning',
  additional_measures: 'Additional measures',
  project_delivery: 'Project delivery',
  contingency: 'Contingency (migrated)',
}

/**
 * Convert a Brief 90-shape cost (`cost.mode` / `cost.headline`) to the new
 * line-item shape, LOSSLESSLY. Idempotent: new-shape or absent costs pass through.
 *
 * Every non-zero headline entry — including Brief 90's derived design/delivery/
 * contingency — becomes an explicit line (qty 1, unit 'sum'); on_costs are set to
 * 0 so the new NRM2 formula does NOT re-apply on-costs on top. Result:
 * computeCostPlanTotal == the exact Brief 90 total (audit §2).
 */
export function migrateCostShape(intervention) {
  const cost = intervention?.cost
  if (!cost) return intervention                       // no cost — nothing to migrate
  if (Array.isArray(cost.groups)) return intervention  // already new shape
  const headline = cost.headline ?? {}
  const lines = Object.keys(B90_HEADLINE_LABELS)
    .map(key => ({ key, value: num(headline[key]) }))
    .filter(e => e.value !== 0)
    .map(e => newLine({ name: B90_HEADLINE_LABELS[e.key], quantity: 1, unit: 'sum', rate: e.value }))
  const migrated = {
    groups: lines.length ? [newGroup({ name: 'Cost plan (migrated)', lines })] : [],
    on_costs: { design_fees_pct: 0, prelims_pct: 0, ohp_pct: 0, contingency_pct: 0, inflation_pct: 0 },
    template_origin: null,
    notes: 'Migrated from Brief 90 headline cost.',
  }
  return { ...intervention, cost: migrated }
}

/** Back-compat alias (Brief 90 name) — same lossless migration. */
export const migrateInterventionCost = migrateCostShape

/** Deep-clone groups with FRESH ids (so two interventions from one template edit
 *  independently and React keys never collide). */
export function cloneGroupsWithNewIds(groups) {
  return (groups ?? []).map(g => newGroup({
    name: g.name, nrm2_category: g.nrm2_category ?? null, collapsed: false,
    lines: (g.lines ?? []).map(l => newLine({ name: l.name, quantity: l.quantity, unit: l.unit, rate: l.rate, notes: l.notes ?? '' })),
  }))
}

/** Build a fresh cost plan from a saved template (fresh ids, records origin). */
export function instantiateTemplate(template) {
  return {
    groups: cloneGroupsWithNewIds(template?.groups),
    on_costs: { ...(template?.on_costs ?? emptyCost().on_costs) },
    template_origin: template?.id ?? null,
    notes: '',
  }
}

// ── Computation ──────────────────────────────────────────────────────────────

/** Σ (line.quantity × line.rate) for a group. */
export function computeGroupSubtotal(group) {
  return (group?.lines ?? []).reduce((s, l) => s + num(l.quantity) * num(l.rate), 0)
}

/** Σ group subtotals across the plan. */
export function computeLinesTotal(cost) {
  return (cost?.groups ?? []).reduce((s, g) => s + computeGroupSubtotal(g), 0)
}

/** Resolve an on-cost % — per-intervention override (number) or project default (null). */
function onCostPct(cost, key, projectDefaults) {
  const v = cost?.on_costs?.[key]
  return (v == null || v === '') ? readProjectDefault(key, projectDefaults) : Number(v)
}

/**
 * Full on-costs breakdown in NRM2 sequence. Each component rounded to whole £
 * (QS convention; matches the design note's £95,941 worked example).
 */
export function computeOnCostsBreakdown(cost, projectDefaults = null) {
  const lines_total = computeLinesTotal(cost)
  const design_fees = Math.round(lines_total * onCostPct(cost, 'design_fees_pct', projectDefaults) / 100)
  const prelims     = Math.round(lines_total * onCostPct(cost, 'prelims_pct', projectDefaults) / 100)
  const ohp         = Math.round(lines_total * onCostPct(cost, 'ohp_pct', projectDefaults) / 100)
  const subtotal_with_works = lines_total + design_fees + prelims + ohp
  const contingency = Math.round(subtotal_with_works * onCostPct(cost, 'contingency_pct', projectDefaults) / 100)
  const inflation   = Math.round(subtotal_with_works * onCostPct(cost, 'inflation_pct', projectDefaults) / 100)
  const total = subtotal_with_works + contingency + inflation
  return { lines_total, design_fees, prelims, ohp, subtotal_with_works, contingency, inflation, total }
}

/** Total cost of a plan (lines + on-costs, NRM2 sequence). */
export function computeCostPlanTotal(cost, projectDefaults = null) {
  // Migrate-on-read (ProjectContext) guarantees every persisted cost is the
  // line-item shape by the time it reaches here; a bare/absent cost totals 0.
  if (!cost || !Array.isArray(cost.groups)) return 0
  return computeOnCostsBreakdown(cost, projectDefaults).total
}

/** Public API (Brief 90 name) — delegates to the plan total. */
export function computeCostTotal(cost, projectDefaults = null) {
  return computeCostPlanTotal(cost, projectDefaults)
}

// ── Operational saving / payback / £-per-tonne (unchanged from Brief 90) ──────

/**
 * Annual operational £ saved from an intervention's per-fuel delta record
 * (interventionsEngine `per_fuel.{electricity,gas}_mwh.delta`, MWh; delta =
 * post − baseline, so a saving is negative). £/yr (can be negative for a fuel
 * switch to pricier electricity).
 */
export function computeAnnualOperationalSaving(perFuelDelta, projectDefaults = null) {
  const savedKwh = (key) => -num(perFuelDelta?.[key]?.delta) * 1000
  return savedKwh('electricity_mwh') * readEnergyPrice('electricity', projectDefaults)
       + savedKwh('gas_mwh')         * readEnergyPrice('gas', projectDefaults)
}

/** Simple payback (years), clamped; null when there's no positive annual saving. */
export function computeSimplePayback(totalCost, annualSavingGbp) {
  if (!(totalCost > 0)) return 0
  if (!(annualSavingGbp > 0)) return null
  return Math.min(PAYBACK_CLAMP_YEARS, totalCost / annualSavingGbp)
}

/** £ per tonne CO₂ saved over lifetime; null when no positive carbon saving. */
export function computePoundsPerTonne(totalCost, lifetimeTco2e) {
  if (!(totalCost > 0) || !(lifetimeTco2e > 0)) return null
  return totalCost / lifetimeTco2e
}
