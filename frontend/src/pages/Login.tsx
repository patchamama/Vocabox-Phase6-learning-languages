import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'

export default function Login() {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { login, isLoading, error, clearError } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await login(username, password)
      navigate('/')
    } catch {
      // error shown from store
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-blue-400 tracking-tight">{t('login.title')}</h1>
          <p className="text-slate-400 mt-2">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-500/20 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('login.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { clearError(); setUsername(e.target.value) }}
              className="input"
              placeholder="tu_usuario"
              required
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { clearError(); setPassword(e.target.value) }}
              className="input"
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isLoading}>
            {isLoading ? t('common.loading') : t('login.login')}
          </button>

          <p className="text-center text-slate-400 text-sm">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="text-blue-400 hover:text-blue-300">
              {t('login.register')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
