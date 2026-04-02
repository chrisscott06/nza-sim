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
  roof: 'flat_roof_standard',
  ground_floor: 'ground_floor_slab',
  glazing: 'double_low_e',
}

export function BuildingProvider({ children }) {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [constructions, setConstructions] = useState(DEFAULT_CONSTRUCTIONS)

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

  return (
    <BuildingContext.Provider value={{ params, constructions, updateParam, updateConstruction }}>
      {children}
    </BuildingContext.Provider>
  )
}
