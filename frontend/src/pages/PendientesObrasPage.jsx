import { useEffect, useMemo, useRef, useState } from 'react'
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

// Filtro de obra por selección múltiple — un botón que abre un panel de
// checkboxes (una obra puede tener muchas notas, y con muchas obras
// activas a la vez conviene poder mirar solo un subconjunto). Ninguna
// seleccionada = sin filtro, se ven todas.
function FiltroObrasMultiple({ obrasDisponibles, seleccionadas, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function alClickAfuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alClickAfuera)
    return () => document.removeEventListener('mousedown', alClickAfuera)
  }, [])

  function alternar(obra) {
    const yaEsta = seleccionadas.includes(obra)
    onCambiar(yaEsta ? seleccionadas.filter((o) => o !== obra) : [...seleccionadas, obra])
  }

  const etiqueta =
    seleccionadas.length === 0
      ? 'Todas las obras'
      : seleccionadas.length === 1
        ? seleccionadas[0]
        : `${seleccionadas.length} obras seleccionadas`

  return (
    <div className="filtro-obras" ref={ref}>
      <button type="button" className="filtro-obras-boton" onClick={() => setAbierto((a) => !a)}>
        {etiqueta} <span className="filtro-obras-flecha">▾</span>
      </button>
      {abierto && (
        <div className="filtro-obras-panel">
          <div className="filtro-obras-acciones">
            <button type="button" onClick={() => onCambiar([])}>Ver todas</button>
          </div>
          <ul className="filtro-obras-lista">
            {obrasDisponibles.map((obra) => (
              <li key={obra}>
                <label className="filtro-obras-item">
                  <input
                    type="checkbox"
                    checked={seleccionadas.includes(obra)}
                    onChange={() => alternar(obra)}
                  />
                  {obra}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function PendientesObrasPage() {
  const { accessToken, usuario } = useAuth()
  const navigate = useNavigate()
  const puedeMarcarHecho = usuario?.roles?.includes('gestion_obras')

  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [obrasFiltradas, setObrasFiltradas] = useState([])

  useEffect(() => {
    pendientesObrasAceptadas(accessToken)
      .then((data) => setPendientes(data.comentarios || []))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const obrasDisponibles = useMemo(() => {
    return Array.from(new Set(pendientes.map((p) => p.obra))).sort((a, b) => a.localeCompare(b, 'es'))
  }, [pendientes])

  const gruposPorObra = useMemo(() => {
    const visibles = obrasFiltradas.length === 0 ? pendientes : pendientes.filter((p) => obrasFiltradas.includes(p.obra))
    const mapa = new Map()
    for (const p of visibles) {
      if (!mapa.has(p.obra)) mapa.set(p.obra, [])
      mapa.get(p.obra).push(p)
    }
    return Array.from(mapa.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([obra, items]) => ({ obra, items }))
  }, [pendientes, obrasFiltradas])

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

      {!cargando && !error && pendientes.length > 0 && (
        <div className="filtro-tabla">
          <div className="filtro-campo">
            <label>Obra</label>
            <FiltroObrasMultiple
              obrasDisponibles={obrasDisponibles}
              seleccionadas={obrasFiltradas}
              onCambiar={setObrasFiltradas}
            />
          </div>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}
      {!cargando && !error && pendientes.length === 0 && (
        <p className="dashboard-nota">No hay pendientes — está todo al día.</p>
      )}
      {!cargando && !error && pendientes.length > 0 && gruposPorObra.length === 0 && (
        <p className="dashboard-nota">Ninguna obra seleccionada tiene pendientes.</p>
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
                  onClick={() => navigate(`/obras-aceptadas/${n.obra_id}?pestana=Notas`)}
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
