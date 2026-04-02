/**
 * BuildingContext.jsx — backwards-compat shim
 *
 * Existing components import BuildingContext and BuildingProvider from here.
 * Both now forward to ProjectContext so those components keep working
 * without changes.
 */

export { ProjectContext as BuildingContext, ProjectProvider as BuildingProvider } from './ProjectContext.jsx'
