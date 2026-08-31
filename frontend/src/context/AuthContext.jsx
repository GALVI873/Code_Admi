import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { login as apiLogin, logout as apiLogout, refresh as apiRefresh, me as apiMe } from '../api/client.js'

const AuthContext = createContext(null)

// Bypass de login para desarrollar el frontend sin backend local: el PHP se va
// a construir directo en el subdominio cuando haya acceso al hosting, así que
// mientras tanto se simula la sesión. Se activa solo con VITE_MOCK_AUTH=true
// en frontend/.env (nunca en el build real) — ver frontend/.env.example.
export const MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === 'true'
const MOCK_ROLE = import.meta.env.VITE_MOCK_ROLE || 'admin'

const MOCK_USUARIOS = {
  admin: {
    id: 1,
    nombre: 'Álvaro (mock)',
    email: 'alvaro@galvi.es',
    roles: ['admin'],
    permisos: [
      'presupuestos.crear', 'presupuestos.ver_propios', 'presupuestos.ver_todos',
      'presupuestos.editar', 'presupuestos.enviar', 'presupuestos.aprobar',
      'presupuestos.reemplazar_version', 'usuarios.gestionar',
      'presupuestos.gestionar_prioridad', 'presupuestos.marcar_interesante',
      'obras.ver_diario_general',
    ],
  },
  presupuestos: {
    id: 2,
    nombre: 'Geraldinne (mock)',
    email: 'presupuestos@galvi.es',
    roles: ['presupuestos'],
    permisos: [
      'presupuestos.crear', 'presupuestos.ver_propios', 'presupuestos.ver_seguimiento',
      'presupuestos.editar', 'presupuestos.enviar', 'presupuestos.reemplazar_version',
      'presupuestos.marcar_interesante',
    ],
  },
  gestion_obras: {
    id: 3,
    nombre: 'Alfredo (mock)',
    email: 'alfredo@galvi.es',
    roles: ['gestion_obras'],
    permisos: ['obras.ver_aceptadas', 'obras.ver_diario_general'],
  },
}

function usuarioMock() {
  return MOCK_USUARIOS[MOCK_ROLE] ?? MOCK_USUARIOS.admin
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => (MOCK_AUTH ? usuarioMock() : null))
  const [accessToken, setAccessToken] = useState(() => (MOCK_AUTH ? 'mock-token' : null))
  const [cargando, setCargando] = useState(() => !MOCK_AUTH)

  useEffect(() => {
    if (MOCK_AUTH) return // ya se inicializó arriba, no hay sesión real que recuperar

    // Al cargar la app se intenta recuperar la sesión con el refresh token
    // (cookie httpOnly) para no perder la sesión al recargar la página.
    // El access token vive solo en memoria (nunca en localStorage/sessionStorage)
    // para reducir el riesgo de robo por XSS.
    apiRefresh()
      .then(async (data) => {
        setAccessToken(data.access_token)
        const { usuario } = await apiMe(data.access_token)
        setUsuario(usuario)
      })
      .catch(() => {
        setAccessToken(null)
        setUsuario(null)
      })
      .finally(() => setCargando(false))
  }, [])

  const login = useCallback(async (email, password) => {
    if (MOCK_AUTH) {
      setUsuario(usuarioMock())
      setAccessToken('mock-token')
      return
    }
    const data = await apiLogin(email, password)
    setAccessToken(data.access_token)
    setUsuario(data.usuario)
  }, [])

  const logout = useCallback(async () => {
    if (MOCK_AUTH) {
      setUsuario(null)
      setAccessToken(null)
      return
    }
    try {
      await apiLogout()
    } catch {
      // si falla la llamada de red, igual limpiamos la sesión localmente
    }
    setAccessToken(null)
    setUsuario(null)
  }, [])

  const tienePermiso = useCallback(
    (permiso) => usuario?.permisos?.includes(permiso) ?? false,
    [usuario],
  )

  return (
    <AuthContext.Provider value={{ usuario, accessToken, cargando, login, logout, tienePermiso }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
