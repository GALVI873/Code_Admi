import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio } from '../api/client.js'

function formatoMoneda(valor) {
  if (valor === null || valor === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(valor)
}

function formatoPorcentaje(valor) {
  if (valor === null || valor === undefined) return '—'
  return `${valor}%`
}

export default function PresupuestosEnEstudioPage() {
  const { accessToken } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => setFilas(data.presupuestos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Presupuestos en Estudio</h1>
          <p>Sincronizado desde Google Drive</p>
        </div>
      </header>

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {!cargando && !error && filas.length === 0 && (
        <p className="dashboard-nota">Todavía no hay presupuestos sincronizados.</p>
      )}

      {!cargando && !error && filas.length > 0 && (
        <table className="tabla-presupuestos">
          <thead>
            <tr>
              <th>Obra</th>
              <th>Cliente</th>
              <th>Estatus</th>
              <th>Nº Ventanas</th>
              <th>Precio/m²</th>
              <th>RAL</th>
              <th>Persiana</th>
              <th>Vidrio</th>
              <th>Precio último ppto.</th>
              <th>% Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr key={p.id}>
                <td>{p.obra}</td>
                <td>{p.cliente || '—'}</td>
                <td><span className="badge badge-borrador">{p.estatus}</span></td>
                <td>{p.no_ventanas ?? '—'}</td>
                <td>{formatoMoneda(p.precio_m2)}</td>
                <td>{p.ral || '—'}</td>
                <td>{p.persiana || '—'}</td>
                <td>{p.vidrio || '—'}</td>
                <td>{formatoMoneda(p.precio_ultimo_presupuesto)}</td>
                <td>{formatoPorcentaje(p.porcentaje_ganancia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
