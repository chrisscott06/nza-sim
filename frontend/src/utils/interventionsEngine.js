/**
 * interventionsEngine.js — Brief 41 Part 2
 *
 * Applies declarative patches against a baseline building_config and
 * runs the engine cumulatively over the stack to produce marginal +
 * cumulative deltas. Pattern Y per the Notion design note (§1–2).
 *
 * Schema, patch shape, path conventions, and the patch-application
 * algorithm are documented in docs/audit/41_interventions_schema.md.
 * That doc is canonical; this file is the implementation.
 *
 * Public API
 * ──────────
 *   resolveValue(value, source, libraryData)
 *       → resolves a patch's value against libraryData when
 *         source === 'library' and the value is a library ref;
 *         returns the literal value otherwise
 *   applyPatch(config, patch, libraryData)
 *       → deep-clones config, navigates patch.path, executes the op
 *   applyIntervention(config, intervention, libraryData)
 *       → applies each patch in order; returns config unchanged if
 *         intervention.enabled === false
 *   runInterventionStack(baselineConfig, interventions, runEngine, libraryData)
 *       → walks the stack producing cumulative configs, runs runEngine
 *         on each, returns { baseline, interventions: [...] } with
 *         marginal + cumulative deltas per intervention
 *   computeDelta(fromResult, toResult)
 *       → structured delta object covering headline metrics, per-fuel,
 *         per-service, per-envelope-term
 *   migratePatch(patch, fromVersion, toVersion)
 *       → patch | [patch, ...] | { deprecated, reason }
 *         Brief 42 ships the first real migration (v1→v2 — Systems UX
 *         service-level vs system-level reorganisation; audit doc
 *         42_systems_ux_schema.md §7). Future schema-changing briefs
 *         register additional steps. Chains v1→v2→v3 by sequencing.
 *   migrateInterventionPatches(intervention, fromVersion, toVersion)
 *       → walks all patches in an intervention through the migration
 *         chain, flat-mapping arrays and separating deprecation
 *         markers into `_deprecated_patches`. Project loader calls
 *         this when `intervention.schema_version < current_schema_version`.
 *
 * "config" is the engine's quartet { building, constructions, systems,
 * libraryData }. Patch paths address this object as the root — e.g.
 * `building.openings.south.cd`, `constructions.external_wall`,
 * `systems.dhw_primary`. The audit doc's `building_config.*` shorthand
 * resolves to the appropriate top-level slot.
 *
 * The engine MUST NEVER mutate the baseline. Each applyPatch deep-clones
 * before mutating; runInterventionStack accumulates clones, never
 * touching the original baseline. This is the invariant that lets the
 * caller compute marginal vs cumulative correctly.
 */

// ── Path parsing ───────────────────────────────────────────────────────

/**
 * Parse a dot-notation path with optional [index] / [id=value] suffixes
 * into an ordered list of segments.
 *
 * Returns an array of segment objects:
 *   { kind: 'key',   name: string }
 *   { kind: 'index', index: number }
 *   { kind: 'match', key: string, value: string | number }
 *
 * Examples:
 *   'building.openings.south.cd'
 *     → key:building, key:openings, key:south, key:cd
 *   'building.systems_config_v40.heating[id=gas_boiler_1].enabled'
 *     → key:building, key:systems_config_v40, key:heating,
 *       match{id=gas_boiler_1}, key:enabled
 *   'building.gains.lighting.profiles[0].magnitude.value'
 *     → key:building, key:gains, key:lighting, key:profiles,
 *       index:0, key:magnitude, key:value
 */
export function parsePath(path) {
  if (typeof path !== 'string' || path.length === 0) return []
  const segments = []
  // Split on '.' but keep bracket-content with the preceding token.
  // Approach: a small character-by-character scanner.
  let i = 0
  let buf = ''
  const flushKey = () => { if (buf.length > 0) { segments.push({ kind: 'key', name: buf }); buf = '' } }
  while (i < path.length) {
    const ch = path[i]
    if (ch === '.') {
      flushKey()
      i++
      continue
    }
    if (ch === '[') {
      flushKey()
      // Read until ']'
      const end = path.indexOf(']', i + 1)
      if (end === -1) {
        // Malformed — treat the rest as a literal key.
        buf += path.slice(i)
        break
      }
      const body = path.slice(i + 1, end)
      if (body.startsWith('id=')) {
        segments.push({ kind: 'match', key: 'id', value: body.slice(3) })
      } else if (/^\d+$/.test(body)) {
        segments.push({ kind: 'index', index: parseInt(body, 10) })
      } else {
        // Generic key=value match — e.g. [service=heating]
        const eq = body.indexOf('=')
        if (eq > 0) {
          segments.push({ kind: 'match', key: body.slice(0, eq), value: body.slice(eq + 1) })
        } else {
          // Treat as a literal key (e.g. someone wrote [oddly])
          segments.push({ kind: 'key', name: body })
        }
      }
      i = end + 1
      continue
    }
    buf += ch
    i++
  }
  flushKey()
  return segments
}

// ── Path navigation ────────────────────────────────────────────────────

/**
 * Walk segments and return { container, leafKey } such that
 * container[leafKey] is the addressable target for set / replace, or
 * such that container is the array for add / remove and leafKey is null
 * when the path resolves to an array itself.
 *
 * For id-matched array entries, `leafKey` is the resolved numeric index.
 *
 * Returns { container: null, leafKey: null } if any segment fails to
 * resolve. Callers MUST check and treat that as a no-op application.
 */
