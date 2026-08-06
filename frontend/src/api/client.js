const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Error de red')
  }
  return data
}

export function login(email, password) {
  return request('/login.php', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function me(accessToken) {
  return request('/me.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function refresh() {
  return request('/refresh.php', { method: 'POST' })
}

export function logout() {
  return request('/logout.php', { method: 'POST' })
}

export function presupuestosEnEstudio(accessToken) {
  return request('/presupuestos_en_estudio.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function actualizarPresupuestoEnEstudio(accessToken, id, cambios) {
  return request('/presupuestos_en_estudio.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id, ...cambios }),
  })
}
