import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio } from '../api/client.js'

// Espacio de trabajo de Alfredo (Gestión de Obras). Primera versión: solo
// lectura, la lista de obras que Geraldinne ya movió a "Aceptadas" — según
// la entrevista de Fase 1, desde ahí Alfredo coordina pedidos de material y
// confirma medidas antes de pasarlas a Taller. No se le muestra precio ni
// % de ganancia (información comercial, no operativa) — solo lo que él
// necesita para su parte del proceso.
const EMAIL_AUTORIZADO = 'alfredo@galvi.es'
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

function TarjetaObraAceptada({ presupuesto, onAbrir }) {
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
      </div>
    </div>
  )
}

function DetalleObraAceptada({ presupuesto, onCerrar }) {
  useEffect(() => {
    function alEscape(e) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alEscape)
    return () => window.removeEventListener('keydown', alEscape)
  }, [onCerrar])

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  )
}

export default function ObrasAceptadasPage() {
  const { usuario, accessToken } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todos')
  const [filtroContacto, setFiltroContacto] = useState('Todos')
  const [obraSeleccionadaId, setObraSeleccionadaId] = useState(null)

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => setFilas(data.presupuestos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  // Esta vista es exclusivamente las obras ya aceptadas — a diferencia de
  // Presupuestos en Estudio/Presupuesto, acá no hay otros estatus que
  // filtrar ni agrupar, es el único que le interesa a Alfredo.
  const aceptadas = useMemo(() => filas.filter((p) => p.estatus === 'Aceptado'), [filas])

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
            <TarjetaObraAceptada key={p.id} presupuesto={p} onAbrir={setObraSeleccionadaId} />
          ))}
        </div>
      )}

      {obraSeleccionada && (
        <DetalleObraAceptada presupuesto={obraSeleccionada} onCerrar={() => setObraSeleccionadaId(null)} />
      )}
    </div>
  )
}
