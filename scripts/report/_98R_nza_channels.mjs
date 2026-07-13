/**
 * 98-R — dump NZA-Sim's per-channel heat-balance + delivered energy for the reconciliation
 * table. Pure consumer of the engine (calculateInstant, anchor path). No engine change.
 * Output: docs/audit/98R_nza_channels.json. Run: node scripts/report/_98R_nza_channels.mjs
 */
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../frontend/src/data/systemTemplatesLibrary.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fx = JSON.parse(execFileSync(path.join(REPO, 'validation/.venv/bin/python'),
  ['-c', 'import yaml,json,sys;json.dump(yaml.safe_load(open(sys.argv[1])),sys.stdout)',
   path.join(REPO, 'validation/fixtures/report_baseline_v1.yaml')], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }))
const b = fx.building_config
const epw = fs.readFileSync(path.join(REPO, 'data/weather/current', b.weather_file), 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const dl = epw.slice(8).filter(l => l.trim()); const N = dl.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N), temperature = new Float32Array(N)
const direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) { const p = dl[i].split(','); month[i] = +p[1]; day[i] = +p[2]; hour[i] = +p[3]; temperature[i] = +p[6]; direct_normal[i] = +p[14]; diffuse_horizontal[i] = +p[15]; wind_speed[i] = +p[21] }
const wd = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const hs = computeHourlySolarByFacade(wd, lat, b.orientation ?? 0)
const lib = { constructions: (fx.library_constructions ?? []).map(c => ({ name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? 1, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers })), system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: b.library_systems ?? [], library_schedules: b.library_schedules ?? [] }
const res = calculateInstant(b, fx.construction_choices, {}, lib, wd, hs, null, { mode: 'full', comfortBand: { lower_c: 21, upper_c: 24 }, engine: 'v2.5', _skipInterventions: true })

const L = res.heat_balance.losses_at_setpoint
const c = res.consumption
const sum = a => (a || []).reduce((x, y) => x + y, 0)
const mwh = k => Math.round((k / 1000) * 10) / 10

// per-system ventilation heating loss (kWh)
const vent = {}
for (const v of L.ventilation) vent[v.name || v.id || v.label] = v.heating_loss_kwh ?? sum(v.monthly_heating_loss_kwh)

const out = {
  _meta: { source: 'NZA-Sim calculateInstant v2.5, report_baseline_v1', units: 'MWh annual' },
  losses: {
    wall_conduction: mwh(L.external_wall.heating_loss_kwh),
    roof_conduction: mwh(L.roof.heating_loss_kwh),
    floor_conduction: mwh(L.ground_floor.heating_loss_kwh),
    glazing_conduction: mwh(L.glazing.heating_loss_kwh),
    infiltration: mwh(L.fabric_leakage.heating_loss_kwh),
    permanent_vents: mwh(L.permanent_vents.heating_loss_kwh),
    thermal_bridging: mwh(L.thermal_bridging.heating_loss_kwh),
    mech_vent_public_mvhr: mwh(vent['mvhr_gf_public'] ?? 0),
    mech_vent_bedroom_extract: mwh(vent['bedroom_extract'] ?? 0),
    mech_vent_toilet_extract: mwh(vent['public_toilet_extract'] ?? 0),
    natural_ventilation: mwh(Array.isArray(L.natural_ventilation) ? L.natural_ventilation.reduce((s, o) => s + (o.heating_loss_kwh || 0), 0) : 0),
    total_gross_loss: mwh(L.totals.total_heating_loss_kwh),
  },
  gains: {
    solar_through_glazing: mwh(L.glazing.solar_transmission_kwh),
    people: mwh(sum(L.internal_gains_monthly.people_kwh)),
    lighting: mwh(sum(L.internal_gains_monthly.lighting_kwh)),
    equipment: mwh(sum(L.internal_gains_monthly.equipment_kwh)),
    auxiliary: mwh(sum(L.internal_gains_monthly.auxiliary_kwh)),
  },
  demand: { heating: mwh(c.space_heating.demand_mwh * 1000), cooling: mwh(c.space_cooling.demand_mwh * 1000) },
  delivered: {
    heating_electricity: c.space_heating.electricity_mwh ?? null,
    heating_gas: c.space_heating.gas_mwh ?? null,
    cooling_electricity: c.space_cooling.electricity_mwh ?? null,
    dhw_electricity: c.dhw?.electricity_mwh ?? null,
    dhw_gas: c.dhw?.gas_mwh ?? null,
    vent_fans_electricity: c.ventilation?.electricity_mwh ?? null,
    lighting_electricity: c.lighting?.electricity_mwh ?? null,
    small_power_electricity: c.small_power?.electricity_mwh ?? null,
    total_electricity: c.total?.electricity_mwh ?? null,
    total_gas: c.total?.gas_mwh ?? null,
  },
}
const OUT = path.join(REPO, 'docs/audit/98R_nza_channels.json')
fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
console.error('wrote ' + path.relative(REPO, OUT))
console.error('gross-loss reconciliation: channels sum vs total = ' +
  mwh(L.external_wall.heating_loss_kwh + L.roof.heating_loss_kwh + L.ground_floor.heating_loss_kwh +
      L.glazing.heating_loss_kwh + L.fabric_leakage.heating_loss_kwh + L.permanent_vents.heating_loss_kwh +
      L.thermal_bridging.heating_loss_kwh + Object.values(vent).reduce((s, x) => s + x, 0)) +
  ' vs ' + mwh(L.totals.total_heating_loss_kwh))
