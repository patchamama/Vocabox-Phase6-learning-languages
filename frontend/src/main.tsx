import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './i18n'

// Apply dark mode class before first render to avoid flash
const profile = JSON.parse(localStorage.getItem('vocabox-user-profile') || '{}')
const darkMode = profile?.state?.darkMode ?? true
document.documentElement.classList.toggle('dark', darkMode)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
