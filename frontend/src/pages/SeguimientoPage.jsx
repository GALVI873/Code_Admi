import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio, actualizarPresupuestoEnEstudio } from '../api/client.js'

// Espacio de trabajo personal de Geraldinne. Nunca muestra Descartadas —a
// diferencia de Presupuestos en Estudio, acá ni siquiera es una opción de
// filtro, porque a ella no le interesan las obras cerradas.
const EMAIL_AUTORIZADO = 'presupuestos@galvi.es'
const ESTATUS_OPCIONES = ['En Estudio', 'En Valoración', 'En Revisión', 'Pdt Aprobación', 'Aceptado']
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

const CLASE_ESTATUS = {
  'En Estudio': 'select-estatus-en-estudio',
  'En Valoración': 'select-estatus-en-valoracion',
  'En Revisión': 'select-estatus-en-revision',
  'Pdt Aprobación': 'select-estatus-pdt-aprobacion',
  Aceptado: 'select-estatus-aceptado',
}

// "Pdt Aprobación" puesto a mano sin que exista un PDF en la carpeta
// Enviados de la obra es un estado inconsistente — igual que en
// Presupuestos en Estudio, se avisa pero no se bloquea.
function faltaEnvio(presupuesto) {
  return presupuesto.estatus === 'Pdt Aprobación' && !presupuesto.fecha_ultimo_envio
}

function InsigniaAlerta() {
  return (
    <span
      className="obra-card-insignia-alerta"
      title="Pdt Aprobación sin ningún presupuesto enviado registrado en Drive"
      onClick={(e) => e.stopPropagation()}
    >
      ⚠
    </span>
  )
}

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