export function navigateToParent(root, segments) {
  if (!root || segments.length === 0) return { container: null, leafKey: null }
  let cur = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (cur == null) return { container: null, leafKey: null }
    if (seg.kind === 'key') {
      cur = cur[seg.name]
    } else if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return { container: null, leafKey: null }
      cur = cur[seg.index]
    } else if (seg.kind === 'match') {
      if (!Array.isArray(cur)) return { container: null, leafKey: null }
      const idx = cur.findIndex(entry => entry != null && entry[seg.key] === seg.value)
      if (idx === -1) return { container: null, leafKey: null }
      cur = cur[idx]
    }
  }
  if (cur == null) return { container: null, leafKey: null }
  const last = segments[segments.length - 1]
  if (last.kind === 'key') return { container: cur, leafKey: last.name }
  if (last.kind === 'index') return { container: cur, leafKey: last.index }
  if (last.kind === 'match') {
    if (!Array.isArray(cur)) return { container: null, leafKey: null }
    const idx = cur.findIndex(entry => entry != null && entry[last.key] === last.value)
    if (idx === -1) return { container: null, leafKey: null }
    return { container: cur, leafKey: idx }
  }
  return { container: null, leafKey: null }
}

/**
 * Navigate to the array at `path` for add / remove ops. The path's leaf
 * must resolve to an Array. Returns the array reference or null on failure.
 */
function navigateToArray(root, segments) {
  if (!root || segments.length === 0) return null
  let cur = root
  for (const seg of segments) {
    if (cur == null) return null
    if (seg.kind === 'key') cur = cur[seg.name]
    else if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return null
      cur = cur[seg.index]
    } else if (seg.kind === 'match') {
      if (!Array.isArray(cur)) return null
      const idx = cur.findIndex(entry => entry != null && entry[seg.key] === seg.value)
      if (idx === -1) return null
      cur = cur[idx]
    }
  }
  return Array.isArray(cur) ? cur : null
}

// ── Value resolution ───────────────────────────────────────────────────

/**
 * Resolve a patch's value against libraryData when source === 'library'.
 * Inline values pass through unchanged.
 *
 * Library refs are objects of shape { library_ref: 'lib_id' }. The lookup
 * searches across the known library arrays carried in libraryData
 * (constructions, system_templates, schedules) and the per-project
 * library on libraryData (library_systems from Brief 40 Part 3,
 * library_schedules from Brief 37 if present). First match by `id` wins.
 *
 * Returns null if source === 'library' but the ref doesn't resolve;
 * applyPatch treats null-resolution as no-op application and logs a
 * warning (audit doc §6 patch_application_error).
 */
export function resolveValue(value, source, libraryData) {
  if (source !== 'library') return value
  if (!value || typeof value !== 'object' || typeof value.library_ref !== 'string') return value
  return libraryLookup(value.library_ref, libraryData)
}

function libraryLookup(libRef, libraryData) {
  if (!libraryData || typeof libraryData !== 'object') return null
  const candidates = [
    libraryData.constructions,
    libraryData.system_templates,
    libraryData.schedules,
    libraryData.library_systems,
    libraryData.library_schedules,
    libraryData.library_interventions,
  ]
  for (const arr of candidates) {
    if (!Array.isArray(arr)) continue
    const found = arr.find(item => item && item.id === libRef)
    if (found) return found
  }
  return null
}

// ── Patch application ─────────────────────────────────────────────────

const HAS_STRUCTURED_CLONE = typeof structuredClone === 'function'

