/**
 * ProjectContext.jsx
 *
 * Central state for the current project. Handles:
 *  - Loading the most-recent project on startup (or creating a default)
 *  - Exposing building params, construction choices, and systems config
 *  - Auto-saving changes to the API with 1 second debounce
 *  - Providing a save-status string for the TopBar indicator
 *  - Project list for the project picker
 *  - createProject / loadProject / deleteProject actions
 *
 * Interface intentionally mirrors the old BuildingContext so existing
 * components can keep using the same keys (params, updateParam, etc.)
 * — only the import path changes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

export const ProjectContext = createContext(null)

// ── Defaults (mirror api/db/database.py) ─────────────────────────────────────

const DEFAULT_PARAMS = {
  name:            'New Project',
  length:          60.0,
  width:           15.0,
  num_floors:      4,
  floor_height:    3.2,
  orientation:     0.0,
  wwr:             { north: 0.25, south: 0.25, east: 0.25, west: 0.25 },
  infiltration_ach: 0.5,
  window_count:    { north: 8, south: 8, east: 3, west: 3 },
  // Occupancy (hotel-specific)
  num_bedrooms:    138,
  occupancy_rate:  0.75,
  people_per_room: 1.5,
  location: {
    latitude:  51.127,
    longitude: -2.992,
    name:      'Bridgewater, Somerset',
  },
}

const DEFAULT_CONSTRUCTIONS = {
  external_wall: 'cavity_wall_standard',
  roof:          'flat_roof_standard',
  ground_floor:  'ground_floor_slab',
  glazing:       'double_low_e',
}

const DEFAULT_SYSTEMS = {
  mode:                   'detailed',  // Brief 07: default to detailed HVAC
  hvac_type:              'vrf_standard',
  ventilation_type:       'mev_standard',
  natural_ventilation:    false,
  natural_vent_threshold: 22.0,
  dhw_primary:            'gas_boiler_dhw',
  dhw_preheat:            'ashp_dhw',
  dhw_setpoint:           60.0,
  dhw_preheat_setpoint:   45.0,
  lighting_power_density: 8.0,
  lighting_control:       'occupancy_sensing',
  pump_type:              'variable_speed',
}

// ── Save status: 'idle' | 'saving' | 'saved' | 'error' ──────────────────────

// ── Provider ──────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }) {
  // ── Project list & current project
  const [projects, setProjects]               = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [isLoading, setIsLoading]             = useState(true)

  // ── Current project parameters
  const [params, setParams]           = useState(DEFAULT_PARAMS)
  const [constructions, setConstructions] = useState(DEFAULT_CONSTRUCTIONS)
  const [systems, setSystems]         = useState(DEFAULT_SYSTEMS)

  // ── Save status indicator
  const [saveStatus, setSaveStatus]   = useState('idle') // 'idle'|'saving'|'saved'|'error'
  const saveTimerRef = useRef(null)   // debounce timeout
  const savedTimerRef = useRef(null)  // auto-dismiss 'saved' message

  // ── API helpers ───────────────────────────────────────────────────────────

  async function _apiFetch(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
      throw new Error(err.detail ?? `HTTP ${res.status}`)
    }
    if (res.status === 204) return null
    return res.json()
  }

  // ── Load a project by ID into local state ────────────────────────────────

  function _applyProject(project) {
    setCurrentProjectId(project.id)
    const bc = project.building_config ?? {}
    setParams({
      name:         bc.name         ?? DEFAULT_PARAMS.name,
      length:       bc.length       ?? DEFAULT_PARAMS.length,
      width:        bc.width        ?? DEFAULT_PARAMS.width,
      num_floors:   bc.num_floors   ?? DEFAULT_PARAMS.num_floors,
      floor_height: bc.floor_height ?? DEFAULT_PARAMS.floor_height,
      orientation:  bc.orientation  ?? DEFAULT_PARAMS.orientation,
      wwr:             bc.wwr             ?? DEFAULT_PARAMS.wwr,
      infiltration_ach: bc.infiltration_ach ?? DEFAULT_PARAMS.infiltration_ach,
      window_count: bc.window_count ?? DEFAULT_PARAMS.window_count,
      num_bedrooms:    bc.num_bedrooms    ?? DEFAULT_PARAMS.num_bedrooms,
      occupancy_rate:  bc.occupancy_rate  ?? DEFAULT_PARAMS.occupancy_rate,
      people_per_room: bc.people_per_room ?? DEFAULT_PARAMS.people_per_room,
      location:     bc.location     ?? DEFAULT_PARAMS.location,
    })
    setConstructions(project.construction_choices ?? DEFAULT_CONSTRUCTIONS)
    setSystems(project.systems_config ?? DEFAULT_SYSTEMS)
  }

  // ── Startup: fetch project list, load most recent (or create default) ────

  useEffect(() => {
    async function bootstrap() {
      try {
        const list = await _apiFetch('/api/projects')
        setProjects(list)

        if (list.length > 0) {
          const full = await _apiFetch(`/api/projects/${list[0].id}`)
          _applyProject(full)
        } else {
          // No projects yet — create the default
          const created = await _apiFetch('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ name: 'New Project' }),
          })
          setProjects([created])
          _applyProject(created)
        }
      } catch (err) {
        console.error('[ProjectContext] Bootstrap failed:', err)
      } finally {
        setIsLoading(false)
      }
    }
    bootstrap()
  }, [])

  // ── Debounced save helpers ────────────────────────────────────────────────

  // endpoint: sub-path like 'building' → PUT /api/projects/{id}/building
  // endpoint: null → PUT /api/projects/{id} (for general updates like construction_choices)
  function _scheduleSave(endpoint, body) {
    if (!currentProjectId) return

    // Clear any pending save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    setSaveStatus('saving')

    saveTimerRef.current = setTimeout(async () => {
      try {
        const url = endpoint
          ? `/api/projects/${currentProjectId}/${endpoint}`
          : `/api/projects/${currentProjectId}`
        await _apiFetch(url, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        setSaveStatus('saved')
        // Auto-dismiss after 2 s
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
        // Refresh project list (updated_at timestamp)
        const list = await _apiFetch('/api/projects')
        setProjects(list)
      } catch (err) {
        console.error('[ProjectContext] Save failed:', err)
        setSaveStatus('error')
      }
    }, 1000)
  }

  // ── updateParam — mirrors old BuildingContext.updateParam ────────────────

  const updateParam = useCallback((key, value) => {
    setParams(p => {
      let next
      if (key === 'wwr') {
        next = { ...p, wwr: { ...p.wwr, ...value } }
      } else if (key === 'location') {
        next = { ...p, location: { ...p.location, ...value } }
      } else {
        next = { ...p, [key]: value }
      }
      _scheduleSave('building', next)
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── updateConstruction ───────────────────────────────────────────────────

  const updateConstruction = useCallback((key, value) => {
    setConstructions(c => {
      const next = { ...c, [key]: value }
      _scheduleSave(null, { construction_choices: next })
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── updateSystem ─────────────────────────────────────────────────────────

  const updateSystem = useCallback((key, value) => {
    setSystems(s => {
      const next = { ...s, [key]: value }
      _scheduleSave('systems', next)
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Project management actions ────────────────────────────────────────────

  async function createProject(name = 'New Project') {
    const created = await _apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    const list = await _apiFetch('/api/projects')
    setProjects(list)
    _applyProject(created)
    return created
  }

  async function loadProject(id) {
    setIsLoading(true)
    try {
      const full = await _apiFetch(`/api/projects/${id}`)
      _applyProject(full)
    } finally {
      setIsLoading(false)
    }
  }

  async function deleteProject(id) {
    await _apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
    const list = await _apiFetch('/api/projects')
    setProjects(list)

    // If we deleted the current project, load the first remaining or create new
    if (id === currentProjectId) {
      if (list.length > 0) {
        const full = await _apiFetch(`/api/projects/${list[0].id}`)
        _applyProject(full)
      } else {
        const created = await _apiFetch('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name: 'New Project' }),
        })
        setProjects([created])
        _applyProject(created)
      }
    }
  }

  async function updateProjectName(name) {
    if (!currentProjectId) return
    await _apiFetch(`/api/projects/${currentProjectId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
    // Update local params and project list
    setParams(p => ({ ...p, name }))
    const list = await _apiFetch('/api/projects')
    setProjects(list)
  }

  // ── Context value ─────────────────────────────────────────────────────────

  return (
    <ProjectContext.Provider value={{
      // Project management
      currentProjectId,
      projects,
      isLoading,
      saveStatus,

      // Building state (mirrors old BuildingContext interface)
      params,
      constructions,
      systems,

      // Update actions
      updateParam,
      updateConstruction,
      updateSystem,
      updateProjectName,

      // Project CRUD
      createProject,
      loadProject,
      deleteProject,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  return useContext(ProjectContext)
}
