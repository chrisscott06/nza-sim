import { createContext, useState, useContext } from 'react'
import { ProjectContext } from './ProjectContext.jsx'

export const SimulationContext = createContext(null)

export function SimulationProvider({ children }) {
  const [status, setStatus] = useState('idle')   // idle | running | complete | error
  const [runId, setRunId] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const projectCtx = useContext(ProjectContext)

  async function runSimulation() {
    setStatus('running')
    setError(null)

    // Read from ProjectContext — falls back to defaults if context not ready
    const params = projectCtx?.params ?? {
      name: 'New Project',
      length: 60, width: 15, num_floors: 4, floor_height: 3.2,
      orientation: 0,
      wwr: { north: 0.25, south: 0.25, east: 0.25, west: 0.25 },
    }
    const constructions = projectCtx?.constructions ?? {
      external_wall: 'cavity_wall_standard',
      roof: 'flat_roof_standard',
      ground_floor: 'ground_floor_slab',
      glazing: 'double_low_e',
    }
    const systems = projectCtx?.systems ?? {
      mode: 'ideal',
      hvac_type: 'vrf_standard',
      ventilation_type: 'mev_standard',
      natural_ventilation: false,
      natural_vent_threshold: 22,
      dhw_primary: 'gas_boiler_dhw',
      dhw_preheat: 'ashp_dhw',
      dhw_setpoint: 60,
      dhw_preheat_setpoint: 45,
      lighting_power_density: 8.0,
      lighting_control: 'occupancy_sensing',
      pump_type: 'variable_speed',
    }

    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building: { ...params },
          constructions,
          systems,
          weather_file: 'USE_DEFAULT',
        }),
      })

      if (!response.ok) {
        const detail = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(detail.detail ?? `HTTP ${response.status}`)
      }

      const data = await response.json()
      setResults(data)
      setRunId(data.run_id)
      setStatus('complete')
      console.log('[SimulationContext] Results:', data)
    } catch (err) {
      console.error('[SimulationContext] Error:', err)
      setError(err.message ?? 'Simulation failed')
      setStatus('error')
    }
  }

  return (
    <SimulationContext.Provider value={{ status, runId, results, error, runSimulation }}>
      {children}
    </SimulationContext.Provider>
  )
}
