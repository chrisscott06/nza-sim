# Dev-setup: isolated verification environment

**Why this exists:** Chris's browser session and Claude Code's verification probes were both writing to the same `data/nza_sim.db`, causing project-state drift (the Brief 53 128.20 → 131.90 anchor regression). This setup separates the two so the user's interactive work and the verification harness can never share state.

---

## Two backends, two DBs, two ports

| Instance | DB file | Port | Used by |
|---|---|---|---|
| **Live** (user) | `data/nza_sim.db` | **8002** | Chris's browser session, the dev frontend, EnergyPlus runs |
| **Verification** (Claude Code) | `data/nza_sim_cc.db` | **8003** | Brief verification probes (`scripts/_brief*.mjs`), anchor checks, mutation diagnoses |

Both DBs live under `data/` (gitignored). Both share `data/weather/`, `data/simulations/`, and the system templates library — those are read-only references, not project state.

## Running the two backends

```bash
# Live (the existing pattern, unchanged):
cd <project root>
python -m uvicorn api.main:app --host 127.0.0.1 --port 8002

# Verification (Claude Code's harness target):
cd <project root>
NZA_DB_FILE=nza_sim_cc.db python -m uvicorn api.main:app --host 127.0.0.1 --port 8003
```

Windows PowerShell:
```powershell
$env:NZA_DB_FILE = "nza_sim_cc.db"
python -m uvicorn api.main:app --host 127.0.0.1 --port 8003
```

The `NZA_DB_FILE` env var is read by `api/db/database.py` (Brief 53 sidecar patch). Default when unset: `nza_sim.db`. Filename only — the directory is always `DATA_DIR`.

## Verification probe convention

All `scripts/_brief*.mjs` probes default to `NZA_API = 'http://127.0.0.1:8003'` (verification backend). Override per-run with the `NZA_API` env var if needed:

```bash
# Default (verification DB):
node scripts/_brief53_bypass_falsifiability.mjs

# Force-target live DB (rare — only for cross-check, NEVER for write probes):
NZA_API=http://127.0.0.1:8002 node scripts/_brief53_bypass_falsifiability.mjs
```

Write probes (e.g. `_brief53_anchor_persist.mjs`) have a hard-coded safety guard that aborts if `NZA_API` points at port 8002.

## Initial-state seeding

The verification DB starts as a byte-for-byte copy of the live DB:

```bash
cp data/nza_sim.db data/nza_sim_cc.db
```

Run this once. If the live DB was drifted at copy time, the verification DB will be too — re-anchor before trusting it.

**For Brief 53 / Bridgewater specifically, the documented 128.20 anchor requires THREE field reverts** (see `docs/audit/53_anchor_drift_diagnosis.md` §2 for full diff):

| Field | Anchor value | Drifted to |
|---|---|---|
| `v40.heating[0/1].share_pct` | 95 / 5 | 90 / 10 |
| `v40.ventilation[].flow_rate` | matches `v25.flow_l_s` (1425 / 2208 / 210) | 1431 / 2292 / 479 |
| `v40.lighting[0].control_factor` | 0.86 (daylight dimming) | 1.0 |

These are written to the verification DB by `scripts/_brief53_anchor_persist.mjs`, which targets port 8003 by default and has a safety guard refusing to write to port 8002. Verify with the falsifiability harness: T1 must report EUI = 128.20 exactly before any Brief 53 verification work is trustworthy.

**Process discipline:** before running anchor work, kill stray vite/node processes. Multiple parallel vite dev servers + stale browser tabs are the contamination vector that produced the Brief 53 drift. Use `netstat -ano | grep LISTENING | grep ':5\|:8003'` (Mac: `lsof -i -P -n | grep LISTEN`) to enumerate; PowerShell `Stop-Process -Id <pid> -Force` to kill.

## Why not just run two browsers?

The frontend's autosave debounce (1 s) + cross-window broadcast (`ProjectContext.publishState`) means that ANY mounted browser tab against the project can write to the DB without explicit user input — exactly the failure mode that caused the Brief 53 anchor regression. Two DBs is the only reliable isolation.

## Cross-platform

The env-var mechanism is identical on macOS and Windows. Mac:
```bash
NZA_DB_FILE=nza_sim_cc.db python -m uvicorn api.main:app --host 127.0.0.1 --port 8003
```

Windows PowerShell (use `$env:` not `export`):
```powershell
$env:NZA_DB_FILE = "nza_sim_cc.db"
python -m uvicorn api.main:app --host 127.0.0.1 --port 8003
```

Windows cmd:
```cmd
set NZA_DB_FILE=nza_sim_cc.db
python -m uvicorn api.main:app --host 127.0.0.1 --port 8003
```

The `data/` folder path resolution is OS-agnostic (driven by `nza_engine.config.PROJECT_ROOT`).

## Refreshing the verification DB

If the live DB diverges substantially from the verification DB (e.g. Chris does intentional work on the live side), refresh:

```bash
# Stop the verification backend (Ctrl+C on the uvicorn process)
cp data/nza_sim.db data/nza_sim_cc.db
# Restart the verification backend
NZA_DB_FILE=nza_sim_cc.db python -m uvicorn api.main:app --host 127.0.0.1 --port 8003
```

This wipes whatever the verification DB held — only do it when Claude Code's probe state can be safely discarded.

---

*Setup landed by Brief 53 sidecar, 2026-05-26. Backend env-var patch at `api/db/database.py` L31-44.*