function formatoMoneda(valor) {
  if (valor === null || valor === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(valor)
}

function formatoPorcentaje(valor) {
  if (valor === null || valor === undefined) return '—'
  return `${valor}%`
}

// "Solicitud" toma como fecha el día que se creó la carpeta de la obra en
// Drive — según la entrevista, así entra todo: Álvaro deja la info sin
// ordenar y Geraldinne la clasifica en la carpeta correspondiente para
// arrancar el CALCULO. No hay un campo de "solicitud" separado que registrar.
function construirPasos(p) {
  const hojaCalculoConValores = p.precio_ultimo_presupuesto != null && p.precio_m2 != null
  const fichaDiligenciada = Boolean(p.numero_ppto && p.carpinteria && p.vidrio)
  const tieneOfertas = Boolean(p.fecha_ultimo_envio)

  return [
    {
      clave: 'solicitud',
      etiqueta: 'Solicitud',
      hecho: Boolean(p.fecha_creacion_carpeta),
      fecha: formatoFecha(p.fecha_creacion_carpeta),
    },
    {
      clave: 'hoja_calculo',
      etiqueta: 'Hoja de cálculo con valores',
      hecho: hojaCalculoConValores,
      fecha: null,
    },
    {
      clave: 'ficha',
      etiqueta: 'Ficha diligenciada',
      hecho: fichaDiligenciada,
      fecha: null,
    },
    {
      // Según la entrevista: Geraldinne pide precios a varios proveedores
      // por tipo de material y arma la propuesta final con la oferta más
      // alta o más completa (margen para negociar con el cliente, no un
      // error). Un mismo presupuesto puede tener varias ofertas de
      // proveedor (una carpeta "Valoración" con varios PDF) — por eso este
      // paso es desplegable en vez de mostrar un solo dato.
      clave: 'ofertas',
      etiqueta: 'Ofertas',
      hecho: tieneOfertas,
      fecha: formatoFecha(p.fecha_ultimo_envio),
      desplegable: true,
    },
  ]
}

function ListaOfertas({ ofertas }) {
  if (ofertas.length === 0) {
    return <p className="seguimiento-ofertas-vacio">No se detectaron ofertas de proveedor en la carpeta "Valoración" de esta obra.</p>
  }
  return (
    <ul className="seguimiento-ofertas-lista">
      {ofertas.map((o) => (
        <li key={o.id} className="seguimiento-oferta-item">
          <span className="seguimiento-oferta-proveedor">{o.proveedor || 'Proveedor sin detectar'}</span>
          <span className="seguimiento-oferta-valor">{o.valor != null ? formatoMoneda(o.valor) : 'Valor sin detectar'}</span>
          <span className="seguimiento-oferta-fecha">{formatoFecha(o.fecha) || 'Sin fecha'}</span>
          <span className="seguimiento-oferta-archivo" title={o.archivo}>{o.archivo}</span>
        </li>
      ))}
    </ul>
  )
}

function LineaTiempo({ presupuesto, ofertas, ofertasAbiertas, onToggleOfertas }) {
  const pasos = construirPasos(presupuesto)

  return (
    <>
      <ol className="seguimiento-timeline">
        {pasos.map((paso, i) => (
          <li
            key={paso.clave}
            className={`seguimiento-paso ${paso.hecho ? 'seguimiento-paso-hecho' : 'seguimiento-paso-pendiente'} ${paso.desplegable ? 'seguimiento-paso-clicable' : ''}`}
            onClick={paso.desplegable ? onToggleOfertas : undefined}
            role={paso.desplegable ? 'button' : undefined}
            tabIndex={paso.desplegable ? 0 : undefined}
          >
            <div className="seguimiento-paso-punto">{paso.hecho ? '✓' : i + 1}</div>
            <div className="seguimiento-paso-texto">
              <span className="seguimiento-paso-etiqueta">
                {paso.etiqueta}
                {paso.desplegable && <span className="seguimiento-paso-flecha">{ofertasAbiertas ? ' ▲' : ' ▼'}</span>}
              </span>
              {paso.fecha && <span className="seguimiento-paso-fecha">{paso.fecha}</span>}
            </div>
          </li>
        ))}
      </ol>
      {ofertasAbiertas && (
        <div className="seguimiento-ofertas-panel">
          <ListaOfertas ofertas={ofertas} />
        </div>
      )}
    </>
  )
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

function TarjetaSeguimiento({ presupuesto, onAbrir, onCambio }) {
  const alerta = faltaEnvio(presupuesto)
  return (
    <div
      className={`obra-card ${alerta ? 'obra-card-alerta' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(presupuesto.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir(presupuesto.id)
      }}
    >
      {alerta && <InsigniaAlerta />}
      <div className="obra-card-titulo" title={presupuesto.obra}>{presupuesto.obra}</div>
      <div className="obra-card-cliente" title={presupuesto.cliente || ''}>{presupuesto.cliente || 'Sin cliente'}</div>
      <div className="obra-card-meta">
        <SelectEstatus presupuesto={presupuesto} onCambio={onCambio} />
      </div>
    </div>
  )
}

function DetalleSeguimiento({ presupuesto, ofertas, onCerrar, onCambio }) {
  const [ofertasAbiertas, setOfertasAbiertas] = useState(false)

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

        {faltaEnvio(presupuesto) && (
          <p className="modal-aviso">⚠ "Pdt Aprobación" sin ningún presupuesto enviado registrado en Drive.</p>
        )}

        <div className="modal-meta">
          <div className="modal-campo">
            <span>Estatus</span>
            <SelectEstatus presupuesto={presupuesto} onCambio={onCambio} />
          </div>
        </div>

        <LineaTiempo
          presupuesto={presupuesto}
          ofertas={ofertas}
          ofertasAbiertas={ofertasAbiertas}
          onToggleOfertas={() => setOfertasAbiertas((v) => !v)}
        />

        {!ofertasAbiertas && (
          <dl className="modal-detalle">
            <div><dt>Nº Ppto</dt><dd>{presupuesto.numero_ppto || '—'}</dd></div>
            <div><dt>Nº Ventanas</dt><dd>{presupuesto.no_ventanas ?? '—'}</dd></div>
            <div><dt>Carpintería</dt><dd>{presupuesto.carpinteria || '—'}</dd></div>
            <div><dt>Proveedor</dt><dd>{presupuesto.proveedor || '—'}</dd></div>
            <div><dt>RAL / Color</dt><dd>{presupuesto.ral || '—'}</dd></div>
            <div><dt>Persiana</dt><dd>{presupuesto.persiana || '—'}</dd></div>
            <div><dt>Vidrio</dt><dd>{presupuesto.vidrio || '—'}</dd></div>
            <div><dt>Precio/m²</dt><dd>{formatoMoneda(presupuesto.precio_m2)}</dd></div>
            <div><dt>Precio total oferta</dt><dd>{formatoMoneda(presupuesto.precio_ultimo_presupuesto)}</dd></div>
            <div><dt>% Ganancia</dt><dd>{formatoPorcentaje(presupuesto.porcentaje_ganancia)}</dd></div>
            <div><dt>Fecha solicitud</dt><dd>{formatoFecha(presupuesto.fecha_creacion_carpeta) || '—'}</dd></div>
            <div><dt>Fecha última oferta</dt><dd>{formatoFecha(presupuesto.fecha_ultimo_envio) || '—'}</dd></div>
          </dl>
        )}
      </div>
    </div>
  )
}

export default function SeguimientoPage() {
  const { usuario, accessToken } = useAuth()
  const [filas, setFilas] = useState([])
  const [ofertas, setOfertas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todos')
  const [filtroContacto, setFiltroContacto] = useState('Todos')
  const [filtroEstatus, setFiltroEstatus] = useState('Todos')
  const [obraSeleccionadaId, setObraSeleccionadaId] = useState(null)

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => {
        setFilas(data.presupuestos)
        setOfertas(data.ofertas || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  // Nunca Descartadas, sin excepción — a diferencia de Presupuestos en
  // Estudio, acá no hay forma de volver a mostrarlas.
  const filasVivas = useMemo(() => filas.filter((p) => p.estatus !== 'Descartado'), [filas])

  const contactosDisponibles = useMemo(() => {
    if (filtroCategoria === 'Todos') return []
    const unicos = new Set(
      filasVivas.filter((p) => p.categoria === filtroCategoria && p.contacto).map((p) => p.contacto),
    )
    return Array.from(unicos).sort((a, b) => a.localeCompare(b, 'es'))
  }, [filasVivas, filtroCategoria])

  const filasFiltradas = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return filasVivas
      .filter((p) => !texto || p.obra?.toLowerCase().includes(texto))
      .filter((p) => filtroCategoria === 'Todos' || p.categoria === filtroCategoria)
      .filter((p) => filtroContacto === 'Todos' || p.contacto === filtroContacto)
      .filter((p) => filtroEstatus === 'Todos' || p.estatus === filtroEstatus)
      .sort((a, b) => (a.obra || '').localeCompare(b.obra || '', 'es'))
  }, [filasVivas, busquedaObra, filtroCategoria, filtroContacto, filtroEstatus])

  function handleCambioCategoria(valor) {
    setFiltroCategoria(valor)
    setFiltroContacto('Todos')
  }

  const obraSeleccionada = filas.find((p) => p.id === obraSeleccionadaId) || null
  const ofertasDeSeleccionada = obraSeleccionada
    ? ofertas.filter((o) => o.obra === obraSeleccionada.obra)
    : []

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
          <h1>Presupuesto</h1>
          <p>Línea de tiempo por obra — desde la solicitud hasta la oferta enviada</p>
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
          <div className="filtro-campo">
            <label htmlFor="filtro-estatus">Estatus</label>
            <select
              id="filtro-estatus"
              className="select-inline"
              value={filtroEstatus}
              onChange={(e) => setFiltroEstatus(e.target.value)}
            >
              <option value="Todos">Todos</option>
              {ESTATUS_OPCIONES.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <span className="filtro-contador">
            {filasFiltradas.length} de {filasVivas.length}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}
      {!cargando && !error && filasFiltradas.length === 0 && (
        <p className="dashboard-nota">Ninguna obra coincide con los filtros aplicados.</p>
      )}

      {!cargando && !error && filasFiltradas.length > 0 && (
        <div className="obras-grid">
          {filasFiltradas.map((p) => (
            <TarjetaSeguimiento key={p.id} presupuesto={p} onAbrir={setObraSeleccionadaId} onCambio={handleCambio} />
          ))}
        </div>
      )}

      {obraSeleccionada && (
        <DetalleSeguimiento
          presupuesto={obraSeleccionada}
          ofertas={ofertasDeSeleccionada}
          onCerrar={() => setObraSeleccionadaId(null)}
          onCambio={handleCambio}
        />
      )}
    </div>
  )
}
