import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { adicionalesObra, agregarAdicionalObra, eliminarAdicionalObra } from '../api/client.js'

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Adicionales de obra: trabajo extra que un cliente pide sobre una obra ya
// aceptada — Geraldinne (o Álvaro) lo carga a mano acá, no viene de ninguna
// sincronización. "Nombre" es un desplegable de las obras aceptadas
// (obras_disponibles, ver adicionales_obra.php); en cuanto se elige una,
// "Cliente" se completa solo (siempre el mismo que tiene esa obra aceptada,
// no se puede escribir a mano) — el resto son campos de texto libre.
export default function AdicionalesDeObra() {
  const { accessToken } = useAuth()
  const [adicionales, setAdicionales] = useState([])
  const [obrasDisponibles, setObrasDisponibles] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [obra, setObra] = useState('')
  const [fechaSolicitud, setFechaSolicitud] = useState('')
  const [detalle, setDetalle] = useState('')
  const [solicitadoPor, setSolicitadoPor] = useState('')

  useEffect(() => {
    adicionalesObra(accessToken)
      .then((data) => {
        setAdicionales(data.adicionales || [])
        setObrasDisponibles(data.obras_disponibles || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const clienteDeObraSeleccionada = useMemo(
    () => obrasDisponibles.find((o) => o.obra === obra)?.cliente || '',
    [obrasDisponibles, obra],
  )

  async function enviar(e) {
    e.preventDefault()
    if (!obra || !detalle.trim() || guardando) return
    setGuardando(true)
    setError('')
    try {
      const { adicional } = await agregarAdicionalObra(accessToken, {
        obra,
        fecha_solicitud: fechaSolicitud,
        detalle: detalle.trim(),
        solicitado_por: solicitadoPor.trim(),
      })
      setAdicionales((prev) => [adicional, ...prev])
      setObra('')
      setFechaSolicitud('')
      setDetalle('')
      setSolicitadoPor('')
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  async function handleEliminar(id) {
    if (!window.confirm('¿Eliminar este adicional? No se puede deshacer.')) return
    const anteriores = adicionales
    setAdicionales((prev) => prev.filter((a) => a.id !== id))
    try {
      await eliminarAdicionalObra(accessToken, id)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  return (
    <div className="adicionales-obra">
      <form className="adicionales-obra-form" onSubmit={enviar}>
        <div className="filtro-campo">
          <label htmlFor="adicional-obra">Nombre</label>
          <select
            id="adicional-obra"
            className="select-inline"
            value={obra}
            onChange={(e) => setObra(e.target.value)}
          >
            <option value="">Seleccionar obra aceptada…</option>
            {obrasDisponibles.map((o) => (
              <option key={o.obra} value={o.obra}>{o.obra}</option>
            ))}
          </select>
        </div>
        <div className="filtro-campo">
          <label>Cliente</label>
          <span className="adicionales-obra-cliente-derivado">{clienteDeObraSeleccionada || '—'}</span>
        </div>
        <div className="filtro-campo">
          <label htmlFor="adicional-fecha">Fecha de solicitud</label>
          <input
            id="adicional-fecha"
            type="date"
            className="input-filtro input-fecha-limite"
            value={fechaSolicitud}
            onChange={(e) => setFechaSolicitud(e.target.value)}
          />
        </div>
        <div className="filtro-campo">
          <label htmlFor="adicional-solicitado-por">Quién lo solicitó</label>
          <input
            id="adicional-solicitado-por"
            type="text"
            className="input-filtro"
            placeholder="Nombre de quien lo pidió…"
            value={solicitadoPor}
            onChange={(e) => setSolicitadoPor(e.target.value)}
          />
        </div>
        <div className="filtro-campo adicionales-obra-campo-detalle">
          <label htmlFor="adicional-detalle">Detalle</label>
          <textarea
            id="adicional-detalle"
            className="input-filtro"
            rows={2}
            placeholder="Descripción del adicional…"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="adicionales-obra-boton-agregar"
          disabled={guardando || !obra || !detalle.trim()}
        >
          Agregar
        </button>
      </form>

      {error && <div className="auth-error">{error}</div>}
      {cargando && <p className="dashboard-nota">Cargando…</p>}

      {!cargando && adicionales.length === 0 && (
        <p className="dashboard-nota">Todavía no se cargó ningún adicional.</p>
      )}

      {!cargando && adicionales.length > 0 && (
        <div className="tabla-scroll">
          <table className="tabla-adicionales">
            <thead>
              <tr>
                <th>Obra</th>
                <th>Cliente</th>
                <th>Fecha solicitud</th>
                <th>Detalle</th>
                <th>Solicitado por</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {adicionales.map((a) => (
                <tr key={a.id}>
                  <td className="adicionales-obra-col-obra">{a.obra}</td>
                  <td>{a.obra_cliente || 'Sin cliente'}</td>
                  <td>{formatoFecha(a.fecha_solicitud) || '—'}</td>
                  <td className="adicionales-obra-col-detalle">{a.detalle}</td>
                  <td>{a.solicitado_por || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="boton-icono boton-icono-eliminar"
                      title="Eliminar este adicional"
                      onClick={() => handleEliminar(a.id)}
                    >
                      −
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
