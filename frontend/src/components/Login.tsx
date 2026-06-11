export function Login() {
  const handleLogin = () => {
    window.location.href = '/api/auth/github'
  }

  return (
    <div class="app">
      <div class="login-container">
        <h1>json-drop</h1>
        <p>A simple backend for the backendless.</p>
        <p>Store arbitrary JSON with flexible access control.</p>
        <button onClick={handleLogin} class="login-btn">
          Sign in with GitHub
        </button>
      </div>
    </div>
  )
}
