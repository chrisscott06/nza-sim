/**
 * patchCapture.js — Brief 41 Part 4
 *
 * Helpers for the intervention editor's patch capture flow:
 *
 *   newPatchId()
 *     Stable UUID for a new patch.
 *
 *   capturePatch(patches, newPatch)
 *     Dedupe-aware append. If a `set` patch already exists for the
 *     same path, the new patch replaces it in place (keeping the
 *     patch list short — one row per addressed leaf). For non-set
 *     ops or new paths, the new patch appends.
 *
 *   removePatch(patches, patchId)
 *     Removes the patch with the given id.
 *
 *   summarizePatch(patch, baselineConfig, libraryData)
 *     Returns a { label, value_before, value_after, percent? } object
 *     suitable for plain-English rendering in PatchList. Falls back
 *     to a generic representation if the path isn't recognised.
 *
 *   getValueAtPath(config, path)
 *     Read the value at a path (uses interventionsEngine's path
 *     parser). Returns undefined if path doesn't resolve.
 *
 * These run client-side only; they have no network or persistence
 * effects beyond what the consuming component does.
 */

import { parsePath, navigateToParent } from '../../../utils/interventionsEngine.js'

export function newPatchId() {
  const raw = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `patch_${raw}`
}

/**
 * Read value at path (read-only). Returns undefined if path doesn't
 * resolve in the given config.
 */
export function getValueAtPath(config, path) {
  if (!config || typeof path !== 'string') return undefined
  const segs = parsePath(path)
  const { container, leafKey } = navigateToParent(config, segs)
  if (container == null) return undefined
  return container[leafKey]
}

/**
 * Dedupe-aware patch append. For `set` ops the latest write to a
 * path wins — replace the existing patch at that path. For other ops
 * (add / remove / replace) just append, since they target arrays
 * with `match` keys that aren't path-collidable.
 */
export function capturePatch(patches, newPatch) {
  if (!Array.isArray(patches)) patches = []
  if (!newPatch || typeof newPatch !== 'object') return patches
  if (newPatch.op === 'set' && newPatch.path) {
    const existingIdx = patches.findIndex(p => p && p.op === 'set' && p.path === newPatch.path)
    if (existingIdx !== -1) {
      // Replace in place, preserving the original id so PatchList keys are stable.
      const replaced = [...patches]
      replaced[existingIdx] = { ...newPatch, id: patches[existingIdx].id }
      return replaced
    }
  }
  return [...patches, newPatch]
}

export function removePatch(patches, patchId) {
  if (!Array.isArray(patches) || !patchId) return patches
  return patches.filter(p => p && p.id !== patchId)
}

// ── Plain-English summarisation ───────────────────────────────────────

/**
 * Pretty-print a numeric value with a small set of formatting heuristics.
 */
function fmtNum(v, opts = {}) {
  if (v == null || !Number.isFinite(Number(v))) return String(v)
  const n = Number(v)
  if (opts.fixed != null) return n.toFixed(opts.fixed)
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 1)   return n.toFixed(2)
  return n.toFixed(3)
}

function fmtPct(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null
  const pct = ((after - before) / before) * 100
  const sign = pct < 0 ? '−' : '+'
  return `${sign}${Math.abs(pct).toFixed(0)}%`
}

/**
 * Match a path against a list of pattern handlers. Each handler is
 * `{ test: regex|fn, label: string|fn(match,parts) }`. Returns the
 * first match's label, or null if none match.
 *
 * The pattern handlers below cover the curated editor's targets in
 * Brief 41 Part 4. Future briefs can extend the list as patch surface
 * grows.
 */
