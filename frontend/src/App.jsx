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
import OperationModule    from './components/modules/OperationModule.jsx'
import InformationModule  from './components/modules/InformationModule.jsx'
import ResultsDashboard from './components/modules/results/ResultsDashboard.jsx'
import SystemsZones from './components/modules/SystemsZones.jsx'
import LibraryBrowser  from './components/modules/LibraryBrowser.jsx'
import ProfilesEditor  from './components/modules/ProfilesEditor.jsx'
import InternalGainsModule from './components/modules/gains/InternalGainsModule.jsx'
import ScenarioManager from './components/modules/ScenarioManager.jsx'
import ConsumptionManager from './components/modules/consumption/ConsumptionManager.jsx'
import CRREMModule from './components/modules/CRREMModule.jsx'
import WeatherModule from './components/modules/WeatherModule.jsx'
import BalanceTestPage from './components/modules/balance/BalanceTestPage.jsx'

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
                <Route path="/project"      element={<ErrorBoundary moduleName="Project Dashboard"><ProjectDashboard /></ErrorBoundary>} />
                <Route path="/information" element={<ErrorBoundary moduleName="Information"><InformationModule /></ErrorBoundary>} />
                <Route path="/building"    element={<ErrorBoundary moduleName="Building Definition"><BuildingDefinition /></ErrorBoundary>} />
                <Route path="/operation"   element={<ErrorBoundary moduleName="Operation"><OperationModule /></ErrorBoundary>} />
                <Route path="/systems"   element={<ErrorBoundary moduleName="Systems & Zones"><SystemsZones /></ErrorBoundary>} />
                <Route path="/profiles"  element={<ErrorBoundary moduleName="Profiles Editor"><ProfilesEditor /></ErrorBoundary>} />
                <Route path="/gains"     element={<ErrorBoundary moduleName="Internal Gains"><InternalGainsModule /></ErrorBoundary>} />
                <Route path="/consumption" element={<ErrorBoundary moduleName="Consumption"><ConsumptionManager /></ErrorBoundary>} />
                <Route path="/results"   element={<ErrorBoundary moduleName="Results Dashboard"><ResultsDashboard /></ErrorBoundary>} />
                <Route path="/crrem"     element={<ErrorBoundary moduleName="CRREM"><CRREMModule /></ErrorBoundary>} />
                <Route path="/weather"   element={<ErrorBoundary moduleName="Weather"><WeatherModule /></ErrorBoundary>} />
                <Route path="/balance-test" element={<ErrorBoundary moduleName="Heat Balance Test"><BalanceTestPage /></ErrorBoundary>} />
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
