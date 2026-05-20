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
  // Envelope
  { test: /^building\.infiltration_ach$/,                                              label: 'Infiltration (legacy ACH)',   unit: ' ACH' },
  { test: /^building\.fabric\.air_permeability_q50$/,                                  label: 'Air permeability (q50)',      unit: ' m³/(h·m²)' },
  { test: /^building\.openings\.(north|south|east|west)\.cd$/,                          label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} facade C_d` },
  { test: /^building\.openings\.(north|south|east|west)\.flow_mode$/,                   label: m => `${m[1][0].toUpperCase()+m[1].slice(1)} facade flow mode` },
  // Constructions (passed via construction_choices, but path root is "constructions" in the engine quartet)
  { test: /^constructions\.external_wall$/,                                            label: 'External wall construction' },
  { test: /^constructions\.roof$/,                                                     label: 'Roof construction' },
  { test: /^constructions\.ground_floor$/,                                             label: 'Ground floor construction' },
  { test: /^constructions\.glazing$/,                                                  label: 'Glazing construction' },
  // Internal gains
  { test: /^building\.occupancy_rate$/,                                                label: 'Occupancy rate' },
  { test: /^building\.occupancy\.occupancy_rate$/,                                     label: 'Occupancy rate (v2.3)' },
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
  { test: /^building\.systems_config_v40\.dhw\[id=([^\]]+)\]\.efficiency_metric$/,     label: m => `DHW "${m[1]}" efficiency` },
  { test: /^building\.systems_config_v40\.dhw\[id=([^\]]+)\]\.share_pct$/,             label: m => `DHW "${m[1]}" share`,            unit: '%' },
  { test: /^building\.systems_config_v40\.dhw\[id=([^\]]+)\]\.enabled$/,               label: m => `DHW "${m[1]}" enabled` },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.sfp_w_per_l_per_s$/, label: m => `Ventilation "${m[1]}" SFP`,  unit: ' W/l·s⁻¹' },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.recovery_sensible_pct$/, label: m => `Ventilation "${m[1]}" sensible recovery`, unit: '%' },
  { test: /^building\.systems_config_v40\.ventilation\[id=([^\]]+)\]\.enabled$/,       label: m => `Ventilation "${m[1]}" enabled` },
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
      const ref = patch.source === 'library' && patch.value?.library_ref
        ? patch.value.library_ref
        : (patch.value && typeof patch.value === 'object' && patch.value.label)
          ? `"${patch.value.label}"`
          : 'item'
      return {
        label, verb: 'add',
        before: '—',
        after: ref,
        pct: null, tone: 'neutral',
      }
    }
    case 'remove': {
      const which = patch.match?.id ?? JSON.stringify(patch.match ?? {})
      return {
        label, verb: 'remove',
        before: which,
        after: '—',
        pct: null, tone: 'neutral',
      }
    }
    case 'replace': {
      const which = patch.match?.id ?? JSON.stringify(patch.match ?? {})
      const ref = patch.source === 'library' && patch.value?.library_ref
        ? patch.value.library_ref
        : (patch.value && typeof patch.value === 'object' && patch.value.label)
          ? `"${patch.value.label}"`
          : 'item'
      return {
        label, verb: 'replace',
        before: which,
        after: ref,
        pct: null, tone: 'neutral',
      }
    }
    default:
      return { label: 'unknown op', verb: 'set', before: '—', after: '—', pct: null, tone: 'neutral', unrecognised: true }
  }
}
