/**
 * solarCalc.js
 *
 * Hourly solar radiation decomposition onto building facades.
 *
 * Given hourly direct-normal and diffuse-horizontal irradiance from an EPW
 * file, computes the incident radiation on each vertical facade and the roof
 * for every hour of the year.
 *
 * Method: ASHRAE simplified isotropic sky model (Hay & Davies / Perez lite)
 * Accuracy target: ±10% annual totals vs full Perez/HDKR model — good enough
 * for a feasibility instant calc.
 *
 * Reference: ASHRAE Handbook of Fundamentals 2021, Ch. 14 — Fenestration
 */

const DEG = Math.PI / 180   // degrees → radians

// ── Day of year from month+day ────────────────────────────────────────────────

const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

function dayOfYear(month, day) {
  return MONTH_START_DAY[(month - 1) | 0] + day
}

// ── Solar position for a given hour ──────────────────────────────────────────

/**
 * Calculate solar altitude and azimuth for a given location and time.
 *
 * @param {number} latitude_deg  — degrees north
 * @param {number} doy           — day of year (1-365)
 * @param {number} hour          — solar hour (0-23; EPW hour 1 = midnight-to-1am → use 0.5 for midpoint)
 * @returns {{ altitude: number, azimuth: number, aboveHorizon: boolean }}
 *   altitude: solar elevation above horizon in radians
 *   azimuth:  from north, clockwise, in radians (0=N, π/2=E, π=S, 3π/2=W)
 */
function sunPosition(latitude_deg, doy, hour) {
  const lat  = latitude_deg * DEG
  // Solar declination (radians)
  const decl = 23.45 * DEG * Math.sin(2 * Math.PI * (284 + doy) / 365)
  // Solar hour angle: 0 at solar noon, negative in morning, positive in afternoon
  // EPW hour 1 = 00:00-01:00; use midpoint (0.5 offset already applied by caller)
  const hourAngle = (hour - 12) * 15 * DEG

  // Solar altitude (elevation)
  const sinAlt = (
    Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  )
  if (sinAlt <= 0) {
    return { altitude: 0, azimuth: 0, aboveHorizon: false }
  }
  const altitude = Math.asin(sinAlt)
  const cosAlt = Math.cos(altitude)

  // Solar azimuth from south (standard formula)
  const cosAzFromS = (Math.sin(decl) - Math.sin(lat) * sinAlt) /
                     (Math.cos(lat) * (cosAlt > 1e-6 ? cosAlt : 1e-6))
  const azFromS = Math.acos(Math.max(-1, Math.min(1, cosAzFromS)))  // 0–π

  // Convert to from-north, clockwise (0=N, π=S)
  // Morning (hourAngle < 0): sun is east of south → azimuth from N = π − azFromS
  // Afternoon (hourAngle > 0): sun is west of south → azimuth from N = π + azFromS
  const azimuth = hourAngle >= 0 ? Math.PI + azFromS : Math.PI - azFromS

  return { altitude, azimuth, aboveHorizon: true }
}

// ── Incident radiation on a vertical facade ───────────────────────────────────

/**
 * Calculate incident solar radiation on a vertical facade.
 *
 * @param {number} directNormal      — direct normal irradiance (Wh/m²)
 * @param {number} diffuseHorizontal — diffuse horizontal irradiance (Wh/m²)
 * @param {number} altitude          — solar altitude (radians)
 * @param {number} azimuth           — solar azimuth from north, clockwise (radians)
 * @param {number} facadeAzimuth     — facade outward normal, from north, clockwise (radians)
 * @returns {number} total incident radiation on the facade (Wh/m²)
 */
function facadeRadiation(directNormal, diffuseHorizontal, altitude, azimuth, facadeAzimuth) {
  if (!directNormal && !diffuseHorizontal) return 0

  // Cosine of incidence angle on the vertical facade
  const cosIncidence = Math.cos(altitude) * Math.cos(azimuth - facadeAzimuth)

  // Direct beam component (only if sun faces the facade and is above horizon)
  const direct = (cosIncidence > 0) ? directNormal * cosIncidence : 0

  // Diffuse (isotropic sky): vertical surface sees half the sky dome
  const diffuse = diffuseHorizontal * 0.5

  // Ground-reflected: global horizontal × albedo × view factor (0.5 for vertical)
  const globalHorizontal = directNormal * Math.sin(altitude) + diffuseHorizontal
  const reflected = globalHorizontal * 0.2 * 0.5   // albedo=0.2, vf=0.5

  return Math.max(0, direct + diffuse + reflected)
}

