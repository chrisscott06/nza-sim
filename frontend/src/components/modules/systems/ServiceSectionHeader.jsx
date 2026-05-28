/**
 * ServiceSectionHeader.jsx — Brief 42 Part 3 (2026-05-20)
 *
 * Per-service building-level fields editor. Rendered at the top of
 * each service section's body in the Systems module's left panel.
 *
 * Service-level fields (per audit doc 42 §3):
 *   - Heating: setpoint mode + custom value
 *   - Cooling: setpoint mode + custom value
 *   - DHW:     storage / tap outlet / cold supply temps,
 *              demand basis + quantity
 *   - Ventilation / lighting / small power: NO service-level fields
 *     (this component renders nothing for those services)
 *
 * Writes go through `onUpdateServiceLevel(patch)` — the parent merges
 * the patch into `params.systems_config_v40` and persists via
 * `updateParam`.
 */

import { SERVICE_COLOURS } from './SystemEditorCard.jsx'

function Group({ children }) {
  return (
    <div className="space-y-1.5 px-2 py-2 mb-1.5 border border-light-grey/60 rounded bg-off-white/30">
      {children}
    </div>
  )
}

function LabeledNumber({ label, value, onChange, min, max, step = 1, unit }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-xxs text-mid-grey">{label}</label>
      <input
        type="number"
        min={min} max={max} step={step}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-16 px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-navy tabular-nums text-right"
      />
      {unit && <span className="flex-shrink-0 text-xxs text-mid-grey w-12">{unit}</span>}
    </div>
  )
}

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-xxs text-mid-grey">{label}</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="flex-shrink-0 w-40 px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-navy cursor-pointer"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Heating / Cooling setpoint editor ────────────────────────────────

function SetpointEditor({ service, serviceLevel, comfortBand, onUpdateServiceLevel }) {
  const accent = SERVICE_COLOURS[service]
  const comfortVal = service === 'heating'
    ? (comfortBand?.lower_c ?? 21)
    : (comfortBand?.upper_c ?? 24)
  const mode = serviceLevel?.[`${service}_setpoint_mode`] ?? 'follow_comfort'
  const customVal = serviceLevel?.[`${service}_setpoint_c`]
  const isCustom = mode === 'custom'

  // 2026-05-28 (Chris-flag, post-Brief-69 walkthrough): cross-clamp the two
  // setpoints so cooling can never go below heating (and vice versa). Pre-fix,
  // sliding cooling below heating created an inverted dead band — the Brief
  // 69 active_setpoint model handles this by giving heating priority via
  // if/else if, but the result is both clamps fighting in alternate hours
  // and producing huge spurious demand. The guard keeps the model in a
  // physically sensible regime. MIN_BAND_WIDTH = 0.5°C is the same step
  // size the sliders use — so the guard never blocks a single click.
  const MIN_BAND_WIDTH = 0.5
  const otherService = service === 'heating' ? 'cooling' : 'heating'
  const otherMode = serviceLevel?.[`${otherService}_setpoint_mode`] ?? 'follow_comfort'
  const otherCustomVal = serviceLevel?.[`${otherService}_setpoint_c`]
  const otherComfortVal = otherService === 'heating'
    ? (comfortBand?.lower_c ?? 21)
    : (comfortBand?.upper_c ?? 24)
  const otherResolved = (otherMode === 'custom' && typeof otherCustomVal === 'number')
    ? otherCustomVal
    : otherComfortVal

  const setMode = (nextMode) => {
    if (nextMode === 'follow_comfort') {
      onUpdateServiceLevel({
        [`${service}_setpoint_mode`]: 'follow_comfort',
        [`${service}_setpoint_c`]: null,
      })
    } else {
      onUpdateServiceLevel({
        [`${service}_setpoint_mode`]: 'custom',
        // Seed custom value from comfort if currently null
        [`${service}_setpoint_c`]: typeof customVal === 'number' ? customVal : comfortVal,
      })
    }
  }

  const setCustomVal = (v) => {
    onUpdateServiceLevel({
      [`${service}_setpoint_mode`]: 'custom',
      [`${service}_setpoint_c`]: v,
    })
  }

  // Compute the effective slider range with the cross-clamp applied. Heating
  // can't rise above (cooling - 0.5); cooling can't fall below (heating + 0.5).
  const baseMin = service === 'heating' ? 10 : 18
  const baseMax = service === 'heating' ? 28 : 32
  const sliderMin = service === 'heating' ? baseMin : Math.max(baseMin, otherResolved + MIN_BAND_WIDTH)
  const sliderMax = service === 'heating' ? Math.min(baseMax, otherResolved - MIN_BAND_WIDTH) : baseMax
  const sliderVal = isCustom && typeof customVal === 'number' ? customVal : comfortVal

  return (
    <Group>
      <label className="block text-xxs uppercase tracking-wider text-mid-grey font-medium">
        {service === 'heating' ? 'Heating' : 'Cooling'} setpoint
      </label>
      <div className="flex items-center gap-2 text-xxs">
        <input
          type="radio"
          checked={!isCustom}
          onChange={() => setMode('follow_comfort')}
          style={{ accentColor: accent }}
        />
        <span className={!isCustom ? 'text-navy' : 'text-mid-grey'}>
          Follow comfort ({comfortVal}°C)
        </span>
      </div>
      <div className="flex items-center gap-2 text-xxs">
        <input
          type="radio"
          checked={isCustom}
          onChange={() => setMode('custom')}
          style={{ accentColor: accent }}
        />
        <span className={isCustom ? 'text-navy' : 'text-mid-grey'}>Custom</span>
        {isCustom && (
          <>
            <input
              type="range"
              min={sliderMin} max={sliderMax} step={0.5}
              value={Number(sliderVal)}
              onChange={e => setCustomVal(Number(e.target.value))}
              className="flex-1 h-[3px]"
              style={{ accentColor: accent }}
            />
            <span className="tabular-nums text-navy w-10 text-right">
              {Number(sliderVal).toFixed(1)}°C
            </span>
          </>
        )}
      </div>
    </Group>
  )
}

