/**
 * WeatherContext.jsx
 *
 * Loads and caches hourly EPW weather data from the backend API.
 * Fetched once per weather file — not repeated on navigation.
 *
 * Provides: { weatherData, weatherLoading }
 *   weatherData: { temperature, direct_normal, diffuse_horizontal, month, hour, location, count }
 *   weatherLoading: boolean
 */

import { createContext, useContext, useEffect, useState } from 'react'
import { ProjectContext } from './ProjectContext.jsx'

export const WeatherContext = createContext({ weatherData: null, weatherLoading: true })

export function WeatherProvider({ children }) {
  const [weatherData, setWeatherData] = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(true)

  // Use future weather file if selected, otherwise current weather file
  const { params } = useContext(ProjectContext)
  const weatherFile = params?.future_weather_file || params?.weather_file || 'default'

  useEffect(() => {
    let cancelled = false
    setWeatherLoading(true)

    fetch(`/api/weather/${encodeURIComponent(weatherFile)}/hourly`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (!cancelled) {
          setWeatherData(data)
          setWeatherLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.warn('WeatherContext: could not load EPW data —', err.message)
          setWeatherLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [weatherFile])

  return (
    <WeatherContext.Provider value={{ weatherData, weatherLoading }}>
      {children}
    </WeatherContext.Provider>
  )
}

export function useWeather() {
  return useContext(WeatherContext)
}
