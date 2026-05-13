/**
 * useAnnualGains — annual + peak gain summary per category.
 *
 * Reads `params.occupancy.*` + `params.gains.*` (v2.3 contract) and runs
 * `computeHourlyGains` 8,760 times to build the per-category annual
 * totals and peak instantaneous rates that the left-panel section cards
 * surface. Memoised on the params subtree + weather data — re-runs only
 * when a relevant input actually changes. ~10 ms on a modern machine,
 * so input-side feedback is effectively instant.
 *
 * Returns:
 *   {
 *     people:    { kwh, peak_kw, hours_active }
 *     lighting:  { kwh, peak_kw, effective_lpd_w_per_m2, hours_active }
 *     equipment: { kwh, peak_kw, baseload_kwh, active_kwh, hours_active }
 *     gia_m2:    number
 *     ready:     boolean    // false if weather isn't loaded yet
 *   }
 *
 * Per docs/ui_principles.md the input-side feedback is INSIDE each
 * section's card (principle #2 — related items in one card). Each
 * section component reads this hook's output via prop.
 */

import { useContext, useMemo } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { computeHourlyGains } from '../../../utils/instantCalc.js'

export function useAnnualGains() {
  const { params } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)

  return useMemo(() => {
    const empty = {
      people:    { kwh: 0, peak_kw: 0, hours_active: 0 },
      lighting:  { kwh: 0, peak_kw: 0, effective_lpd_w_per_m2: 0, hours_active: 0 },
      equipment: { kwh: 0, peak_kw: 0, baseload_kwh: 0, active_kwh: 0, hours_active: 0 },
      gia_m2: 0,
      ready: false,
    }
    if (!params || !weatherData?.temperature?.length) return empty

    const L = Number(params.length || 0)
    const W = Number(params.width || 0)
    const nf = Number(params.num_floors || 0)
    const gia = L * W * nf
    if (gia <= 0) return empty

    let people_wh = 0, light_wh = 0, equip_wh = 0
    let peak_p = 0, peak_l = 0, peak_e = 0
    let baseload_wh = 0, active_wh = 0
    let hours_p = 0, hours_l = 0, hours_e_active = 0

    const n = weatherData.temperature.length
    for (let h = 0; h < n; h++) {
      const g = computeHourlyGains(params, h, weatherData, gia)
      people_wh   += g.people
      light_wh    += g.lighting
      equip_wh    += g.equipment
      baseload_wh += g.equipment_baseload
      active_wh   += g.equipment_active
      if (g.people    > peak_p) peak_p = g.people
      if (g.lighting  > peak_l) peak_l = g.lighting
      if (g.equipment > peak_e) peak_e = g.equipment
      if (g.people    > 0.01) hours_p++
      if (g.lighting  > 0.01) hours_l++
      if (g.equipment_active > 0.01) hours_e_active++
    }

    // Effective LPD = lighting kWh / GIA / 8760, useful for cross-check.
    const effective_lpd = (light_wh / Math.max(1, n)) / Math.max(1, gia)

    return {
      people: {
        kwh: people_wh / 1000,
        peak_kw: peak_p / 1000,
        hours_active: hours_p,
      },
      lighting: {
        kwh: light_wh / 1000,
        peak_kw: peak_l / 1000,
        effective_lpd_w_per_m2: effective_lpd,
        hours_active: hours_l,
      },
      equipment: {
        kwh: equip_wh / 1000,
        peak_kw: peak_e / 1000,
        baseload_kwh: baseload_wh / 1000,
        active_kwh: active_wh / 1000,
        hours_active: hours_e_active,
      },
      gia_m2: gia,
      ready: true,
    }
    // Memoise on the gain-relevant subtree + weather. We pass the
    // whole params to the helper but only need the gain/occupancy
    // blocks + num_bedrooms + geometry to change for a refresh.
  }, [
    params?.occupancy,
    params?.gains,
    params?.num_bedrooms,
    params?.length,
    params?.width,
    params?.num_floors,
    weatherData,
  ])
}