function deepClone(obj) {
  if (HAS_STRUCTURED_CLONE) {
    try { return structuredClone(obj) } catch { /* fall through to JSON path */ }
  }
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Apply a single patch to config. Returns a new (cloned + mutated) config
 * on success, or the original config unchanged on a path-resolution
 * failure (with a console warning). NEVER mutates the input.
 */
export function applyPatch(config, patch, libraryData) {
  if (!config || !patch || typeof patch !== 'object') return config
  const segments = parsePath(patch.path)
  if (segments.length === 0) {
    console.warn('[interventionsEngine] patch_application_error: empty path', patch)
    return config
  }
  const resolved = resolveValue(patch.value, patch.source, libraryData)
  if (patch.source === 'library' && resolved == null) {
    console.warn('[interventionsEngine] patch_application_error: library_ref unresolved', patch)
    return config
  }

  const cloned = deepClone(config)

  switch (patch.op) {
    case 'set': {
      const { container, leafKey } = navigateToParent(cloned, segments)
      if (container == null) {
        console.warn('[interventionsEngine] patch_application_error: set path not found', patch)
        return config
      }
      container[leafKey] = resolved
      return cloned
    }
    // Relative ops (interventions-fix brief D1). Unlike `set`, these read the
    // CURRENT (live) value at the path and transform it — so a measure is a
    // relative transformation coherent against ANY baseline (Model 2 here), not
    // an absolute frozen to a config that no longer exists.
    //   scale: value ×= factor        delta: value += amount
    // FAIL LOUDLY, never silently: a scale/delta that can't resolve its path or
    // finds a non-numeric current value THROWS — a silent no-op would leave the
    // value untransformed and the measure would compute as a placebo (exactly
    // the failure class the diagnostic caught). Authoring errors surface here.
    case 'scale':
    case 'delta': {
      const { container, leafKey } = navigateToParent(cloned, segments)
      if (container == null) {
        throw new Error(`[interventionsEngine] ${patch.op}: path not found — ${patch.path}`)
      }
      const cur = container[leafKey]
      if (typeof cur !== 'number' || !Number.isFinite(cur)) {
        throw new Error(`[interventionsEngine] ${patch.op}: current value at ${patch.path} is not a finite number (got ${JSON.stringify(cur)})`)
      }
      const operand = Number(resolved)
      if (!Number.isFinite(operand)) {
        throw new Error(`[interventionsEngine] ${patch.op}: operand is not a finite number (got ${JSON.stringify(resolved)})`)
      }
      container[leafKey] = patch.op === 'scale' ? cur * operand : cur + operand
      return cloned
    }
    case 'add': {
      const arr = navigateToArray(cloned, segments)
      if (!Array.isArray(arr)) {
        console.warn('[interventionsEngine] patch_application_error: add path is not an array', patch)
        return config
      }
      arr.push(resolved)
      return cloned
    }
    case 'remove': {
      const arr = navigateToArray(cloned, segments)
      if (!Array.isArray(arr)) {
        console.warn('[interventionsEngine] patch_application_error: remove path is not an array', patch)
        return config
      }
      if (!patch.match || typeof patch.match !== 'object') {
        console.warn('[interventionsEngine] patch_application_error: remove requires match', patch)
        return config
      }
      const matchKeys = Object.keys(patch.match)
      const idx = arr.findIndex(entry =>
        entry != null && matchKeys.every(k => entry[k] === patch.match[k])
      )
      if (idx === -1) {
        console.warn('[interventionsEngine] patch_application_error: remove match not found', patch)
        return config
      }
      arr.splice(idx, 1)
      return cloned
    }
    case 'replace': {
      const arr = navigateToArray(cloned, segments)
      if (!Array.isArray(arr)) {
        console.warn('[interventionsEngine] patch_application_error: replace path is not an array', patch)
        return config
      }
      if (!patch.match || typeof patch.match !== 'object') {
        console.warn('[interventionsEngine] patch_application_error: replace requires match', patch)
        return config
      }
      const matchKeys = Object.keys(patch.match)
      const idx = arr.findIndex(entry =>
        entry != null && matchKeys.every(k => entry[k] === patch.match[k])
      )
      if (idx === -1) {
        console.warn('[interventionsEngine] patch_application_error: replace match not found', patch)
        return config
      }
      arr[idx] = resolved
      return cloned
    }
    default:
      console.warn('[interventionsEngine] patch_application_error: unknown op', patch.op, patch)
      return config
  }
}

/**
 * Apply every patch in an intervention to config, in order. Skipped if
 * the intervention is disabled.
 */
export function applyIntervention(config, intervention, libraryData) {
  if (!intervention || intervention.enabled === false) return config
  const patches = Array.isArray(intervention.patches) ? intervention.patches : []
  let result = config
  for (const patch of patches) {
    result = applyPatch(result, patch, libraryData)
  }
  return result
}

// ── Stack runner ──────────────────────────────────────────────────────

/**
 * Run the intervention stack:
 *   1. Build the cumulative config list: [baseline, after_int_1, after_int_2, ...]
 *      (disabled interventions don't modify the rolling config — they're skipped)
 *   2. Run runEngine on each config to produce results
 *   3. Compute marginal (vs previous CONFIG in the rolling list) and
 *      cumulative (vs baseline) deltas per intervention
 *
 * Disabled-intervention semantics (audit doc §1, Notion §10):
 *   - Disabled interventions are skipped — their patches are NOT applied
 *     to the rolling config.
 *   - The disabled intervention still appears in the result list with
 *     `enabled: false` so the UI can render its row in muted state.
 *   - The disabled intervention's `result` is the SAME as the previous
 *     intervention's result (or baseline if disabled is first); its
 *     marginal_delta is therefore all zeros.
 *   - Subsequent enabled interventions compute their marginal against
 *     the PREVIOUS ENABLED state — i.e. the rolling config skips the
 *     disabled entry.
 */
export function runInterventionStack(baselineConfig, interventions, runEngine, libraryData) {
  const list = Array.isArray(interventions) ? interventions : []
  // Build the rolling config — disabled interventions don't advance it.
  const configs = [baselineConfig]
  // Per-row reference: which rolling-config index each intervention's
  // result corresponds to. Disabled rows point to the previous enabled
  // (or baseline if no enabled prior).
  const rowConfigIndex = []
  for (const intervention of list) {
    if (intervention && intervention.enabled !== false) {
      const next = applyIntervention(configs[configs.length - 1], intervention, libraryData)
      configs.push(next)
      rowConfigIndex.push(configs.length - 1)
    } else {
      rowConfigIndex.push(configs.length - 1)
    }
  }
  // Run the engine on each rolling config.
  const rollingResults = configs.map(cfg => runEngine(cfg))
  // Compose the per-intervention result rows.
  const interventionRows = list.map((intervention, i) => {
    const myIdx = rowConfigIndex[i]
    // Previous rolling-config index: same as previous intervention's
    // rowConfigIndex (or 0 for the first row).
    const prevIdx = i === 0 ? 0 : rowConfigIndex[i - 1]
    return {
      id: intervention?.id ?? null,
      enabled: intervention?.enabled !== false,
      result: rollingResults[myIdx],
      marginal_delta: computeDelta(rollingResults[prevIdx], rollingResults[myIdx]),
      cumulative_delta: computeDelta(rollingResults[0], rollingResults[myIdx]),
    }
  })
  return {
    baseline: rollingResults[0],
    interventions: interventionRows,
  }
}

// ── Delta computation ─────────────────────────────────────────────────

/**
 * Build a single { from, to, delta, delta_pct } record. Returns null if
 * both ends are missing.
 */
function deltaRecord(from, to) {
  const f = Number.isFinite(from) ? from : null
  const t = Number.isFinite(to) ? to : null
  if (f === null && t === null) return null
  const fNum = f ?? 0
  const tNum = t ?? 0
  const delta = tNum - fNum
  const delta_pct = fNum !== 0 ? (delta / fNum) * 100 : null
  return { from: fNum, to: tNum, delta, delta_pct }
}

/**
 * Pull a numeric field from `result` via a list of path candidates.
 * Returns the first non-null finite value encountered, or null if none.
 * (Allows the same delta extractor to work across engine result shapes
 *  that may differ slightly across modes.)
 */
function pickNumber(result, paths) {
  if (!result || typeof result !== 'object') return null
  for (const path of paths) {
    let cur = result
    for (const seg of path.split('.')) {
      if (cur == null) break
      cur = cur[seg]
    }
    if (Number.isFinite(cur)) return cur
  }
  return null
}

/**
 * Display-side helper: post-MVHR heating demand for the BreakdownPanel.
 *
 * 2026-05-26 (refbox MVHR cap diagnostic — Brief 55 follow-on, Option (b)):
 *   `consumption.space_heating.demand_mwh` IS the post-MVHR demand. State 2
 *   bakes the (1-HRE) recovery into the demand via the vent UA factor —
 *   confirmed on the clean refbox: demand drops 182.6 → 147.8 MWh as HRE
 *   goes 0 → 0.75 at flow=500 L/s, matching the airstream integral
 *   (35.3 MWh) to within rounding. See instantCalc.js L4328-4343 and
 *   docs/audit/55_refbox_mvhr_cap.json.
 *
 *   The PREVIOUS implementation of this helper returned `raw − offset`,
 *   which double-subtracted recovery: it took the already-post-MVHR
 *   `demand_mwh` and subtracted `recovery_offset_mwh` (the airstream
 *   recovery integral, surfaced for display) a SECOND time. On Bridgewater
 *   that produced a NEGATIVE "After heat recovery" panel row (−68.68 MWh
 *   when raw=101.9 and offset=170.58). Engine was always correct; this
 *   helper was wrong.
 *
 * Returns the engine-emitted post-MVHR demand. Null when missing.
 */
function _postMvhrHeatingDemand(result) {
  return pickNumber(result, ['consumption.space_heating.demand_mwh'])
}

/**
 * Brief 48 Part 1 (2026-05-25): per-service efficiency-metric path for
 * the `_serviceDelta` extension. Heating → scop_effective, cooling →
 * seer_effective. DHW + ventilation + lighting + small_power have no
 * single-number efficiency on the engine result — the panel derives
 * DHW efficiency from delivered ÷ (electricity + gas) on its own.
 */
function _efficiencyPathFor(service) {
  if (service === 'space_heating') return 'consumption.space_heating.scop_effective'
  if (service === 'space_cooling') return 'consumption.space_cooling.seer_effective'
  return null
}

/**
 * Compute a structured delta object between two engine results.
 * Headline metrics + per-service + per-fuel (best-effort — fields not
 * present on the engine result yield null in their record slot).
 *
 * Field names mirror common consumption.* roots used across the
 * existing engine paths. The Part 5 comparison view + Brief 48
 * breakdown panel both read from this shape; if a field is missing,
 * a record slot will read null rather than crashing.
 *
 * Brief 48 Part 1 (2026-05-25) — boundary-named field additions:
 *
 * The existing `heating_demand_mwh` field reads `consumption.space_heating.
 * demand_mwh`. For back-compat the field is RETAINED. Brief 48 adds three
 * boundary-named fields alongside:
 *
 *   heating_raw_demand_mwh        — engine demand_mwh (POST-MVHR per
 *                                    State 2's (1-HRE) factor — see the
 *                                    instantCalc.js L4328-4343 comment).
 *   heating_recovery_offset_mwh   — the airstream recovery integral,
 *                                    surfaced for display.
 *   heating_post_mvhr_demand_mwh  — same as heating_raw_demand_mwh
 *                                    (engine demand is already post-MVHR).
 *                                    Kept as a distinct field so the
 *                                    BreakdownPanel "After heat recovery"
 *                                    row can reference an explicit name.
 *
 * 2026-05-26 update (refbox MVHR cap diagnostic — Brief 55 follow-on,
 * Option (b)): the previous `heating_post_mvhr_demand_mwh = raw − offset`
 * formula double-subtracted recovery. The refbox proved engine demand_mwh
 * is already post-MVHR. The helper now returns engine demand_mwh directly.
 * Falsifiability: after-recovery == demand_mwh on every project including
 * Bridgewater (never negative); refbox after-recovery == post-MVHR demand
 * at every flow.
 *
 * Reconciliation identity #3 (cumulative === sum of marginals on
 * Bridgewater): TRUE BY CONSTRUCTION for every field on this object.
 * `deltaRecord.delta = to − from`. For consecutive interventions where
 * `prev(i+1) = my(i)`, the telescoping sum collapses:
 *   sum(marginal[i].delta for i in 0..N)
 *     = (my(0) − baseline) + (my(1) − my(0)) + … + (my(N) − my(N−1))
 *     = my(N) − baseline
 *     = cumulative[N].delta
 * Any deviation observable on Bridgewater would be a floating-point
 * rounding artefact, NOT a Finding D defect. The reorder behaviour
 * (Finding D from Brief 47 walkthrough) is therefore correct marginal
 * physics at the delta-extraction layer — if reordering changes the
 * cumulative numerically, the divergence comes from upstream patch
 * application (overlapping patches → last-write-wins per Brief 41 §6),
 * not from `computeDelta`. The Part 5 walkthrough will read this off
 * the new panel; Brief 48 records the algebraic conclusion HERE so
 * the next boundary-fix brief starts from the right hypothesis.
 */
export function computeDelta(fromResult, toResult) {
  return {
    // Headline — canonical consumption.total.kwh_per_m2_yr first, then legacy
    // per-m² summary shapes. The deprecated top-level alias (Brief 88) is not
    // listed: canonical always wins for instant results, read via engineReads.
    eui_kwh_per_m2:      deltaRecord(
      pickNumber(fromResult, ['consumption.total.kwh_per_m2_yr', 'results.energy.kwh_per_m2_yr', 'energy_use.totals.eui_kwh_per_m2', 'eui_kwh_per_m2', 'eui_kWh_per_m2', 'results_summary.eui_kWh_per_m2']),
      pickNumber(toResult,   ['consumption.total.kwh_per_m2_yr', 'results.energy.kwh_per_m2_yr', 'energy_use.totals.eui_kwh_per_m2', 'eui_kwh_per_m2', 'eui_kWh_per_m2', 'results_summary.eui_kWh_per_m2']),
    ),
    total_delivered_mwh: deltaRecord(
      pickNumber(fromResult, ['results.energy.total_mwh', 'consumption.total_delivered_mwh', 'total_delivered_mwh', 'annual_energy.total_kWh', 'fuel_split.total_kWh']),
      pickNumber(toResult,   ['results.energy.total_mwh', 'consumption.total_delivered_mwh', 'total_delivered_mwh', 'annual_energy.total_kWh', 'fuel_split.total_kWh']),
    ),
    carbon_kgco2_per_m2: deltaRecord(
      pickNumber(fromResult, ['carbon_kg_co2_per_m2', 'results.carbon.today.kgCO2_per_m2_yr', 'carbon_kgco2_per_m2', 'consumption.carbon_kgco2_per_m2', 'carbon_kgCO2_m2', 'results_summary.carbon_kgco2_per_m2']),
      pickNumber(toResult,   ['carbon_kg_co2_per_m2', 'results.carbon.today.kgCO2_per_m2_yr', 'carbon_kgco2_per_m2', 'consumption.carbon_kgco2_per_m2', 'carbon_kgCO2_m2', 'results_summary.carbon_kgco2_per_m2']),
    ),
    // Demand-side: State 3 emits MWh under `consumption.{service}.demand_mwh`;
    // degree-day fallback emits kWh under `annual_{service}_kWh` (which we
    // divide by 1000 for parity is NOT done here — comparison view shows
    // kWh-vs-MWh by reading the actual values; deltaRecord is unit-agnostic
    // and the comparison view's label tracks "MWh" generically. The slot
    // exposes raw values from whichever shape the engine produced.)
    heating_demand_mwh:  deltaRecord(
      pickNumber(fromResult, ['consumption.space_heating.demand_mwh', 'demand.heating_demand_mwh', 'demand.heating_mwh', 'consumption.heating_demand_mwh', 'heating_demand_mwh', 'annual_heating_kWh']),
      pickNumber(toResult,   ['consumption.space_heating.demand_mwh', 'demand.heating_demand_mwh', 'demand.heating_mwh', 'consumption.heating_demand_mwh', 'heating_demand_mwh', 'annual_heating_kWh']),
    ),
    // Brief 48 Part 1 (2026-05-25) — boundary-named heating-demand triple.
    // Added alongside `heating_demand_mwh` (kept as back-compat alias).
    // See computeDelta docstring for the post-MVHR derivation rationale
    // and the cumulative-equals-sum-of-marginals proof.
    heating_raw_demand_mwh: deltaRecord(
      pickNumber(fromResult, ['consumption.space_heating.demand_mwh']),
      pickNumber(toResult,   ['consumption.space_heating.demand_mwh']),
    ),
    heating_recovery_offset_mwh: deltaRecord(
      pickNumber(fromResult, ['consumption.space_heating.recovery_offset_mwh']),
      pickNumber(toResult,   ['consumption.space_heating.recovery_offset_mwh']),
    ),
    heating_post_mvhr_demand_mwh: deltaRecord(
      _postMvhrHeatingDemand(fromResult),
      _postMvhrHeatingDemand(toResult),
    ),
    cooling_demand_mwh:  deltaRecord(
      pickNumber(fromResult, ['consumption.space_cooling.demand_mwh', 'demand.cooling_demand_mwh', 'demand.cooling_mwh', 'consumption.cooling_demand_mwh', 'cooling_demand_mwh', 'annual_cooling_kWh']),
      pickNumber(toResult,   ['consumption.space_cooling.demand_mwh', 'demand.cooling_demand_mwh', 'demand.cooling_mwh', 'consumption.cooling_demand_mwh', 'cooling_demand_mwh', 'annual_cooling_kWh']),
    ),
    // Per-service delivered (Brief 40 / v40 + v25 engine paths attach
    // these under consumption.* sub-blocks).
    per_service: {
      heating:      _serviceDelta(fromResult, toResult, 'space_heating'),
      cooling:      _serviceDelta(fromResult, toResult, 'space_cooling'),
      dhw:          _serviceDelta(fromResult, toResult, 'dhw'),
      ventilation:  _serviceDelta(fromResult, toResult, 'ventilation'),
      lighting:     _serviceDelta(fromResult, toResult, 'lighting'),
      small_power:  _serviceDelta(fromResult, toResult, 'small_power'),
    },
    // Per-fuel — State 3 emits MWh under consumption.total.*_mwh + results.energy.by_carrier.*,
    // degree-day fallback emits kWh under fuel_split.*.
    per_fuel: {
      electricity_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.total.electricity_mwh', 'results.energy.by_carrier.electricity', 'consumption.electricity_mwh', 'annual_energy.electricity_kWh', 'fuel_split.electricity_kWh']),
        pickNumber(toResult,   ['consumption.total.electricity_mwh', 'results.energy.by_carrier.electricity', 'consumption.electricity_mwh', 'annual_energy.electricity_kWh', 'fuel_split.electricity_kWh']),
      ),
      gas_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.total.gas_mwh', 'results.energy.by_carrier.gas', 'consumption.gas_mwh', 'annual_energy.gas_kWh', 'fuel_split.gas_kWh']),
        pickNumber(toResult,   ['consumption.total.gas_mwh', 'results.energy.by_carrier.gas', 'consumption.gas_mwh', 'annual_energy.gas_kWh', 'fuel_split.gas_kWh']),
      ),
      oil_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.oil_mwh']),
        pickNumber(toResult,   ['consumption.oil_mwh']),
      ),
      district_heat_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.total.district_heat_mwh', 'results.energy.by_carrier.district_heat', 'consumption.district_heat_mwh']),
        pickNumber(toResult,   ['consumption.total.district_heat_mwh', 'results.energy.by_carrier.district_heat', 'consumption.district_heat_mwh']),
      ),
    },
    // Per-envelope-term (Building module integrand)
    per_envelope: {
      wall_loss_mwh:           _envelopeDelta(fromResult, toResult, 'wall'),
      roof_loss_mwh:           _envelopeDelta(fromResult, toResult, 'roof'),
      ground_loss_mwh:         _envelopeDelta(fromResult, toResult, 'ground'),
      glazing_loss_mwh:        _envelopeDelta(fromResult, toResult, 'glazing'),
      infiltration_loss_mwh:   _envelopeDelta(fromResult, toResult, 'infiltration'),
      permanent_vent_loss_mwh: _envelopeDelta(fromResult, toResult, 'permanent_vents'),
      thermal_bridge_loss_mwh: _envelopeDelta(fromResult, toResult, 'thermal_bridge'),
      solar_gain_mwh:          _envelopeDelta(fromResult, toResult, 'solar'),
    },
  }
}

