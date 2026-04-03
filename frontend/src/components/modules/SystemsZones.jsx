/**
 * SystemsZones.jsx — three-column live workspace
 *
 * Left (w-64):   All system inputs (HVAC, Ventilation, DHW, Lighting, Small Power)
 * Centre (flex-1): System schematic diagram
 * Right (w-80):  SystemsLiveResults — instant-calc results
 */

import { useContext, useEffect, useState } from 'react'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import SystemSankey from './systems/SystemSankey.jsx'
import SystemsLiveResults from './systems/SystemsLiveResults.jsx'

// ── Shared compact input components ──────────────────────────────────────────

function SectionHeader({ title }) {
  return (
    <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2 mt-3 first:mt-0">{title}</p>
  )
}

function Field({ label, children }) {
  return (
    <div className="mb-2">
      <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-0.5">{label}</label>
      {children}
    </div>
  )
}

function CompactSelect({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal transition-colors appearance-none disabled:opacity-40 cursor-pointer"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2395A5A6' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
        paddingRight: '24px',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SliderWithNumber({ value, onChange, min, max, step = 0.1, unit = '', disabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 h-[3px] accent-teal disabled:opacity-40"
      />
      <input
        type="number" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-14 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-right focus:outline-none focus:border-teal disabled:opacity-40"
      />
      {unit && <span className="text-xxs text-mid-grey flex-shrink-0">{unit}</span>}
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-1.5 text-xxs px-2 py-1 rounded border transition-colors ${
        value
          ? 'bg-teal/10 text-teal border-teal/30'
          : 'bg-white text-mid-grey border-light-grey hover:border-teal'
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${value ? 'bg-teal' : 'bg-light-grey'}`} />
      {label}
    </button>
  )
}

// ── Accordion section ─────────────────────────────────────────────────────────

function AccordionSection({ id, title, summary, isOpen, onToggle, children, accentColor = '#00AEEF' }) {
  return (
    <div
      className="border-t border-light-grey"
      style={{ borderLeft: `3px solid ${isOpen ? accentColor : 'transparent'}` }}
    >
      <button
        onClick={() => onToggle(id)}
        className={`w-full flex items-center justify-between px-2 py-2 text-left transition-colors ${
          isOpen ? 'bg-teal/5' : 'hover:bg-off-white'
        }`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xxs font-semibold text-navy uppercase tracking-wider">{title}</p>
          {!isOpen && summary && (
            <p className="text-xxs text-mid-grey truncate mt-0.5">{summary}</p>
          )}
        </div>
        <svg
          className={`flex-shrink-0 ml-1 w-3 h-3 text-mid-grey transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: isOpen ? '600px' : '0px' }}
      >
        <div className={`px-2 pb-3 ${isOpen ? 'bg-teal/5' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Demand section helpers ─────────────────────────────────────────────────────

/** Get the label for a system name from the library array */
function sysLabel(library, name, fallback = name) {
  return library.find(l => l.name === name)?.display_name ?? fallback
}

/** Get a library item by name */
function sysItem(library, name) {
  return library.find(l => l.name === name)
}

// ── Left inputs column (demand-based) ────────────────────────────────────────

function InputsColumn({ library, openSection, setOpenSection }) {
  const { systems, updateSystem } = useContext(ProjectContext)

  const isIdeal = systems.mode !== 'detailed'
  const toggleSection = (id) => setOpenSection(prev => prev === id ? null : id)

  // ── Demand state shortcuts ────────────────────────────────────────────────
  const sh  = systems.space_heating  ?? { primary: { system: 'gas_boiler_standard', share: 1.0 }, secondary: null }
  const sc  = systems.space_cooling  ?? { primary: { system: 'vrf_standard',         share: 1.0 }, secondary: null }
  const dhw = systems.dhw            ?? { primary: { system: 'gas_boiler_dhw',        share: 1.0 }, secondary: null }
  const ven = systems.ventilation    ?? { primary: { system: 'mvhr_standard',          share: 1.0 }, secondary: null }

  const shSys  = sh.primary?.system  ?? 'gas_boiler_standard'
  const scSys  = sc.primary?.system  ?? 'vrf_standard'
  const dhwSys = dhw.primary?.system ?? 'gas_boiler_dhw'
  const venSys = ven.primary?.system ?? 'mvhr_standard'

  const isMVHR    = venSys.startsWith('mvhr')
  const hasDhwSec = !!dhw.secondary
  const hasShSec  = !!sh.secondary
  const hasScSec  = !!sc.secondary

  // ── Demand update helpers ─────────────────────────────────────────────────
  const setPrimary   = (demand, system) => updateSystem(demand, { ...systems[demand], primary:   { ...(systems[demand]?.primary   ?? { share: 1.0, efficiency_override: null }), system } })
  const setSecondary = (demand, sec)    => updateSystem(demand, { ...systems[demand], secondary: sec })
  const setShare     = (demand, share)  => {
    const s = systems[demand]
    updateSystem(demand, { ...s, primary: { ...s.primary, share }, secondary: s.secondary ? { ...s.secondary, share: Math.round((1 - share) * 100) / 100 } : null })
  }
  const setSecSys    = (demand, system) => {
    const s = systems[demand]
    updateSystem(demand, { ...s, secondary: { ...(s.secondary ?? { share: 0.2, efficiency_override: null }), system } })
  }

  // ── Filtered option lists ─────────────────────────────────────────────────
  const heatingOpts = (() => {
    const items = library.filter(l => l.serves === 'heating' || l.serves === 'heating_and_cooling')
    if (!items.length) return [{ value: shSys, label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const coolingOpts = (() => {
    const items = library.filter(l => l.serves === 'cooling' || l.serves === 'heating_and_cooling')
    if (!items.length) return [{ value: scSys, label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const dhwPrimOpts = (() => {
    const items = library.filter(l => l.serves === 'dhw' && !l.name.includes('preheat'))
    if (!items.length) return [{ value: dhwSys, label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const dhwSecOpts = (() => {
    const items = library.filter(l => l.serves === 'dhw' && (l.type === 'ashp_dhw' || l.name.includes('solar') || l.name.includes('preheat')))
    if (!items.length) return [{ value: 'ashp_dhw', label: 'ASHP preheat' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const ventOpts = (() => {
    const items = library.filter(l => l.serves === 'ventilation')
    if (!items.length) return [{ value: venSys, label: 'Loading…' }]
    return items.map(l => ({ value: l.name, label: l.display_name ?? l.name }))
  })()

  const lightingControlOpts = [
    { value: 'manual',            label: 'Manual switching' },
    { value: 'occupancy_sensing', label: 'Occupancy sensing' },
    { value: 'daylight_dimming',  label: 'Daylight dimming' },
  ]

  const ventControlOpts = [
    { value: 'continuous', label: 'Continuous' },
    { value: 'occupied',   label: 'Occupied hours' },
    { value: 'timer',      label: 'Timer' },
  ]

  const lpd = systems.lighting_power_density ?? 8.0
  const epd = systems.equipment_power_density ?? 15.0
  const LPD_PRESETS = [{ label: 'LED', value: 4 }, { label: 'Fluor', value: 8 }, { label: 'Incan', value: 16 }]

  // ── One-line summaries ────────────────────────────────────────────────────
  const shItem   = sysItem(library, shSys)
  const scItem   = sysItem(library, scSys)
  const dhwItem  = sysItem(library, dhwSys)
  const venItem  = sysItem(library, venSys)

  const shEff    = shItem?.scop ?? shItem?.efficiency_value ?? shItem?.heating_cop
  const scEff    = scItem?.seer ?? scItem?.efficiency_value ?? scItem?.cooling_eer
  const shEffStr = shEff ? (shItem?.fuel_type === 'gas' ? `${Math.round(shEff * 100)}% eff` : `SCOP ${shEff}`) : ''
  const scEffStr = scEff ? `SEER ${scEff}` : 'No cooling'

  const shSummary  = isIdeal ? 'Ideal Loads' : `${sysLabel(library, shSys)} ${shEffStr ? `(${shEffStr})` : ''}${hasShSec ? ` + ${sysLabel(library, sh.secondary?.system ?? '')} secondary` : ''}`
  const scSummary  = isIdeal ? 'Ideal Loads' : `${sysLabel(library, scSys)} ${scEffStr ? `(${scEffStr})` : ''}${hasScSec ? ` + secondary` : ''}`
  const dhwSummary = `${sysLabel(library, dhwSys)}${hasDhwSec ? ` + ${sysLabel(library, dhw.secondary?.system ?? 'ashp_dhw', 'ASHP preheat')}` : ''} · ${systems.dhw_setpoint ?? 60}°C`
  const venSummary = isMVHR
    ? `MVHR · SFP ${systems.sfp_override ?? 1.8} W/(l/s) · ${systems.hre_override ?? 85}% HR`
    : `${venItem?.display_name ?? 'MEV'} · SFP ${systems.sfp_override ?? 1.5} W/(l/s)`
  const lightSummary = `${lpd} W/m² · ${lightingControlOpts.find(o => o.value === (systems.lighting_control ?? 'occupancy_sensing'))?.label}`
  const powerSummary = `${epd} W/m²`

  // Is the space cooling system the same combined VRF as heating?
  const isCombinedVRF = shSys === scSys && (sysItem(library, shSys)?.serves === 'heating_and_cooling')

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-r border-light-grey">
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-light-grey" style={{ borderTopWidth: '3px', borderTopColor: '#00AEEF', borderTopStyle: 'solid' }}>
        <p className="text-caption font-medium" style={{ color: '#00AEEF' }}>Systems</p>
        <p className="text-xxs text-mid-grey">Assign systems to each energy demand</p>
      </div>

      {/* Simulation Mode */}
      <div className="px-3 py-2 border-b border-light-grey">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Simulation Mode</p>
        <div className="flex gap-1.5">
          {[{ v: 'detailed', l: 'Detailed' }, { v: 'ideal', l: 'Ideal Loads' }].map(opt => (
            <button key={opt.v} onClick={() => updateSystem('mode', opt.v)}
              className={`flex-1 py-1 text-xxs rounded border transition-colors ${systems.mode === opt.v ? 'bg-teal text-white border-teal' : 'bg-white text-mid-grey border-light-grey hover:border-teal'}`}
            >{opt.l}</button>
          ))}
        </div>
        {isIdeal && <p className="text-xxs text-amber-600 mt-1.5">⚠ Ideal Loads bypasses real HVAC</p>}
      </div>

      {/* ── Space Heating ── */}
      <AccordionSection id="space_heating" title="Space Heating" summary={shSummary}
        isOpen={openSection === 'space_heating'} onToggle={toggleSection}
      >
        <div className={`mt-2 space-y-1 ${isIdeal ? 'opacity-40 pointer-events-none' : ''}`}>
          <Field label="Primary system">
            <CompactSelect value={shSys} onChange={v => setPrimary('space_heating', v)} options={heatingOpts} />
          </Field>
          {/* Efficiency override */}
          {shItem && (shItem.scop || shItem.efficiency_value) && (
            <Field label={shItem.fuel_type === 'gas' ? 'Seasonal efficiency' : 'SCOP'}>
              <SliderWithNumber
                value={sh.primary?.efficiency_override ?? shItem?.scop ?? shItem?.efficiency_value ?? 3.5}
                onChange={v => updateSystem('space_heating', { ...sh, primary: { ...sh.primary, efficiency_override: v } })}
                min={shItem?.fuel_type === 'gas' ? 0.7 : 1.5}
                max={shItem?.fuel_type === 'gas' ? 1.0 : 6.0}
                step={shItem?.fuel_type === 'gas' ? 0.01 : 0.1}
              />
            </Field>
          )}
          {/* Combined VRF note */}
          {isCombinedVRF && (
            <p className="text-xxs text-teal italic mt-1">Also serving Space Cooling</p>
          )}
          {/* Secondary system */}
          {!hasShSec ? (
            <button onClick={() => setSecondary('space_heating', { system: 'gas_boiler_heating', share: 0.2, efficiency_override: null })}
              className="text-xxs text-teal hover:underline mt-1 block"
            >+ Add secondary (bivalent)</button>
          ) : (
            <div className="mt-1 pt-1 border-t border-light-grey space-y-1">
              <Field label={`Secondary (${Math.round((sh.secondary?.share ?? 0.2) * 100)}%)`}>
                <CompactSelect
                  value={sh.secondary?.system ?? 'gas_boiler_heating'}
                  onChange={v => setSecSys('space_heating', v)}
                  options={heatingOpts}
                />
              </Field>
              <Field label="Secondary share">
                <SliderWithNumber
                  value={Math.round((sh.secondary?.share ?? 0.2) * 100)}
                  onChange={v => setSecondary('space_heating', { ...sh.secondary, share: v / 100 })}
                  min={5} max={50} step={5} unit="%"
                />
              </Field>
              <button onClick={() => setSecondary('space_heating', null)} className="text-xxs text-mid-grey hover:text-red-500">✕ Remove secondary</button>
            </div>
          )}
        </div>
      </AccordionSection>

      {/* ── Space Cooling ── */}
      <AccordionSection id="space_cooling" title="Space Cooling" summary={scSummary}
        isOpen={openSection === 'space_cooling'} onToggle={toggleSection}
      >
        <div className={`mt-2 space-y-1 ${isIdeal ? 'opacity-40 pointer-events-none' : ''}`}>
          <Field label="Primary system">
            <CompactSelect value={scSys} onChange={v => setPrimary('space_cooling', v)} options={coolingOpts} />
          </Field>
          {/* Efficiency override */}
          {scItem && (scItem.seer || scItem.efficiency_value) && scItem.serves !== 'heating' && (
            <Field label="SEER">
              <SliderWithNumber
                value={sc.primary?.efficiency_override ?? scItem?.seer ?? scItem?.efficiency_value ?? 3.2}
                onChange={v => updateSystem('space_cooling', { ...sc, primary: { ...sc.primary, efficiency_override: v } })}
                min={1.5} max={7.0} step={0.1}
              />
            </Field>
          )}
          {isCombinedVRF && (
            <p className="text-xxs text-teal italic mt-1">Linked to Space Heating — same VRF unit</p>
          )}
          {!hasScSec ? (
            <button onClick={() => setSecondary('space_cooling', { system: 'split_system_cooling', share: 0.2, efficiency_override: null })}
              className="text-xxs text-teal hover:underline mt-1 block"
            >+ Add secondary</button>
          ) : (
            <div className="mt-1 pt-1 border-t border-light-grey space-y-1">
              <Field label={`Secondary (${Math.round((sc.secondary?.share ?? 0.2) * 100)}%)`}>
                <CompactSelect value={sc.secondary?.system ?? 'split_system_cooling'} onChange={v => setSecSys('space_cooling', v)} options={coolingOpts} />
              </Field>
              <button onClick={() => setSecondary('space_cooling', null)} className="text-xxs text-mid-grey hover:text-red-500">✕ Remove secondary</button>
            </div>
          )}
        </div>
      </AccordionSection>

      {/* ── DHW ── */}
      <AccordionSection id="dhw" title="DHW" summary={dhwSummary}
        isOpen={openSection === 'dhw'} onToggle={toggleSection}
      >
        <div className="mt-2 space-y-1">
          <Field label="Primary system">
            <CompactSelect value={dhwSys} onChange={v => setPrimary('dhw', v)} options={dhwPrimOpts} />
          </Field>
          <Field label="Preheat (secondary)">
            <div className="flex items-center gap-1.5">
              <CompactSelect
                value={hasDhwSec ? (dhw.secondary?.system ?? 'ashp_dhw') : 'none'}
                onChange={v => {
                  if (v === 'none') setSecondary('dhw', null)
                  else setSecondary('dhw', { system: v, share: 0.7, efficiency_override: null })
                }}
                options={[{ value: 'none', label: 'None' }, ...dhwSecOpts]}
              />
            </div>
          </Field>
          {hasDhwSec && (
            <p className="text-xxs text-green-700 italic">ASHP heats 10→{systems.dhw_preheat_setpoint ?? 45}°C · Boiler tops up to {systems.dhw_setpoint ?? 60}°C</p>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Setpoint (°C)">
              <input type="number" min={45} max={70} step={1} value={systems.dhw_setpoint ?? 60}
                onChange={e => updateSystem('dhw_setpoint', Number(e.target.value))}
                className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
              />
            </Field>
            {hasDhwSec && (
              <Field label="Preheat to (°C)">
                <input type="number" min={30} max={55} step={1} value={systems.dhw_preheat_setpoint ?? 45}
                  onChange={e => updateSystem('dhw_preheat_setpoint', Number(e.target.value))}
                  className="w-full px-2 py-1 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
                />
              </Field>
            )}
          </div>
        </div>
      </AccordionSection>

      {/* ── Ventilation ── */}
      <AccordionSection id="ventilation" title="Ventilation" summary={venSummary}
        isOpen={openSection === 'ventilation'} onToggle={toggleSection}
      >
        <div className="mt-2 space-y-1">
          <Field label="System type">
            <CompactSelect value={venSys} onChange={v => setPrimary('ventilation', v)} options={ventOpts} />
          </Field>
          <Field label="Specific fan power">
            <SliderWithNumber value={systems.sfp_override ?? 1.8}
              onChange={v => updateSystem('sfp_override', v)}
              min={0} max={3.0} step={0.1} unit="W/(l/s)"
            />
          </Field>
          {isMVHR && (
            <Field label="Heat recovery efficiency">
              <SliderWithNumber value={systems.hre_override ?? 85}
                onChange={v => updateSystem('hre_override', v)}
                min={50} max={95} step={1} unit="%"
              />
            </Field>
          )}
          <Field label="Control strategy">
            <CompactSelect value={systems.ventilation_control ?? 'continuous'}
              onChange={v => updateSystem('ventilation_control', v)} options={ventControlOpts}
            />
          </Field>
          <div className="mt-1.5">
            <Toggle value={systems.natural_ventilation ?? false}
              onChange={v => updateSystem('natural_ventilation', v)}
              label="Natural ventilation (openable windows)"
            />
          </div>
          {systems.natural_ventilation && (
            <Field label={`Window opening threshold — ${systems.window_opening_threshold ?? 22}°C`}>
              <SliderWithNumber value={systems.window_opening_threshold ?? 22}
                onChange={v => updateSystem('window_opening_threshold', v)}
                min={18} max={28} step={0.5} unit="°C"
              />
            </Field>
          )}
        </div>
      </AccordionSection>

      {/* ── Lighting ── */}
      <AccordionSection id="lighting" title="Lighting" summary={lightSummary}
        isOpen={openSection === 'lighting'} onToggle={toggleSection}
      >
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xxs uppercase tracking-wider text-mid-grey">LPD — {lpd} W/m²</label>
            <div className="flex gap-1">
              {LPD_PRESETS.map(p => (
                <button key={p.label} onClick={() => updateSystem('lighting_power_density', p.value)}
                  className={`text-xxs px-1.5 py-0.5 rounded border transition-colors ${lpd === p.value ? 'bg-gold/20 text-navy border-gold/40' : 'bg-white text-mid-grey border-light-grey hover:border-gold'}`}
                >{p.label}</button>
              ))}
            </div>
          </div>
          <SliderWithNumber value={lpd} onChange={v => updateSystem('lighting_power_density', v)} min={0} max={20} step={0.5} unit="W/m²" />
          <Field label="Control strategy">
            <CompactSelect value={systems.lighting_control ?? 'occupancy_sensing'}
              onChange={v => updateSystem('lighting_control', v)} options={lightingControlOpts}
            />
          </Field>
        </div>
      </AccordionSection>

      {/* ── Small Power ── */}
      <AccordionSection id="smallpower" title="Small Power" summary={powerSummary}
        isOpen={openSection === 'smallpower'} onToggle={toggleSection}
      >
        <div className="mt-2">
          <Field label={`Equipment density — ${epd} W/m²`}>
            <SliderWithNumber value={epd} onChange={v => updateSystem('equipment_power_density', v)} min={0} max={30} step={0.5} unit="W/m²" />
          </Field>
          <p className="text-xxs text-mid-grey mt-1">CIBSE Guide A hotel default: 15 W/m²</p>
        </div>
      </AccordionSection>
    </div>
  )
}

// ── Main three-column layout ──────────────────────────────────────────────────

export default function SystemsZones() {
  const [library, setLibrary]           = useState([])
  const [libraryData, setLibraryData]   = useState({})
  const [openSection, setOpenSection]   = useState('space_heating')  // Space Heating open by default

  useEffect(() => {
    // Fetch systems library for type dropdowns
    fetch('/api/library/systems')
      .then(r => r.ok ? r.json() : { systems: [] })
      .then(d => setLibrary(d.systems ?? []))
      .catch(() => {})

    // Fetch constructions for instant calc
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => setLibraryData({ constructions: d.constructions ?? [] }))
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Left: inputs */}
      <div className="w-64 flex-shrink-0">
        <InputsColumn
          library={library}
          openSection={openSection}
          setOpenSection={setOpenSection}
        />
      </div>

      {/* Centre: systems Sankey flow diagram */}
      <div className="flex-1 bg-white overflow-hidden">
        <SystemSankey
          openSection={openSection}
          setOpenSection={setOpenSection}
          libraryData={libraryData}
        />
      </div>

      {/* Right: live results */}
      <div className="w-80 flex-shrink-0">
        <SystemsLiveResults libraryData={libraryData} />
      </div>
    </div>
  )
}
