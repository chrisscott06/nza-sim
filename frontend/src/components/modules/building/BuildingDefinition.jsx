import { useState, useContext } from 'react'
import ExplorerLayout from '../../ui/ExplorerLayout.jsx'
import TabBar from '../../ui/TabBar.jsx'
import GeometryTab from './GeometryTab.jsx'
import FabricTab from './FabricTab.jsx'
import SummaryTab from './SummaryTab.jsx'
import BuildingViewer3D from './BuildingViewer3D.jsx'
import { BuildingContext } from '../../../context/BuildingContext.jsx'

const TABS = [
  { id: 'geometry', label: 'Geometry' },
  { id: 'fabric',   label: 'Fabric'   },
  { id: 'summary',  label: 'Summary'  },
]

function BuildingSidebar({ activeTab, onTabChange }) {
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
        {activeTab === 'fabric'   && <FabricTab />}
        {activeTab === 'summary'  && <SummaryTab />}
      </div>
    </div>
  )
}

export default function BuildingDefinition() {
  const [activeTab, setActiveTab] = useState('geometry')
  const { params } = useContext(BuildingContext)

  return (
    <ExplorerLayout
      sidebarWidth="w-80"
      sidebar={
        <BuildingSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      }
    >
      {/* Main area — interactive 3D viewer */}
      <div className="relative w-full h-full">
        <BuildingViewer3D params={params} />
      </div>
    </ExplorerLayout>
  )
}
