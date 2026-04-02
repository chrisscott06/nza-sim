import { createContext, useState } from 'react'

export const BuildingContext = createContext(null)

const DEFAULT_PARAMS = {
  name: 'Bridgewater Hotel',
  length: 60,
  width: 15,
  num_floors: 4,
  floor_height: 3.2,
  orientation: 0,
  wwr: { north: 0.25, south: 0.25, east: 0.25, west: 0.25 },
}

const DEFAULT_CONSTRUCTIONS = {
  external_wall: 'cavity_wall_standard',
  roof:          'flat_roof_standard',
  ground_floor:  'ground_floor_slab',
  glazing:       'double_low_e',
}

const DEFAULT_SYSTEMS = {
  mode:                  'ideal',       // 'ideal' | 'detailed'
  hvac_type:             'vrf_standard',
  ventilation_type:      'mev_standard',
  natural_ventilation:   false,
  natural_vent_threshold: 22,           // °C
  dhw_primary:           'gas_boiler_dhw',
  dhw_preheat:           'ashp_dhw',
  dhw_setpoint:          60,            // °C
  dhw_preheat_setpoint:  45,            // °C
  lighting_power_density: 8.0,          // W/m²
  lighting_control:      'occupancy_sensing',
  pump_type:             'variable_speed',
}

export function BuildingProvider({ children }) {
  const [params, setParams]           = useState(DEFAULT_PARAMS)
  const [constructions, setConstructions] = useState(DEFAULT_CONSTRUCTIONS)
  const [systems, setSystems]         = useState(DEFAULT_SYSTEMS)

  function updateParam(key, value) {
    if (key === 'wwr') {
      setParams(p => ({ ...p, wwr: { ...p.wwr, ...value } }))
    } else {
      setParams(p => ({ ...p, [key]: value }))
    }
  }

  function updateConstruction(key, value) {
    setConstructions(c => ({ ...c, [key]: value }))
  }

  function updateSystem(key, value) {
    setSystems(s => ({ ...s, [key]: value }))
  }

  return (
    <BuildingContext.Provider value={{
      params, constructions, systems,
      updateParam, updateConstruction, updateSystem,
    }}>
      {children}
    </BuildingContext.Provider>
  )
}
