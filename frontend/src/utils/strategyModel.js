// ── Brief 94 Part 2 — strategy-as-references data model + lossless migrate-on-read ──
//
// Decouples the intervention LIBRARY (definitions) from the STRATEGY (an ordered,
// parameter-read-only selection of library items). Pure module — no React, no DOM —
// so it is importable by both ProjectContext (migrate-on-read) and node test scripts.
//
//   Library  = building_config.interventions[]  (definitions; order NOT meaningful).
//              Each item's `id` IS its library_id. Owns all parameters (patches,
//              label, theme, notes, capex, cost, schema_version).
//   Strategy = building_config.strategies[0] = { id, name, refs: StrategyRef[] }
//              where StrategyRef = { library_id, enabled, order }. The strategy
//              SELECTS and ORDERS library items and carries per-membership `enabled`.
//              It holds NO parameters — those live on the library item.
//
// Migration discipline (Brief 94 Decisions 2–4, Notion design note §Migration):
//   • Lossless: every applied intervention survives as a library item (untouched) +
//     exactly one strategy ref, in the engine's current stack order.
//   • The engine's canonical order is the `interventions` ARRAY order — NOT the
//     legacy Brief-87 `ordered_intervention_ids`, which is vestigial (written but read
//     nowhere) and observed to drift stale (dangling ids, missing entries). We ignore
//     it so migration can never inherit that drift.
//   • Idempotent: a project already in refs-shape migrates to itself. Old shape
//     (`ordered_intervention_ids`) is never written back.
//   • No duplicate library_id in one strategy (Decision 2).

export const STRATEGY_REFS_SCHEMA = 1

/** Build one ordered strategy reference. `enabled` defaults true (only `false` disables). */
export function makeStrategyRef(library_id, enabled = true, order = 0) {
  return { library_id, enabled: enabled !== false, order }
}

/** True once the active strategy carries the refs shape (i.e. already migrated). */
export function hasStrategyRefs(bc) {
  const s = Array.isArray(bc?.strategies) ? bc.strategies : []
  return s.length > 0 && Array.isArray(s[0]?.refs)
}

/**
 * Lossless, idempotent migrate-on-read. Returns the strategies array in refs-shape.
 * Derives refs from `interventions` array order (the canonical engine stack order),
 * preserving each item's `enabled`. Preserves a prior strategy's id/name if present.
 * Never mutates `interventions`; never carries `ordered_intervention_ids` forward.
 */
export function migrateStrategyRefs(bc) {
  const interventions = Array.isArray(bc?.interventions) ? bc.interventions : []
  const existing = Array.isArray(bc?.strategies) ? bc.strategies : []

  // Already migrated → return unchanged (idempotent; load-twice migrates once).
  if (hasStrategyRefs(bc)) return existing

  const prior = existing[0] || null
  // De-dup defensively (Decision 2: no duplicate library_id in one strategy) while
  // preserving first-seen array order.
  const seen = new Set()
  const refs = []
  for (let i = 0; i < interventions.length; i++) {
    const iv = interventions[i]
    const id = iv?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    refs.push(makeStrategyRef(id, iv?.enabled !== false, refs.length))
  }

  return [{
    id: prior?.id || 'strategy_default',
    name: prior?.name || 'Strategy 1',
    refs,
  }]
}

// ── Ref mutation helpers (Parts 3–5) — all immutable: take a strategies array,
//    return a NEW strategies array with strategies[strategyIndex] updated. Order
//    fields are always renumbered 0..N-1 to stay canonical. ─────────────────────

function _withActive(strategies, strategyIndex, fn) {
  const arr = Array.isArray(strategies) ? strategies : []
  const strat = arr[strategyIndex]
  if (!strat) return arr
  const refs = Array.isArray(strat.refs) ? strat.refs : []
  const nextRefs = fn(refs).map((r, i) => ({ ...r, order: i }))
  const next = [...arr]
  next[strategyIndex] = { ...strat, refs: nextRefs }
  return next
}

/** Reorder refs to match `orderedLibraryIds` (ids not present are dropped; unknown ignored). */
export function reorderStrategyRefs(strategies, orderedLibraryIds, strategyIndex = 0) {
  return _withActive(strategies, strategyIndex, (refs) => {
    const byId = new Map(refs.map((r) => [r.library_id, r]))
    return orderedLibraryIds.map((id) => byId.get(id)).filter(Boolean)
  })
}

/** Set (or toggle) a ref's enabled flag. Pass `enabled` omitted to toggle. */
export function setStrategyRefEnabled(strategies, library_id, enabled, strategyIndex = 0) {
  return _withActive(strategies, strategyIndex, (refs) =>
    refs.map((r) =>
      r.library_id === library_id
        ? { ...r, enabled: enabled === undefined ? r.enabled === false : enabled !== false }
        : r,
    ),
  )
}

/** Remove a library item's reference from the strategy (does NOT delete the library item). */
export function removeStrategyRef(strategies, library_id, strategyIndex = 0) {
  return _withActive(strategies, strategyIndex, (refs) =>
    refs.filter((r) => r.library_id !== library_id),
  )
}

/** Append a reference (enabled) if not already present (duplicate guard). No-op if present. */
export function addStrategyRef(strategies, library_id, strategyIndex = 0) {
  return _withActive(strategies, strategyIndex, (refs) =>
    refs.some((r) => r.library_id === library_id) ? refs : [...refs, makeStrategyRef(library_id, true, refs.length)],
  )
}

/** Set of library_ids currently referenced by the active strategy (for the picker's dup guard). */
export function strategyRefIdSet(bc, strategyIndex = 0) {
  const strategies = migrateStrategyRefs(bc)
  const strat = strategies[strategyIndex]
  return new Set(Array.isArray(strat?.refs) ? strat.refs.map((r) => r.library_id) : [])
}

/**
 * Canonical read path (Bible Rule 11) for the composed strategy: the ordered,
 * enabled-annotated library items the engine/UI should stack. Sorts by ref.order,
 * drops refs whose library_id no longer resolves (defensive against a deleted item),
 * and returns library items with the strategy's per-membership `enabled` applied.
 *
 * Consumed by Parts 3–5 (strategy view, engine composition). Returns [] if no
 * strategy or no library. Does not mutate its inputs.
 */
export function resolveStrategyInterventions(bc, strategyIndex = 0) {
  const interventions = Array.isArray(bc?.interventions) ? bc.interventions : []
  const strategies = migrateStrategyRefs(bc)
  const strat = strategies[strategyIndex]
  if (!strat || !Array.isArray(strat.refs)) return []
  const byId = new Map(interventions.map((iv) => [iv?.id, iv]))
  return [...strat.refs]
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
    .filter((ref) => byId.has(ref?.library_id))
    .map((ref) => ({ ...byId.get(ref.library_id), enabled: ref?.enabled !== false, _strategy_order: ref?.order }))
}
