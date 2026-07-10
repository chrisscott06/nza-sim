/** Brief 100 P3 — verify the XLSX export builds correctly from live data.
 * Runs the engine to get per-intervention deltas, builds the workbook (the SAME
 * buildInterventionsWorkbook the UI download uses), reads it back, asserts the 4
 * sheets + spot-checks (1.4 capex, PV off-model carbon). Read-only. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from '../frontend/node_modules/xlsx/xlsx.mjs'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { runInterventionStack } from '../frontend/src/utils/interventionsEngine.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { buildInterventionsWorkbook } from '../frontend/src/utils/interventionExport.js'

const API = 'http://127.0.0.1:8002'
const PID = '12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const proj = await (await fetch(`${API}/api/projects/${PID}`)).json()
const libArr = (await (await fetch(`${API}/api/library/constructions`)).json()).constructions ?? []
const building = proj.building_config
const constructions = proj.construction_choices
const comfortBand = { lower_c: proj.comfort_band_lower_c ?? 20, upper_c: proj.comfort_band_upper_c ?? 26 }
const interventions = building.interventions ?? []
const gia = building.length * building.width * (building.num_floors ?? building.floors ?? 5)

const epw = fs.readFileSync(path.join(REPO,'data/weather/current',building.weather_file),'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6]); const D = epw.slice(8).filter(l=>l.trim()); const N=D.length
const mo=new Int8Array(N),dy=new Int8Array(N),hr=new Int8Array(N),te=new Float32Array(N),dn=new Float32Array(N),df=new Float32Array(N),ws=new Float32Array(N)
for(let i=0;i<N;i++){const p=D[i].split(',');mo[i]=+p[1];dy[i]=+p[2];hr[i]=+p[3];te[i]=+p[6];dn[i]=+p[14];df[i]=+p[15];ws[i]=+p[21]}
const weatherData={temperature:te,direct_normal:dn,diffuse_horizontal:df,wind_speed:ws,month:mo,day:dy,hour:hr}
const hourlySolar=computeHourlySolarByFacade(weatherData,lat,building.orientation??0)
const libraryData={constructions:libArr.map(c=>({name:c.name,u_value_W_per_m2K:c.config_json?.u_value_W_per_m2K??c.u_value_W_per_m2K,y_factor:c.config_json?.y_factor??c.y_factor??1.0,g_value:c.config_json?.g_value,config_json:c.config_json??c,layers:c.layers})),system_templates:SYSTEM_TEMPLATES_LIBRARY,library_systems:building?.library_systems??[],library_schedules:building?.library_schedules??[]}
const runEngine=(cfg)=>calculateInstant(cfg.building??building,cfg.constructions??constructions,cfg.systems??{},cfg.libraryData??libraryData,weatherData,hourlySolar,null,{mode:'full',comfortBand,engine:'v2.5',_skipInterventions:true})
const baseCfg={building,constructions,systems:{},libraryData,comfortBand}

// isolatedRows: each intervention alone, {id, cumulativeDelta, isolatedResult:{baseline}}
const isolatedRows = interventions.map(iv => {
  const stack = runInterventionStack(baseCfg, [{id:iv.id,label:iv.label,patches:iv.patches,enabled:true}], runEngine, libraryData)
  return { id: iv.id, cumulativeDelta: stack.interventions[0].cumulative_delta, isolatedResult: { baseline: stack.baseline } }
})

const wb = buildInterventionsWorkbook({ interventions, isolatedRows, projectDefaults: building.cost_defaults, gia })

// round-trip: write to buffer, read back
const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
const wb2 = XLSX.read(buf, { type: 'buffer' })
console.log('sheets:', wb2.SheetNames.join(', '))
const need = ['Summary','Calc trail','Cost plans','Narratives']
for (const s of need) { if (!wb2.SheetNames.includes(s)) throw new Error('missing sheet '+s) }

const summary = XLSX.utils.sheet_to_json(wb2.Sheets['Summary'])
console.log('Summary rows:', summary.length)
const ashp = summary.find(r => /Larger ASHP/.test(r['Label']))
const pv = summary.find(r => /Solar PV/.test(r['Label']))
console.log('1.4 ASHP:', JSON.stringify({capex:ashp['Capex (£)'], eui:ashp['EUI Δ (kWh/m²)'], life:ashp['Lifetime carbon Δ (tCO₂e)']}))
console.log('7.1 PV  :', JSON.stringify({capex:pv['Capex (£)'], eui:pv['EUI Δ (kWh/m²)'], life:pv['Lifetime carbon Δ (tCO₂e)'], perTonne:pv['£ / tonne CO₂'], payback:pv['Payback (yr)'], offmodel:pv['Off-model']}))

if (Math.abs(ashp['Capex (£)'] - 105700) > 1) throw new Error('1.4 capex != 105700: '+ashp['Capex (£)'])
if (Math.abs(pv['Lifetime carbon Δ (tCO₂e)'] - -30.8) > 0.1) throw new Error('PV lifetime carbon != -30.8: '+pv['Lifetime carbon Δ (tCO₂e)'])
if (pv['Off-model'] !== 'yes') throw new Error('PV not flagged off-model')
if (Math.abs(pv['EUI Δ (kWh/m²)'] - 0) > 0.01) throw new Error('PV EUI Δ should be 0: '+pv['EUI Δ (kWh/m²)'])

const cost = XLSX.utils.sheet_to_json(wb2.Sheets['Cost plans']).filter(r => /Larger ASHP/.test(r['Label']))
console.log('1.4 cost lines:', cost.filter(r=>r['Line item'] && !r['Line item'].startsWith('contingency')).map(r=>`${r['Line item']}=${r['Line total (£)']}`).join(' | '))
const calc = XLSX.utils.sheet_to_json(wb2.Sheets['Calc trail']).filter(r=>/Larger ASHP/.test(r['Label']))
console.log('1.4 calc-trail metrics:', calc.map(r=>r['Metric']).join(', '))
const narr = XLSX.utils.sheet_to_json(wb2.Sheets['Narratives']).find(r=>/Solar PV/.test(r['Label']))
console.log('PV narrative present:', !!narr['How this works (energy + cost)'], '· off-model basis present:', !!narr['Off-model basis'])

console.log('\nALL EXPORT CHECKS PASS.')
