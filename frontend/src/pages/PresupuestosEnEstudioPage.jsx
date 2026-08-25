import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio, actualizarPresupuestoEnEstudio } from '../api/client.js'

const ESTATUS_OPCIONES = ['En Estudio', 'Seguimiento', 'Aceptado', 'Descartado']

const CLASE_ESTATUS = {
  'En Estudio': 'select-estatus-en-estudio',
  Seguimiento: 'select-estatus-seguimiento',
  Aceptado: 'select-estatus-aceptado',
  Descartado: 'select-estatus-descartado',
}

const CLASE_PRIORIDAD = {
  Alta: 'select-prioridad-alta',
  Normal: 'select-prioridad-normal',
}

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

function SelectEstatus({ presupuesto, onCambio }) {
  return (
    <select
      className={`select-inline select-estatus ${CLASE_ESTATUS[presupuesto.estatus] || ''}`}
      value={presupuesto.estatus}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambio(presupuesto.id, { estatus: e.target.value })}
    >
      {ESTATUS_OPCIONES.map((op) => (
        <option key={op} value={op}>{op}</option>
      ))}
    </select>
  )
}

function SelectPrioridad({ presupuesto, onCambio, puedeCambiar }) {
  if (!puedeCambiar) {
    return (
      <span className={`badge ${presupuesto.prioridad === 'Alta' ? 'badge-rechazado' : 'badge-borrador'}`}>
        {presupuesto.prioridad}
      </span>
    )
  }
  return (
    <select
      className={`select-inline select-prioridad ${CLASE_PRIORIDAD[presupuesto.prioridad] || ''}`}
      value={presupuesto.prioridad}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambio(presupuesto.id, { prioridad: e.target.value })}
    >
      <option value="Normal">Normal</option>
      <option value="Alta">Alta</option>
    </select>
  )
}

function TarjetaObra({ presupuesto, onAbrir, onCambio, puedeCambiarPrioridad }) {
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
        <SelectEstatus presupuesto={presupuesto} onCambio={onCambio} />
        <SelectPrioridad presupuesto={presupuesto} onCambio={onCambio} puedeCambiar={puedeCambiarPrioridad} />
      </div>
    </div>
  )
}

function DetalleObra({ presupuesto, onCerrar, onCambio, puedeCambiarPrioridad }) {
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

        <div className="modal-meta">
          <div className="modal-campo">
            <span>Estatus</span>
            <SelectEstatus presupuesto={presupuesto} onCambio={onCambio} />
          </div>
          <div className="modal-campo">
            <span>Prioridad</span>
            <SelectPrioridad presupuesto={presupuesto} onCambio={onCambio} puedeCambiar={puedeCambiarPrioridad} />
          </div>
        </div>

        <dl className="modal-detalle">
          <div><dt>Nº Ventanas</dt><dd>{presupuesto.no_ventanas ?? '—'}</dd></div>
          <div><dt>Precio/m²</dt><dd>{formatoMoneda(presupuesto.precio_m2)}</dd></div>
          <div><dt>RAL / Color</dt><dd>{presupuesto.ral || '—'}</dd></div>
          <div><dt>Persiana</dt><dd>{presupuesto.persiana || '—'}</dd></div>
          <div><dt>Vidrio</dt><dd>{presupuesto.vidrio || '—'}</dd></div>
          <div><dt>Precio último ppto.</dt><dd>{formatoMoneda(presupuesto.precio_ultimo_presupuesto)}</dd></div>
          <div><dt>% Ganancia</dt><dd>{formatoPorcentaje(presupuesto.porcentaje_ganancia)}</dd></div>
          <div><dt>Fecha último envío</dt><dd>{formatoFecha(presupuesto.fecha_ultimo_envio)}</dd></div>
        </dl>
      </div>
    </div>
  )
}

