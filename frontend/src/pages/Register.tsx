import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useUserProfileStore } from '../stores/userProfileStore'

export default function Register() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { register, isLoading, error, clearError } = useAuthStore()
  const { setDisplayName } = useUserProfileStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await register(username, email, password)
      if (name.trim()) setDisplayName(name.trim())
      navigate('/')
    } catch {
      // error shown from store
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-blue-400 tracking-tight">Vocabox</h1>
          <p className="text-slate-400 mt-2">{t('register.title')}</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-500/20 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('register.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder={t('register.namePlaceholder')}
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('register.username')}</label>
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
            <label className="text-sm text-slate-400 block mb-1">{t('register.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { clearError(); setEmail(e.target.value) }}
              className="input"
              placeholder={t('profile.emailPlaceholder')}
              required
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('register.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { clearError(); setPassword(e.target.value) }}
              className="input"
              placeholder="mínimo 6 caracteres"
              minLength={6}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isLoading}>
            {isLoading ? t('common.loading') : t('register.register')}
          </button>

          <p className="text-center text-slate-400 text-sm">
            {t('register.haveAccount')}{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300">
              {t('register.login')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
