import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio, actualizarPresupuestoEnEstudio } from '../api/client.js'
import ComentariosObra from '../components/ComentariosObra.jsx'

// Orden = flujo real: "En Estudio" es el default al descubrir la obra en
// Drive (solo existe la carpeta, sin valores en la hoja de cálculo);
// "En Valoración" es automático en cuanto esa hoja tiene un total real;
// "En Revisión" es la única fase previa al envío que se pone siempre a
// mano; "Enviado" se pone solo en cuanto hay un PDF en la carpeta Enviados
// de la obra (se llamaba "Pdt Aprobación", cambiado por confuso — sonaba a
// que faltaba aprobar algo); "Alvarada" es, igual que "En Revisión", una
// fase que se pone siempre a mano — la sincronización nunca la asigna ni
// la pisa; Aceptado/Descartado son decisiones finales manuales.
const ESTATUS_OPCIONES = ['En Estudio', 'En Valoración', 'En Revisión', 'Enviado', 'Alvarada', 'Aceptado', 'Descartado']

// Categorías de contacto tal como las organiza Drive (Arquitectos/
// Constructores/Particulares/Proveedores/Reformistas), en singular para
// mostrar en el panel.
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

const CLASE_ESTATUS = {
  'En Estudio': 'select-estatus-en-estudio',
  'En Valoración': 'select-estatus-en-valoracion',
  'En Revisión': 'select-estatus-en-revision',
  Enviado: 'select-estatus-enviado',
  Alvarada: 'select-estatus-alvarada',
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

// Una obra con varias alternativas de presupuesto (ej. "Alfonso XIII, Bajo
// 2 — Opción A" / "— Opción B") vive en Drive y en el panel como filas
// separadas — cada opción tiene vida propia, puede aceptarse o descartarse
// en momentos distintos. Pero es UNA obra con pestañas adentro, no dos
// tarjetas repetidas: nombreBase() quita el sufijo para agruparlas,
// etiquetaOpcion() lo recupera para nombrar cada pestaña — mismo criterio
// que la página Presupuesto (Geraldinne).
function nombreBase(obra) {
  return (obra || '').replace(/\s*—\s*Opci[oó]n\s+\w+\s*$/i, '')
}

function etiquetaOpcion(obra) {
  const m = (obra || '').match(/—\s*(Opci[oó]n\s+\w+)\s*$/i)
  return m ? m[1] : null
}

// "Enviado" puesto a mano sin que exista un PDF en la carpeta Enviados de
// la obra es un estado inconsistente — probablemente alguien se adelantó o
// el PDF todavía no se subió a Drive. No se bloquea (el estatus siempre se
// puede cambiar), pero se avisa.
function faltaEnvio(presupuesto) {
  return presupuesto.estatus === 'Enviado' && !presupuesto.fecha_ultimo_envio
}

// Filtro rápido, no un estatus real (no se guarda en la base ni aparece en
// el select de Estatus para editar) — junta los presupuestos que ya se
// enviaron hace rato y siguen sin decisión, candidatos a descartar a mano.
// Mismo criterio que en Seguimiento (Geraldinne): la decisión sigue siendo
// manual, esto solo evita tener que buscarlos uno por uno.
const PROX_DESCARTAR = 'Prox. Descartar'
const MESES_PROX_DESCARTAR = 2

function esProximoADescartar(presupuesto) {
  if (!presupuesto.fecha_ultimo_envio) return false
  if (presupuesto.estatus === 'Aceptado' || presupuesto.estatus === 'Descartado') return false
  const limite = new Date()
  limite.setMonth(limite.getMonth() - MESES_PROX_DESCARTAR)
  return new Date(presupuesto.fecha_ultimo_envio) <= limite
}

// Insignia flotante en la esquina de la tarjeta, con pulso animado, para
// que salte a la vista al escanear el grid completo (no solo un ícono
// chico junto al select).
function InsigniaAlerta() {
  return (
    <span
      className="obra-card-insignia-alerta"
      title="Estatus Enviado sin ningún PDF de envío registrado en Drive"
      onClick={(e) => e.stopPropagation()}
    >
      ⚠
    </span>
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

// Estrella para marcar una obra de alto interés — exclusiva de Álvaro y
// Valentina (permiso presupuestos.marcar_interesante). Para cualquier otro
// usuario ni siquiera se renderiza, no solo se deshabilita.
function BotonInteresante({ presupuesto, onCambio, puedeMarcar }) {
  if (!puedeMarcar) return null
  return (
    <button
      type="button"
      className={`obra-card-interesante ${presupuesto.interesante ? 'obra-card-interesante-activo' : ''}`}
      title={presupuesto.interesante ? 'Quitar de alto interés' : 'Marcar como alto interés'}
      onClick={(e) => {
        e.stopPropagation()
        onCambio(presupuesto.id, { interesante: !presupuesto.interesante })
      }}
    >
      {presupuesto.interesante ? '★' : '☆'}
    </button>
  )
}

// Insignia de "hay mensajes sin leer" en la conversación de la obra — con
// tantas obras en la lista, sin esto no hay forma de notar que llegó un
// mensaje nuevo sin abrir cada ficha una por una. Esquina inferior derecha:
// las de arriba ya las ocupan la alerta y la estrella.
function InsigniaMensajes({ presupuesto }) {
  if (!presupuesto.tiene_mensajes_sin_leer) return null
  return (
    <span className="obra-card-insignia-mensajes" title="Tiene mensajes nuevos en la conversación">
      💬
    </span>
  )
}

// Fecha límite que Geraldinne le puso a la obra desde su vista — acá es
// solo lectura (Álvaro no la gestiona, es información de ella para
// organizarse), pero se avisa igual como una notificación arriba a la
// derecha de la ficha para que no pase desapercibida.
function NotificacionFechaLimite({ presupuesto }) {
  if (!presupuesto.fecha_limite_entrega) return null
  return (
    <span className="notificacion-fecha-limite" title="Fecha límite de entrega puesta por Geraldinne">
      {formatoFecha(presupuesto.fecha_limite_entrega)}
    </span>
  )
}

function TarjetaObra({ presupuesto, onAbrir, onCambio, puedeCambiarPrioridad, puedeMarcarInteresante }) {
  const alerta = faltaEnvio(presupuesto)
  return (
    <div
      className={`obra-card ${alerta ? 'obra-card-alerta' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(nombreBase(presupuesto.obra))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir(nombreBase(presupuesto.obra))
      }}
    >
      {alerta && <InsigniaAlerta />}
      <BotonInteresante presupuesto={presupuesto} onCambio={onCambio} puedeMarcar={puedeMarcarInteresante} />
      <InsigniaMensajes presupuesto={presupuesto} />
      <div className="obra-card-titulo" title={presupuesto.obra}>{presupuesto.obra}</div>
      <div className="obra-card-cliente" title={presupuesto.cliente || ''}>{presupuesto.cliente || 'Sin cliente'}</div>
      {presupuesto.fecha_ultimo_envio && (
        <div className="obra-card-fecha-envio">Enviado {formatoFecha(presupuesto.fecha_ultimo_envio)}</div>
      )}
      <div className="obra-card-meta">
        <SelectEstatus presupuesto={presupuesto} onCambio={onCambio} />
        <SelectPrioridad presupuesto={presupuesto} onCambio={onCambio} puedeCambiar={puedeCambiarPrioridad} />
      </div>
    </div>
  )
}

// Tarjeta de una obra con varias opciones vivas: mismo look que TarjetaObra
// (de hecho lo reusa cuando hay una sola opción, caso más común y sin
// cambios visuales) pero cuando hay más de una, en vez de un único select de
// Estatus/Prioridad muestra una insignia por opción — cada una con su propio
// color de estatus — porque acá no hay un solo valor que mostrar; editar
// cada opción se sigue haciendo adentro, en su propia pestaña del detalle.
function TarjetaGrupoObra({ grupo, onAbrir, onCambio, puedeCambiarPrioridad, puedeMarcarInteresante }) {
  const { base, opciones } = grupo
  if (opciones.length === 1) {
    return (
      <TarjetaObra
        presupuesto={opciones[0]}
        onAbrir={onAbrir}
        onCambio={onCambio}
        puedeCambiarPrioridad={puedeCambiarPrioridad}
        puedeMarcarInteresante={puedeMarcarInteresante}
      />
    )
  }

  const alerta = opciones.some(faltaEnvio)
  return (
    <div
      className={`obra-card ${alerta ? 'obra-card-alerta' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(base)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir(base)
      }}
    >
      {alerta && <InsigniaAlerta />}
      <InsigniaMensajes presupuesto={opciones[0]} />
      <div className="obra-card-titulo" title={base}>{base}</div>
      <div className="obra-card-cliente" title={opciones[0].cliente || ''}>{opciones[0].cliente || 'Sin cliente'}</div>
      <div className="seguimiento-opciones-chips">
        {opciones.map((o) => (
          <span key={o.id} className={`seguimiento-chip-opcion ${CLASE_ESTATUS[o.estatus] || ''}`}>
            {etiquetaOpcion(o.obra) || o.obra}
          </span>
        ))}
      </div>
      {grupo.prioridadAlta && <span className="badge badge-rechazado">Alta</span>}
    </div>
  )
}

function DetalleObra({ base, opciones, onCerrar, onCambio, puedeCambiarPrioridad, puedeMarcarInteresante, accessToken, usuarioEmail, onLeido }) {
  const [pestanaActivaId, setPestanaActivaId] = useState(opciones[0]?.id)
  const [chatAbierto, setChatAbierto] = useState(false)

  // Se resetea a la primera pestaña solo cuando se abre una obra distinta
  // (por base, no por el array de opciones, que cambia de referencia cada
  // vez que se guarda algo aunque sea la misma obra).
  useEffect(() => {
    setPestanaActivaId(opciones[0]?.id)
    setChatAbierto(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  useEffect(() => {
    function alEscape(e) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alEscape)
    return () => window.removeEventListener('keydown', alEscape)
  }, [onCerrar])

  const activo = opciones.find((o) => o.id === pestanaActivaId) || opciones[0]

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{base}</h2>
            <p>{activo.cliente || 'Sin cliente'}</p>
          </div>
          <div className="modal-header-acciones">
            <NotificacionFechaLimite presupuesto={activo} />
            <BotonInteresante presupuesto={activo} onCambio={onCambio} puedeMarcar={puedeMarcarInteresante} />
            <button
              type="button"
              className={`chat-obra-boton ${chatAbierto ? 'chat-obra-boton-activo' : ''} ${activo.tiene_mensajes_sin_leer ? 'chat-obra-boton-nuevo' : ''}`}
              onClick={() => setChatAbierto((v) => !v)}
              aria-label="Conversación con Geraldinne"
              title="Conversación con Geraldinne"
            >
              💬
            </button>
            <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
          </div>
        </div>

        {chatAbierto && (
          <ComentariosObra
            obra={activo.obra}
            accessToken={accessToken}
            usuarioEmail={usuarioEmail}
            onCerrar={() => setChatAbierto(false)}
            onLeido={onLeido}
          />
        )}

        {opciones.length > 1 && (
          <div className="seguimiento-pestanas">
            {opciones.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`seguimiento-pestana ${CLASE_ESTATUS[o.estatus] || ''} ${o.id === activo.id ? 'seguimiento-pestana-activa' : ''}`}
                onClick={() => setPestanaActivaId(o.id)}
              >
                {etiquetaOpcion(o.obra) || o.obra}
              </button>
            ))}
          </div>
        )}

        {faltaEnvio(activo) && (
          <p className="modal-aviso">⚠ "Enviado" sin ningún PDF de envío registrado en Drive.</p>
        )}

        <div className="modal-meta">
          <div className="modal-campo">
            <span>Estatus</span>
            <SelectEstatus presupuesto={activo} onCambio={onCambio} />
          </div>
          <div className="modal-campo">
            <span>Prioridad</span>
            <SelectPrioridad presupuesto={activo} onCambio={onCambio} puedeCambiar={puedeCambiarPrioridad} />
          </div>
        </div>

        <dl className="modal-detalle">
          <div><dt>Nº Ventanas</dt><dd>{activo.no_ventanas ?? '—'}</dd></div>
          <div><dt>Precio/m²</dt><dd>{formatoMoneda(activo.precio_m2)}</dd></div>
          <div><dt>RAL / Color</dt><dd>{activo.ral || '—'}</dd></div>
          <div><dt>Persiana</dt><dd>{activo.persiana || '—'}</dd></div>
          <div><dt>Vidrio</dt><dd>{activo.vidrio || '—'}</dd></div>
          <div><dt>Precio último ppto.</dt><dd>{formatoMoneda(activo.precio_ultimo_presupuesto)}</dd></div>
          <div><dt>Presupuesto persianas/motores</dt><dd>{formatoMoneda(activo.precio_complementario)}</dd></div>
          <div><dt>% Ganancia</dt><dd>{formatoPorcentaje(activo.porcentaje_ganancia)}</dd></div>
          <div><dt>Fecha último envío</dt><dd>{formatoFecha(activo.fecha_ultimo_envio)}</dd></div>
        </dl>
      </div>
    </div>
  )
}

export default function PresupuestosEnEstudioPage() {
  const { usuario, accessToken, tienePermiso } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todos')
  const [filtroContacto, setFiltroContacto] = useState('Todos')
  const [filtroEstatus, setFiltroEstatus] = useState('Todos')
  // Botón aparte, no una opción más del desplegable de Estatus — es un
  // filtro rápido, no un estatus real, así que se maneja como un toggle
  // independiente que pisa a filtroEstatus mientras está activo.
  const [soloProxDescartar, setSoloProxDescartar] = useState(false)
  const [obraSeleccionadaBase, setObraSeleccionadaBase] = useState(null)
  const puedeCambiarPrioridad = tienePermiso('presupuestos.gestionar_prioridad')
  const puedeMarcarInteresante = tienePermiso('presupuestos.marcar_interesante')

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => setFilas(data.presupuestos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const proxADescartar = useMemo(() => filas.filter(esProximoADescartar), [filas])

  function handleToggleProxDescartar() {
    setSoloProxDescartar((v) => !v)
    setFiltroEstatus('Todos')
  }

  function handleCambioFiltroEstatus(valor) {
    setFiltroEstatus(valor)
    setSoloProxDescartar(false)
  }

  // "Todos" muestra los presupuestos vivos (todo menos Descartado) — las
  // descartadas solo aparecen si se filtra explícitamente por ese estatus,
  // para que la vista por defecto no se llene de obras viejas ya cerradas.
  const filasSegunEstatus = useMemo(() => {
    if (soloProxDescartar) return proxADescartar
    if (filtroEstatus === 'Todos') return filas.filter((p) => p.estatus !== 'Descartado')
    return filas.filter((p) => p.estatus === filtroEstatus)
  }, [filas, filtroEstatus, soloProxDescartar, proxADescartar])

  // Contactos disponibles para el segundo desplegable: solo los que
  // realmente aparecen bajo la categoría elegida (no la lista fija de
  // CATEGORIAS_CLIENTE, esa es solo para el primer desplegable).
  const contactosDisponibles = useMemo(() => {
    if (filtroCategoria === 'Todos') return []
    const unicos = new Set(
      filas.filter((p) => p.categoria === filtroCategoria && p.contacto).map((p) => p.contacto),
    )
    return Array.from(unicos).sort((a, b) => a.localeCompare(b, 'es'))
  }, [filas, filtroCategoria])

  const filasFiltradas = useMemo(() => {
    const terminoObra = busquedaObra.trim().toLowerCase()
    return filasSegunEstatus
      .filter((p) => !terminoObra || p.obra?.toLowerCase().includes(terminoObra))
      .filter((p) => filtroCategoria === 'Todos' || p.categoria === filtroCategoria)
      .filter((p) => filtroContacto === 'Todos' || p.contacto === filtroContacto)
  }, [filasSegunEstatus, busquedaObra, filtroCategoria, filtroContacto])

  function handleCambioCategoria(valor) {
    setFiltroCategoria(valor)
    setFiltroContacto('Todos') // el contacto elegido puede no existir en la nueva categoría
  }

  // Agrupa las opciones de una misma obra ("— Opción A"/"— Opción B") bajo
  // una sola tarjeta (antes salían como obras separadas). El estatus que
  // decide en qué sección aparece el grupo es el menos avanzado entre sus
  // opciones vivas (el orden de ESTATUS_OPCIONES) — si una sigue "En
  // Estudio" y otra ya está "Aceptado", la obra sigue necesitando trabajo
  // activo, así que se queda en la sección de "En Estudio".
  const gruposObra = useMemo(() => {
    const mapa = new Map()
    for (const p of filasFiltradas) {
      const base = nombreBase(p.obra)
      if (!mapa.has(base)) mapa.set(base, [])
      mapa.get(base).push(p)
    }
    return Array.from(mapa.entries())
      .map(([base, opciones]) => {
        const estatusRepresentativo = opciones.reduce((mejor, o) => {
          const iActual = ESTATUS_OPCIONES.indexOf(o.estatus)
          const iMejor = ESTATUS_OPCIONES.indexOf(mejor)
          if (iActual === -1) return mejor
          if (iMejor === -1) return o.estatus
          return iActual < iMejor ? o.estatus : mejor
        }, opciones[0].estatus)
        return {
          base,
          opciones,
          prioridadAlta: opciones.some((o) => o.prioridad === 'Alta'),
          estatusRepresentativo,
        }
      })
      .sort((a, b) => a.base.localeCompare(b.base, 'es'))
  }, [filasFiltradas])

  const totalGruposSegunEstatus = useMemo(
    () => new Set(filasSegunEstatus.map((p) => nombreBase(p.obra))).size,
    [filasSegunEstatus],
  )

  // Agrupadas por estatus (en el orden de ESTATUS_OPCIONES: En Estudio ->
  // En Valoración -> En Revisión -> Enviado -> Aceptado) para que el
  // grid tenga secciones claras en vez de una sola pared de tarjetas. Al
  // filtrar por un estatus puntual no hace falta el agrupamiento: ya es un
  // solo grupo (y solo entran las obras que tengan AL MENOS una opción en
  // ese estatus puntual).
  const gruposVisibles = useMemo(() => {
    // Con el botón "Prox. Descartar" activo, gruposObra ya viene filtrado
    // por esProximoADescartar desde filasSegunEstatus/filasFiltradas, así
    // que acá no hace falta filtrar de nuevo, alcanza con envolverlo en un
    // solo grupo (sin encabezado — se muestra igual que filtrar por un
    // estatus puntual).
    if (soloProxDescartar) {
      return [{ estatus: PROX_DESCARTAR, items: gruposObra }]
    }
    if (filtroEstatus !== 'Todos') {
      return [{ estatus: filtroEstatus, items: gruposObra.filter((g) => g.opciones.some((o) => o.estatus === filtroEstatus)) }]
    }
    return ESTATUS_OPCIONES.filter((e) => e !== 'Descartado')
      .map((estatus) => ({ estatus, items: gruposObra.filter((g) => g.estatusRepresentativo === estatus) }))
      .filter((g) => g.items.length > 0)
  }, [gruposObra, filtroEstatus, soloProxDescartar])

  // Todas las opciones vivas de la obra abierta (no solo las que pasan los
  // filtros del grid) para que, una vez adentro, las pestañas no dependan de
  // qué se estaba filtrando afuera cuando se abrió la tarjeta.
  const opcionesSeleccionadas = useMemo(
    () => (obraSeleccionadaBase ? filas.filter((p) => nombreBase(p.obra) === obraSeleccionadaBase) : []),
    [filas, obraSeleccionadaBase],
  )

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

  // Solo local: el backend ya marcó la conversación como leída al abrir el
  // hilo (comentarios_obra.php). Se limpia la insignia en TODAS las opciones
  // que comparten la misma obra base (la conversación es una sola para
  // todas, ver ComentariosObra), no solo en la pestaña que estaba activa.
  function handleLeido(base) {
    setFilas((f) => f.map((p) => (nombreBase(p.obra) === base ? { ...p, tiene_mensajes_sin_leer: false } : p)))
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
              onChange={(e) => handleCambioFiltroEstatus(e.target.value)}
            >
              <option value="Todos">Todos (activos)</option>
              {ESTATUS_OPCIONES.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          {proxADescartar.length > 0 && (
            <button
              type="button"
              className={`filtro-prox-descartar ${soloProxDescartar ? 'filtro-prox-descartar-activo' : ''}`}
              onClick={handleToggleProxDescartar}
            >
              ⚠ {proxADescartar.length} próx. a descartar
            </button>
          )}
          <span className="filtro-contador">
            {gruposObra.length} de {totalGruposSegunEstatus}
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
              {filtroEstatus === 'Todos' && !soloProxDescartar && (
                <h2 className={`obras-seccion-titulo ${CLASE_ESTATUS[grupo.estatus] || ''}`}>
                  {grupo.estatus}
                  <span className="obras-seccion-contador">{grupo.items.length}</span>
                </h2>
              )}
              <div className="obras-grid">
                {grupo.items.map((g) => (
                  <TarjetaGrupoObra
                    key={g.base}
                    grupo={g}
                    onAbrir={setObraSeleccionadaBase}
                    onCambio={handleCambio}
                    puedeCambiarPrioridad={puedeCambiarPrioridad}
                    puedeMarcarInteresante={puedeMarcarInteresante}
                  />
                ))}
              </div>
            </section>
          ))}
          {gruposObra.length === 0 && (
            <p className="dashboard-nota">Ningún presupuesto coincide con los filtros aplicados.</p>
          )}
        </>
      )}

      {obraSeleccionadaBase && opcionesSeleccionadas.length > 0 && (
        <DetalleObra
          base={obraSeleccionadaBase}
          opciones={opcionesSeleccionadas}
          onCerrar={() => setObraSeleccionadaBase(null)}
          onCambio={handleCambio}
          puedeCambiarPrioridad={puedeCambiarPrioridad}
          puedeMarcarInteresante={puedeMarcarInteresante}
          accessToken={accessToken}
          usuarioEmail={usuario.email}
          onLeido={() => handleLeido(obraSeleccionadaBase)}
        />
      )}
    </div>
  )
}
