import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import {
  obrasAceptadas,
  seguimientoMateriales,
  confirmarCampoObraAceptada,
  quitarConfirmacionObraAceptada,
  actualizarMaterialObraAceptada,
} from '../api/client.js'

// Espacio de trabajo de Alfredo (Gestión de Obras). Primera versión: solo
// lectura, la lista de obras que Geraldinne ya movió a "Aceptadas" — según
// la entrevista de Fase 1, desde ahí Alfredo coordina pedidos de material y
// confirma medidas antes de pasarlas a Taller. No se le muestra precio ni
// % de ganancia (información comercial, no operativa) — solo lo que él
// necesita para su parte del proceso.
const EMAIL_AUTORIZADO = 'alfredo@galvi.es'
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

// Estos son los estados que todavía necesitan que Alfredo haga algo —
// "EN OBRA"/"FABRICACIÓN"/"EN BOROX" ya están en marcha, no reclaman
// atención inmediata. Lista fija: la hoja "BD" (ver
// extract_seguimiento_materiales.js) no tiene un vocabulario cerrado de
// estados, así que puede haber obras con estados que no calcen acá — se
// ajusta a medida que aparezcan casos reales.
const ESTADOS_PENDIENTES = ['PEDIR MATERIAL', 'MEDIR']

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Selector con chips y checklist — mismo patrón que el filtro de obra de
// Diario General (DiarioGeneralPage.jsx), generalizado para reusarlo acá
// con Tipo en vez de obra. Reusa las mismas clases CSS (selector-obras/
// chip-obra): son puramente visuales, no específicas de "obra".
function SelectorMultipleGenerico({ valores, seleccionados, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function alHacerClicFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alHacerClicFuera)
    return () => document.removeEventListener('mousedown', alHacerClicFuera)
  }, [])

  const filtrados = valores.filter((v) => v.toLowerCase().includes(texto.trim().toLowerCase()))

  function alternar(valor) {
    const nuevo = new Set(seleccionados)
    if (nuevo.has(valor)) nuevo.delete(valor)
    else nuevo.add(valor)
    onCambiar(nuevo)
  }

  function quitar(valor, e) {
    e.stopPropagation()
    const nuevo = new Set(seleccionados)
    nuevo.delete(valor)
    onCambiar(nuevo)
  }

  return (
    <div className="selector-obras" ref={ref}>
      <div className="selector-obras-campo" onClick={() => setAbierto(true)}>
        {[...seleccionados].map((v) => (
          <span key={v} className="chip-obra">
            {v}
            <button type="button" onClick={(e) => quitar(v, e)} aria-label={`Quitar ${v}`}>✕</button>
          </span>
        ))}
        <input
          type="text"
          className="selector-obras-input"
          placeholder={seleccionados.size === 0 ? 'Todos…' : ''}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => setAbierto(true)}
        />
      </div>
      {abierto && (
        <div className="selector-obras-lista">
          {filtrados.length === 0 && <div className="selector-obras-vacio">Sin resultados</div>}
          {filtrados.map((v) => (
            <label key={v} className="selector-obras-opcion">
              <input type="checkbox" checked={seleccionados.has(v)} onChange={() => alternar(v)} />
              {v}
            </label>
          ))}
        </div>
      )}
    </div>
  )
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
        <span className="badge badge-borrador">{presupuesto.proveedor || 'Sin proveedor'}</span>
        {pendientes > 0 && (
          <span className="badge badge-rechazado">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

// Campo de texto editable con guardado al perder el foco — usado para
// Fecha Estimada/Comentario. Estado local propio porque el valor puede
// quedar "sucio" mientras se escribe, antes de confirmar con onBlur (mismo
// patrón que otros campos editables del panel).
function CeldaEditable({ valor, tipo, placeholder, onGuardar }) {
  const [texto, setTexto] = useState(valor || '')

  useEffect(() => {
    setTexto(valor || '')
  }, [valor])

  function guardar() {
    if (texto !== (valor || '')) onGuardar(texto)
  }

  return (
    <input
      type={tipo || 'text'}
      className="input-filtro celda-editable-material"
      placeholder={placeholder}
      value={texto}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

// Estado es un desplegable cerrado (no texto libre): las opciones son los
// valores que ya existen en esta obra, más el valor actual de la fila por
// si es uno nuevo que todavía no aparece en ninguna otra.
function SelectEstadoMaterial({ valor, opciones, onCambiar }) {
  const todasLasOpciones = valor && !opciones.includes(valor) ? [...opciones, valor] : opciones
  return (
    <select
      className="select-inline celda-editable-material"
      value={valor || ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambiar(e.target.value)}
    >
      <option value="">—</option>
      {todasLasOpciones.map((op) => (
        <option key={op} value={op}>{op}</option>
      ))}
    </select>
  )
}

// Filtro estilo Excel: un ▾ en el encabezado que abre una lista de
// checkboxes con los valores distintos de esa columna — sin nada tildado
// se ve todo, como el multi-select de obra de Diario General.
function FiltroColumna({ etiqueta, valores, seleccionados, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function alHacerClicFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alHacerClicFuera)
    return () => document.removeEventListener('mousedown', alHacerClicFuera)
  }, [])

  function alternar(valor) {
    const nuevo = new Set(seleccionados)
    if (nuevo.has(valor)) nuevo.delete(valor)
    else nuevo.add(valor)
    onCambiar(nuevo)
  }

  const activo = seleccionados.size > 0

  return (
    <span className="filtro-columna" ref={ref}>
      {etiqueta}
      <button
        type="button"
        className={`filtro-columna-boton ${activo ? 'filtro-columna-boton-activo' : ''}`}
        onClick={() => setAbierto((v) => !v)}
      >
        ▾
      </button>
      {abierto && (
        <div className="filtro-columna-lista" onClick={(e) => e.stopPropagation()}>
          {valores.map((v) => (
            <label key={v} className="filtro-columna-opcion">
              <input type="checkbox" checked={seleccionados.has(v)} onChange={() => alternar(v)} />
              {v}
            </label>
          ))}
        </div>
      )}
    </span>
  )
}

function FilaMaterial({ m, estadosDisponibles, onCambiar }) {
  return (
    <tr>
      <td>{m.posicion || '—'}</td>
      <td className="seguimiento-oferta-proveedor">{m.material || '—'}</td>
      <td>{m.descripcion || '—'}</td>
      <td className="celda-confirmacion">
        <SelectEstadoMaterial valor={m.estado} opciones={estadosDisponibles} onCambiar={(v) => onCambiar(m, 'estado', v)} />
      </td>
      <td>{m.proveedor || '—'}</td>
      <td>{formatoFecha(m.fecha_pedido) || '—'}</td>
      <td>{m.numero_orden || '—'}</td>
      <td className="celda-confirmacion">
        {m.fecha_estimada ? (
          formatoFecha(m.fecha_estimada)
        ) : (
          <CeldaEditable valor="" tipo="date" onGuardar={(v) => onCambiar(m, 'fecha_estimada', v)} />
        )}
      </td>
      <td className="celda-confirmacion">
        <CeldaEditable
          valor={m.comentario}
          placeholder="Comentario…"
          onGuardar={(v) => onCambiar(m, 'comentario', v)}
        />
      </td>
    </tr>
  )
}

// Columnas con filtro estilo Excel en el encabezado — Tipo queda aparte
// (controla qué cajas se muestran, ver SeguimientoPorPosicion) porque ya es
// el agrupador visual, no tiene sentido filtrarlo desde adentro de su
// propia caja.
const COLUMNAS_FILTRABLES = [
  { campo: 'posicion', etiqueta: 'Posición', valor: (m) => m.posicion || '—' },
  { campo: 'material', etiqueta: 'Material', valor: (m) => m.material || '—' },
  { campo: 'descripcion', etiqueta: 'Descripción', valor: (m) => m.descripcion || '—' },
  { campo: 'estado', etiqueta: 'Estado', valor: (m) => m.estado || '—' },
  { campo: 'proveedor', etiqueta: 'Proveedor', valor: (m) => m.proveedor || '—' },
  { campo: 'fecha_pedido', etiqueta: 'Fecha Pedido', valor: (m) => formatoFecha(m.fecha_pedido) || '—' },
  { campo: 'numero_orden', etiqueta: 'Nº Orden', valor: (m) => m.numero_orden || '—' },
  { campo: 'fecha_estimada', etiqueta: 'Fecha Estimada', valor: (m) => formatoFecha(m.fecha_estimada) || '—' },
  { campo: 'comentario', etiqueta: 'Comentario', valor: (m) => m.comentario || '—' },
]

function agruparPorTipo(materiales) {
  const porTipo = new Map()
  for (const m of materiales) {
    const tipo = m.tipo || '(sin tipo)'
    if (!porTipo.has(tipo)) porTipo.set(tipo, [])
    porTipo.get(tipo).push(m)
  }
  return [...porTipo.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([tipo, items]) => ({ tipo, items }))
}

function pasaFiltros(m, filtros) {
  return COLUMNAS_FILTRABLES.every(({ campo, valor }) => {
    const seleccionados = filtros[campo]
    return seleccionados.size === 0 || seleccionados.has(valor(m))
  })
}

function SeguimientoPorPosicion({ materiales, onCambiarMaterial }) {
  const [tiposSeleccionados, setTiposSeleccionados] = useState(() => new Set())
  const [filtros, setFiltros] = useState(() =>
    Object.fromEntries(COLUMNAS_FILTRABLES.map(({ campo }) => [campo, new Set()])),
  )

  const estadosDisponibles = useMemo(
    () => [...new Set(materiales.map((m) => m.estado).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [materiales],
  )

  const tiposDisponibles = useMemo(
    () => [...new Set(materiales.map((m) => m.tipo || '(sin tipo)'))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    [materiales],
  )

  const materialesFiltrados = useMemo(
    () => materiales.filter((m) => pasaFiltros(m, filtros)),
    [materiales, filtros],
  )

  const grupos = useMemo(() => {
    const todos = agruparPorTipo(materialesFiltrados)
    return tiposSeleccionados.size === 0 ? todos : todos.filter((g) => tiposSeleccionados.has(g.tipo))
  }, [materialesFiltrados, tiposSeleccionados])

  if (materiales.length === 0) {
    return <p className="seguimiento-ofertas-vacio">Todavía no hay seguimiento de material cargado para esta obra.</p>
  }

  function cambiarFiltroColumna(campo, valores) {
    setFiltros((f) => ({ ...f, [campo]: valores }))
  }

  return (
    <div className="posiciones-seguimiento">
      <div className="filtro-tabla">
        <div className="filtro-campo">
          <label>Tipo</label>
          <SelectorMultipleGenerico
            valores={tiposDisponibles}
            seleccionados={tiposSeleccionados}
            onCambiar={setTiposSeleccionados}
          />
        </div>
        <span className="filtro-contador">
          {materialesFiltrados.length} de {materiales.length} ítems
        </span>
      </div>

      {grupos.length === 0 && (
        <p className="dashboard-nota">Ningún ítem coincide con los filtros aplicados.</p>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.tipo} className="tipo-caja">
          <div className="tipo-titulo">Tipo {grupo.tipo} <span className="obras-seccion-contador">{grupo.items.length}</span></div>
          <div className="tabla-scroll">
            <table className="tabla-ofertas">
              <thead>
                <tr>
                  {COLUMNAS_FILTRABLES.map(({ campo, etiqueta, valor }) => (
                    <th key={campo}>
                      <FiltroColumna
                        etiqueta={etiqueta}
                        valores={[...new Set(materiales.map(valor))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))}
                        seleccionados={filtros[campo]}
                        onCambiar={(valores2) => cambiarFiltroColumna(campo, valores2)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupo.items.map((m) => (
                  <FilaMaterial
                    key={m.filaExcel ?? `${m.tipo}-${m.posicion}-${m.material}-${m.descripcion}`}
                    m={m}
                    estadosDisponibles={estadosDisponibles}
                    onCambiar={onCambiarMaterial}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// Mismo orden que la sección "CONFIRMACION DETALLES DE PROYECTO" del Excel
// real (ver backend/drive_sync/extract_ficha_aceptada.js — mismas claves).
const CAMPOS_FICHA = [
  { campo: 'proveedor', etiqueta: 'Proveedor' },
  { campo: 'color_carpinteria', etiqueta: 'Color Carpintería' },
  { campo: 'correderas', etiqueta: 'Serie Correderas' },
  { campo: 'abatibles', etiqueta: 'Serie Abatibles' },
  { campo: 'vidrio', etiqueta: 'Vidrio' },
  { campo: 'ral', etiqueta: 'RAL Silicona' },
  { campo: 'persiana', etiqueta: 'Persiana' },
  { campo: 'color_persiana', etiqueta: 'Color Persiana' },
  { campo: 'modelo_lamas', etiqueta: 'Tipo de Lama' },
  { campo: 'motor_radio', etiqueta: 'Motor Vía Radio' },
  { campo: 'motor_mecanico', etiqueta: 'Motor Mecánico' },
]

function formatoFechaHora(iso) {
  if (!iso) return null
  // "2026-08-27 10:52:16" (SQLite datetime) -> "27/08/2026"
  return formatoFecha(iso.slice(0, 10))
}

// Una fila por campo: "Presupuesto" es de solo lectura (lo que trajo la
// sincronización con Drive); "Confirmación" arranca con un ✓ (aceptar tal
// cual) y un ✎ (corregirlo) — una vez confirmado, el mismo ✓ queda
// clickeable para deshacer la confirmación (por si se tocó sin querer),
// y el ✎ sigue disponible por si hay que corregirlo. Guarda al tocar ✓ o
// al salir del campo en modo edición.
function FilaFicha({ definicion, valorPresupuesto, confirmacion, onConfirmar, onQuitar }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')

  function empezarEdicion() {
    setTexto(confirmacion ? confirmacion.valor || '' : valorPresupuesto || '')
    setEditando(true)
  }

  function guardar(valor) {
    onConfirmar(definicion.campo, valor)
    setEditando(false)
  }

  return (
    <tr>
      <td className="seguimiento-oferta-proveedor">{definicion.etiqueta}</td>
      <td>{valorPresupuesto || '—'}</td>
      <td className="celda-confirmacion">
        {editando ? (
          <input
            type="text"
            className="input-filtro"
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => guardar(texto)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditando(false)
            }}
          />
        ) : confirmacion ? (
          <span className="confirmacion-valor">
            <button
              type="button"
              className="boton-icono boton-icono-agregar boton-icono-chico"
              title={`Confirmado el ${formatoFechaHora(confirmacion.confirmado_en)} — click para deshacer`}
              onClick={() => onQuitar(definicion.campo)}
            >
              ✓
            </button>
            {confirmacion.valor || '—'}
            <button type="button" className="boton-lapiz" title="Corregir" onClick={empezarEdicion}>✎</button>
          </span>
        ) : (
          <span className="confirmacion-acciones">
            <button
              type="button"
              className="boton-icono boton-icono-agregar boton-icono-chico"
              title="Confirmar tal cual"
              onClick={() => guardar(valorPresupuesto || '')}
            >
              ✓
            </button>
            <button type="button" className="boton-lapiz" title="Corregir" onClick={empezarEdicion}>✎</button>
          </span>
        )}
      </td>
    </tr>
  )
}

function FichaObraAceptada({ presupuesto, confirmaciones, onConfirmar, onQuitar }) {
  const confirmacionPorCampo = useMemo(
    () => new Map(confirmaciones.map((c) => [c.campo, c])),
    [confirmaciones],
  )

  return (
    <>
      <div className="tabla-scroll">
        <table className="tabla-ofertas tabla-ficha-confirmacion">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Presupuesto</th>
              <th>Confirmación</th>
            </tr>
          </thead>
          <tbody>
            {CAMPOS_FICHA.map((definicion) => (
              <FilaFicha
                key={definicion.campo}
                definicion={definicion}
                valorPresupuesto={presupuesto[definicion.campo]}
                confirmacion={confirmacionPorCampo.get(definicion.campo)}
                onConfirmar={(campo, valor) => onConfirmar(presupuesto.obra, campo, valor)}
                onQuitar={(campo) => onQuitar(presupuesto.obra, campo)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const PESTANAS_DETALLE = ['Ficha', 'Seguimiento']

// Página propia (no modal): la información de una obra aceptada —
// especialmente Seguimiento, con su tabla ancha y filtros por columna —
// necesita todo el ancho de la pantalla, no el espacio acotado de un
// modal encima de la lista. Tiene su propia URL (/obras-aceptadas/:id) para
// poder volver a abrirla o pasarla por link.
function DetalleObraAceptada({ presupuesto, materiales, confirmaciones, onCerrar, onConfirmar, onQuitar, onCambiarMaterial }) {
  const [pestana, setPestana] = useState('Ficha')

  useEffect(() => {
    setPestana('Ficha')
  }, [presupuesto.id])

  return (
    <div className="dashboard dashboard-ancho">
      <button type="button" className="boton-volver" onClick={onCerrar}>← Volver a Obras Aceptadas</button>

      <header className="dashboard-header">
        <div>
          <h1>{presupuesto.obra}</h1>
          <p>
            {presupuesto.cliente || 'Sin cliente'}
            {presupuesto.numero_ppto && ` · Nº Ppto ${presupuesto.numero_ppto}`}
            {presupuesto.fecha_ppto && ` · Presupuesto ${formatoFecha(presupuesto.fecha_ppto)}`}
          </p>
        </div>
      </header>

      <div className="seguimiento-pestanas">
        {PESTANAS_DETALLE.map((p) => (
          <button
            key={p}
            type="button"
            className={`seguimiento-pestana ${p === pestana ? 'seguimiento-pestana-activa' : ''}`}
            onClick={() => setPestana(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {pestana === 'Ficha' ? (
        <FichaObraAceptada presupuesto={presupuesto} confirmaciones={confirmaciones} onConfirmar={onConfirmar} onQuitar={onQuitar} />
      ) : (
        <SeguimientoPorPosicion materiales={materiales} onCambiarMaterial={(m, campo, valor) => onCambiarMaterial(presupuesto.obra, m, campo, valor)} />
      )}
    </div>
  )
}

export default function ObrasAceptadasPage() {
  const { usuario, accessToken } = useAuth()
  const { id: obraSeleccionadaId } = useParams()
  const navigate = useNavigate()
  const [filas, setFilas] = useState([])
  const [materiales, setMateriales] = useState([])
  const [confirmaciones, setConfirmaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todos')
  const [filtroContacto, setFiltroContacto] = useState('Todos')

  useEffect(() => {
    Promise.all([obrasAceptadas(accessToken), seguimientoMateriales(accessToken)])
      .then(([datosObras, datosMateriales]) => {
        setFilas(datosObras.obras)
        setConfirmaciones(datosObras.confirmaciones || [])
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

  const confirmacionesPorObra = useMemo(() => {
    const mapa = new Map()
    for (const c of confirmaciones) {
      if (!mapa.has(c.obra)) mapa.set(c.obra, [])
      mapa.get(c.obra).push(c)
    }
    return mapa
  }, [confirmaciones])

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

  const obraSeleccionada = obraSeleccionadaId
    ? filas.find((p) => String(p.id) === obraSeleccionadaId) || null
    : null

  async function handleConfirmarCampo(obra, campo, valor) {
    const anteriores = confirmaciones
    const ahora = new Date().toISOString()
    setConfirmaciones((c) => {
      const sinEsteCampo = c.filter((x) => !(x.obra === obra && x.campo === campo))
      return [...sinEsteCampo, { obra, campo, valor, confirmado_en: ahora }]
    })
    try {
      await confirmarCampoObraAceptada(accessToken, obra, campo, valor)
    } catch (err) {
      setConfirmaciones(anteriores)
      setError(err.message)
    }
  }

  async function handleQuitarConfirmacion(obra, campo) {
    const anteriores = confirmaciones
    setConfirmaciones((c) => c.filter((x) => !(x.obra === obra && x.campo === campo)))
    try {
      await quitarConfirmacionObraAceptada(accessToken, obra, campo)
    } catch (err) {
      setConfirmaciones(anteriores)
      setError(err.message)
    }
  }

  // Se compara por referencia (=== m), no por contenido: puede haber dos
  // ítems con exactamente los mismos valores (ej. dos paños de vidrio
  // idénticos en la misma posición) — comparar por referencia asegura que
  // se actualiza solo la fila que Alfredo tocó, aunque haya otra idéntica
  // al lado. El guardado en el servidor sí identifica por contenido (no hay
  // otra clave estable entre sincronizaciones, ver seguimiento_materiales.php)
  // así que un duplicado exacto comparte el mismo valor guardado ahí.
  async function handleCambiarMaterial(obra, m, campo, valor) {
    const anteriores = materiales
    setMateriales((ms) => ms.map((x) => (x === m ? { ...x, [campo]: valor } : x)))
    try {
      await actualizarMaterialObraAceptada(accessToken, obra, m, campo, valor)
    } catch (err) {
      setMateriales(anteriores)
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

  if (obraSeleccionadaId) {
    if (obraSeleccionada) {
      return (
        <DetalleObraAceptada
          presupuesto={obraSeleccionada}
          materiales={materialesPorObra.get(obraSeleccionada.obra) || []}
          confirmaciones={confirmacionesPorObra.get(obraSeleccionada.obra) || []}
          onCerrar={() => navigate('/obras-aceptadas')}
          onConfirmar={handleConfirmarCampo}
          onQuitar={handleQuitarConfirmacion}
          onCambiarMaterial={handleCambiarMaterial}
        />
      )
    }
    return (
      <div className="dashboard dashboard-ancho">
        <button type="button" className="boton-volver" onClick={() => navigate('/obras-aceptadas')}>← Volver a Obras Aceptadas</button>
        {cargando && <p className="dashboard-nota">Cargando…</p>}
        {error && <div className="auth-error">{error}</div>}
        {!cargando && !error && <p className="dashboard-nota">No se encontró esa obra.</p>}
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
              onAbrir={(id) => navigate(`/obras-aceptadas/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