const PATH_HANDLERS = [
  // Brief 43 Part 2: structural ops target whole-array paths.
  // pathLabel returns a service-aware label so PatchList reads as
  // "Added Heating system: ASHP" / "Removed DHW system: gas_combi_1".
  { test: /^building\.systems_config_v40\.heating$/,      label: 'Heating system' },
  { test: /^building\.systems_config_v40\.cooling$/,      label: 'Cooling system' },
  { test: /^building\.systems_config_v40\.dhw$/,          label: 'DHW system' },
  { test: /^building\.systems_config_v40\.ventilation$/,  label: 'Ventilation system' },
  { test: /^building\.systems_config_v40\.lighting$/,     label: 'Lighting entry' },
  { test: /^building\.systems_config_v40\.small_power$/,  label: 'Small power entry' },
  // Brief 43 Part 3: service-level (building-level) field paths post-Brief-42.
  { test: /^building\.systems_config_v40\.heating_setpoint_mode$/, label: 'Heating setpoint mode' },
  { test: /^building\.systems_config_v40\.heating_setpoint_c$/,    label: 'Heating setpoint',         unit: '°C' },
  { test: /^building\.systems_config_v40\.cooling_setpoint_mode$/, label: 'Cooling setpoint mode' },
  { test: /^building\.systems_config_v40\.cooling_setpoint_c$/,    label: 'Cooling setpoint',         unit: '°C' },
  { test: /^building\.systems_config_v40\.dhw_storage_setpoint_c$/, label: 'DHW storage setpoint',    unit: '°C' },
  { test: /^building\.systems_config_v40\.dhw_tap_outlet_temp_c$/,  label: 'DHW tap outlet',          unit: '°C' },
  { test: /^building\.systems_config_v40\.dhw_cold_supply_temp_c$/, label: 'DHW cold supply',         unit: '°C' },
  { test: /^building\.systems_config_v40\.dhw_demand_basis$/,       label: 'DHW demand basis' },
  { test: /^building\.systems_config_v40\.dhw_demand_litres_per_person_per_day$/, label: 'DHW demand',  unit: ' L/p/day' },
  { test: /^building\.systems_config_v40\.dhw_demand_litres_per_m2_per_day$/,     label: 'DHW demand',  unit: ' L/m²/day' },
  // Envelope
  { test: /^building\.infiltration_ach$/,                                              label: 'Infiltration (legacy ACH)',   unit: ' ACH' },
  { test: /^building\.fabric\.air_permeability_q50$/,                                  label: 'Air permeability (q50)',      unit: ' m³/(h·m²)' },
  { test: /^building\.openings\.(north|south|east|west)\.cd$/,                          label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} facade C_d` },
  { test: /^building\.openings\.(north|south|east|west)\.flow_mode$/,                   label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} facade flow mode` },
  // External shading (Brief 41 §V row 3)
  { test: /^building\.shading_overhang\.(north|south|east|west)\.depth_m$/,             label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} overhang depth`, unit: ' m' },
  { test: /^building\.shading_overhang\.(north|south|east|west)\.offset_m$/,            label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} overhang offset`, unit: ' m' },
  { test: /^building\.shading_fin\.(north|south|east|west)\.(left|right)_depth_m$/,     label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} ${m[2]} fin depth`, unit: ' m' },
  // Constructions (passed via construction_choices, but path root is "constructions" in the engine quartet).
  // Shape: { library_id: string, u_value_override: number|null }. Patches that swap
  // construction libraries write the whole object; an explicit U-override is a
  // future enhancement.
  { test: /^constructions\.external_wall$/,                                            label: 'External wall construction' },
  { test: /^constructions\.external_wall\.library_id$/,                                label: 'External wall library' },
  { test: /^constructions\.external_wall\.u_value_override$/,                          label: 'External wall U override', unit: ' W/m²·K' },
  { test: /^constructions\.roof$/,                                                     label: 'Roof construction' },
  { test: /^constructions\.roof\.library_id$/,                                         label: 'Roof library' },
  { test: /^constructions\.roof\.u_value_override$/,                                   label: 'Roof U override', unit: ' W/m²·K' },
  { test: /^constructions\.ground_floor$/,                                             label: 'Ground floor construction' },
  { test: /^constructions\.ground_floor\.library_id$/,                                 label: 'Ground floor library' },
  { test: /^constructions\.ground_floor\.u_value_override$/,                           label: 'Ground floor U override', unit: ' W/m²·K' },
  { test: /^constructions\.glazing$/,                                                  label: 'Glazing construction' },
  { test: /^constructions\.glazing\.library_id$/,                                      label: 'Glazing library' },
  { test: /^constructions\.glazing\.u_value_override$/,                                label: 'Glazing U override', unit: ' W/m²·K' },
  // Internal gains
  { test: /^building\.occupancy_rate$/,                                                label: 'Occupancy rate' },
  { test: /^building\.occupancy\.occupancy_rate$/,                                     label: 'Occupancy rate (v2.3)' },
  { test: /^building\.occupancy\.density\.value$/,                                     label: 'Occupancy density' },
  { test: /^building\.gains\.lighting\.profiles\[[^\]]+\]\.magnitude\.value$/,         label: 'Lighting load',                unit: ' W/m²' },
  { test: /^building\.gains\.equipment\.profiles\[[^\]]+\]\.active\.value$/,           label: 'Equipment active load',        unit: ' W/m²' },
  { test: /^building\.gains\.equipment\.profiles\[[^\]]+\]\.baseload\.value$/,         label: 'Equipment baseload',           unit: ' W/m²' },
  // Systems v40
  { test: /^building\.systems_config_v40\.heating\[id=([^\]]+)\]\.efficiency_metric$/, label: m => `Heating "${m[1]}" efficiency` },
  { test: /^building\.systems_config_v40\.heating\[id=([^\]]+)\]\.share_pct$/,         label: m => `Heating "${m[1]}" share`,        unit: '%' },
  { test: /^building\.systems_config_v40\.heating\[id=([^\]]+)\]\.enabled$/,           label: m => `Heating "${m[1]}" enabled` },
  { test: /^building\.systems_config_v40\.cooling\[id=([^\]]+)\]\.efficiency_metric$/, label: m => `Cooling "${m[1]}" efficiency` },
  { test: /^building\.systems_config_v40\.cooling\[id=([^\]]+)\]\.share_pct$/,         label: m => `Cooling "${m[1]}" share`,        unit: '%' },
  { test: /^building\.systems_config_v40\.cooling\[id=([^\]]+)\]\.enabled$/,           label: m => `Cooling "${m[1]}" enabled` },
  { test: /^building\.systems_config_v40\.cooling\[id=([^\]]+)\]\.setpoint$/,          label: m => `Cooling "${m[1]}" setpoint`,     unit: '°C' },
  { test: /^building\.systems_config_v40\.heating\[id=([^\]]+)\]\.setpoint$/,          label: m => `Heating "${m[1]}" setpoint`,     unit: '°C' },
  { test: /^building\.systems_config_v40\.dhw\[id=([^\]]+)\]\.efficiency_metric$/,     label: m => `DHW "${m[1]}" efficiency` },
  { test: /^building\.systems_config_v40\.dhw\[id=([^\]]+)\]\.share_pct$/,             label: m => `DHW "${m[1]}" share`,            unit: '%' },
  { test: /^building\.systems_config_v40\.dhw\[id=([^\]]+)\]\.enabled$/,               label: m => `DHW "${m[1]}" enabled` },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.efficiency_metric\.sfp_w_per_lps$/,         label: m => `Ventilation "${m[1]}" SFP (v40)`,           unit: ' W/l·s⁻¹' },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.efficiency_metric\.recovery_sensible_pct$/, label: m => `Ventilation "${m[1]}" sensible recovery (v40)`, unit: '%' },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.efficiency_metric\.recovery_latent_pct$/,   label: m => `Ventilation "${m[1]}" latent recovery (v40)`,   unit: '%' },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.enabled$/,       label: m => `Ventilation "${m[1]}" enabled` },
  // v25 vent mirror — written by editor's vent dual-write (State 2 demand-side reads v25)
  { test: /^building\.systems_config_v25\.ventilation\[id=([^\]]+)\]\.sfp_w_per_l_s$/,  label: m => `Ventilation "${m[1]}" SFP (v25 mirror)`,    unit: ' W/l·s⁻¹' },
  { test: /^building\.systems_config_v25\.ventilation\[id=([^\]]+)\]\.hre$/,            label: m => `Ventilation "${m[1]}" HRE (v25 mirror)`,    unit: '' },
  { test: /^building\.systems_config_v40\.lighting\[id=([^\]]+)\]\.control_mechanism$/,label: m => `Lighting "${m[1]}" control mechanism` },
  { test: /^building\.systems_config_v40\.lighting\[id=([^\]]+)\]\.control_factor$/,   label: m => `Lighting "${m[1]}" control factor` },
  { test: /^building\.systems_config_v40\.small_power\[id=([^\]]+)\]\.control_mechanism$/, label: m => `Small power "${m[1]}" control mechanism` },
  { test: /^building\.systems_config_v40\.small_power\[id=([^\]]+)\]\.control_factor$/, label: m => `Small power "${m[1]}" control factor` },
]

function pathLabel(path) {
  for (const handler of PATH_HANDLERS) {
    const m = path.match(handler.test)
    if (m) {
      const label = typeof handler.label === 'function' ? handler.label(m) : handler.label
      return { label, unit: handler.unit ?? '' }
    }
  }
  // Fallback: humanise the last segment.
  const segs = path.split('.')
  const last = segs[segs.length - 1]
  return { label: last.replace(/_/g, ' '), unit: '' }
}

// Brief 43 Part 3: short label for one patch, suitable for inline use in
// the stack row's summary column. Concatenates a verb prefix with the
// path's label. For structural ops the value's label (if present) is
// appended so the user sees what's being added / replaced.
//
//   set    Wall U-value             →  "Wall construction"
//   add    Heating system (ASHP)    →  "+ Heating system: ASHP"
//   remove DHW system (gas_combi)   →  "− DHW system: gas_combi"
//   replace Ventilation MEV→MVHR    →  "⇄ Ventilation system: MEV → MVHR"
function shortPatchLabel(patch, baselineConfig) {
  if (!patch) return null
  const { label } = pathLabel(patch.path || '')
  if (patch.op === 'add') {
    const newLbl = (patch.value && typeof patch.value === 'object' && patch.value.label)
      ? patch.value.label
      : (patch.value?.library_ref ?? 'item')
    return `+ ${label}: ${newLbl}`
  }
  if (patch.op === 'remove') {
    const matchId = patch.match?.id
    let oldLbl = matchId ?? '?'
    if (matchId && patch.path) {
      const arr = getValueAtPath(baselineConfig, patch.path)
      if (Array.isArray(arr)) {
        const found = arr.find(e => e && e.id === matchId)
        if (found?.label) oldLbl = found.label
      }
    }
    return `− ${label}: ${oldLbl}`
  }
  if (patch.op === 'replace') {
    const matchId = patch.match?.id
    let oldLbl = matchId ?? '?'
    if (matchId && patch.path) {
      const arr = getValueAtPath(baselineConfig, patch.path)
      if (Array.isArray(arr)) {
        const found = arr.find(e => e && e.id === matchId)
        if (found?.label) oldLbl = found.label
      }
    }
    const newLbl = (patch.value && typeof patch.value === 'object' && patch.value.label)
      ? patch.value.label
      : (patch.value?.library_ref ?? 'item')
    return `⇄ ${label}: ${oldLbl} → ${newLbl}`
  }
  // set — just the label.
  return label
}

/**
 * Brief 43 Part 3: build a single-line summary of an intervention's
 * patch list for use in the stack row. Returns the first `maxItems` short
 * labels comma-separated, with a "+N more" suffix when truncated. The
 * total returned string is independent of patch count (one tag per
 * captured leaf — capturePatch dedupes set ops to per-path; structural
 * ops append).
 *
 *   summarizePatchListShort([infiltration, wallU, ashp_add], baseline)
 *     → "Air permeability, Wall construction, + Heating system: ASHP"
 *
 *   summarizePatchListShort([5 patches], baseline, { maxItems: 3 })
 *     → "Wall, Roof, Heating mech +2 more"
 */
export function summarizePatchListShort(patches, baselineConfig, { maxItems = 3 } = {}) {
  if (!Array.isArray(patches) || patches.length === 0) return null
  const tags = patches
    .map(p => shortPatchLabel(p, baselineConfig))
    .filter(Boolean)
  if (tags.length === 0) return null
  if (tags.length <= maxItems) return tags.join(', ')
  const head = tags.slice(0, maxItems)
  const more = tags.length - maxItems
  return `${head.join(', ')} +${more} more`
}

/**
 * Returns a structured summary for plain-English rendering:
 *
 *   {
 *     label: 'Infiltration',
 *     verb:  'set' | 'add' | 'remove' | 'replace',
 *     before: '0.5 ACH',     // formatted with unit
 *     after:  '0.3 ACH',
 *     pct:    '−40%',        // signed, with sign char
 *     tone:   'good' | 'bad' | 'neutral',
 *     unrecognised: false,
 *   }
 *
 * For `add` / `remove` / `replace` ops, before/after may carry a
 * short shape descriptor instead of a value.
 */
export function summarizePatch(patch, baselineConfig, libraryData) {
  if (!patch) return null
  const { label, unit } = pathLabel(patch.path || '')
  const valueBefore = getValueAtPath(baselineConfig, patch.path)

  switch (patch.op) {
    case 'set': {
      const valueAfter = patch.value
      // For booleans
      if (typeof valueAfter === 'boolean' || typeof valueBefore === 'boolean') {
        return {
          label, verb: 'set',
          before: valueBefore == null ? '—' : (valueBefore ? 'on' : 'off'),
          after:  valueAfter == null  ? '—' : (valueAfter  ? 'on' : 'off'),
          pct: null, tone: 'neutral',
        }
      }
      // For strings (constructions, control_mechanism)
      if (typeof valueAfter === 'string' || typeof valueBefore === 'string') {
        return {
          label, verb: 'set',
          before: valueBefore == null ? '—' : String(valueBefore),
          after:  valueAfter  == null ? '—' : String(valueAfter),
          pct: null, tone: 'neutral',
        }
      }
      // Numeric
      const bn = Number(valueBefore), an = Number(valueAfter)
      const pct = Number.isFinite(bn) && Number.isFinite(an) ? fmtPct(bn, an) : null
      const numericTone = !Number.isFinite(bn) || !Number.isFinite(an)
        ? 'neutral'
        : (an < bn ? 'good' : (an > bn ? 'bad' : 'neutral'))
      return {
        label, verb: 'set',
        before: valueBefore == null ? '—' : `${fmtNum(valueBefore)}${unit}`,
        after:  valueAfter  == null ? '—' : `${fmtNum(valueAfter)}${unit}`,
        pct, tone: numericTone,
      }
    }
    case 'add': {
      // Brief 43 Part 2: prefer the new system's label, then library_ref,
      // then a generic 'item' fallback. Append " — from library" when the
      // source is 'library' so the user can see provenance at a glance.
      const lbl = patch.value && typeof patch.value === 'object' && patch.value.label
        ? `"${patch.value.label}"`
        : (patch.source === 'library' && patch.value?.library_ref ? patch.value.library_ref : 'item')
      const provenance = patch.source === 'library' ? ' — from library' : ''
      return {
        label, verb: 'add',
        before: '—',
        after: lbl + provenance,
        pct: null, tone: 'neutral',
      }
    }
    case 'remove': {
      // Brief 43 Part 2: try to read the human label of the removed entry
      // from baselineConfig. Falls back to the match id. If baseline lookup
      // fails (the patch references a system added by a prior patch in the
      // same intervention chain — applyIntervention sees it but baseline
      // doesn't) we still render the id as the descriptor.
      const matchId = patch.match?.id
      let removedLabel = null
      if (matchId && patch.path) {
        const arr = getValueAtPath(baselineConfig, patch.path)
        if (Array.isArray(arr)) {
          const found = arr.find(e => e && e.id === matchId)
          if (found && found.label) removedLabel = `"${found.label}"`
        }
      }
      const which = removedLabel ?? matchId ?? JSON.stringify(patch.match ?? {})
      return {
        label, verb: 'remove',
        before: which,
        after: '—',
        pct: null, tone: 'neutral',
      }
    }
    case 'replace': {
      // Brief 43 Part 2: surface "X with Y" — old entry from baseline,
      // new entry from patch.value.
      const matchId = patch.match?.id
      let oldLabel = null
      if (matchId && patch.path) {
        const arr = getValueAtPath(baselineConfig, patch.path)
        if (Array.isArray(arr)) {
          const found = arr.find(e => e && e.id === matchId)
          if (found && found.label) oldLabel = `"${found.label}"`
        }
      }
      const oldDescriptor = oldLabel ?? matchId ?? JSON.stringify(patch.match ?? {})
      const newLabel = patch.value && typeof patch.value === 'object' && patch.value.label
        ? `"${patch.value.label}"`
        : (patch.source === 'library' && patch.value?.library_ref ? patch.value.library_ref : 'item')
      const provenance = patch.source === 'library' ? ' — from library' : ''
      return {
        label, verb: 'replace',
        before: oldDescriptor,
        after: newLabel + provenance,
        pct: null, tone: 'neutral',
      }
    }
    default:
      return { label: 'unknown op', verb: 'set', before: '—', after: '—', pct: null, tone: 'neutral', unrecognised: true }
  }
}
