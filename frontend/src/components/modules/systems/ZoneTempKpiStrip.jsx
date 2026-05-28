/**
 * ZoneTempKpiStrip — 6 tile summary of the zone-temperature trace.
 * Brief 70 Part 1.
 *
 * Reads result.demand.{hourly_zone_air_c, heating_demand_hourly_kwh,
 * cooling_demand_hourly_kwh, effective_heating_setpoint_c,
 * effective_cooling_setpoint_c}. All numbers come from the engine; nothing
 * recomputed here.
 */

function fmtDateFromHour(h) {
  // EPW-shape: hours 0..8759 → date in the synthetic Jan 1 = Monday year.
  // We just need the date label for the tile (no day-of-week dependency).
  const dayOfYear = Math.floor(h / 24) // 0..364
  const hourOfDay = h % 24
  // Days per month (non-leap).
  const dpm = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let m = 0, d = dayOfYear
  while (m < 11 && d >= dpm[m]) { d -= dpm[m]; m++ }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m]} ${d + 1}, ${String(hourOfDay).padStart(2, '0')}:00`
}

function Tile({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-light-grey rounded-md px-3 py-2 flex flex-col gap-0.5 min-w-[120px]">
      <p className="text-xxs uppercase tracking-wider text-mid-grey font-medium leading-tight">{label}</p>
      <p className={`text-section font-semibold tabular-nums leading-tight ${accent ?? 'text-navy'}`}>{value}</p>
      {sub && <p className="text-xxs text-mid-grey leading-tight">{sub}</p>}
    </div>
  )
}

export default function ZoneTempKpiStrip({ result }) {
  // 2026-05-28: read the FREE trace (pre-conditioning) so KPIs reflect
  // what the building WOULD reach with no systems — the diagnostic
  // signal. The post-clamp T_zone is held at setpoint by Brief 69's
  // active-setpoint clamp, so KPIs computed off it would always read
  // 100% in dead band (correct but useless).
  const T = result?.demand?.hourly_zone_air_free_c
           ?? result?.demand?.hourly_zone_air_c   // back-compat fallback
  const hH = result?.demand?.heating_demand_hourly_kwh
  const hC = result?.demand?.cooling_demand_hourly_kwh
  const hsp = result?.demand?.effective_heating_setpoint_c ?? 21
  const csp = result?.demand?.effective_cooling_setpoint_c ?? 24

  if (!T || T.length === 0) {
    return (
      <div className="text-xxs text-mid-grey italic px-1 py-2">
        No hourly zone-temperature trace on the current result. Open the live
        engine pass (any input edit triggers re-render) to populate the view.
      </div>
    )
  }

  // Compute KPIs. All single-pass, O(8760).
  let above = 0, below = 0, peakHeat = 0, peakCool = 0
  let hottestT = -Infinity, hottestH = 0
  let coldestT = Infinity, coldestH = 0
  for (let i = 0; i < T.length; i++) {
    const t = T[i]
    if (t > csp) above++
    if (t < hsp) below++
    if (t > hottestT) { hottestT = t; hottestH = i }
    if (t < coldestT) { coldestT = t; coldestH = i }
    if (hH && hH[i] > peakHeat) peakHeat = hH[i]
    if (hC && hC[i] > peakCool) peakCool = hC[i]
  }
  const dead = T.length - above - below

  return (
    <div className="flex flex-wrap gap-2">
      <Tile label="Hours above csp"   value={above.toLocaleString()} sub={`${(above / T.length * 100).toFixed(1)}% · free-float > cooling SP`} accent="text-rose-700" />
      <Tile label="Hours below hsp"   value={below.toLocaleString()} sub={`${(below / T.length * 100).toFixed(1)}% · free-float < heating SP`} accent="text-sky-700" />
      <Tile label="Dead-band hours"   value={dead.toLocaleString()}  sub={`${(dead / T.length * 100).toFixed(1)}% · free-float in band`} />
      <Tile label="Peak heating"      value={`${peakHeat.toFixed(1)} kW`} sub="hourly maximum" accent="text-rose-700" />
      <Tile label="Peak cooling"      value={`${peakCool.toFixed(1)} kW`} sub="hourly maximum" accent="text-sky-700" />
      <Tile label="Hottest float"     value={`${hottestT.toFixed(1)} °C`} sub={fmtDateFromHour(hottestH)} accent="text-rose-700" />
    </div>
  )
}
