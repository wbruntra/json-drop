import { TokenManager } from './TokenManager'
import { DocManager } from './DocManager'
import { CurlGuide } from './CurlGuide'

type User = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
}

type Props = {
  user: User
  onLogout: () => void
}

export function Dashboard({ user, onLogout }: Props) {
  const handleLogout = () => {
    localStorage.removeItem('token')
    onLogout()
  }

  return (
    <div class="app">
      <header class="header">
        <h1>json-drop</h1>
        <div class="user-info">
          <span>{user.display_name || user.github_id}</span>
          <button onClick={handleLogout} class="logout-btn">
            Logout
          </button>
        </div>
      </header>

      <main class="dashboard">
        <section class="section">
          <h2>API Tokens</h2>
          <TokenManager />
        </section>

        <section class="section">
          <h2>Documents</h2>
          <DocManager />
        </section>

        <section class="section">
          <CurlGuide />
        </section>
      </main>
    </div>
  )
}
