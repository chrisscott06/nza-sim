-- NZA Simulate database schema
-- SQLite with WAL mode for concurrent access

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    building_config JSON NOT NULL,     -- geometry params, orientation, WWR
    systems_config JSON NOT NULL,      -- HVAC, ventilation, DHW, lighting
    construction_choices JSON NOT NULL, -- which library constructions are assigned
    schedule_assignments JSON,         -- which library schedules are assigned per zone type
    weather_file TEXT,                 -- filename of assigned weather file
    metadata JSON                      -- any extra project-level metadata
);

-- Library items (global, reusable across projects)
CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    library_type TEXT NOT NULL,        -- 'construction', 'system', 'schedule', 'weather', 'benchmark'
    name TEXT NOT NULL,
    display_name TEXT,
    description TEXT,
    config_json JSON NOT NULL,         -- the full item definition
    is_default INTEGER DEFAULT 0,      -- 1 for built-in items, 0 for user-created
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Simulation runs
CREATE TABLE IF NOT EXISTS simulation_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    scenario_name TEXT DEFAULT 'Baseline',
    status TEXT NOT NULL,              -- 'running', 'complete', 'error'
    input_snapshot JSON NOT NULL,      -- full snapshot of inputs at time of run
    results_summary JSON,              -- parsed summary results (EUI, peaks, etc.)
    results_monthly JSON,              -- monthly breakdown
    results_hourly_path TEXT,          -- file path to full hourly data (too large for DB)
    envelope_heat_flow JSON,           -- per-facade heat flow data
    hourly_profiles JSON,              -- typical day profiles (4 × 24 hours)
    sankey_data JSON,                  -- pre-computed Sankey nodes and links
    annual_energy JSON,                -- annual energy by end use
    energyplus_warnings INTEGER DEFAULT 0,
    energyplus_errors INTEGER DEFAULT 0,
    error_message TEXT,
    simulation_time_seconds REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_simruns_project_id ON simulation_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_type ON library_items (library_type);
