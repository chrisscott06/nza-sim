// Module colour themes — accent colours per module section
// Used by Sidebar active indicators and module header accent bars.

export const MODULE_THEMES = {
  building:  { accent: '#A1887F', label: 'Building'  },
  systems:   { accent: '#00AEEF', label: 'Systems'   },
  profiles:  { accent: '#8B5CF6', label: 'Profiles'  },
  results:   { accent: '#2B2A4C', label: 'Results'   },
  scenarios: { accent: '#E84393', label: 'Scenarios' },
  library:   { accent: '#16A34A', label: 'Library'   },
  home:      { accent: '#2B2A4C', label: 'Home'      },
}

/** Return the accent colour for a given pathname */
export function accentForPath(pathname) {
  if (pathname.startsWith('/building')) return MODULE_THEMES.building.accent
  if (pathname.startsWith('/systems'))  return MODULE_THEMES.systems.accent
  if (pathname.startsWith('/profiles')) return MODULE_THEMES.profiles.accent
  if (pathname.startsWith('/results'))  return MODULE_THEMES.results.accent
  if (pathname.startsWith('/scenarios'))return MODULE_THEMES.scenarios.accent
  if (pathname.startsWith('/library'))  return MODULE_THEMES.library.accent
  return MODULE_THEMES.home.accent
}