function _serviceDelta(fromResult, toResult, service) {
  // Brief 48 Part 1 (2026-05-25): per-service split extended from
  // {delivered, demand} → {delivered, demand, electricity, gas,
  // efficiency}. The breakdown panel needs these to make the
  // "delivered ÷ efficiency = electricity + gas" identity visually
  // legible per row. Fields not emitted by the engine for a given
  // service (e.g. ventilation has per-vent fan_electricity but no
  // service-level aggregate; lighting + small_power have no gas)
  // yield null record slots — the panel renders "—" in those cells.
  const effPath = _efficiencyPathFor(service)
  return {
    delivered_mwh: deltaRecord(
      pickNumber(fromResult, [
        `consumption.${service}.delivered_mwh`,
        `consumption.${service}.delivered_total_mwh`,
      ]),
      pickNumber(toResult, [
        `consumption.${service}.delivered_mwh`,
        `consumption.${service}.delivered_total_mwh`,
      ]),
    ),
    demand_mwh: deltaRecord(
      pickNumber(fromResult, [`consumption.${service}.demand_mwh`]),
      pickNumber(toResult,   [`consumption.${service}.demand_mwh`]),
    ),
    electricity_mwh: deltaRecord(
      pickNumber(fromResult, [`consumption.${service}.electricity_mwh`]),
      pickNumber(toResult,   [`consumption.${service}.electricity_mwh`]),
    ),
    gas_mwh: deltaRecord(
      pickNumber(fromResult, [`consumption.${service}.gas_mwh`]),
      pickNumber(toResult,   [`consumption.${service}.gas_mwh`]),
    ),
    // Efficiency metric — SCOP for heating, SEER for cooling, null for
    // others (the panel can derive DHW efficiency from delivered/(elec+gas)).
    efficiency: effPath
      ? deltaRecord(
          pickNumber(fromResult, [effPath]),
          pickNumber(toResult,   [effPath]),
        )
      : null,
  }
}

