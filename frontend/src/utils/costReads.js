/**
 * costReads.js — Brief 90 (Brief B): the ONE canonical read path for cost rates,
 * project cost defaults, and energy prices (Bible Rule 11, extending Brief 88/89).
 *
 * Read project defaults / energy prices / type rates ONLY through these helpers —
 * never import `costLibrary.js` directly in a consumer. A project override
 * (`params.cost_defaults`) wins over the library default; the library is the floor.
 */
import {
  PROJECT_COST_DEFAULTS, INTERVENTION_TYPES,
} from '../data/costLibrary.js'
import { HIEX_COST_RATES } from '../data/hiexCostRates.js'

/** Canonical project-level default for a key, project override winning over library. */
export function readProjectDefault(key, projectDefaults = null) {
  const v = projectDefaults?.[key]
  if (v != null && v !== '') return Number(v)
  return PROJECT_COST_DEFAULTS[key]
}

/** Canonical energy price (£/kWh) for a fuel. */
export function readEnergyPrice(fuel, projectDefaults = null) {
  if (fuel === 'electricity') return readProjectDefault('electricity_price_per_kWh', projectDefaults)
  if (fuel === 'gas')         return readProjectDefault('gas_price_per_kWh', projectDefaults)
  return null
}

/**
 * Canonical type-default cost seed for an intervention type/theme, or null when
 * no seed exists yet (rates pending Applemore — caller falls back to £0 / direct
 * entry, never a fabricated number).
 */
export function readRateForIntervention(typeOrTheme) {
  if (!typeOrTheme) return null
  const key = String(typeOrTheme).toLowerCase().trim().replace(/\s+/g, '_')
  return INTERVENTION_TYPES[key] ?? null
}

/** True once any per-type rate seeds exist (i.e. Applemore has been ingested). */
export function hasSeededRates() {
  return Object.keys(INTERVENTION_TYPES).length > 0
}

// ── HIEX type-default rates (Brief 97 P7) ─────────────────────────────────────
// Canonical read path for the HIEX benchmark-derived per-unit rates. Editor
// components read suggestions ONLY through here (Bible Rule 11), never by
// importing hiexCostRates.js directly.

/** All HIEX rate seeds ({ key, label, unit, rate, source }). */
export function listHiexRates() {
  return HIEX_COST_RATES
}

/** HIEX rate seeds matching a line unit (for new-line rate suggestions). */
export function hiexRatesForUnit(unit) {
  if (!unit) return []
  return HIEX_COST_RATES.filter(r => r.unit === unit)
}

// ── Per-project template library (Brief 91) ──────────────────────────────────
// Templates live on `project.cost_template_library`. The save/delete helpers are
// PURE: they return the new library array; the caller persists it via
// `updateParam('cost_template_library', library)`. Cross-project sharing is a
// future migration — the shape is designed to move storage tier cleanly.

/** Saved cost-plan templates on the project (metadata + structure). */
export function listTemplates(project) {
  return Array.isArray(project?.cost_template_library) ? project.cost_template_library : []
}

/** Full template structure by id, or null. */
export function readTemplate(templateId, project) {
  return listTemplates(project).find(t => t.id === templateId) ?? null
}

/**
 * Build a new template from a cost plan + return `{ id, library }` (the caller
 * persists `library`). Deep-clones the plan structure so later edits to the
 * source intervention don't mutate the stored template.
 */
export function saveTemplate(name, costPlan, project) {
  const lib = listTemplates(project)
  const now = new Date().toISOString()
  const id = `tpl_${(globalThis.crypto?.randomUUID?.() || String(Math.round(performance.now()))).slice(0, 12)}`
  const groups = structuredClone(costPlan?.groups ?? [])
  const entry = {
    id,
    name: (name || 'Untitled template').trim(),
    groups,
    on_costs: { ...(costPlan?.on_costs ?? {}) },
    created_at: now,
    updated_at: now,
    group_count: groups.length,
    line_count: groups.reduce((s, g) => s + (g.lines?.length ?? 0), 0),
  }
  return { id, library: [...lib, entry] }
}

/** Remove a template by id → new library array (caller persists). */
export function deleteTemplate(templateId, project) {
  return listTemplates(project).filter(t => t.id !== templateId)
}
