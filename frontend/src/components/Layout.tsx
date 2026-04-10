import { Outlet } from 'react-router-dom'
import NavBar from './NavBar'

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <main className="flex-1 max-w-lg mx-auto w-full pb-20">
        <Outlet />
      </main>
      <NavBar />
    </div>
  )
}