function _envelopeDelta(fromResult, toResult, term) {
  return deltaRecord(
    pickNumber(fromResult, [
      `losses.${term}_mwh`,
      `envelope.${term}_loss_mwh`,
      `heat_balance.${term}_mwh`,
    ]),
    pickNumber(toResult, [
      `losses.${term}_mwh`,
      `envelope.${term}_loss_mwh`,
      `heat_balance.${term}_mwh`,
    ]),
  )
}

// ── Schema migration scaffolding ──────────────────────────────────────

/**
 * Schema-flexibility discipline (Notion §7 / audit doc 41 §7 / audit
 * doc 42 §7).
 *
 * Briefs that change `building_config` schema in a way that touches
 * existing patch paths register a migration function here. The
 * signature is:
 *
 *   migratePatch(patch, fromVersion, toVersion)
 *     → patch                                        (no change / unrecognised path)
 *     → [patch, ...]                                 (one v1 patch produces multiple v2 patches)
 *     → { deprecated: true, reason: '...' }          (no v2 equivalent)
 *
 * Migration steps chain: a project at `schema_version: 1` migrating to
 * `schema_version: 3` runs v1→v2 then v2→v3 in sequence. The patch
 * returned by step N is the input to step N+1.
 *
 * Brief 42 (2026-05-20) registers the v1→v2 step — Systems UX
 * reorganisation lifts building-level fields (setpoints, DHW demand
 * + temps) out of per-system entries to service-level positions on
 * `systems_config_v40`. Pre-v2 patches addressing the per-system
 * fields get rewritten to the new service-level paths.
 */

