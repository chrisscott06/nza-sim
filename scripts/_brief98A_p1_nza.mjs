/** Brief 98-A P1 — run NZA-Sim (calculateInstant) on report_baseline_v1 and dump the
 * detailed consumption + monthly heating/cooling shapes for the two-claim comparison.
 * Output: docs/audit/98A_nza_results.json. Read-only. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const py = path.join(REPO, 'validation/.venv/bin/python3')
const fx = JSON.parse(execFileSync(py, ['-c', 'import yaml,json,sys;json.dump(yaml.safe_load(open(sys.argv[1])),sys.stdout)', path.join(REPO, 'validation/fixtures/report_baseline_v1.yaml')]))
const building = fx.building_config
const constructions = fx.construction_choices
const dbCb = { lower_c: fx.comfort_band?.lower_c ?? 20, upper_c: fx.comfort_band?.upper_c ?? 26 }
const libArr = fx.library_constructions ?? []

const epw = fs.readFileSync(path.join(REPO, 'data/weather/current', building.weather_file), 'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const D = epw.slice(8).filter(l => l.trim()); const N = D.length
const mo=new Int8Array(N),dy=new Int8Array(N),hr=new Int8Array(N),te=new Float32Array(N),dn=new Float32Array(N),df=new Float32Array(N),ws=new Float32Array(N)
for (let i=0;i<N;i++){const p=D[i].split(',');mo[i]=+p[1];dy[i]=+p[2];hr[i]=+p[3];te[i]=+p[6];dn[i]=+p[14];df[i]=+p[15];ws[i]=+p[21]}
const weatherData={temperature:te,direct_normal:dn,diffuse_horizontal:df,wind_speed:ws,month:mo,day:dy,hour:hr}
const hourlySolar=computeHourlySolarByFacade(weatherData,lat,building.orientation??0)
const libraryData={constructions:libArr.map(c=>({name:c.name,u_value_W_per_m2K:c.config_json?.u_value_W_per_m2K??c.u_value_W_per_m2K,y_factor:c.config_json?.y_factor??c.y_factor??1.0,g_value:c.config_json?.g_value,config_json:c.config_json??c,layers:c.layers})),system_templates:SYSTEM_TEMPLATES_LIBRARY,library_systems:building?.library_systems??[],library_schedules:building?.library_schedules??[]}

const r = calculateInstant(building, constructions, {}, libraryData, weatherData, hourlySolar, null, { mode: 'full', comfortBand: dbCb, _skipInterventions: true, engine: 'v2.5' })
const c = r?.consumption ?? {}
const hb = r?.heat_balance ?? {}
const svc = (s) => ({ demand_mwh: c?.[s]?.demand_mwh ?? null, delivered_mwh: c?.[s]?.delivered_mwh ?? c?.[s]?.delivered_total_mwh ?? null, electricity_mwh: c?.[s]?.electricity_mwh ?? null, gas_mwh: c?.[s]?.gas_mwh ?? null })

// Loss breakdown (gross losses at setpoint) — for naming the Claim-1 residuals.
const losses = hb?.annual?.losses ?? {}
const lossMwh = Object.fromEntries(Object.entries(losses).map(([k, v]) => [k, (v?.kwh ?? 0) / 1000]))
// Monthly heating-loss shape = Σ per-element monthly_heating_loss_kwh (the demand-shape proxy).
const los = hb?.losses_at_setpoint ?? {}
const elems = Object.values(los).filter(v => Array.isArray(v?.monthly_heating_loss_kwh))
const monthly_heating_loss = Array.from({ length: 12 }, (_, m) =>
  elems.reduce((s, e) => s + (e.monthly_heating_loss_kwh[m] ?? 0), 0))
const out = {
  eui_kwh_per_m2: c?.total?.kwh_per_m2_yr ?? null,
  electricity_mwh: c?.total?.electricity_mwh ?? null,
  gas_mwh: c?.total?.gas_mwh ?? null,
  space_heating: svc('space_heating'),
  space_cooling: svc('space_cooling'),
  dhw: svc('dhw'),
  ventilation: svc('ventilation'),
  lighting: svc('lighting'),
  small_power: svc('small_power'),
  gross_losses_mwh: lossMwh,
  monthly_heating_loss_kwh: monthly_heating_loss,
  consumption_keys: Object.keys(c ?? {}),
}
const OUT = path.join(REPO, 'docs/audit/98A_nza_results.json')
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`NZA EUI ${out.eui_kwh_per_m2} · heating ${out.space_heating.demand_mwh} MWh · cooling ${out.space_cooling.demand_mwh} MWh`)
console.log('consumption keys:', out.consumption_keys.join(', '))
console.log('heat_balance keys:', out.heat_balance_keys.join(', '))
console.log(`wrote ${OUT}`)
