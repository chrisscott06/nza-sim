/**
 * crremPathwayUkHotel.js — Brief 89 (Brief C): CRREM decarbonisation pathway,
 * UK Hotel, 1.5°C, both axes (energy intensity + GHG intensity), 2020–2060.
 *
 * This is the canonical CRREM-target source for the **interventions / Brief C
 * boundary** (per-intervention Lifetime Carbon card + Strategy CRREM stranding
 * diagram). Read it ONLY through `utils/carbonReads.readCrremTarget()` — never
 * re-interpolate the raw array in a consumer (Bible Rule 11).
 *
 * Provenance: mirrors the backend benchmark `crrem_hotel_uk_15`
 * (`GET /api/library/benchmarks?building_type=hotel` → `config_json.{eui_targets,
 * carbon_targets}`), CRREM V2.07 Risk Assessment Tool, 1.5°C, United Kingdom,
 * Hotel. Baked into the frontend so the client-side interventions module reads
 * synchronously (no async benchmark fetch on every render). Backend benchmark +
 * this module are two views of the SAME CRREM v2.07 UK Hotel dataset; if the
 * backend curve is updated, re-sync this file.
 *
 * NB (boundary note, per Brief 88 discipline): the *engine's* CRREM consumer
 * (`data/crremTargets.js`, v2.04 International, carbon-only) is a SEPARATE,
 * pre-existing boundary used by `instantCalc.js` + `roadmapEngine.js`. Brief 89
 * does NOT touch it. Cross-trajectory harmonisation is queued tech debt
 * (flagged in `carbonFactors.js`), out of scope here.
 */

// year → { eui: kWh/m²·yr target, carbon: kgCO₂e/m²·yr target }
export const CRREM_UK_HOTEL_15C = Object.freeze([
  { year: 2020, eui: 280, carbon: 80 }, { year: 2021, eui: 268, carbon: 73 },
  { year: 2022, eui: 257, carbon: 66 }, { year: 2023, eui: 246, carbon: 60 },
  { year: 2024, eui: 235, carbon: 57 }, { year: 2025, eui: 225, carbon: 55 },
  { year: 2026, eui: 215, carbon: 50 }, { year: 2027, eui: 205, carbon: 45 },
  { year: 2028, eui: 196, carbon: 41 }, { year: 2029, eui: 188, carbon: 39 },
  { year: 2030, eui: 180, carbon: 38 }, { year: 2031, eui: 171, carbon: 34 },
  { year: 2032, eui: 162, carbon: 30 }, { year: 2033, eui: 154, carbon: 27 },
  { year: 2034, eui: 147, carbon: 26 }, { year: 2035, eui: 140, carbon: 25 },
  { year: 2036, eui: 133, carbon: 23 }, { year: 2037, eui: 127, carbon: 21 },
  { year: 2038, eui: 121, carbon: 19 }, { year: 2039, eui: 116, carbon: 18 },
  { year: 2040, eui: 110, carbon: 18 }, { year: 2041, eui: 106, carbon: 16 },
  { year: 2042, eui: 102, carbon: 15 }, { year: 2043, eui: 98,  carbon: 14 },
  { year: 2044, eui: 94,  carbon: 13 }, { year: 2045, eui: 90,  carbon: 12 },
  { year: 2046, eui: 87,  carbon: 11 }, { year: 2047, eui: 84,  carbon: 10 },
  { year: 2048, eui: 81,  carbon: 9  }, { year: 2049, eui: 78,  carbon: 8  },
  { year: 2050, eui: 75,  carbon: 8  }, { year: 2051, eui: 72,  carbon: 7  },
  { year: 2052, eui: 69,  carbon: 6  }, { year: 2053, eui: 67,  carbon: 6  },
  { year: 2054, eui: 65,  carbon: 5  }, { year: 2055, eui: 63,  carbon: 5  },
  { year: 2056, eui: 61,  carbon: 4  }, { year: 2057, eui: 59,  carbon: 4  },
  { year: 2058, eui: 57,  carbon: 3  }, { year: 2059, eui: 56,  carbon: 3  },
  { year: 2060, eui: 55,  carbon: 2  },
])

/**
 * Registry of available CRREM pathways. v1 carries UK Hotel 1.5°C only; other
 * country/property/pathway combinations land in a future brief. Keyed by the
 * `{country, property_type, pathway}` the project picker stores.
 */
export const CRREM_PATHWAYS = Object.freeze({
  'UK|hotel|1.5C': { label: 'UK · Hotel · 1.5°C', curve: CRREM_UK_HOTEL_15C },
})

/** Canonical project-default pick (Bridgewater + every v1 project). */
export const CRREM_DEFAULT_PICK = Object.freeze({ country: 'UK', property_type: 'hotel', pathway: '1.5C' })
