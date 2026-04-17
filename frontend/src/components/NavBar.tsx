import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NavBar() {
  const { t } = useTranslation()

  const TABS = [
    { to: '/', label: t('nav.home'), icon: '🏠' },
    { to: '/review', label: t('nav.review'), icon: '📚' },
    { to: '/grammar', label: t('nav.grammar', 'Gramática'), icon: '✏️' },
    { to: '/words', label: t('nav.words'), icon: '📝' },
    { to: '/stats', label: t('nav.stats'), icon: '📊' },
    { to: '/settings', label: t('nav.settings'), icon: '⚙️' },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
      <div className="max-w-lg mx-auto flex">
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 px-1 text-xs transition-colors ${
                isActive ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
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
