import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, MOCK_AUTH } from '../context/AuthContext.jsx'

// Menú organizado por departamento a pedido de Álvaro — un ítem plano
// sigue siendo un ítem plano ({to, label, icono, permiso}), pero un
// departamento con más de una vista adentro es un grupo desplegable
// ({grupo, icono, items:[{to, label, permiso}]}). Cada módulo nuevo agrega
// su entrada acá (suelto o dentro de un grupo existente) cuando se
// construya — el filtro por permiso ya queda listo para cualquiera de los
// dos casos.
const NAV_ITEMS = [
  { to: '/presupuestos-en-estudio', label: 'Presupuestos', icono: '🔍', permiso: 'presupuestos.ver_todos' },
  // Vista de Geraldinne (Orden del día / General), pero también accesible
  // para admin (Álvaro/Valentina) — antes era exclusiva de Geraldinne por
  // email, ahora cualquiera con ver_todos O ver_seguimiento entra. Dentro
  // de la página, los campos que son de trabajo operativo de ella (fecha
  // límite de entrega, gestión de ofertas a proveedor) siguen siendo
  // de solo lectura para quien no tenga ver_seguimiento específicamente —
  // ver SeguimientoPage.jsx. Queda como ítem suelto (no entra en el grupo
  // "Seguimiento" de abajo): es una vista completamente distinta de las de
  // Alfredo/Álvaro, comparte nombre de ruta nada más.
  {
    to: '/seguimiento',
    label: 'Presupuesto',
    icono: '🧭',
    permisoAlguno: ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento'],
  },
  // Departamento "Seguimiento" (Alfredo/Álvaro) — antes tres ítems sueltos,
  // ahora agrupados en un desplegable. "Notas" es la vista consolidada de
  // pendientes (PendientesObrasPage.jsx, ruta /pendientes sin cambios) —
  // solo se le cambió el nombre en el menú, a pedido explícito.
  {
    grupo: 'Seguimiento',
    icono: '🏗️',
    items: [
      { to: '/obras-aceptadas', label: 'Obras Aceptadas', permiso: 'obras.ver_aceptadas' },
      { to: '/diario-general', label: 'Diario General', permiso: 'obras.ver_diario_general' },
      { to: '/pendientes', label: 'Notas', permiso: 'obras.ver_aceptadas' },
    ],
  },
  // Departamento nuevo, todavía sin diseñar (a pedido de Álvaro, para que
  // el lugar ya exista en el menú) — soloRol en vez de depender solo del
  // permiso, porque por ahora es exclusivamente exploratorio para admin;
  // cuando se diseñe de verdad, contabilidad.ver se puede otorgar a otros
  // roles sin tocar este archivo.
  {
    to: '/contabilidad',
    label: 'Contabilidad',
    icono: '💰',
    permiso: 'contabilidad.ver',
    soloRol: 'admin',
  },
]

export default function AppLayout() {
  const { usuario, logout, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [grupoAbierto, setGrupoAbierto] = useState(null)

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function puedeVer(item) {
    return (
      (!item.permiso || tienePermiso(item.permiso)) &&
      (!item.permisoAlguno || item.permisoAlguno.some(tienePermiso)) &&
      (!item.soloEmail || usuario?.email === item.soloEmail) &&
      (!item.soloRol || usuario?.roles?.includes(item.soloRol))
    )
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-logo">🏗️ Panel Galvi</div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => {
            if (item.grupo) {
              const itemsVisibles = item.items.filter(puedeVer)
              if (itemsVisibles.length === 0) return null
              const tieneRutaActiva = itemsVisibles.some((sub) => location.pathname.startsWith(sub.to))
              const abierto = grupoAbierto === item.grupo || tieneRutaActiva
              return (
                <div key={item.grupo} className="app-nav-grupo">
                  <button
                    type="button"
                    className={`app-nav-link app-nav-grupo-boton${tieneRutaActiva ? ' activo' : ''}`}
                    onClick={() => setGrupoAbierto((g) => (g === item.grupo ? null : item.grupo))}
                  >
                    <span>{item.icono}</span> {item.grupo}
                    <span className={`app-nav-grupo-flecha${abierto ? ' app-nav-grupo-flecha-abierta' : ''}`}>▾</span>
                  </button>
                  {abierto && (
                    <div className="app-nav-subitems">
                      {itemsVisibles.map((sub) => (
                        <NavLink
                          key={sub.to}
                          to={sub.to}
                          className={({ isActive }) => `app-nav-link app-nav-sublink${isActive ? ' activo' : ''}`}
                        >
                          {sub.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            if (!puedeVer(item)) return null
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `app-nav-link${isActive ? ' activo' : ''}`}
              >
                <span>{item.icono}</span> {item.label}
              </NavLink>
            )
          })}
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
