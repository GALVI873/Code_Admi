import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AppLayout from './components/AppLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import PresupuestosEnEstudioPage from './pages/PresupuestosEnEstudioPage.jsx'
import SeguimientoPage from './pages/SeguimientoPage.jsx'
import ObrasAceptadasPage from './pages/ObrasAceptadasPage.jsx'
import DiarioGeneralPage from './pages/DiarioGeneralPage.jsx'
import PendientesObrasPage from './pages/PendientesObrasPage.jsx'
import ContabilidadPage from './pages/ContabilidadPage.jsx'
import CostesObraPage from './pages/CostesObraPage.jsx'
import InicioPage from './pages/InicioPage.jsx'
import PlanificacionPage from './pages/PlanificacionPage.jsx'

// "/" manda a Inicio (InicioPage.jsx) para todos — a pedido de Álvaro,
// 2026-09-29: una página común con el Gantt semanal de montaje que puede ver
// cualquier usuario logueado. Antes cada perfil caía en su propia vista
// (Presupuesto para admin/Geraldinne, Obras Aceptadas para Alfredo); esas
// siguen en el menú como siempre.
// "presupuestos-en-estudio" ya no es el destino de nadie: se sacó del menú
// (ver AppLayout.jsx) porque duplicaba a "seguimiento" para admin.
function InicioRedirect() {
  return <Navigate to="/inicio" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<InicioRedirect />} />
            <Route path="/inicio" element={<InicioPage />} />
            <Route path="/planificacion" element={<PlanificacionPage />} />
            <Route path="/presupuestos-en-estudio" element={<PresupuestosEnEstudioPage />} />
            <Route path="/seguimiento" element={<SeguimientoPage />} />
            <Route path="/obras-aceptadas" element={<ObrasAceptadasPage />} />
            <Route path="/obras-aceptadas/:id" element={<ObrasAceptadasPage />} />
            <Route path="/pendientes" element={<PendientesObrasPage />} />
            <Route path="/diario-general" element={<DiarioGeneralPage />} />
            <Route path="/contabilidad" element={<ContabilidadPage />} />
            <Route path="/costes" element={<CostesObraPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}
