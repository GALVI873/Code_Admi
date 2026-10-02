import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, MOCK_AUTH } from '../context/AuthContext.jsx'
import { DeshacerProvider } from '../context/DeshacerContext.jsx'

// Menú organizado por departamento a pedido de Álvaro — un ítem plano
// sigue siendo un ítem plano ({to, label, icono, permiso}), pero un
// departamento con más de una vista adentro es un grupo desplegable
// ({grupo, icono, items:[{to, label, permiso}]}). Cada módulo nuevo agrega
// su entrada acá (suelto o dentro de un grupo existente) cuando se
// construya — el filtro por permiso ya queda listo para cualquiera de los
// dos casos.
const NAV_ITEMS = [
  // Inicio para todos (Gantt semanal de montaje) — a pedido de Álvaro,
  // 2026-09-29, ver InicioPage.jsx. Sin permiso: cualquier usuario logueado.
  { to: '/inicio', label: 'Inicio', icono: '🏠' },
  // Antes había una segunda entrada "Presupuestos" (plural) apuntando a
  // /presupuestos-en-estudio, la vista original de admin — cuando se le dio
  // acceso a Álvaro a esta página (Orden del día / General, antes exclusiva
  // de Geraldinne) terminaron conviviendo dos ítems casi idénticos en su
  // menú ("Presupuestos" / "Presupuesto") y generaba confusión sobre cuál
  // era cuál. Se sacó esa entrada del menú a pedido de Álvaro — la página
  // /presupuestos-en-estudio sigue existiendo en el código por si hace
  // falta recuperarla, pero ya no es alcanzable desde la navegación (el
  // control de prioridad Alta que solo vivía ahí ahora también está acá,
  // ver SeguimientoPage.jsx). Es una vista completa en sí misma (Orden del
  // día / General), pensada originalmente para Geraldinne pero ahora
  // también accesible para admin — cualquiera con ver_todos O
  // ver_seguimiento entra. Dentro de la página, los campos que son de
  // trabajo operativo de ella (fecha límite de entrega, gestión de ofertas
  // a proveedor) siguen siendo de solo lectura para quien no tenga
  // ver_seguimiento específicamente — ver SeguimientoPage.jsx.
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
      // Cronograma + Gantt de montaje (reemplaza "Seguimiento Obras" de
      // Notion, a pedido de Álvaro 2026-09-29) — solo admin edita, ver
      // public/api/planificacion.php.
      { to: '/planificacion', label: 'Planificación', permiso: 'obras.ver_aceptadas' },
      { to: '/diario-general', label: 'Diario General', permiso: 'obras.ver_diario_general' },
      { to: '/pendientes', label: 'Notas', permiso: 'obras.ver_aceptadas' },
      // Obras en fase de finalización (PrioridadesPage.jsx) — antes suelto y
      // solo admin; a pedido de Álvaro (2026-10-01) pasa acá debajo de Notas
      // para que también lo use Alfredo (puede editar igual que admin, ver
      // prioridades.php).
      { to: '/prioridades', label: 'Prioridades', permiso: 'obras.ver_aceptadas' },
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
  // Costo del presupuesto vs gasto real (PAF.xlsx) — exclusivo de admin, a
  // pedido de Álvaro (2026-09-15). soloRol en vez de un permiso nuevo: es
  // información financiera sensible, no tiene sentido otorgársela a otro
  // rol sin decidirlo a propósito (ver costes_obra.php).
  {
    to: '/costes',
    label: 'Costes',
    icono: '📊',
    soloRol: 'admin',
  },
]

export default function AppLayout() {
  const { usuario, logout, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [grupoAbierto, setGrupoAbierto] = useState(null)
  // Tablet/teléfono (a pedido de Álvaro, 2026-10-02): el menú lateral se
  // esconde y se abre con ☰ (ver .app-barra-movil en global.css); se cierra
  // solo al navegar a otra página.
  const [menuAbierto, setMenuAbierto] = useState(false)
  useEffect(() => { setMenuAbierto(false) }, [location.pathname])

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
    <div className={`app-shell${menuAbierto ? ' app-menu-abierto' : ''}`}>
      <div className="app-barra-movil">
        <button type="button" className="app-boton-menu" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú">☰</button>
        <span className="app-barra-movil-titulo">🏗️ Panel Galvi</span>
      </div>
      {menuAbierto && <div className="app-menu-fondo" onClick={() => setMenuAbierto(false)} />}
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
        <DeshacerProvider>
          <Outlet />
        </DeshacerProvider>
      </main>
    </div>
  )
}
