import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AppLayout from './components/AppLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import PresupuestosPage from './pages/PresupuestosPage.jsx'
import PresupuestosEnEstudioPage from './pages/PresupuestosEnEstudioPage.jsx'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/presupuestos" replace />} />
            <Route path="/presupuestos" element={<PresupuestosPage />} />
            <Route path="/presupuestos-en-estudio" element={<PresupuestosEnEstudioPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}
