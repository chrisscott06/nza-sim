import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ProjectProvider } from './context/ProjectContext.jsx'
import { SimulationProvider } from './context/SimulationContext.jsx'
import AppShell from './components/layout/AppShell.jsx'
import HomePage from './pages/HomePage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'
import BuildingDefinition from './components/modules/building/BuildingDefinition.jsx'
import ResultsDashboard from './components/modules/results/ResultsDashboard.jsx'
import SystemsZones from './components/modules/SystemsZones.jsx'
import LibraryBrowser  from './components/modules/LibraryBrowser.jsx'
import ProfilesEditor  from './components/modules/ProfilesEditor.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <ProjectProvider>
        <SimulationProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/"          element={<HomePage />} />
              <Route path="/building"  element={<BuildingDefinition />} />
              <Route path="/systems"   element={<SystemsZones />} />
              <Route path="/profiles"  element={<ProfilesEditor />} />
              <Route path="/results"   element={<ResultsDashboard />} />
              <Route path="/scenarios" element={<PlaceholderPage title="Scenarios" />} />
              <Route path="/library"   element={<LibraryBrowser />} />
            </Route>
          </Routes>
        </SimulationProvider>
      </ProjectProvider>
    </BrowserRouter>
  )
}
