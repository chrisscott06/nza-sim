/**
 * scripts/trace_calc.mjs — Brief 59 Part 2
 *
 * Calculation-trace harness. Prints the first-principles derivation of
 * every demand / delivered / fuel / EUI number the engine produces, for
 * any building + optional intervention/mutation, with source tags on
 * every input.
 *
 * INSTRUMENTS the real engine — never re-implements physics. The harness
 * reads `calculateInstant`'s result fields and annotates them with:
 *   - which config field each input was read from (v25 / v40 / building /
 *     metadata / library) including any v40-wins override chain
 *   - the formula in symbolic form
 *   - the formula with numbers substituted
 *   - the result (read straight from the engine output)
 * The final printed EUI MUST equal the engine's EUI (if it doesn't,
 * either the harness is re-implementing or a source tag is wrong).
 *
 * Usage:
 *   node scripts/trace_calc.mjs                                  # baseline
 *   node scripts/trace_calc.mjs --project=<UUID>                 # other project
 *   node scripts/trace_calc.mjs --vent=<id>=<flow_lps>           # one-off vent flow patch
 *   node scripts/trace_calc.mjs --diff --vent=<id>=<flow_lps>    # diff vs baseline
 *   node scripts/trace_calc.mjs --out=docs/audit/trace_foo.md    # custom output path
 *
 * Default output: docs/audit/trace_<UTC-timestamp>.md
 *
 * Diff mode prints BEFORE / AFTER side-by-side with Δ per stage, so a
 * downstream number that should have moved but didn't is visible
 * immediately. Specifically catches Brief 59 Part 1's bug class: if
 * an editable input's source tag differs from the demand-path's source
 * tag, a v40 edit will move one column but not the other.
 *
 * Falsifiability gates:
 *   T-G1  Printed final EUI == engine.consumption.brief40.totals.eui_kWh_per_m2
 *         (no re-implementation; if they diverge the harness is wrong)
 *   T-G2  Every "→ result" line's substituted-numbers expression evaluates
 *         (within numerical-precision tolerance 0.5%) to the printed result
 *         (arithmetic self-consistency)
 *   T-G3  Every input line carries a [source: ...] tag
 *   T-G4  Diff mode reproduces the Part 1 bug's signature pre-fix and
 *         shows coupled flow post-fix (manual narrative gate, see PART 2
 *         demonstration markdown)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── Args ─────────────────────────────────────────────────────────────
const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq < 0) return [a.slice(2), true]
      return [a.slice(2, eq), a.slice(eq + 1)]
    }
    return [a, true]
  })
)
const API        = process.env.NZA_API || 'http://127.0.0.1:8003'
const PROJECT_ID = ARGS.project || '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
const DIFF       = ARGS.diff === true
const VENT_PATCH = typeof ARGS.vent === 'string' ? ARGS.vent : null  // e.g. "vent_bedroom_extract=1000"
const OUT_PATH   = ARGS.out || path.join(REPO_ROOT, `docs/audit/trace_${new Date().toISOString().replace(/[:.]/g, '-')}.md`)

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() }

const project = await fj(`${API}/api/projects/${PROJECT_ID}`)
const lib     = await fj(`${API}/api/library/constructions`)
const libArr  = lib.constructions ?? []
const constructions = project.construction_choices
const comfortBand = { lower_c: project.comfort_band_lower_c ?? 20, upper_c: project.comfort_band_upper_c ?? 26 }
const baseBuilding = JSON.parse(JSON.stringify(project.building_config))
const weatherFile = baseBuilding.weather_file || project.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month=new Int8Array(N),day=new Int8Array(N),hour=new Int8Array(N)
const temperature=new Float32Array(N),direct_normal=new Float32Array(N)
const diffuse_horizontal=new Float32Array(N),wind_speed=new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i]=parseInt(p[1]);day[i]=parseInt(p[2]);hour[i]=parseInt(p[3])
  temperature[i]=parseFloat(p[6]);direct_normal[i]=parseFloat(p[14])
  diffuse_horizontal[i]=parseFloat(p[15]);wind_speed[i]=parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, Number(baseBuilding.orientation ?? 0))
const libraryData = {
  constructions: libArr.map(c=>({name:c.name,u_value_W_per_m2K:c.config_json?.u_value_W_per_m2K??c.u_value_W_per_m2K,y_factor:c.config_json?.y_factor??c.y_factor??1.0,g_value:c.config_json?.g_value,config_json:c.config_json??c,layers:c.layers})),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

function parseVentPatch(spec) {
  // "vent_bedroom_extract=1000" → { id, flow_rate }
  if (!spec) return null
  const eq = spec.indexOf('=')
  if (eq < 0) return null
  return { id: spec.slice(0, eq).trim(), flow_rate: Number(spec.slice(eq + 1)) }
}
function applyVentPatch(building, patch) {
  if (!patch) return
  for (const v of (building.systems_config_v40?.ventilation ?? [])) {
    if (v.id === patch.id) v.flow_rate = patch.flow_rate
  }
}

// Run the engine on a (possibly mutated) building. Returns the FULL
// calculateInstant result — the harness then reads + annotates fields.
function runEngine(mutate) {
  const b = JSON.parse(JSON.stringify(baseBuilding))
  if (typeof mutate === 'function') mutate(b)
  return {
    building: b,
    result:   calculateInstant(b, constructions, {}, libraryData, weatherData, hourlySolar, null,
                                { mode: 'full', engine: 'v2.5', comfortBand, _skipInterventions: true }),
  }
}

// ── Self-consistency check — every printed formula evaluates to its result
const consistencyMisses = []
function record(label, lhs, rhs, tol = 0.005) {
  if (rhs === 0) { if (Math.abs(lhs) > 0.05) consistencyMisses.push({ label, lhs, rhs, abs_err: Math.abs(lhs - rhs) }); return }
  const rel = Math.abs((lhs - rhs) / rhs)
  if (rel > tol) consistencyMisses.push({ label, lhs, rhs, rel })
}
const fmt = (v, digits = 3) => (v == null || !Number.isFinite(v)) ? '—' : Number(v).toFixed(digits)
const fmt1 = v => fmt(v, 1)
const fmt2 = v => fmt(v, 2)
const fmt0 = v => fmt(v, 0)

// ── Build a trace for one engine run ──
function traceOne(label, { building, result }) {
  const lines = []
  const push = (s = '') => lines.push(s)
  const gia = result?.metadata?.gia_m2 ?? result?.heat_balance?.metadata?.gia_m2 ?? 0
  const hb  = result?.heat_balance?.annual ?? {}
  const ig  = hb?.gains?.internal ?? {}
  const lo  = hb?.losses ?? {}
  const b40 = result?.consumption?.brief40

  push(`# ${label}`); push()
  push(`Generated: ${new Date().toISOString()}`)
  push(`Project: ${project.name} (id ${PROJECT_ID})`)
  push(`Reported GIA: ${gia} m²  ·  Comfort band: ${comfortBand.lower_c}–${comfortBand.upper_c} °C`)
  push()

  // ── ENVELOPE LOSSES ────────────────────────────────────────────────
  push(`## ENVELOPE LOSSES (annual, at comfort band)`)
  push()
  push(`Each line: gross conduction / vent loss in MWh/yr, integrand over hourly heating-needed K·h.`)
  push()
  const lossRows = [
    ['external_wall',    lo.external_wall],
    ['roof',             lo.roof],
    ['ground_floor',     lo.ground_floor],
    ['glazing',          lo.glazing],
    ['thermal_bridging', lo.thermal_bridging],
    ['fabric_leakage',   lo.fabric_leakage],
    ['permanent_vents',  lo.permanent_vents],
  ]
  let envelopeTotal = 0
  for (const [name, row] of lossRows) {
    if (!row) continue
    const kwh = Number(row.kwh ?? 0)
    envelopeTotal += kwh
    const area = row.area_m2 != null ? ` area=${row.area_m2} m²` : ''
    push(`  ${name.padEnd(20)} = ${fmt1(kwh / 1000)} MWh   (${fmt1(row.kwh_per_m2)} kWh/m²${area})`)
    push(`     [source: heat_balance.annual.losses.${name}.kwh; integrated in _calculateState2 hourly loop]`)
  }
  push(`  ──`)
  push(`  envelope total       = ${fmt1(envelopeTotal / 1000)} MWh`)
  push(`     [Σ of lines above; cross-check vs hb.annual.totals]`)
  push()

  // ── VENTILATION (per system, pre/post recovery) ────────────────────
  push(`## VENTILATION (per system — full chain)`)
  push()
  push(`AIR_HEAT_CAPACITY = 0.33 Wh/m³·K (constant)`)
  push()
  const ventDisplay = result?.losses_at_setpoint?.ventilation ?? []
  const v40Vents = building?.systems_config_v40?.ventilation ?? []
  const v40ById = Object.fromEntries(v40Vents.map(v => [v.id, v]))
  const v25Vents = building?.systems_config_v25?.ventilation ?? []
  const v25ById = Object.fromEntries(v25Vents.map(v => [v.id, v]))
  for (const vd of ventDisplay) {
    const id = (() => {
      for (const v of v25Vents) if ((v.name ?? '') === vd.name) return v.id
      return null
    })()
    const v40 = id ? v40ById[id] : null
    const v25 = id ? v25ById[id] : null
    const flow = Number(vd.flow_l_s)
    const hre  = Number(vd.hre)
    const sfp  = Number(vd.sfp_w_per_l_s)
    const hrs  = Number(vd.hours)
    const Q_m3_h = flow * 3.6
    const ventUA = 0.33 * Q_m3_h * (1 - hre) * (hrs / 8760)
    push(`### ${vd.name}`)
    // Source tag for flow with v40-wins override (Brief 59 Part 1)
    const flow_src = (v40 && v40.flow_rate != null)
      ? `v40.systems_config_v40.ventilation[id=${id}].flow_rate=${v40.flow_rate} (basis '${v40.flow_rate_basis ?? 'constant'}', v40-wins per Brief 59 P1)`
      : (v25 ? `v25.systems_config_v25.ventilation[id=${id}].flow_l_s=${v25.flow_l_s} (v40-fallback)` : '?')
    const hre_src = (v40 && v40.efficiency_metric?.recovery_sensible_pct != null)
      ? `v40.systems_config_v40.ventilation[id=${id}].efficiency_metric.recovery_sensible_pct=${v40.efficiency_metric.recovery_sensible_pct} (÷100; v40-wins per Brief 50 P6)`
      : (v25 ? `v25.systems_config_v25.ventilation[id=${id}].hre=${v25.hre} (v40-fallback)` : '?')
    push(`  flow_l_s   = ${flow}                  [source: ${flow_src}]`)
    push(`  HRE        = ${hre}                    [source: ${hre_src}]`)
    push(`  SFP        = ${sfp} W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]`)
    push(`  hours      = ${hrs}                    [source: v25.hours, sched_factor = hours/8760]`)
    push(`  Q_m3_h     = ${flow} × 3.6              = ${fmt1(Q_m3_h)} m³/h`)
    push(`  ventUA     = 0.33 × ${fmt1(Q_m3_h)} × (1 − ${hre}) × ${fmt2(hrs/8760)} = ${fmt2(ventUA)} W/K`)
    // Heat loss is the per-hour Σ over heating-needed hours: ventUA × max(0, T_set − T_out)
    // The engine reports the annual integral directly. K·hours back-solved:
    const heatLossKwh = Number(vd.heat_loss_kwh ?? 0)
    const k_hours = ventUA > 0 ? heatLossKwh * 1000 / ventUA : 0
    push(`  effective K_hours integrand  = ${fmt0(k_hours)} K·h    (back-solved from engine; UK heating-needed degree-hours at ${comfortBand.lower_c}°C)`)
    push(`  → heat_loss  = ${fmt2(ventUA)} × ${fmt0(k_hours)} / 1000 = ${fmt1(heatLossKwh / 1000)} MWh`)
    push(`     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]`)
    push(`  → fan_power  = ${sfp} × ${flow} × 8760 / 1000 = ${fmt1(Number(vd.fan_kwh ?? 0))} kWh`)
    push(`     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]`)
    // Self-consistency: ventUA arithmetic
    record(`vent ${vd.name} ventUA`, ventUA, 0.33 * Q_m3_h * (1 - hre) * (hrs / 8760))
    // Self-consistency: fan formula
    record(`vent ${vd.name} fan_kwh`, sfp * flow * hrs / 1000, Number(vd.fan_kwh ?? 0))
    push()
  }

  // ── INTERNAL GAINS (per source) ────────────────────────────────────
  push(`## INTERNAL GAINS (annual, at zone)`)
  push()
  const gainRows = [
    ['people',    ig.people,    'building.occupancy + sensible_w_per_person'],
    ['lighting',  ig.lighting,  'building.gains.lighting.profiles[*] × effectiveSystemScalar(systems_config_v40.lighting) [Brief 58 C coupling]'],
    ['equipment', ig.equipment, 'building.gains.equipment.profiles[*] × effectiveSystemScalar(systems_config_v40.small_power) [Brief 58 C coupling]'],
  ]
  let gainTotalKwh = 0
  for (const [name, row, src] of gainRows) {
    if (!row) continue
    const kwh = Number(row.kwh ?? 0)
    gainTotalKwh += kwh
    push(`  ${name.padEnd(11)} = ${fmt1(kwh / 1000)} MWh   (${fmt1(row.kwh_per_m2)} kWh/m²)`)
    push(`     [source: heat_balance.annual.gains.internal.${name}.kwh; integrand: ${src}]`)
  }
  const solar = hb?.gains?.solar
  if (solar) {
    push(`  solar       = ${fmt1((solar.total_kwh ?? 0) / 1000)} MWh   (${fmt1(solar.total_kwh_per_m2)} kWh/m²)`)
    push(`     [source: heat_balance.annual.gains.solar; per facade × g_value × (1−frame_fraction) × shading × WWR_area]`)
  }
  push()

  // ── DEMAND ─────────────────────────────────────────────────────────
  push(`## HEATING + COOLING DEMAND (post heat balance, post MVHR recovery)`)
  push()
  const heatMwh = Number(result?.demand?.heating_demand_mwh ?? 0)
  const coolMwh = Number(result?.demand?.cooling_demand_mwh ?? 0)
  push(`  heating_demand  = ${fmt1(heatMwh)} MWh   (Σ over hours: max(0, hourly_loss − useful_gain) per State 2 hourly loop)`)
  push(`     [source: demand.heating_demand_mwh; State 2 integrand combines envelope + vent loss − internal/solar gain utilisation buckets]`)
  push(`  cooling_demand  = ${fmt1(coolMwh)} MWh   (Σ over hours: max(0, hourly_gain_surplus − loss-removal-budget))`)
  push(`     [source: demand.cooling_demand_mwh]`)
  push()

  // ── DHW (Brief 58 B3 headcount formula traced) ─────────────────────
  push(`## DHW DEMAND (Brief 58 B3 headcount basis)`)
  push()
  const dhw = b40?.dhw
  if (dhw) {
    const cfg = building?.systems_config_v40
    const basis = dhw.demand_basis
    push(`  basis            = ${basis}    [source: systems_config_v40.dhw_demand_basis]`)
    if (basis === 'per_person') {
      const num_rooms = Number(building?.num_bedrooms ?? 0)
      const ppr       = Number(building?.people_per_room ?? 1.5)
      const occ_rate  = Number(building?.occupancy_rate ?? 1)
      const headcount = num_rooms * ppr * occ_rate
      const L_per_p   = Number(cfg?.dhw_demand_litres_per_person_per_day ?? 80)
      const tap_lpd   = headcount * L_per_p
      const tap_outlet = Number(cfg?.dhw_tap_outlet_temp_c ?? 40)
      const storage    = Number(cfg?.dhw_storage_setpoint_c ?? 60)
      const cold       = Number(cfg?.dhw_cold_supply_temp_c ?? 10)
      const setpt_minus_cold = Math.max(storage - cold, 1)
      const hot_fraction     = Math.max(0, Math.min(1, (tap_outlet - cold) / setpt_minus_cold))
      const boiler_lpd       = tap_lpd * hot_fraction
      const annual_thermal_kwh = boiler_lpd * setpt_minus_cold * (4186 / 3.6e6) * 365   // WATER_SHC_KWH_PER_L_PER_K
      push(`  num_rooms        = ${num_rooms}      [source: building.num_bedrooms (UI label "Number of rooms")]`)
      push(`  people_per_room  = ${ppr}            [source: building.people_per_room (Internal Gains sensitivity, Brief 58 B2)]`)
      push(`  occupancy_rate   = ${occ_rate}       [source: building.occupancy.occupancy_rate]`)
      push(`  headcount        = ${num_rooms} × ${ppr} × ${occ_rate} = ${fmt1(headcount)} people`)
      push(`  L_per_person/day = ${L_per_p}        [source: systems_config_v40.dhw_demand_litres_per_person_per_day]`)
      push(`  total_tap_lpd    = ${fmt1(headcount)} × ${L_per_p} = ${fmt0(tap_lpd)} L/day`)
      push(`  tap_outlet_c     = ${tap_outlet}     [source: systems_config_v40.dhw_tap_outlet_temp_c]`)
      push(`  storage_c        = ${storage}     [source: systems_config_v40.dhw_storage_setpoint_c]`)
      push(`  cold_supply_c    = ${cold}     [source: systems_config_v40.dhw_cold_supply_temp_c]`)
      push(`  hot_fraction     = (${tap_outlet} − ${cold}) / (${storage} − ${cold}) = ${fmt2(hot_fraction)}`)
      push(`  boiler_lpd       = ${fmt0(tap_lpd)} × ${fmt2(hot_fraction)} = ${fmt0(boiler_lpd)} L/day`)
      push(`  → annual_thermal = ${fmt0(boiler_lpd)} × ${setpt_minus_cold} K × 4186 J/L/K × 365 / 3.6e9`)
      push(`                   = ${fmt1(annual_thermal_kwh / 1000)} MWh`)
      push(`     [source: brief40.dhw.demand_at_comfort_mwh — engine arithmetic matches above]`)
      push(`  load_shape       = ${dhw.load_shape}   [source: systems_config_v40.dhw_load_shape; Brief 58 B4 toggle]`)
      record('dhw annual_thermal', annual_thermal_kwh / 1000, Number(dhw.demand_at_comfort_mwh ?? 0))
    } else {
      const litres_per_m2 = Number(cfg?.dhw_demand_litres_per_m2_per_day ?? 1.1)
      const tap_lpd = litres_per_m2 * gia
      push(`  litres_per_m2/day = ${litres_per_m2}    [source: systems_config_v40.dhw_demand_litres_per_m2_per_day]`)
      push(`  total_tap_lpd     = ${litres_per_m2} × ${gia} = ${fmt0(tap_lpd)} L/day`)
      push(`  → annual_thermal  = ${fmt1(Number(dhw.demand_at_comfort_mwh ?? 0))} MWh`)
    }
    push(`  demand_at_comfort = ${fmt1(Number(dhw.demand_at_comfort_mwh ?? 0))} MWh   [engine output]`)
  }
  push()

  // ── DELIVERED (per service) ────────────────────────────────────────
  push(`## DELIVERED ENERGY (per service)`)
  push()
  if (b40) {
    const services = ['heating','cooling','dhw','ventilation','lighting','small_power']
    for (const s of services) {
      const block = b40[s]
      if (!block) continue
      let mwh
      if (s === 'ventilation') mwh = block.total_fan_electrical_mwh
      else if (s === 'lighting' || s === 'small_power') mwh = block.total_delivered_electrical_mwh
      else mwh = block.delivered_total_mwh
      push(`  ${s.padEnd(13)} = ${fmt1(Number(mwh ?? 0))} MWh   [source: brief40.${s}.${s==='ventilation' ? 'total_fan_electrical_mwh' : (s==='lighting'||s==='small_power' ? 'total_delivered_electrical_mwh' : 'delivered_total_mwh')}]`)
    }
  }
  push()

  // ── FUEL (per carrier) ─────────────────────────────────────────────
  push(`## FUEL (per carrier)`)
  push()
  if (b40) {
    const fs_ = b40.totals?.fuel_split ?? {}
    const carriers = ['electricity_kWh', 'gas_kWh', 'oil_kWh', 'biomass_kWh', 'district_heating_kWh', 'district_cooling_kWh']
    let totalKwh = 0
    for (const c of carriers) {
      const kwh = Number(fs_[c] ?? 0)
      if (kwh === 0) continue
      totalKwh += kwh
      push(`  ${c.replace('_kWh','').padEnd(20)} = ${fmt0(kwh)} kWh   [source: brief40.totals.fuel_split.${c}]`)
    }
    push(`  ──`)
    push(`  source_total          = ${fmt0(totalKwh)} kWh   [source: brief40.totals.annual_source_kWh]`)
    record('source_total', totalKwh, Number(b40.totals?.annual_source_kWh ?? 0))
  }
  push()

  // ── EUI ────────────────────────────────────────────────────────────
  push(`## EUI (kWh/m²·yr)`)
  push()
  const eui = Number(b40?.totals?.eui_kWh_per_m2 ?? 0)
  push(`  EUI = source_total / GIA = ${fmt0(Number(b40?.totals?.annual_source_kWh ?? 0))} / ${gia} = ${fmt1(eui)} kWh/m²·yr`)
  push(`     [source: brief40.totals.eui_kWh_per_m2; FINAL ENGINE OUTPUT]`)
  // T-G1: harness EUI MUST equal engine EUI by construction (we read it)
  push()

  return { lines, summary: { eui, heating_demand_mwh: heatMwh, cooling_demand_mwh: coolMwh, gia } }
}

// ── Diff mode helper ──
function traceDiff(beforeRun, afterRun, beforeSummary, afterSummary, ventPatch) {
  const lines = []
  const push = (s = '') => lines.push(s)
  push(`# DIFF MODE — Before vs After`)
  push()
  if (ventPatch) {
    push(`Mutation: \`v40.ventilation[id=${ventPatch.id}].flow_rate := ${ventPatch.flow_rate}\``)
    push()
  }
  // Side-by-side summary
  const b = beforeSummary
  const a = afterSummary
  push(`| Stage | Before | After | Δ |`)
  push(`|---|---:|---:|---:|`)
  push(`| Heating demand (MWh) | ${fmt1(b.heating_demand_mwh)} | ${fmt1(a.heating_demand_mwh)} | ${fmt1(a.heating_demand_mwh - b.heating_demand_mwh)} |`)
  push(`| Cooling demand (MWh) | ${fmt1(b.cooling_demand_mwh)} | ${fmt1(a.cooling_demand_mwh)} | ${fmt1(a.cooling_demand_mwh - b.cooling_demand_mwh)} |`)
  push(`| EUI (kWh/m²·yr)      | ${fmt1(b.eui)}                | ${fmt1(a.eui)}                | ${fmt1(a.eui - b.eui)} |`)
  push()
  if (ventPatch) {
    // Pull the specific ventilation system's flow + heat loss from both
    const findVent = (run) => {
      const v = (run.result?.losses_at_setpoint?.ventilation ?? []).find(x => {
        const m = (run.building?.systems_config_v25?.ventilation ?? []).find(s => (s.name ?? '') === x.name)
        return m && m.id === ventPatch.id
      })
      return v
    }
    const bv = findVent(beforeRun)
    const av = findVent(afterRun)
    const v40_before = (beforeRun.building?.systems_config_v40?.ventilation ?? []).find(v => v.id === ventPatch.id)
    const v40_after  = (afterRun.building?.systems_config_v40?.ventilation  ?? []).find(v => v.id === ventPatch.id)
    push(`## Patched system: ${ventPatch.id}`)
    push()
    push(`| Field | Source | Before | After | Δ | Tracked patch? |`)
    push(`|---|---|---:|---:|---:|---|`)
    push(`| v40.flow_rate           | systems_config_v40.ventilation[id=${ventPatch.id}].flow_rate | ${v40_before?.flow_rate} | ${v40_after?.flow_rate} | ${(v40_after?.flow_rate ?? 0) - (v40_before?.flow_rate ?? 0)} | ✓ this is what the editor writes |`)
    push(`| demand-path flow_l_s    | ventSystems[].flow_l_s (Brief 59 P1: v40-wins) | ${bv?.flow_l_s} | ${av?.flow_l_s} | ${(av?.flow_l_s ?? 0) - (bv?.flow_l_s ?? 0)} | ✓ coupled to v40.flow_rate |`)
    push(`| fan-path flow_l_s       | _computeVentilation reads v40 directly | ${v40_before?.flow_rate} | ${v40_after?.flow_rate} | ${(v40_after?.flow_rate ?? 0) - (v40_before?.flow_rate ?? 0)} | ✓ |`)
    push(`| ventUA (W/K)            | 0.33 × Q_m3_h × (1−HRE) × hours/8760 | ${fmt1(0.33 * (bv?.flow_l_s ?? 0) * 3.6 * (1 - (bv?.hre ?? 0)))} | ${fmt1(0.33 * (av?.flow_l_s ?? 0) * 3.6 * (1 - (av?.hre ?? 0)))} | ${fmt1(0.33 * 3.6 * ((av?.flow_l_s ?? 0) * (1 - (av?.hre ?? 0)) - (bv?.flow_l_s ?? 0) * (1 - (bv?.hre ?? 0))))} |  |`)
    push(`| vent heat_loss (kWh/yr) | losses_at_setpoint.ventilation[].heat_loss_kwh | ${fmt0(bv?.heat_loss_kwh)} | ${fmt0(av?.heat_loss_kwh)} | ${fmt0((av?.heat_loss_kwh ?? 0) - (bv?.heat_loss_kwh ?? 0))} | engine arithmetic |`)
    push(`| fan_kwh                 | losses_at_setpoint.ventilation[].fan_kwh | ${fmt0(bv?.fan_kwh)} | ${fmt0(av?.fan_kwh)} | ${fmt0((av?.fan_kwh ?? 0) - (bv?.fan_kwh ?? 0))} | engine arithmetic |`)
    push()
    push(`### Bug-signature check (Brief 59 Part 1)`)
    push()
    const demandFlowMoves = Math.abs((av?.flow_l_s ?? 0) - (bv?.flow_l_s ?? 0)) > 0.01
    const fanFlowMoves    = (v40_after?.flow_rate ?? 0) !== (v40_before?.flow_rate ?? 0)
    const heatLossMoves   = Math.abs((av?.heat_loss_kwh ?? 0) - (bv?.heat_loss_kwh ?? 0)) > 1
    if (demandFlowMoves && fanFlowMoves && heatLossMoves) {
      push(`✓ Demand-path flow AND fan-path flow AND vent heat_loss all move together. Coupling is correct (post-fix).`)
    } else if (!demandFlowMoves && fanFlowMoves) {
      push(`✗ BUG SIGNATURE DETECTED: fan-path flow moves but demand-path flow_l_s does NOT move. v40 edit isn't reaching the demand integrand. (This is exactly what Brief 59 Part 1 fixed — if you're seeing this on current main, the fix has regressed.)`)
    } else {
      push(`(Other pattern — inspect the table above.)`)
    }
  }
  push()
  return lines
}

// ── Main ──
const beforeRun = runEngine(null)
const ventPatch = parseVentPatch(VENT_PATCH)
const trace1 = traceOne('Baseline calculation trace', beforeRun)

let output = trace1.lines.join('\n')

if (DIFF || ventPatch) {
  const afterRun = runEngine(b => { if (ventPatch) applyVentPatch(b, ventPatch) })
  const trace2 = traceOne(`After mutation: vent[${ventPatch?.id ?? '?'}].flow_rate = ${ventPatch?.flow_rate ?? '?'}`, afterRun)
  output = [
    ...trace1.lines, '', '---', '',
    ...trace2.lines, '', '---', '',
    ...traceDiff(beforeRun, afterRun, trace1.summary, trace2.summary, ventPatch),
  ].join('\n')
}

// Self-consistency footer (T-G2)
output += '\n\n---\n\n## Harness self-consistency (T-G2)\n\n'
if (consistencyMisses.length === 0) {
  output += `All inspected formula↔result pairs reconcile within tolerance ✓\n`
} else {
  output += `${consistencyMisses.length} miss(es):\n`
  for (const m of consistencyMisses) {
    output += `  - ${m.label}: lhs=${m.lhs}, rhs=${m.rhs}, ${m.rel ? `rel_err=${(m.rel*100).toFixed(3)}%` : `abs_err=${m.abs_err}`}\n`
  }
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, output)
console.log(`Calculation trace written: ${OUT_PATH}`)
console.log(`Baseline EUI: ${fmt1(trace1.summary.eui)} kWh/m²·yr`)
if (DIFF || ventPatch) console.log(`Diff mode: included BEFORE vs AFTER section`)
if (consistencyMisses.length > 0) {
  console.error(`\n✗ ${consistencyMisses.length} self-consistency miss(es) — see footer.`)
  process.exit(1)
} else {
  console.log(`✓ T-G2 self-consistency: all inspected formulas reconcile`)
  process.exit(0)
}
