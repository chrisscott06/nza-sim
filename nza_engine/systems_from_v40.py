"""
nza_engine/systems_from_v40.py

Brief 98-pre-b (2026-07-09): single source of system truth for /api/simulate.

A project carries three system representations (see docs/audit/98preb_config_drift.md):
  - systems_config_v40  — rich, per-service arrays; the ONLY one the UI edits and
                          NZA-Sim's instant engine reads. THE SOURCE OF TRUTH.
  - systems_config      — simple flat/nested shape the EnergyPlus assembler consumes;
                          a legacy DB column the current UI never writes → drifts.
  - systems_config_v25  — per-service `enabled` gates the assembler reads; also legacy.

`/api/simulate` used to read the stale simple copy + v25 gates, so an edited project
would silently simulate its pre-edit systems. This module derives BOTH the simple
systems_config AND the v25 gates from v40 at simulate time (ephemeral — never
persisted; truth flows one way only, v40 → sim). The assembler is untouched.

v40 → simple mapping (assembler dispatch is coarse — gas-vs-VRF, none-vs-VRF,
mvhr-vs-mev — so the translation is small):
  heating  combustion source → gas_boiler_heating (fuel coil); else → vrf_standard
  cooling  any enabled cooling system → vrf_standard;          else → none_cooling
  vent     efficiency_metric.recovery_sensible_pct > 0 → mvhr_standard; else mev_standard
  dhw      always gas_boiler_dhw primary (the generator has no electric-primary path —
           documented limitation, out of scope for this brief) + ashp_dhw preheat if a
           heat-pump DHW entry exists. Efficiency passed through from v40.

The DHW generator supporting only a gas primary is a pre-existing generator limitation
(hvac_dhw.py: primary is always WaterHeater:Mixed NaturalGas). Correcting THAT is
"changing what the systems are" — explicitly out of Brief 98-pre-b scope.
"""
from __future__ import annotations

# Sources that route heating to a combustion (fuel-coil) generator rather than a
# heat pump / electric VRF. Everything else (ambient_air, ground, water,
# exhaust_air, electricity) is a heat pump or electric system → VRF.
_COMBUSTION_SOURCES = {
    "gas", "natural_gas", "naturalgas", "mains_gas", "lpg", "oil",
    "kerosene", "biomass", "biofuel", "wood", "hydrogen", "coal",
}
_HEATPUMP_DHW_SOURCES = {"ambient_air", "exhaust_air", "ground", "water"}


def _primary(systems):
    """The representative single system for a v40 service array: the highest-share
    enabled entry (falls back to first enabled). The simple assembler models one
    primary per service; proportional split stays NZA-Sim-only (documented in the
    audit). Returns None when the service has no enabled systems."""
    enabled = [s for s in (systems or []) if isinstance(s, dict) and s.get("enabled", True)]
    if not enabled:
        return None
    return max(enabled, key=lambda s: (s.get("share_pct") or 0))


def _num_metric(metric, default):
    """v40 efficiency_metric is a number for most services (SCOP/EER/η) but a dict
    for ventilation. Return the number, or `default` when it isn't a plain number."""
    if isinstance(metric, bool):
        return default
    if isinstance(metric, (int, float)):
        return float(metric)
    return default


def _has_v40_systems(v40) -> bool:
    return any((v40.get(s)) for s in ("heating", "cooling", "dhw", "ventilation"))


def derive_systems_for_sim(building_config, fallback_simple=None):
    """
    Derive the simple systems_config + v25 enabled gates that /api/simulate should
    feed the EnergyPlus assembler, from `building_config['systems_config_v40']`.

    Returns
    -------
    (simple_systems_config: dict, v25_enabled: dict | None)
        simple_systems_config — mode="detailed" + nested `systems.{service}.primary`
                                (+ .secondary for ASHP DHW preheat), ready for
                                assemble_epjson(systems_config=...).
        v25_enabled           — {"heating": {"enabled": ...}, "cooling": {...},
                                "dhw": {...}} for building_params["systems_config_v25"].

    If v40 is absent/empty (a legacy project predating v40), returns
    `(fallback_simple, existing systems_config_v25)` unchanged — no behaviour change
    for projects that never had a v40.
    """
    bc = building_config or {}
    v40 = bc.get("systems_config_v40") or {}

    if not _has_v40_systems(v40):
        return fallback_simple, bc.get("systems_config_v25")

    heat = _primary(v40.get("heating"))
    cool = _primary(v40.get("cooling"))
    dhw = _primary(v40.get("dhw"))
    vent = _primary(v40.get("ventilation"))

    systems: dict = {}

    # ── Heating ──────────────────────────────────────────────────────────────
    if heat is not None:
        src = (heat.get("source") or "").lower()
        is_gas = src in _COMBUSTION_SOURCES
        systems["space_heating"] = {"primary": {
            "system": "gas_boiler_heating" if is_gas else "vrf_standard",
            "efficiency_override": _num_metric(
                heat.get("efficiency_metric"), 0.92 if is_gas else 3.5),
        }}

    # ── Cooling ──────────────────────────────────────────────────────────────
    if cool is not None:
        systems["space_cooling"] = {"primary": {
            "system": "vrf_standard",
            "efficiency_override": _num_metric(cool.get("efficiency_metric"), 3.2),
        }}
    else:
        systems["space_cooling"] = {"primary": {"system": "none_cooling"}}

    # ── Ventilation ──────────────────────────────────────────────────────────
    if vent is not None:
        metric = vent.get("efficiency_metric")
        rec = metric.get("recovery_sensible_pct") if isinstance(metric, dict) else None
        if rec is not None and float(rec) > 0:
            systems["ventilation"] = {"primary": {
                "system": "mvhr_standard",
                "efficiency_override": float(rec),  # 0-100; assembler divides by 100
            }}
        else:
            systems["ventilation"] = {"primary": {"system": "mev_standard"}}

    # ── DHW ──────────────────────────────────────────────────────────────────
    if dhw is not None:
        # Primary is always gas_boiler_dhw — the generator has no electric-primary
        # path (documented limitation, out of scope). Efficiency passed through.
        systems["dhw"] = {"primary": {
            "system": "gas_boiler_dhw",
            "efficiency_override": _num_metric(dhw.get("efficiency_metric"), 0.92),
        }}
        # If a separate heat-pump DHW entry exists, model it as an ASHP preheat.
        others = [s for s in (v40.get("dhw") or [])
                  if isinstance(s, dict) and s is not dhw and s.get("enabled", True)]
        if any((s.get("source") or "").lower() in _HEATPUMP_DHW_SOURCES for s in others):
            systems["dhw"]["secondary"] = {"system": "ashp_dhw"}

    simple = {"mode": "detailed", "systems": systems}

    # ── v25 enabled gates (the third source) — derived from v40 too ──────────
    def _any_enabled(service: str) -> bool:
        return any(
            isinstance(s, dict) and s.get("enabled", True)
            for s in (v40.get(service) or [])
        )

    v25_enabled = {
        "heating": {"enabled": _any_enabled("heating")},
        "cooling": {"enabled": _any_enabled("cooling")},
        "dhw": {"enabled": _any_enabled("dhw")},
    }

    return simple, v25_enabled
