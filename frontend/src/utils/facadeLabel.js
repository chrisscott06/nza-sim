/**
 * facadeLabel.js
 *
 * Canonical helper for facade naming. Same convention used in:
 *   - Building module's Glazing input panel
 *   - Building module's FabricSankey (legacy)
 *   - Heat Balance (Rows / Stacked / Sankey + DrillDown)
 *
 * Compass letter is dynamic: rotates with the building's `orientation`
 * angle so F1 (N) at orientation 0° becomes F1 (NE) at 45°, etc.
 */

const BASE_ANGLES = { 1: 0, 2: 90, 3: 180, 4: 270 }
const FACE_TO_NUM = { north: 1, east: 2, south: 3, west: 4 }
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/**
 * Convert a building-relative facade key/number to a directional label
 * given the current building orientation (degrees clockwise from N).
 *
 * @param {number|string} faceOrNum  1..4 OR 'north'|'east'|'south'|'west'
 * @param {number} orientationDeg    Building rotation, default 0
 * @returns {string} e.g. "F1 (N)" / "F2 (E)"
 */
export function facadeLabel(faceOrNum, orientationDeg = 0) {
  const num = typeof faceOrNum === 'number' ? faceOrNum : FACE_TO_NUM[faceOrNum]
  if (!num) return '—'
  const trueAngle = ((BASE_ANGLES[num] ?? 0) + Number(orientationDeg ?? 0) + 360) % 360
  const compass   = DIRS[Math.round(trueAngle / 45) % 8]
  return `F${num} (${compass})`
}

/** "Solar — F3 (S)" — used by Heat Balance solar elements */
export function solarLabel(face, orientationDeg = 0) {
  return `Solar — ${facadeLabel(face, orientationDeg)}`
}
