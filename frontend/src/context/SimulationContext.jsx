import { createContext, useState, useContext } from 'react'
import { BuildingContext } from './BuildingContext.jsx'

export const SimulationContext = createContext(null)

export function SimulationProvider({ children }) {
  const [status, setStatus] = useState('idle')   // idle | running | complete | error
  const [runId, setRunId] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  // BuildingContext may not be mounted yet at this level — we'll read it lazily in runSimulation
  const buildingCtx = useContext(BuildingContext)

  async function runSimulation() {
    setStatus('running')
    setError(null)

    // Read building params from BuildingContext if available, else use defaults
    const params = buildingCtx?.params ?? {
      name: 'Bridgewater Hotel',
      length: 60, width: 15, num_floors: 4, floor_height: 3.2,
      orientation: 0,
      wwr: { north: 0.25, south: 0.25, east: 0.25, west: 0.25 },
    }
    const constructions = buildingCtx?.constructions ?? {
      external_wall: 'cavity_wall_standard',
      roof: 'flat_roof_standard',
      ground_floor: 'ground_floor_slab',
      glazing: 'double_low_e',
    }

    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building: { ...params },
          constructions,
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