/**
 * Calculate incident solar radiation on a horizontal surface (roof).
 *
 * @param {number} directNormal      — W/m²
 * @param {number} diffuseHorizontal — W/m²
 * @param {number} altitude          — radians
 * @returns {number} Wh/m²
 */
function roofRadiation(directNormal, diffuseHorizontal, altitude) {
  const directHorizontal = altitude > 0 ? directNormal * Math.sin(altitude) : 0
  return Math.max(0, directHorizontal + diffuseHorizontal)
}

// ── Precompute hourly solar for all facades ───────────────────────────────────

/**
 * Compute hourly solar radiation incident on each building facade and roof.
 *
 * Facade numbering matches the building geometry convention in instantCalc:
 *   F1 = building "north" face  (true bearing = orientationDeg + 0°)
 *   F2 = building "east"  face  (true bearing = orientationDeg + 90°)
 *   F3 = building "south" face  (true bearing = orientationDeg + 180°)
 *   F4 = building "west"  face  (true bearing = orientationDeg + 270°)
 *
 * At orientationDeg=0 (building aligned to true N), F1=N, F3=S as expected.
 * Rotating to orientationDeg=90 makes F1 face east, F3 face west, etc.
 *
 * @param {{ temperature, direct_normal, diffuse_horizontal, month, hour, location }} weatherData
 * @param {number} latitude  — degrees north (from EPW)
 * @param {number} orientationDeg — building north axis rotation from true N (°, clockwise)
 * @returns {{ f1, f2, f3, f4, roof }} — each is Float32Array(8760) in Wh/m²
 */
export function computeHourlySolarByFacade(weatherData, latitude, orientationDeg) {
  const n = weatherData.temperature.length
  const f1 = new Float32Array(n)   // north face
  const f2 = new Float32Array(n)   // east face
  const f3 = new Float32Array(n)   // south face
  const f4 = new Float32Array(n)   // west face
  const roof = new Float32Array(n)

  // Facade outward normals (radians from north, clockwise)
  const ori = (orientationDeg || 0) * DEG
  const az1 = ori + 0             // F1 (north at 0°)
  const az2 = ori + Math.PI / 2   // F2 (east)
  const az3 = ori + Math.PI       // F3 (south)
  const az4 = ori + 3 * Math.PI / 2  // F4 (west)

  const lat = latitude || 51.5

  for (let h = 0; h < n; h++) {
    const dn  = weatherData.direct_normal[h]
    const dh  = weatherData.diffuse_horizontal[h]

    if (dn === 0 && dh === 0) continue  // night — all zero

    const mo  = weatherData.month[h]
    const day = 15  // EPW rows don't include day in easy form; use mid-month (sufficient for hourly sun position)
    const hr  = (weatherData.hour[h] - 0.5)  // EPW hour 1 = 00:00-01:00; use midpoint = 0.5
    const doy = dayOfYear(mo, day)

    const { altitude, azimuth, aboveHorizon } = sunPosition(lat, doy, hr)
    if (!aboveHorizon) continue

    f1[h]   = facadeRadiation(dn, dh, altitude, azimuth, az1)
    f2[h]   = facadeRadiation(dn, dh, altitude, azimuth, az2)
    f3[h]   = facadeRadiation(dn, dh, altitude, azimuth, az3)
    f4[h]   = facadeRadiation(dn, dh, altitude, azimuth, az4)
    roof[h] = roofRadiation(dn, dh, altitude)
  }

  return { f1, f2, f3, f4, roof }
}

/**
 * Return annual kWh/m² totals for each facade (useful for verification).
 */
export function annualSolarByFacade(hourlySolar) {
  const sum = arr => Array.from(arr).reduce((a, b) => a + b, 0) / 1000
  return {
    f1: sum(hourlySolar.f1),
    f2: sum(hourlySolar.f2),
    f3: sum(hourlySolar.f3),
    f4: sum(hourlySolar.f4),
    roof: sum(hourlySolar.roof),
  }
}
