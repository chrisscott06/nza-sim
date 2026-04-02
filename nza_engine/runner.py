"""
nza_engine/runner.py

Runs an EnergyPlus simulation via subprocess and returns a structured result.

Usage
-----
    from nza_engine.runner import run_simulation

    result = run_simulation(
        epjson_path="data/simulations/test_bridgewater/input.epJSON",
        weather_file_path="/Applications/EnergyPlus-25-2-0/WeatherData/USA_CO_Golden-NREL.724666_TMY3.epw",
        output_dir="data/simulations/test_bridgewater/",
    )
    print(result.success, result.sql_path)
"""

import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from nza_engine.config import ENERGYPLUS_BIN


@dataclass
class SimulationResult:
    success: bool
    return_code: int
    runtime_seconds: float
    output_dir: Path
    epjson_path: Path
    weather_file_path: Path
    fatal_errors: int = 0
    severe_errors: int = 0
    warnings: int = 0
    sql_path: Path | None = None
    html_path: Path | None = None
    err_path: Path | None = None
    err_summary: str = ""
    stdout: str = ""
    stderr: str = ""


def run_simulation(
    epjson_path: str | Path,
    weather_file_path: str | Path,
    output_dir: str | Path,
) -> SimulationResult:
    """
    Run an EnergyPlus simulation and return a structured result.

    Parameters
    ----------
    epjson_path       : Path to the input .epJSON file
    weather_file_path : Path to the .epw weather file
    output_dir        : Directory for EnergyPlus output files (created if needed)

    Returns
    -------
    SimulationResult dataclass
    """
    epjson_path = Path(epjson_path).resolve()
    weather_file_path = Path(weather_file_path).resolve()
    output_dir = Path(output_dir).resolve()

    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(ENERGYPLUS_BIN),
        "-w", str(weather_file_path),
        "-d", str(output_dir),
        str(epjson_path),
    ]

    start = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    runtime = time.monotonic() - start

    result = SimulationResult(
        success=proc.returncode == 0,
        return_code=proc.returncode,
        runtime_seconds=round(runtime, 2),
        output_dir=output_dir,
        epjson_path=epjson_path,
        weather_file_path=weather_file_path,
        stdout=proc.stdout,
        stderr=proc.stderr,
    )

    # ── Locate output files ───────────────────────────────────────────────────
    # EnergyPlus names outputs based on the input file stem
    stem = epjson_path.stem    # e.g. "input"

    sql_candidate = output_dir / f"{stem}out.sql"
    if not sql_candidate.exists():
        # EnergyPlus sometimes uses eplusout.sql
        sql_candidate = output_dir / "eplusout.sql"
    result.sql_path = sql_candidate if sql_candidate.exists() else None

    html_candidate = output_dir / f"{stem}tbl.htm"
    if not html_candidate.exists():
        html_candidate = output_dir / "eplustbl.htm"
    result.html_path = html_candidate if html_candidate.exists() else None

    err_candidate = output_dir / f"{stem}out.err"
    if not err_candidate.exists():
        err_candidate = output_dir / "eplusout.err"
    result.err_path = err_candidate if err_candidate.exists() else None

    # ── Parse error file ──────────────────────────────────────────────────────
    if result.err_path and result.err_path.exists():
        err_text = result.err_path.read_text(errors="replace")
        result.fatal_errors  = err_text.lower().count("** fatal")
        result.severe_errors = err_text.lower().count("** severe")
        result.warnings      = err_text.lower().count("** warning")
        result.err_summary   = err_text[-4000:] if len(err_text) > 4000 else err_text

        # A simulation with fatal errors is a failure even if return code was 0
        if result.fatal_errors > 0:
            result.success = False

    return result
