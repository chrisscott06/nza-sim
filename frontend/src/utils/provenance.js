/**
 * provenance.js — input provenance metadata helpers.
 *
 * Implements the v2.1 state contract's provenance schema. Per the contract:
 *   - Every input in {building, gains, operation, systems}_config has an
 *     associated provenance record tracking where the value came from.
 *   - Records live in a sibling `_provenance` block keyed by dot-notated
 *     input path (e.g. "fabric.external_wall.u_value").
 *   - Per-path record: { source, ref?, confidence?, recorded_at? }
 *   - `source` is required and one of the six contract enum values.
 *   - Default when unspecified: { source: 'user_entered', confidence: 'medium' }.
 *
 * States 1–3 record provenance but don't branch on it; State 4 reconciliation
 * reads it to weight the bottom-up estimate and bound proposed adjustments.
 *
 * See `docs/state_contracts.md` § Cross-cutting concepts → Input provenance.
 */

/** Canonical provenance source enum, per contract v2.1. */
export const PROVENANCE_SOURCES = Object.freeze([
  'user_entered',
  'spec_sheet',
  'vintage_default',
  'benchmark',
  'inferred',
  'calibrated',
])

/** Default record returned by getProvenance when no entry exists at the path. */
export const DEFAULT_PROVENANCE = Object.freeze({
  source: 'user_entered',
  confidence: 'medium',
})

/**
 * Get the provenance record for a given input path.
 *
 * @param {object|null|undefined} config — a config blob (building_config, etc.).
 * @param {string} path — dot-notated path of the input within the config.
 * @returns {{source, ref?, confidence?, recorded_at?}} — the stored record,
 *          or the contract default if none is set / config is null.
 */
export function getProvenance(config, path) {
  if (!config || !path) return { ...DEFAULT_PROVENANCE }
  const prov = config._provenance
  if (!prov || typeof prov !== 'object') return { ...DEFAULT_PROVENANCE }
  const rec = prov[path]
  if (!rec || typeof rec !== 'object' || !rec.source) {
    return { ...DEFAULT_PROVENANCE }
  }
  return { ...rec }
}

/**
 * Set the provenance record for a given input path. Immutable — returns a
 * new config object with the `_provenance` block updated.
 *
 * @param {object} config — a config blob (must be non-null; pass {} for empty).
 * @param {string} path — dot-notated path of the input.
 * @param {{source, ref?, confidence?, recorded_at?}} record — must include
 *        `source` (one of PROVENANCE_SOURCES). Throws otherwise.
 * @returns {object} new config with the record merged into _provenance.
 */
export function setProvenance(config, path, record) {
  if (!config || typeof config !== 'object') {
    throw new Error('setProvenance: config must be an object')
  }
  if (!path || typeof path !== 'string') {
    throw new Error('setProvenance: path must be a non-empty string')
  }
  if (!record || !record.source) {
    throw new Error('setProvenance: record.source is required')
  }
  if (!PROVENANCE_SOURCES.includes(record.source)) {
    throw new Error(
      `setProvenance: source '${record.source}' is not a valid contract enum value ` +
      `(must be one of: ${PROVENANCE_SOURCES.join(', ')})`
    )
  }
  const cleaned = {
    source: record.source,
    ...(record.ref !== undefined ? { ref: record.ref } : {}),
    ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
    recorded_at: record.recorded_at ?? new Date().toISOString(),
  }
  return {
    ...config,
    _provenance: {
      ...(config._provenance ?? {}),
      [path]: cleaned,
    },
  }
}

/**
 * Remove a single provenance entry (so subsequent reads fall back to default).
 * Immutable.
 *
 * @param {object} config
 * @param {string} path
 * @returns {object} new config with the entry removed.
 */
export function clearProvenance(config, path) {
  if (!config || typeof config !== 'object') return config
  if (!path || !config._provenance) return config
  if (!(path in config._provenance)) return config
  const nextProv = { ...config._provenance }
  delete nextProv[path]
  // If the _provenance block is now empty, drop it entirely.
  if (Object.keys(nextProv).length === 0) {
    const { _provenance: _drop, ...rest } = config
    return rest
  }
  return { ...config, _provenance: nextProv }
}

/**
 * Enumerate every provenance entry currently set on a config.
 *
 * @param {object|null|undefined} config
 * @returns {Array<{path, source, ref?, confidence?, recorded_at?}>}
 */
export function listProvenance(config) {
  if (!config || !config._provenance || typeof config._provenance !== 'object') {
    return []
  }
  return Object.entries(config._provenance)
    .filter(([_, rec]) => rec && rec.source)
    .map(([path, rec]) => ({ path, ...rec }))
}
