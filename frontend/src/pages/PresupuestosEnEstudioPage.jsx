import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio, actualizarPrioridad } from '../api/client.js'

function formatoMoneda(valor) {
  if (valor === null || valor === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(valor)
}

function formatoPorcentaje(valor) {
  if (valor === null || valor === undefined) return '—'
  return `${valor}%`
}

function formatoFecha(iso) {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

export default function PresupuestosEnEstudioPage() {
  const { accessToken, tienePermiso } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const puedeCambiarPrioridad = tienePermiso('presupuestos.gestionar_prioridad')

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => setFilas(data.presupuestos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const filasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()
    if (!termino) return filas
    return filas.filter(
      (p) =>
        p.obra?.toLowerCase().includes(termino) ||
        p.cliente?.toLowerCase().includes(termino),
    )
  }, [filas, busqueda])

  async function handlePrioridadChange(id, prioridad) {
    const anteriores = filas
    setFilas((f) => f.map((p) => (p.id === id ? { ...p, prioridad } : p)))
    try {
      await actualizarPrioridad(accessToken, id, prioridad)
    } catch (err) {
      setFilas(anteriores)
      setError(err.message)
    }
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Presupuestos en Estudio</h1>
          <p>Sincronizado desde Google Drive</p>
        </div>
      </header>

      {!cargando && !error && filas.length > 0 && (
        <div className="filtro-tabla">
          <input
            type="text"
            className="input-filtro"
            placeholder="Filtrar por obra o cliente…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <span className="filtro-contador">
            {filasFiltradas.length} de {filas.length}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {!cargando && !error && filas.length === 0 && (
        <p className="dashboard-nota">Todavía no hay presupuestos sincronizados.</p>
      )}

      {!cargando && !error && filas.length > 0 && (
        <div className="tabla-scroll">
          <table className="tabla-presupuestos tabla-presupuestos-ancha">
            <thead>
              <tr>
                <th>Obra</th>
                <th>Cliente</th>
                <th>Estatus</th>
                <th>Prioridad</th>
                <th>Nº Ventanas</th>
                <th>Precio/m²</th>
                <th>RAL / Color</th>
                <th>Persiana</th>
                <th>Vidrio</th>
                <th>Precio último ppto.</th>
                <th>% Ganancia</th>
                <th>Fecha último envío</th>
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.map((p) => (
                <tr key={p.id}>
                  <td>{p.obra}</td>
                  <td>{p.cliente || '—'}</td>
                  <td><span className="badge badge-borrador">{p.estatus}</span></td>
                  <td>
                    {puedeCambiarPrioridad ? (
                      <select
                        className="select-prioridad"
                        value={p.prioridad}
                        onChange={(e) => handlePrioridadChange(p.id, e.target.value)}
                      >
                        <option value="Normal">Normal</option>
                        <option value="Alta">Alta</option>
                      </select>
                    ) : (
                      <span className={`badge ${p.prioridad === 'Alta' ? 'badge-rechazado' : 'badge-borrador'}`}>
                        {p.prioridad}
                      </span>
                    )}
                  </td>
                  <td>{p.no_ventanas ?? '—'}</td>
                  <td>{formatoMoneda(p.precio_m2)}</td>
                  <td>{p.ral || '—'}</td>
                  <td>{p.persiana || '—'}</td>
                  <td>{p.vidrio || '—'}</td>
                  <td>{formatoMoneda(p.precio_ultimo_presupuesto)}</td>
                  <td>{formatoPorcentaje(p.porcentaje_ganancia)}</td>
                  <td>{formatoFecha(p.fecha_ultimo_envio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filasFiltradas.length === 0 && (
            <p className="dashboard-nota">Ningún presupuesto coincide con "{busqueda}".</p>
          )}
        </div>
      )}
    </div>
  )
}