// ── Brief 42 v1 → v2 path rewrites ────────────────────────────────────
//
// Each entry is { test: RegExp, rewrite: (patch, match) → patch | [patch, ...] | { deprecated, reason } }.
// The test captures the path-root (`building` or `building_config`) as
// match[1]; the rewrite preserves that root in the rewritten path so
// the caller's choice of `building` vs `building_config` is honoured.
//
// Heating + cooling setpoint rewrites are multi-emit:
//   - patch.value === null → single patch setting *_setpoint_mode = 'follow_comfort'
//                            (no _c patch needed; mode='follow_comfort' means engine
//                            substitutes comfort band at compute time)
//   - patch.value non-null → two patches:
//       (a) *_setpoint_mode = 'custom'
//       (b) *_setpoint_c    = <value>
//     emitted mode-first so the value patch is the "last write" (any
//     subsequent override of just the value path doesn't accidentally
//     reset mode back to 'follow_comfort').
//
// DHW path rewrites are single-emit — no mode flag, just relabel the
// service-level field.
const V1_TO_V2_PATCH_MIGRATIONS = [
  {
    // heating + cooling per-system setpoint → service-level mode + value
    test: /^(building(?:_config)?)\.systems_config_v40\.(heating|cooling)\[id=[^\]]+\]\.setpoint$/,
    rewrite: (patch, m) => {
      const root = m[1]
      const service = m[2]   // 'heating' | 'cooling'
      if (patch.op !== 'set') {
        return {
          deprecated: true,
          reason: `Brief 42 schema_version v1→v2: ${service} setpoint per-system field removed; ${patch.op} op on it is not supported. Re-author intervention against ${root}.systems_config_v40.${service}_setpoint_c.`,
        }
      }
      const baseProps = {
        source: patch.source ?? 'inline',
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      }
      if (patch.value === null || patch.value === undefined) {
        // "follow comfort band" intent
        return [{
          id: patch.id,
          op: 'set',
          path: `${root}.systems_config_v40.${service}_setpoint_mode`,
          value: 'follow_comfort',
          ...baseProps,
        }]
      }
      // Custom setpoint value
      return [
        {
          id: `${patch.id}_mode`,
          op: 'set',
          path: `${root}.systems_config_v40.${service}_setpoint_mode`,
          value: 'custom',
          ...baseProps,
        },
        {
          id: patch.id,
          op: 'set',
          path: `${root}.systems_config_v40.${service}_setpoint_c`,
          value: patch.value,
          ...baseProps,
        },
      ]
    },
  },
  {
    // DHW per-system setpoint (storage temperature) → service-level
    test: /^(building(?:_config)?)\.systems_config_v40\.dhw\[id=[^\]]+\]\.setpoint$/,
    rewrite: (patch, m) => {
      const root = m[1]
      if (patch.op !== 'set') {
        return {
          deprecated: true,
          reason: `Brief 42 schema_version v1→v2: DHW storage setpoint moved to service-level; ${patch.op} op on per-system path no longer supported.`,
        }
      }
      return { ...patch, path: `${root}.systems_config_v40.dhw_storage_setpoint_c` }
    },
  },
  {
    test: /^(building(?:_config)?)\.systems_config_v40\.dhw\[id=[^\]]+\]\.tap_outlet_temp_c$/,
    rewrite: (patch, m) => ({ ...patch, path: `${m[1]}.systems_config_v40.dhw_tap_outlet_temp_c` }),
  },
  {
    test: /^(building(?:_config)?)\.systems_config_v40\.dhw\[id=[^\]]+\]\.cold_supply_temp_c$/,
    rewrite: (patch, m) => ({ ...patch, path: `${m[1]}.systems_config_v40.dhw_cold_supply_temp_c` }),
  },
  {
    test: /^(building(?:_config)?)\.systems_config_v40\.dhw\[id=[^\]]+\]\.demand_basis$/,
    rewrite: (patch, m) => ({ ...patch, path: `${m[1]}.systems_config_v40.dhw_demand_basis` }),
  },
  {
    test: /^(building(?:_config)?)\.systems_config_v40\.dhw\[id=[^\]]+\]\.demand_litres_per_person_per_day$/,
    rewrite: (patch, m) => ({ ...patch, path: `${m[1]}.systems_config_v40.dhw_demand_litres_per_person_per_day` }),
  },
  {
    test: /^(building(?:_config)?)\.systems_config_v40\.dhw\[id=[^\]]+\]\.demand_litres_per_m2_day$/,
    rewrite: (patch, m) => ({ ...patch, path: `${m[1]}.systems_config_v40.dhw_demand_litres_per_m2_per_day` }),
  },
]

