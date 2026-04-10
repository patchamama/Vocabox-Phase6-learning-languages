import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Inicio', icon: '🏠' },
  { to: '/review', label: 'Repasar', icon: '📚' },
  { to: '/words', label: 'Palabras', icon: '📝' },
  { to: '/import', label: 'Importar', icon: '📥' },
  { to: '/stats', label: 'Stats', icon: '📊' },
  { to: '/settings', label: 'Config', icon: '⚙️' },
]

export default function NavBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700">
      <div className="max-w-lg mx-auto flex">
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 px-1 text-xs transition-colors ${
                isActive ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            <span className="text-xl mb-0.5">{icon}</span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