// ── DHW service-level editor (storage / tap / cold / demand) ────────

function DHWServiceFields({ serviceLevel, onUpdateServiceLevel }) {
  const basis = serviceLevel?.dhw_demand_basis ?? 'per_person'
  const storage = serviceLevel?.dhw_storage_setpoint_c ?? 60
  const tap     = serviceLevel?.dhw_tap_outlet_temp_c ?? 40
  const cold    = serviceLevel?.dhw_cold_supply_temp_c ?? 10

  // Tap-mix correction surfaced inline (per audit doc 42 §4.1 — read-only doc)
  const setpointMinusCold = Math.max(storage - cold, 1)
  const hotFraction = Math.max(0, Math.min(1, (tap - cold) / setpointMinusCold))

  return (
    <>
      <Group>
        <label className="block text-xxs uppercase tracking-wider text-mid-grey font-medium">
          DHW temperatures
        </label>
        <LabeledNumber
          label="Storage setpoint"
          value={storage}
          onChange={v => onUpdateServiceLevel({ dhw_storage_setpoint_c: v })}
          min={45} max={80} step={1} unit="°C"
        />
        <LabeledNumber
          label="Tap outlet"
          value={tap}
          onChange={v => onUpdateServiceLevel({ dhw_tap_outlet_temp_c: v })}
          min={20} max={70} step={1} unit="°C"
        />
        <LabeledNumber
          label="Cold supply"
          value={cold}
          onChange={v => onUpdateServiceLevel({ dhw_cold_supply_temp_c: v })}
          min={2} max={20} step={1} unit="°C"
        />
        <p className="text-xxs text-mid-grey/70 leading-tight pt-1 border-t border-light-grey/40">
          Tap-mix hot fraction = (tap − cold) / (storage − cold) ={' '}
          <span className="tabular-nums text-navy font-medium">{(hotFraction * 100).toFixed(0)}%</span>
          {' '}of tap litres need full storage-temperature heating.
        </p>
      </Group>
      <Group>
        <label className="block text-xxs uppercase tracking-wider text-mid-grey font-medium">
          DHW demand
        </label>
        <LabeledSelect
          label="Basis"
          value={basis}
          onChange={v => onUpdateServiceLevel({ dhw_demand_basis: v })}
          options={[
            { value: 'per_person', label: 'Per person (occupancy)' },
            { value: 'per_m2',     label: 'Per m² (CIBSE TM54)' },
          ]}
        />
        {basis === 'per_person' && (
          <LabeledNumber
            label="Demand"
            value={serviceLevel?.dhw_demand_litres_per_person_per_day}
            onChange={v => onUpdateServiceLevel({ dhw_demand_litres_per_person_per_day: v })}
            min={5} max={500} step={5} unit="L/p/day"
          />
        )}
        {basis === 'per_m2' && (
          <LabeledNumber
            label="Demand"
            value={serviceLevel?.dhw_demand_litres_per_m2_per_day}
            onChange={v => onUpdateServiceLevel({ dhw_demand_litres_per_m2_per_day: v })}
            min={0.1} max={10.0} step={0.1} unit="L/m²/day"
          />
        )}
      </Group>
    </>
  )
}

// ── Public component ────────────────────────────────────────────────

export default function ServiceSectionHeader({ service, serviceLevel, comfortBand, onUpdateServiceLevel }) {
  if (service === 'heating' || service === 'cooling') {
    return (
      <SetpointEditor
        service={service}
        serviceLevel={serviceLevel}
        comfortBand={comfortBand}
        onUpdateServiceLevel={onUpdateServiceLevel}
      />
    )
  }
  if (service === 'dhw') {
    return (
      <DHWServiceFields
        serviceLevel={serviceLevel}
        onUpdateServiceLevel={onUpdateServiceLevel}
      />
    )
  }
  // Ventilation / lighting / small_power have no service-level fields
  return null
}