function migrateV1toV2(patch) {
  if (!patch || typeof patch !== 'object' || typeof patch.path !== 'string') return patch
  for (const rule of V1_TO_V2_PATCH_MIGRATIONS) {
    const m = patch.path.match(rule.test)
    if (m) return rule.rewrite(patch, m)
  }
  return patch  // no v1→v2 rewrite applies — patch passes through unchanged
}

// ── Brief 55 v2 → v3 migration ────────────────────────────────────────
//
// Whole-object `systems_config_v40` snapshots → field-level patches.
// Detects the legacy capture shape (one `op:set` patch on
// `building.systems_config_v40` with the entire v40 as value), and
// expands it into one patch per CHANGED leaf by diffing against the
// project's baseline v40.
//
// Needs the baseline systems_config_v40 to diff against — passed via
// the second arg `baselineV40` on the migration step. Loader supplies
// it (the project's `building_config.systems_config_v40` at load time);
// the engine doesn't see baselines, so `migratePatch` exposes the
// optional `baselineConfig` arg for this case.
//
// Audit: docs/audit/55_granular_patch.md §6.
import { diffV40ToFieldPatches } from '../components/modules/interventions/patchCapture.js'

function migrateV2toV3(patch, baselineV40) {
  if (!patch || typeof patch !== 'object' || typeof patch.path !== 'string') return patch
  // Only legacy whole-object v40 snapshots qualify. Other paths
  // (already field-level building.* / constructions.* / etc.) pass
  // through unchanged.
  if (patch.op !== 'set' || patch.path !== 'building.systems_config_v40') return patch
  const snapshotV40 = patch.value
  if (!snapshotV40 || typeof snapshotV40 !== 'object' || Array.isArray(snapshotV40)) return patch
  // Diff against the project baseline. baselineV40 SHOULD be the
  // bc.systems_config_v40 from disk (the pre-interventions ground truth).
  // When the loader doesn't provide it (defensive), fall back to a {}
  // baseline so the diff emits "add everything" — slightly wasteful but
  // semantically equivalent (the whole snapshot becomes additions).
  const prev = baselineV40 ?? {}
  const fieldPatches = diffV40ToFieldPatches(prev, snapshotV40)
  if (fieldPatches.length === 0) {
    // Snapshot equals baseline — no-op intervention, drop it.
    return { deprecated: true, reason: 'Brief 55 v2→v3: legacy whole-object systems_config_v40 snapshot was identical to baseline — no-op patch dropped.' }
  }
  return fieldPatches
}

