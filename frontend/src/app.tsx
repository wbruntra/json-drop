import { useState, useEffect } from 'preact/hooks'
import { Login } from './components/Login'
import { Dashboard } from './components/Dashboard'

type User = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUser(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div class="app">
        <div class="loading">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return <Dashboard user={user} onLogout={() => setUser(null)} />
}
