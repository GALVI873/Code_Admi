import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AppLayout from './components/AppLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import PresupuestosEnEstudioPage from './pages/PresupuestosEnEstudioPage.jsx'
import SeguimientoPage from './pages/SeguimientoPage.jsx'
import ObrasAceptadasPage from './pages/ObrasAceptadasPage.jsx'
import DiarioGeneralPage from './pages/DiarioGeneralPage.jsx'

// No hay una sola "página principal" para todos: cada perfil tiene acceso a
// una vista distinta (Presupuestos en Estudio para admin, Presupuesto para
// Geraldinne, Obras Aceptadas para Alfredo), así que "/" manda a la primera
// a la que el usuario logueado realmente tenga acceso, en vez de una ruta fija.
function InicioRedirect() {
  const { usuario, tienePermiso } = useAuth()
  if (tienePermiso('presupuestos.ver_todos')) return <Navigate to="/presupuestos-en-estudio" replace />
  if (tienePermiso('presupuestos.ver_seguimiento')) return <Navigate to="/seguimiento" replace />
  if (tienePermiso('obras.ver_aceptadas')) return <Navigate to="/obras-aceptadas" replace />
  return (
    <div className="dashboard">
      <p className="dashboard-nota">Tu usuario ({usuario?.email}) no tiene acceso a ninguna vista todavía.</p>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<InicioRedirect />} />
            <Route path="/presupuestos-en-estudio" element={<PresupuestosEnEstudioPage />} />
            <Route path="/seguimiento" element={<SeguimientoPage />} />
            <Route path="/obras-aceptadas" element={<ObrasAceptadasPage />} />
            <Route path="/diario-general" element={<DiarioGeneralPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}
