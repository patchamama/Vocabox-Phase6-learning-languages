import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import NavBar from './NavBar'
import Dashboard from '../pages/Dashboard'
import Review from '../pages/Review'
import Words from '../pages/Words'
import GrammarWorkshop from '../pages/GrammarWorkshop'
import Stats from '../pages/Stats'
import Settings from '../pages/Settings'
import Import from '../pages/Import'
import UserProfile from '../pages/UserProfile'

// All pages kept mounted — switching tabs only toggles display:none/block
// so component state and scroll position are preserved across navigation.
const PAGES = [
  { path: '/', Component: Dashboard, exact: true },
  { path: '/review', Component: Review },
  { path: '/words', Component: Words },
  { path: '/grammar', Component: GrammarWorkshop },
  { path: '/stats', Component: Stats },
  { path: '/settings', Component: Settings },
  { path: '/import', Component: Import },
  { path: '/profile', Component: UserProfile },
]

function isActive(pagePath: string, exact: boolean | undefined, currentPath: string): boolean {
  if (exact) return currentPath === pagePath
  return currentPath === pagePath || currentPath.startsWith(pagePath + '/')
}

export default function Layout() {
  const { pathname } = useLocation()
  const scrollPositions = useRef<Map<string, number>>(new Map())
  const prevPath = useRef<string | null>(null)

  useEffect(() => {
    // Save previous route's scroll before switching
    if (prevPath.current !== null && prevPath.current !== pathname) {
      scrollPositions.current.set(prevPath.current, window.scrollY)
    }
    // Restore scroll for incoming route
    const saved = scrollPositions.current.get(pathname) ?? 0
    window.scrollTo(0, saved)
    prevPath.current = pathname
  }, [pathname])

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <main className="flex-1 max-w-lg mx-auto w-full pb-20">
        {PAGES.map(({ path, Component, exact }) => (
          <div
            key={path}
            style={{ display: isActive(path, exact, pathname) ? 'block' : 'none' }}
          >
            <Component />
          </div>
        ))}
      </main>
      <NavBar />
    </div>
  )
}
