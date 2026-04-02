import { useContext } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'

function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-caption text-mid-grey">Loading project…</p>
      </div>
    </div>
  )
}

export default function AppShell() {
  const { isLoading } = useContext(ProjectContext)

  return (
    <div className="flex h-screen bg-off-white overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-hidden">
          {isLoading ? <FullPageSpinner /> : <Outlet />}
        </main>
      </div>
    </div>
  )
}