export default function PresupuestosEnEstudioPage() {
  const { accessToken, tienePermiso } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [filtroEstatus, setFiltroEstatus] = useState('Todos')
  const [obraSeleccionadaId, setObraSeleccionadaId] = useState(null)
  const puedeCambiarPrioridad = tienePermiso('presupuestos.gestionar_prioridad')

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => setFilas(data.presupuestos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  // "Todos" muestra los presupuestos vivos (todo menos Descartado) — las
  // descartadas solo aparecen si se filtra explícitamente por ese estatus,
  // para que la vista por defecto no se llene de obras viejas ya cerradas.
  const filasSegunEstatus = useMemo(
    () => filas.filter((p) => (filtroEstatus === 'Todos' ? p.estatus !== 'Descartado' : p.estatus === filtroEstatus)),
    [filas, filtroEstatus],
  )

  const filasFiltradas = useMemo(() => {
    const terminoObra = busquedaObra.trim().toLowerCase()
    const terminoCliente = busquedaCliente.trim().toLowerCase()
    return filasSegunEstatus
      .filter((p) => !terminoObra || p.obra?.toLowerCase().includes(terminoObra))
      .filter((p) => !terminoCliente || p.cliente?.toLowerCase().includes(terminoCliente))
      .sort((a, b) => (a.obra || '').localeCompare(b.obra || '', 'es'))
  }, [filasSegunEstatus, busquedaObra, busquedaCliente])

  // Agrupadas por estatus (en el orden En Estudio -> Seguimiento -> Aceptado)
  // para que el grid tenga secciones claras en vez de una sola pared de
  // tarjetas. Al filtrar por un estatus puntual no hace falta el
  // agrupamiento: ya es un solo grupo.
  const gruposVisibles = useMemo(() => {
    if (filtroEstatus !== 'Todos') return [{ estatus: filtroEstatus, items: filasFiltradas }]
    return ESTATUS_OPCIONES.filter((e) => e !== 'Descartado')
      .map((estatus) => ({ estatus, items: filasFiltradas.filter((p) => p.estatus === estatus) }))
      .filter((g) => g.items.length > 0)
  }, [filasFiltradas, filtroEstatus])

  const obraSeleccionada = filas.find((p) => p.id === obraSeleccionadaId) || null

  async function handleCambio(id, cambios) {
    const anteriores = filas
    setFilas((f) => f.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
    try {
      await actualizarPresupuestoEnEstudio(accessToken, id, cambios)
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
            <label htmlFor="filtro-cliente">Cliente</label>
            <input
              id="filtro-cliente"
              type="text"
              className="input-filtro"
              placeholder="Filtrar por cliente…"
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
            />
          </div>
          <div className="filtro-campo">
            <label htmlFor="filtro-estatus">Estatus</label>
            <select
              id="filtro-estatus"
              className="select-inline"
              value={filtroEstatus}
              onChange={(e) => setFiltroEstatus(e.target.value)}
            >
              <option value="Todos">Todos (activos)</option>
              {ESTATUS_OPCIONES.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <span className="filtro-contador">
            {filasFiltradas.length} de {filasSegunEstatus.length}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {!cargando && !error && filas.length === 0 && (
        <p className="dashboard-nota">Todavía no hay presupuestos sincronizados.</p>
      )}

      {!cargando && !error && filas.length > 0 && (
        <>
          {gruposVisibles.map((grupo) => (
            <section key={grupo.estatus} className="obras-seccion">
              {filtroEstatus === 'Todos' && (
                <h2 className={`obras-seccion-titulo ${CLASE_ESTATUS[grupo.estatus] || ''}`}>
                  {grupo.estatus}
                  <span className="obras-seccion-contador">{grupo.items.length}</span>
                </h2>
              )}
              <div className="obras-grid">
                {grupo.items.map((p) => (
                  <TarjetaObra
                    key={p.id}
                    presupuesto={p}
                    onAbrir={setObraSeleccionadaId}
                    onCambio={handleCambio}
                    puedeCambiarPrioridad={puedeCambiarPrioridad}
                  />
                ))}
              </div>
            </section>
          ))}
          {filasFiltradas.length === 0 && (
            <p className="dashboard-nota">Ningún presupuesto coincide con los filtros aplicados.</p>
          )}
        </>
      )}

      {obraSeleccionada && (
        <DetalleObra
          presupuesto={obraSeleccionada}
          onCerrar={() => setObraSeleccionadaId(null)}
          onCambio={handleCambio}
          puedeCambiarPrioridad={puedeCambiarPrioridad}
        />
      )}
    </div>
  )
}
