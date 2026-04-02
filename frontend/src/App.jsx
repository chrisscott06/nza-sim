import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { BuildingProvider } from './context/BuildingContext.jsx'
import { SimulationProvider } from './context/SimulationContext.jsx'
import AppShell from './components/layout/AppShell.jsx'
import HomePage from './pages/HomePage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import BuildingDefinition from './components/modules/building/BuildingDefinition.jsx'
import ResultsDashboard from './components/modules/results/ResultsDashboard.jsx'
import SystemsZones from './components/modules/SystemsZones.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <BuildingProvider>
        <SimulationProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/"          element={<HomePage />} />
              <Route path="/building"  element={<BuildingDefinition />} />
              <Route path="/systems"   element={<SystemsZones />} />
              <Route path="/profiles"  element={<PlaceholderPage title="Profiles" />} />
              <Route path="/results"   element={<ResultsDashboard />} />
              <Route path="/scenarios" element={<PlaceholderPage title="Scenarios" />} />
            </Route>
          </Routes>
        </SimulationProvider>
      </BuildingProvider>
    </BrowserRouter>
  )
}
