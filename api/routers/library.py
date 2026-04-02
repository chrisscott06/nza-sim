"""
api/routers/library.py

GET endpoints for the building physics library.
"""

from fastapi import APIRouter, HTTPException

from nza_engine.library.constructions import list_constructions, get_construction
from nza_engine.library.schedules import list_schedules
from nza_engine.library.systems import list_systems, get_system

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("/constructions")
async def get_constructions():
    """
    Return all available construction buildups with names and U-values.
    """
    return {"constructions": list_constructions()}


@router.get("/constructions/{name}")
async def get_construction_detail(name: str):
    """
    Return the full epJSON-ready definition for a specific construction.
    """
    try:
        data = get_construction(name)
        return {"name": name, "definition": data}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/schedules")
async def get_schedules():
    """
    Return all available schedule templates with peak/min values.
    """
    return {"schedules": list_schedules()}


@router.get("/systems")
async def get_systems(category: str | None = None):
    """
    Return all available HVAC and services system templates.
    Optional category filter: hvac, dhw, ventilation.
    """
    return {"systems": list_systems(category=category)}


@router.get("/systems/{name}")
async def get_system_detail(name: str):
    """
    Return the full template for a specific system.
    """
    try:
        return {"name": name, "system": get_system(name)}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
