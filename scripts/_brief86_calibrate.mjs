import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
const __dirname = path.dirname(fileURLToPath(import.meta.url)); const REPO_ROOT = path.resolve(__dirname,'..')
const API='http://127.0.0.1:8002'; const PID='12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d'
const fj=async u=>{const r=await fetch(u); if(!r.ok) throw new Error(u+' '+r.status); return r.json()}
const project=await fj(`${API}/api/projects/${PID}`)
const lib=await fj(`${API}/api/library/constructions`); const libArr=lib.constructions??[]
const constructions=project.construction_choices
const building=JSON.parse(JSON.stringify(project.building_config))
const comfortBand={lower_c:project.comfort_band_lower_c??20, upper_c:project.comfort_band_upper_c??26}
const weatherFile=building.weather_file||project.weather_file
const epw=fs.readFileSync(path.join(REPO_ROOT,'data/weather/current',weatherFile),'utf-8').split(/\r?\n/)
const lat=parseFloat(epw[0].split(',')[6]); const D=epw.slice(8).filter(l=>l.trim()); const N=D.length
const t=new Float32Array(N),dn=new Float32Array(N),dh=new Float32Array(N),ws=new Float32Array(N),mo=new Int8Array(N),da=new Int8Array(N),ho=new Int8Array(N)
for(let i=0;i<N;i++){const p=D[i].split(',');mo[i]=+p[1];da[i]=+p[2];ho[i]=+p[3];t[i]=+p[6];dn[i]=+p[14];dh[i]=+p[15];ws[i]=+p[21]}
const weatherData={temperature:t,direct_normal:dn,diffuse_horizontal:dh,wind_speed:ws,month:mo,day:da,hour:ho}
const hourlySolar=computeHourlySolarByFacade(weatherData,lat,Number(building.orientation??0))
const libraryData={constructions:libArr.map(c=>({name:c.name,u_value_W_per_m2K:c.config_json?.u_value_W_per_m2K??c.u_value_W_per_m2K,y_factor:1.0,g_value:c.config_json?.g_value,config_json:c.config_json??c})),system_templates:SYSTEM_TEMPLATES_LIBRARY}
const res=calculateInstant(building,constructions,{},libraryData,weatherData,hourlySolar,null,{mode:'full',engine:'v2.5',comfortBand,_skipInterventions:true})
// locate the systems/energy result
const sys=res.systems||res.energy||res
console.log('RESULT TOP KEYS:', Object.keys(res).join(', '))
const fs2=sys.fuel_split||res.fuel_split
const eui=sys.eui_kWh_per_m2 ?? res.eui_kWh_per_m2 ?? res.eui
console.log('EUI kWh/m2:', eui, ' (target 180)')
if(fs2){const e=fs2.electricity||0,g=fs2.gas||0,tot=e+g; console.log(`fuel split: elec ${(100*e/tot).toFixed(0)}% / gas ${(100*g/tot).toFixed(0)}%  (elec ${(e/1000).toFixed(0)} MWh, gas ${(g/1000).toFixed(0)} MWh)`)}
console.log('systems keys:', Object.keys(sys).join(', '))
console.log('\n--- energy_use ---'); console.log(JSON.stringify(sys.energy_use,null,1)?.slice(0,800))
console.log('\n--- consumption ---'); console.log(JSON.stringify(sys.consumption,null,1)?.slice(0,800))
console.log('\n--- results ---'); console.log(JSON.stringify(sys.results,null,1)?.slice(0,600))
console.log('\n=== DIAGNOSIS ===')
console.log('demand (full mode):', JSON.stringify(res.demand))
console.log('heat_balance.annual.demand:', JSON.stringify(res.heat_balance?.annual?.demand))
console.log('consumption.space_cooling:', JSON.stringify(res.consumption?.space_cooling)?.slice(0,300))
console.log('consumption.dhw:', JSON.stringify(res.consumption?.dhw)?.slice(0,300))
console.log('system_performance keys:', Object.keys(res.system_performance||{}).join(', '))
console.log('cfg heating[0]:', JSON.stringify(building.systems_config_v40?.heating?.[0])?.slice(0,300))
console.log('cfg dhw[0]:', JSON.stringify(building.systems_config_v40?.dhw?.[0])?.slice(0,300))
console.log('\n=== EUI/FUEL SEARCH ===')
function walk(o,p=''){ if(o&&typeof o==='object'){for(const k of Object.keys(o)){const kp=p?p+'.'+k:k; if(/eui|fuel_split|source.*kwh|annual_source/i.test(k)) console.log(kp,'=',JSON.stringify(o[k])?.slice(0,160)); if(typeof o[k]==='object') walk(o[k],kp)}}}
walk(res)
const tot=sys.energy_use?.totals||{}
console.log('\nDELIVERED: elec',(tot.electricity_kwh/1000).toFixed(1),'MWh  gas',((tot.gas_kwh||sys.energy_use?.gas?.total)/1000).toFixed(1),'MWh')
