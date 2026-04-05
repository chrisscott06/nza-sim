import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ProjectProvider } from './context/ProjectContext.jsx'
import { SimulationProvider } from './context/SimulationContext.jsx'
import { WeatherProvider } from './context/WeatherContext.jsx'
import AppShell from './components/layout/AppShell.jsx'
import ErrorBoundary from './components/ui/ErrorBoundary.jsx'
import HomePage from './pages/HomePage.jsx'
import ProjectDashboard from './pages/ProjectDashboard.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import PopOutResults from './pages/PopOutResults.jsx'
import BuildingDefinition from './components/modules/building/BuildingDefinition.jsx'
import ResultsDashboard from './components/modules/results/ResultsDashboard.jsx'
import SystemsZones from './components/modules/SystemsZones.jsx'
import LibraryBrowser  from './components/modules/LibraryBrowser.jsx'
import ProfilesEditor  from './components/modules/ProfilesEditor.jsx'
import ScenarioManager from './components/modules/ScenarioManager.jsx'
import ConsumptionManager from './components/modules/consumption/ConsumptionManager.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <ProjectProvider>
        <WeatherProvider>
          <SimulationProvider>
            <Routes>
              {/* Pop-out results window — standalone, no sidebar/topbar */}
              <Route path="/popout" element={<PopOutResults />} />

              <Route element={<AppShell />}>
                <Route path="/"          element={<ErrorBoundary moduleName="Home"><HomePage /></ErrorBoundary>} />
                <Route path="/project"  element={<ErrorBoundary moduleName="Project Dashboard"><ProjectDashboard /></ErrorBoundary>} />
                <Route path="/building"  element={<ErrorBoundary moduleName="Building Definition"><BuildingDefinition /></ErrorBoundary>} />
                <Route path="/systems"   element={<ErrorBoundary moduleName="Systems & Zones"><SystemsZones /></ErrorBoundary>} />
                <Route path="/profiles"  element={<ErrorBoundary moduleName="Profiles Editor"><ProfilesEditor /></ErrorBoundary>} />
                <Route path="/consumption" element={<ErrorBoundary moduleName="Consumption"><ConsumptionManager /></ErrorBoundary>} />
                <Route path="/results"   element={<ErrorBoundary moduleName="Results Dashboard"><ResultsDashboard /></ErrorBoundary>} />
                <Route path="/scenarios" element={<ErrorBoundary moduleName="Scenario Manager"><ScenarioManager /></ErrorBoundary>} />
                <Route path="/library"   element={<ErrorBoundary moduleName="Library Browser"><LibraryBrowser /></ErrorBoundary>} />
              </Route>
            </Routes>
          </SimulationProvider>
        </WeatherProvider>
      </ProjectProvider>
    </BrowserRouter>
  )
}
