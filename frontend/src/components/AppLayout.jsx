import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth, MOCK_AUTH } from '../context/AuthContext.jsx'

// Cada módulo de departamento agrega su entrada aquí cuando se construya
// (Gestión de Obras, Transporte, etc.) — el filtro por permiso ya queda listo.
const NAV_ITEMS = [
  { to: '/presupuestos-en-estudio', label: 'Presupuestos en Estudio', icono: '🔍', permiso: 'presupuestos.ver_todos' },
  // Espacio de trabajo personal de Geraldinne. Permiso propio
  // (ver_seguimiento), no ver_todos — así no comparte puerta con
  // Presupuestos en Estudio (la vista de admin). El filtro por email es
  // una segunda capa además del permiso, ya que hoy es la única persona
  // con ese permiso, pero es exclusivamente su vista, no una capacidad
  // pensada para compartir.
  {
    to: '/seguimiento',
    label: 'Presupuesto',
    icono: '🧭',
    permiso: 'presupuestos.ver_seguimiento',
    soloEmail: 'presupuestos@galvi.es',
  },
]

export default function AppLayout() {
  const { usuario, logout, tienePermiso } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-logo">🏗️ Panel Galvi</div>
        <nav className="app-nav">
          {NAV_ITEMS.filter(
            (item) => tienePermiso(item.permiso) && (!item.soloEmail || usuario?.email === item.soloEmail),
          ).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-nav-link${isActive ? ' activo' : ''}`}
            >
              <span>{item.icono}</span> {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <div className="app-usuario">
            <strong>{usuario.nombre}</strong>
            <span>{usuario.roles.join(', ')}</span>
          </div>
          <button className="btn-secundario" onClick={handleLogout}>Salir</button>
        </div>
      </aside>
      <main className="app-content">
        {MOCK_AUTH && (
          <div className="dev-banner">
            🧪 Modo desarrollo — sesión simulada, no hay login real todavía
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
