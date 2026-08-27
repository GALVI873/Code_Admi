import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { obrasAceptadas, seguimientoMateriales } from '../api/client.js'

// Espacio de trabajo de Alfredo (Gestión de Obras). Primera versión: solo
// lectura, la lista de obras que Geraldinne ya movió a "Aceptadas" — según
// la entrevista de Fase 1, desde ahí Alfredo coordina pedidos de material y
// confirma medidas antes de pasarlas a Taller. No se le muestra precio ni
// % de ganancia (información comercial, no operativa) — solo lo que él
// necesita para su parte del proceso.
const EMAIL_AUTORIZADO = 'alfredo@galvi.es'
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

// Estos dos estados de la hoja "SEG" (ver sync_obras_aceptadas.js) son los
// que todavía necesitan que Alfredo haga algo — "EN OBRA"/"FABRICACIÓN" ya
// están en marcha, no reclaman atención inmediata.
const ESTADOS_PENDIENTES = ['PEDIR MATERIAL', 'MEDIR']

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

function TarjetaObraAceptada({ presupuesto, materiales, onAbrir }) {
  const pendientes = materiales.filter((m) => ESTADOS_PENDIENTES.includes(m.estado)).length
  return (
    <div
      className="obra-card"
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(presupuesto.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir(presupuesto.id)
      }}
    >
      <div className="obra-card-titulo" title={presupuesto.obra}>{presupuesto.obra}</div>
      <div className="obra-card-cliente" title={presupuesto.cliente || ''}>{presupuesto.cliente || 'Sin cliente'}</div>
      <div className="obra-card-meta">
        <span className="badge badge-borrador">{presupuesto.carpinteria || 'Sin carpintería'}</span>
        {pendientes > 0 && (
          <span className="badge badge-rechazado">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

function TablaSeguimientoMateriales({ materiales }) {
  if (materiales.length === 0) {
    return <p className="seguimiento-ofertas-vacio">Todavía no hay seguimiento de material cargado para esta obra.</p>
  }
  return (
    <div className="tabla-scroll">
      <table className="tabla-ofertas">
        <thead>
          <tr>
            <th>Posición</th>
            <th>Material</th>
            <th>Estado</th>
            <th>Proveedor</th>
            <th>Fecha Pedido</th>
            <th>Nº Orden</th>
            <th>Fecha Estimada</th>
            <th>Comentario</th>
          </tr>
        </thead>
        <tbody>
          {materiales.map((m) => (
            <tr key={m.id}>
              <td>{m.posicion || '—'}</td>
              <td className="seguimiento-oferta-proveedor">{m.material || '—'}</td>
              <td>{m.estado || '—'}</td>
              <td>{m.proveedor || '—'}</td>
              <td>{formatoFecha(m.fecha_pedido) || '—'}</td>
              <td>{m.numero_orden || '—'}</td>
              <td>{formatoFecha(m.fecha_estimada) || '—'}</td>
              <td>{m.comentario || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DetalleObraAceptada({ presupuesto, materiales, onCerrar }) {
  useEffect(() => {
    function alEscape(e) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alEscape)
    return () => window.removeEventListener('keydown', alEscape)
  }, [onCerrar])

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja modal-caja-ancha" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{presupuesto.obra}</h2>
            <p>{presupuesto.cliente || 'Sin cliente'}</p>
          </div>
          <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <dl className="modal-detalle">
          <div><dt>Nº Ppto</dt><dd>{presupuesto.numero_ppto || '—'}</dd></div>
          <div><dt>Nº Ventanas</dt><dd>{presupuesto.no_ventanas ?? '—'}</dd></div>
          <div><dt>Carpintería</dt><dd>{presupuesto.carpinteria || '—'}</dd></div>
          <div><dt>Proveedor</dt><dd>{presupuesto.proveedor || '—'}</dd></div>
          <div><dt>RAL / Color</dt><dd>{presupuesto.ral || '—'}</dd></div>
          <div><dt>Persiana</dt><dd>{presupuesto.persiana || '—'}</dd></div>
          <div><dt>Vidrio</dt><dd>{presupuesto.vidrio || '—'}</dd></div>
        </dl>

        <h3 className="modal-subtitulo">Seguimiento de material</h3>
        <TablaSeguimientoMateriales materiales={materiales} />
      </div>
    </div>
  )
}

export default function ObrasAceptadasPage() {
  const { usuario, accessToken } = useAuth()
  const [filas, setFilas] = useState([])
  const [materiales, setMateriales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todos')
  const [filtroContacto, setFiltroContacto] = useState('Todos')
  const [obraSeleccionadaId, setObraSeleccionadaId] = useState(null)

  useEffect(() => {
    Promise.all([obrasAceptadas(accessToken), seguimientoMateriales(accessToken)])
      .then(([datosObras, datosMateriales]) => {
        setFilas(datosObras.obras)
        setMateriales(datosMateriales.materiales || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  // Agrupado por nombre de obra para cruzarlo con la ficha — mismo nombre
  // de carpeta que sube sync_obras_aceptadas.js para ambas tablas.
  const materialesPorObra = useMemo(() => {
    const mapa = new Map()
    for (const m of materiales) {
      if (!mapa.has(m.obra)) mapa.set(m.obra, [])
      mapa.get(m.obra).push(m)
    }
    return mapa
  }, [materiales])

  // Cada fila de obras_aceptadas.php ya es, por definición, una obra
  // aceptada (la tabla solo existe para eso) — a diferencia de
  // Presupuestos en Estudio/Presupuesto, acá no hay otros estatus que
  // filtrar ni agrupar.
  const aceptadas = filas

  const contactosDisponibles = useMemo(() => {
    if (filtroCategoria === 'Todos') return []
    const unicos = new Set(
      aceptadas.filter((p) => p.categoria === filtroCategoria && p.contacto).map((p) => p.contacto),
    )
    return Array.from(unicos).sort((a, b) => a.localeCompare(b, 'es'))
  }, [aceptadas, filtroCategoria])

  const filasFiltradas = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return aceptadas
      .filter((p) => !texto || p.obra?.toLowerCase().includes(texto))
      .filter((p) => filtroCategoria === 'Todos' || p.categoria === filtroCategoria)
      .filter((p) => filtroContacto === 'Todos' || p.contacto === filtroContacto)
      .sort((a, b) => (a.obra || '').localeCompare(b.obra || '', 'es'))
  }, [aceptadas, busquedaObra, filtroCategoria, filtroContacto])

  function handleCambioCategoria(valor) {
    setFiltroCategoria(valor)
    setFiltroContacto('Todos')
  }

  const obraSeleccionada = filas.find((p) => p.id === obraSeleccionadaId) || null

  if (usuario?.email !== EMAIL_AUTORIZADO) {
    return (
      <div className="dashboard">
        <p className="dashboard-nota">No tienes acceso a este espacio de trabajo.</p>
      </div>
    )
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Obras Aceptadas</h1>
          <p>Obras que ya pasaron a seguimiento — datos de carpintería para pedidos y fabricación</p>
        </div>
      </header>

      {!cargando && !error && aceptadas.length > 0 && (
        <div className="filtro-tabla">
          <div className="filtro-campo">
            <label htmlFor="filtro-obra">Obra</label>
            <input
              id="filtro-obra"
              type="text"
              className="input-filtro"
              placeholder="Filtrar por obra…"
              value={busquedaObra}
              onChange={(e) => setBusquedaObra(e.target.value)}
            />
          </div>
          <div className="filtro-campo">
            <label htmlFor="filtro-categoria">Tipo de Cliente</label>
            <select
              id="filtro-categoria"
              className="select-inline"
              value={filtroCategoria}
              onChange={(e) => handleCambioCategoria(e.target.value)}
            >
              <option value="Todos">Todos</option>
              {CATEGORIAS_CLIENTE.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <div className="filtro-campo">
            <label htmlFor="filtro-contacto">Cliente</label>
            <select
              id="filtro-contacto"
              className="select-inline"
              value={filtroContacto}
              onChange={(e) => setFiltroContacto(e.target.value)}
              disabled={filtroCategoria === 'Todos' || contactosDisponibles.length === 0}
            >
              <option value="Todos">Todos</option>
              {contactosDisponibles.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <span className="filtro-contador">
            {filasFiltradas.length} de {aceptadas.length}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}
      {!cargando && !error && aceptadas.length === 0 && (
        <p className="dashboard-nota">Todavía no hay ninguna obra aceptada.</p>
      )}
      {!cargando && !error && aceptadas.length > 0 && filasFiltradas.length === 0 && (
        <p className="dashboard-nota">Ninguna obra coincide con los filtros aplicados.</p>
      )}

      {!cargando && !error && filasFiltradas.length > 0 && (
        <div className="obras-grid">
          {filasFiltradas.map((p) => (
            <TarjetaObraAceptada
              key={p.id}
              presupuesto={p}
              materiales={materialesPorObra.get(p.obra) || []}
              onAbrir={setObraSeleccionadaId}
            />
          ))}
        </div>
      )}

      {obraSeleccionada && (
        <DetalleObraAceptada
          presupuesto={obraSeleccionada}
          materiales={materialesPorObra.get(obraSeleccionada.obra) || []}
          onCerrar={() => setObraSeleccionadaId(null)}
        />
      )}
    </div>
  )
}
