import { useState, useContext, useEffect } from 'react'
import ExplorerLayout from '../../ui/ExplorerLayout.jsx'
import TabBar from '../../ui/TabBar.jsx'
import GeometryTab from './GeometryTab.jsx'
import FabricTab from './FabricTab.jsx'
import FabricSummary from './FabricSummary.jsx'
import SummaryTab from './SummaryTab.jsx'
import BuildingViewer3D from './BuildingViewer3D.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

const TABS = [
  { id: 'geometry', label: 'Geometry' },
  { id: 'fabric',   label: 'Fabric'   },
  { id: 'summary',  label: 'Summary'  },
]

function BuildingSidebar({ activeTab, onTabChange, library, details, onDetailChange }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1 border-b border-light-grey">
        <p className="text-caption font-medium text-navy">Building Definition</p>
        <p className="text-xxs text-mid-grey mt-0.5">Parametric geometry and fabric</p>
      </div>

      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={onTabChange}
        accentColor="#2B2A4C"
        className="px-0"
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {activeTab === 'geometry' && <GeometryTab />}
        {activeTab === 'fabric'   && (
          <FabricTab onDetailChange={onDetailChange} />
        )}
        {activeTab === 'summary'  && <SummaryTab />}
      </div>
    </div>
  )
}

export default function BuildingDefinition() {
  const [activeTab, setActiveTab] = useState('geometry')
  const { params, constructions } = useContext(ProjectContext)

  // Library + details for the FabricSummary main area
  const [library, setLibrary]   = useState([])
  const [details, setDetails]   = useState({})

  useEffect(() => {
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(d => setLibrary(d.constructions ?? []))
      .catch(() => {})
  }, [])

  function handleDetailChange(name, data) {
    setDetails(d => ({ ...d, [name]: data }))
  }

  return (
    <ExplorerLayout
      sidebarWidth="w-80"
      sidebar={
        <BuildingSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          library={library}
          details={details}
          onDetailChange={handleDetailChange}
        />
      }
    >
      {/* Main area */}
      {activeTab === 'fabric' ? (
        <FabricSummary
          library={library}
          constructions={constructions}
          details={details}
        />
      ) : (
        <div className="relative w-full h-full">
          <BuildingViewer3D params={params} />
        </div>
      )}
    </ExplorerLayout>
  )
}
