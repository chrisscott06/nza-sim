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
 *       → schema-flexibility scaffolding (no-op stub until first
 *         schema_version bump; see audit doc §7)
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
 * Compute a structured delta object between two engine results.
 * Headline metrics + per-service + per-fuel (best-effort — fields not
 * present on the engine result yield null in their record slot).
 *
 * Field names mirror common consumption.* roots used across the
 * existing engine paths. The Part 5 comparison view reads from this
 * shape; if a field is missing, the comparison view shows '—' in that
 * cell rather than crashing.
 */
export function computeDelta(fromResult, toResult) {
  return {
    // Headline
    eui_kwh_per_m2:      deltaRecord(
      pickNumber(fromResult, ['eui_kwh_per_m2', 'eui_kWh_per_m2', 'results_summary.eui_kWh_per_m2']),
      pickNumber(toResult,   ['eui_kwh_per_m2', 'eui_kWh_per_m2', 'results_summary.eui_kWh_per_m2']),
    ),
    total_delivered_mwh: deltaRecord(
      pickNumber(fromResult, ['consumption.total_delivered_mwh', 'total_delivered_mwh', 'annual_energy.total_kWh']),
      pickNumber(toResult,   ['consumption.total_delivered_mwh', 'total_delivered_mwh', 'annual_energy.total_kWh']),
    ),
    carbon_kgco2_per_m2: deltaRecord(
      pickNumber(fromResult, ['carbon_kgco2_per_m2', 'consumption.carbon_kgco2_per_m2', 'results_summary.carbon_kgco2_per_m2']),
      pickNumber(toResult,   ['carbon_kgco2_per_m2', 'consumption.carbon_kgco2_per_m2', 'results_summary.carbon_kgco2_per_m2']),
    ),
    // Demand-side (engine convention: `consumption.{service}.demand_mwh`)
    heating_demand_mwh:  deltaRecord(
      pickNumber(fromResult, ['consumption.space_heating.demand_mwh', 'demand.heating_mwh', 'consumption.heating_demand_mwh', 'heating_demand_mwh']),
      pickNumber(toResult,   ['consumption.space_heating.demand_mwh', 'demand.heating_mwh', 'consumption.heating_demand_mwh', 'heating_demand_mwh']),
    ),
    cooling_demand_mwh:  deltaRecord(
      pickNumber(fromResult, ['consumption.space_cooling.demand_mwh', 'demand.cooling_mwh', 'consumption.cooling_demand_mwh', 'cooling_demand_mwh']),
      pickNumber(toResult,   ['consumption.space_cooling.demand_mwh', 'demand.cooling_mwh', 'consumption.cooling_demand_mwh', 'cooling_demand_mwh']),
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
    // Per-fuel
    per_fuel: {
      electricity_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.electricity_mwh', 'annual_energy.electricity_kWh']),
        pickNumber(toResult,   ['consumption.electricity_mwh', 'annual_energy.electricity_kWh']),
      ),
      gas_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.gas_mwh', 'annual_energy.gas_kWh']),
        pickNumber(toResult,   ['consumption.gas_mwh', 'annual_energy.gas_kWh']),
      ),
      oil_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.oil_mwh']),
        pickNumber(toResult,   ['consumption.oil_mwh']),
      ),
      district_heat_mwh: deltaRecord(
        pickNumber(fromResult, ['consumption.district_heat_mwh']),
        pickNumber(toResult,   ['consumption.district_heat_mwh']),
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
 * Schema-flexibility discipline (Notion §7 / audit doc §7).
 *
 * Future briefs that change `building_config` schema in a way that
 * touches existing patch paths must register a migration function here.
 * The signature is `(patch, fromVersion, toVersion) → patch | { deprecated, reason }`.
 *
 * Brief 41 ships this as a no-op stub — no schema migrations exist yet,
 * because schema_version starts at 1 with Brief 41. The first schema
 * change that needs a patch migration will replace this body with a
 * dispatch table.
 */
export function migratePatch(patch, fromVersion, toVersion) {
  if (fromVersion === toVersion) return patch
  // No registered migrations as of Brief 41. Patches authored against
  // older schemas would silently pass through here today; the
  // discipline contract is that the schema change which would need a
  // migration MUST land it in this file alongside the schema change.
  return patch
}
