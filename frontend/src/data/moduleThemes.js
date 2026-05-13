// Module colour themes — accent colours per module section
// Used by Sidebar active indicators and module header accent bars.

export const MODULE_THEMES = {
  information: { accent: '#2B2A4C', label: 'Information' },
  building:    { accent: '#A1887F', label: 'Building'    },
  operation:   { accent: '#0E7490', label: 'Operation'   },
  systems:     { accent: '#00AEEF', label: 'Systems'     },
  profiles:    { accent: '#8B5CF6', label: 'Profiles'    },
  gains:       { accent: '#EA580C', label: 'Internal Gains' },
  consumption: { accent: '#2D6A7A', label: 'Consumption' },
  weather:     { accent: '#0EA5E9', label: 'Weather'     },
  results:     { accent: '#2B2A4C', label: 'Results'     },
  crrem:       { accent: '#DC2626', label: 'CRREM'       },
  scenarios:   { accent: '#E84393', label: 'Scenarios'   },
  library:     { accent: '#16A34A', label: 'Library'     },
  home:        { accent: '#2B2A4C', label: 'Home'        },
}

/** Return the accent colour for a given pathname */
export function accentForPath(pathname) {
  if (pathname.startsWith('/information')) return MODULE_THEMES.information.accent
  if (pathname.startsWith('/building'))    return MODULE_THEMES.building.accent
  if (pathname.startsWith('/operation'))   return MODULE_THEMES.operation.accent
  if (pathname.startsWith('/systems'))     return MODULE_THEMES.systems.accent
  if (pathname.startsWith('/profiles'))    return MODULE_THEMES.profiles.accent
  if (pathname.startsWith('/gains'))       return MODULE_THEMES.gains.accent
  if (pathname.startsWith('/consumption')) return MODULE_THEMES.consumption.accent
  if (pathname.startsWith('/weather'))     return MODULE_THEMES.weather.accent
  if (pathname.startsWith('/results'))     return MODULE_THEMES.results.accent
  if (pathname.startsWith('/crrem'))       return MODULE_THEMES.crrem.accent
  if (pathname.startsWith('/scenarios'))   return MODULE_THEMES.scenarios.accent
  if (pathname.startsWith('/library'))     return MODULE_THEMES.library.accent
  return MODULE_THEMES.home.accent
}
