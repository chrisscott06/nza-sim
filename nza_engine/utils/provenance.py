"""
provenance.py — input provenance metadata helpers.

Mirror of `frontend/src/utils/provenance.js`. Implements the v2.1 state
contract's provenance schema; the two implementations must stay in lockstep
because both backend and frontend read the same `building_config` /
`gains_config` / etc. JSON blobs.

Per the contract (`docs/state_contracts.md` § Cross-cutting concepts →
Input provenance):
    - Provenance lives in a sibling `_provenance` object keyed by
      dot-notated input path (e.g. "fabric.external_wall.u_value").
    - Per-path record: { source, ref?, confidence?, recorded_at? }
    - `source` is required, one of the six contract enum values.
    - Default when unspecified: { source: 'user_entered', confidence: 'medium' }.

States 1–3 record provenance but don't branch on it. State 4 reconciliation
reads it to weight the bottom-up estimate and bound proposed adjustments.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any


# Canonical provenance source enum, per contract v2.1.
PROVENANCE_SOURCES: tuple[str, ...] = (
    "user_entered",
    "spec_sheet",
    "vintage_default",
    "benchmark",
    "inferred",
    "calibrated",
)

# Default record returned by get_provenance when no entry exists at the path.
DEFAULT_PROVENANCE: dict[str, Any] = {
    "source": "user_entered",
    "confidence": "medium",
}


def get_provenance(config: dict | None, path: str) -> dict[str, Any]:
    """Read the provenance record for a given input path.

    Falls back to DEFAULT_PROVENANCE if no entry is set or config is None.
    Returns a fresh dict so callers can't mutate the default.
    """
    if not config or not path:
        return dict(DEFAULT_PROVENANCE)
    prov = config.get("_provenance")
    if not isinstance(prov, dict):
        return dict(DEFAULT_PROVENANCE)
    rec = prov.get(path)
    if not isinstance(rec, dict) or not rec.get("source"):
        return dict(DEFAULT_PROVENANCE)
    return dict(rec)


def set_provenance(config: dict, path: str, record: dict[str, Any]) -> dict:
    """Write or replace a provenance record. Immutable — returns a new config.

    `record.source` is required and must be one of PROVENANCE_SOURCES. Other
    fields (ref, confidence, recorded_at) are optional. If recorded_at is
    absent it's filled with the current UTC ISO 8601 timestamp.
    """
    if not isinstance(config, dict):
        raise ValueError("set_provenance: config must be a dict")
    if not path or not isinstance(path, str):
        raise ValueError("set_provenance: path must be a non-empty string")
    if not isinstance(record, dict) or not record.get("source"):
        raise ValueError("set_provenance: record.source is required")
    if record["source"] not in PROVENANCE_SOURCES:
        raise ValueError(
            f"set_provenance: source {record['source']!r} is not a valid contract enum "
            f"value (must be one of: {', '.join(PROVENANCE_SOURCES)})"
        )

    cleaned: dict[str, Any] = {"source": record["source"]}
    if "ref" in record and record["ref"] is not None:
        cleaned["ref"] = record["ref"]
    if "confidence" in record and record["confidence"] is not None:
        cleaned["confidence"] = record["confidence"]
    cleaned["recorded_at"] = record.get("recorded_at") or datetime.now(timezone.utc).isoformat()

    next_config = deepcopy(config)
    prov = next_config.get("_provenance")
    if not isinstance(prov, dict):
        prov = {}
    prov[path] = cleaned
    next_config["_provenance"] = prov
    return next_config


def clear_provenance(config: dict, path: str) -> dict:
    """Remove a single entry so subsequent reads return the default. Immutable."""
    if not isinstance(config, dict) or not path:
        return config
    prov = config.get("_provenance")
    if not isinstance(prov, dict) or path not in prov:
        return config
    next_config = deepcopy(config)
    next_prov = dict(next_config["_provenance"])
    del next_prov[path]
    if next_prov:
        next_config["_provenance"] = next_prov
    else:
        del next_config["_provenance"]
    return next_config


def list_provenance(config: dict | None) -> list[dict[str, Any]]:
    """Enumerate every provenance entry currently set on a config.

    Returns a list of { path, source, ref?, confidence?, recorded_at? } dicts.
    Entries missing the required `source` field are skipped silently.
    """
    if not isinstance(config, dict):
        return []
    prov = config.get("_provenance")
    if not isinstance(prov, dict):
        return []
    out: list[dict[str, Any]] = []
    for path, rec in prov.items():
        if not isinstance(rec, dict) or not rec.get("source"):
            continue
        out.append({"path": path, **rec})
    return out
