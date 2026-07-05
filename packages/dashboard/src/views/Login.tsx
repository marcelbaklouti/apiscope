import { useState } from 'react'

export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    if (response.ok) onAuthenticated()
    else setError('invalid credentials')
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <div className="card" style={{ width: 320 }}>
        <h2>apiscope</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            username <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            password{' '}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary" onClick={() => void submit()}>
            sign in
          </button>
          <a href="/auth/login">sign in with SSO</a>
          {error !== null && (
            <div className="banner" data-kind="error">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
