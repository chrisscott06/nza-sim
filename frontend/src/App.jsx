import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { BuildingProvider } from './context/BuildingContext.jsx'
import { SimulationProvider } from './context/SimulationContext.jsx'
import AppShell from './components/layout/AppShell.jsx'
import HomePage from './pages/HomePage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'

// These will be replaced with real modules in Parts 4 and 7
const BuildingPage  = () => <PlaceholderPage title="Building Definition" />
const ResultsPage   = () => <PlaceholderPage title="Results Dashboard" />

export default function App() {
  return (
    <BrowserRouter>
      <BuildingProvider>
        <SimulationProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/"          element={<HomePage />} />
              <Route path="/building"  element={<BuildingPage />} />
              <Route path="/systems"   element={<PlaceholderPage title="Systems" />} />
              <Route path="/profiles"  element={<PlaceholderPage title="Profiles" />} />
              <Route path="/results"   element={<ResultsPage />} />
              <Route path="/scenarios" element={<PlaceholderPage title="Scenarios" />} />
            </Route>
          </Routes>
        </SimulationProvider>
      </BuildingProvider>
    </BrowserRouter>
  )
}