/**
 * Migrate a single patch through the version chain.
 *
 * `baselineConfig` is optional and is consulted by steps that need to
 * diff against the project baseline (Brief 55 v2→v3). Pass the project's
 * `building_config` (or at least `building_config.systems_config_v40`).
 */
export function migratePatch(patch, fromVersion, toVersion, baselineConfig = null) {
  if (fromVersion === toVersion) return patch
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) return patch
  if (fromVersion > toVersion) return patch   // downgrades not supported
  let cur = patch
  const baselineV40 = baselineConfig?.systems_config_v40 ?? baselineConfig ?? null
  for (let v = fromVersion; v < toVersion; v++) {
    if (v === 1) cur = _applyMigrationStep(cur, migrateV1toV2)
    else if (v === 2) cur = _applyMigrationStep(cur, p => migrateV2toV3(p, baselineV40))
    // Future schema-changing briefs add cases here.
  }
  return cur
}

// Apply a migration step to a single patch OR an array of patches
// (intermediate result from a prior step). Preserves deprecation
// markers as-is (caller separates them out).
function _applyMigrationStep(input, stepFn) {
  if (Array.isArray(input)) {
    const out = []
    for (const p of input) {
      const r = stepFn(p)
      if (Array.isArray(r)) out.push(...r)
      else if (r) out.push(r)
    }
    return out
  }
  return stepFn(input)
}

/**
 * Walk an intervention's `patches` list through the migration chain,
 * flat-mapping array-returns and separating out deprecation markers.
 * Returns `{ ...intervention, schema_version: toVersion, patches:
 * <migrated>, _deprecated_patches?: [...] }`.
 *
 * Used by the project loader on load when `intervention.schema_version
 * < current_schema_version`. Brief 42 Part 2 wires the call site.
 */
export function migrateInterventionPatches(intervention, fromVersion, toVersion, baselineConfig = null) {
  if (!intervention || !Array.isArray(intervention.patches)) return intervention
  if (fromVersion === toVersion) return intervention
  const migrated = []
  const deprecated = []
  for (const p of intervention.patches) {
    const r = migratePatch(p, fromVersion, toVersion, baselineConfig)
    if (Array.isArray(r)) {
      for (const x of r) {
        if (x && x.deprecated) deprecated.push({ original: p, ...x })
        else if (x) migrated.push(x)
      }
    } else if (r && r.deprecated) {
      deprecated.push({ original: p, ...r })
    } else if (r) {
      migrated.push(r)
    }
  }
  const result = { ...intervention, schema_version: toVersion, patches: migrated }
  if (deprecated.length > 0) result._deprecated_patches = deprecated
  return result
}
