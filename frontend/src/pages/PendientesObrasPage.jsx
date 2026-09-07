import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { pendientesObrasAceptadas, marcarComentarioHecho } from '../api/client.js'

// Control general de pendientes para Alfredo — junta, de TODAS las obras
// aceptadas, las notas que Álvaro dejó en la pestaña "Notas" de cada obra
// y que todavía no se marcaron como "Hecho" (ver comentarios_obra.php,
// acción ?pendientes=1). Antes tenía que entrar obra por obra a buscar qué
// le habían dejado; acá lo ve todo junto, agrupado por obra, mismo patrón
// visual que Diario General. Se puede tildar directo desde acá (mismo
// PATCH que en la pestaña Notas) — desaparece de la lista al toque, ya no
// está pendiente.
function formatoFechaHora(iso) {
  if (!iso) return ''
  const fecha = new Date(iso.replace(' ', 'T') + 'Z')
  const dia = String(fecha.getDate()).padStart(2, '0')
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const horas = String(fecha.getHours()).padStart(2, '0')
  const minutos = String(fecha.getMinutes()).padStart(2, '0')
  return `${dia}/${mes}/${fecha.getFullYear()} ${horas}:${minutos}`
}

export default function PendientesObrasPage() {
  const { accessToken, usuario } = useAuth()
  const navigate = useNavigate()
  const puedeMarcarHecho = usuario?.roles?.includes('gestion_obras')

  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    pendientesObrasAceptadas(accessToken)
      .then((data) => setPendientes(data.comentarios || []))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const gruposPorObra = useMemo(() => {
    const mapa = new Map()
    for (const p of pendientes) {
      if (!mapa.has(p.obra)) mapa.set(p.obra, [])
      mapa.get(p.obra).push(p)
    }
    return Array.from(mapa.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([obra, items]) => ({ obra, items }))
  }, [pendientes])

  async function handleMarcarHecho(nota) {
    if (!puedeMarcarHecho) return
    const anteriores = pendientes
    setPendientes((prev) => prev.filter((n) => n.id !== nota.id))
    try {
      await marcarComentarioHecho(accessToken, nota.id, 1)
    } catch (err) {
      setPendientes(anteriores)
      setError(err.message)
    }
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Pendientes</h1>
          <p>Notas que Álvaro dejó en Obras Aceptadas, juntas de todas las obras — se van sacando de acá a medida que se marcan como hechas.</p>
        </div>
      </header>

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}
      {!cargando && !error && pendientes.length === 0 && (
        <p className="dashboard-nota">No hay pendientes — está todo al día.</p>
      )}

      {!cargando && !error && gruposPorObra.map((grupo) => (
        <section key={grupo.obra} className="obras-seccion">
          <h2 className="obras-seccion-titulo">
            {grupo.obra}
            <span className="obras-seccion-contador">{grupo.items.length}</span>
          </h2>
          <ul className="notas-obra-lista">
            {grupo.items.map((n) => (
              <li key={n.id} className="notas-obra-item">
                <input
                  type="checkbox"
                  className="notas-obra-checkbox"
                  checked={false}
                  disabled={!puedeMarcarHecho}
                  onChange={() => handleMarcarHecho(n)}
                  title={puedeMarcarHecho ? 'Marcar como hecho' : 'Solo Alfredo puede marcar esto como hecho'}
                />
                <div
                  className="notas-obra-item-cuerpo"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/obras-aceptadas/${n.obra_id}`)}
                >
                  <p className="notas-obra-item-texto">{n.mensaje}</p>
                  <span className="notas-obra-item-meta">{n.autor_nombre} · {formatoFechaHora(n.creado_en)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
