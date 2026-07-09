/** Brief 99 P4 — verify the interventions engine computes on the LIVE Bridgewater
 * project now that the 22 HIEX interventions are seeded. Read-only (no writes).
 * Mirrors scripts/report/run_nza.mjs but fetches the live project via API and uses
 * its OWN seeded interventions. Reports: baseline EUI, isolated ΔEUI per intervention
 * (0 for off-model/enabling), cumulative-spine final EUI. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { runInterventionStack } from '../frontend/src/utils/interventionsEngine.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = 'http://127.0.0.1:8002'
const PID = '12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPINE = ['5.3','4.1','5.1','6.1','3.3','5.4','2.3','2.2','3.1','1.1','5.2','4.2','4.3','3.2','1.5','1.4','1.2','1.3','7.1','3.4','3.5','2.1']
const r1 = v => (Number.isFinite(v) ? Math.round(v*10)/10 : null)

const proj = await (await fetch(`${API}/api/projects/${PID}`)).json()
const libArr = (await (await fetch(`${API}/api/library/constructions`)).json()).constructions ?? []
const building = proj.building_config
const constructions = proj.construction_choices
const comfortBand = { lower_c: proj.comfort_band_lower_c ?? 20, upper_c: proj.comfort_band_upper_c ?? 26 }
const interventions = building.interventions ?? []

const epw = fs.readFileSync(path.join(REPO,'data/weather/current',building.weather_file),'utf-8').split(/\r?\n/)
const lat = parseFloat(epw[0].split(',')[6])
const D = epw.slice(8).filter(l=>l.trim()); const N=D.length
const mo=new Int8Array(N),dy=new Int8Array(N),hr=new Int8Array(N),te=new Float32Array(N),dn=new Float32Array(N),df=new Float32Array(N),ws=new Float32Array(N)
for(let i=0;i<N;i++){const p=D[i].split(',');mo[i]=+p[1];dy[i]=+p[2];hr[i]=+p[3];te[i]=+p[6];dn[i]=+p[14];df[i]=+p[15];ws[i]=+p[21]}
const weatherData={temperature:te,direct_normal:dn,diffuse_horizontal:df,wind_speed:ws,month:mo,day:dy,hour:hr}
const hourlySolar=computeHourlySolarByFacade(weatherData,lat,building.orientation??0)
const libraryData={constructions:libArr.map(c=>({name:c.name,u_value_W_per_m2K:c.config_json?.u_value_W_per_m2K??c.u_value_W_per_m2K,y_factor:c.config_json?.y_factor??c.y_factor??1.0,g_value:c.config_json?.g_value,config_json:c.config_json??c,layers:c.layers})),system_templates:SYSTEM_TEMPLATES_LIBRARY,library_systems:building?.library_systems??[],library_schedules:building?.library_schedules??[]}

const runEngine=(cfg)=>calculateInstant(cfg.building??building,cfg.constructions??constructions,cfg.systems??{},cfg.libraryData??libraryData,weatherData,hourlySolar,null,{mode:'full',comfortBand,engine:'v2.5',_skipInterventions:true})
const baseCfg={building,constructions,systems:{},libraryData,comfortBand}
const euiOf=r=>r1(r?.consumption?.total?.kwh_per_m2_yr)

const baselineEui = euiOf(runEngine(baseCfg))
console.log(`LIVE baseline EUI: ${baselineEui} kWh/m²·yr  (report_baseline_v1 was 126.0)`)
console.log(`seeded interventions: ${interventions.length}\n`)

// Isolated ΔEUI per intervention (each alone vs baseline)
console.log('ISOLATED ΔEUI per intervention:')
let zeroDeltaClasses=0, nonzeroCount=0
const byId=Object.fromEntries(interventions.map(iv=>[iv.id,iv]))
for(const ref of SPINE.slice().sort()){
  const iv=byId[`int_hiex_${ref.replace('.','_')}`]; if(!iv) continue
  const stack=runInterventionStack(baseCfg,[{id:iv.id,label:iv.label,patches:iv.patches,enabled:true}],runEngine,libraryData)
  const eui=euiOf(stack.interventions[0].result); const d=r1(eui-baselineEui)
  const flag=(iv.notes.match(/\(([a-z_]+)\)/)||[])[1]||'?'
  const npatch=iv.patches.length
  if(npatch===0){ if(Math.abs(d)<0.05) zeroDeltaClasses++; }
  else if(Math.abs(d)>0.05) nonzeroCount++
  console.log(`  ${ref.padEnd(4)} ${flag.padEnd(10)} patches=${npatch}  ΔEUI=${(d>0?'+':'')}${d}`)
}
console.log(`\n  → ${nonzeroCount} modellable interventions moved EUI; off-model/enabling (0-patch) showed ~0 Δ.`)

// Cumulative spine (all 22 in phasing order)
const spine=SPINE.map(ref=>byId[`int_hiex_${ref.replace('.','_')}`]).filter(Boolean).map(iv=>({id:iv.id,label:iv.label,patches:iv.patches,enabled:true}))
const cum=runInterventionStack(baseCfg,spine,runEngine,libraryData)
const finalEui=euiOf(cum.interventions[cum.interventions.length-1].result)
const redPct=r1(100*(finalEui-baselineEui)/baselineEui)
console.log(`\nCUMULATIVE spine (22 in phasing order):`)
console.log(`  final EUI = ${finalEui}  (from live baseline ${baselineEui} → ${redPct}%)`)
console.log(`  report reference: 74.8 from 126.0 baseline (-40.6%). Live baseline differs, so compare the reduction %.`)
