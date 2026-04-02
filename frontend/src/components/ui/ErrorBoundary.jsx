/**
 * ErrorBoundary.jsx
 *
 * Class-based React error boundary.  Wraps a module so that a runtime crash
 * shows a contained error card instead of white-screening the whole app.
 *
 * Usage:
 *   <ErrorBoundary moduleName="Results Dashboard">
 *     <ResultsDashboard />
 *   </ErrorBoundary>
 */

import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, detailOpen: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.moduleName ?? 'Module', error, info)
  }

  handleReset() {
    this.setState({ hasError: false, error: null, detailOpen: false })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { moduleName = 'Module' } = this.props
    const msg = this.state.error?.message ?? 'Unknown error'

    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full bg-white rounded-xl border border-coral/30 shadow-sm p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={20} className="text-coral flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-caption font-semibold text-navy">{moduleName} — Something went wrong</p>
              <p className="text-xs text-mid-grey mt-1">
                An unexpected error occurred. You can try refreshing this module.
              </p>
            </div>
          </div>

          <button
            onClick={() => this.handleReset()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-caption bg-navy text-white rounded-lg hover:bg-opacity-90 transition-colors mb-3"
          >
            <RefreshCw size={12} />
            Try Again
          </button>

          <button
            onClick={() => this.setState(s => ({ detailOpen: !s.detailOpen }))}
            className="text-xxs text-mid-grey hover:text-navy transition-colors"
          >
            {this.state.detailOpen ? 'Hide' : 'Show'} error details
          </button>

          {this.state.detailOpen && (
            <pre className="mt-2 p-3 bg-off-white rounded text-xxs text-coral overflow-x-auto whitespace-pre-wrap break-all">
              {msg}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
