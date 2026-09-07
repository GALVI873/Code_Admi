import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import {
  presupuestosEnEstudio,
  actualizarPresupuestoEnEstudio,
  agregarSolicitudOferta,
  eliminarOferta,
  cambiarEstatusOferta,
  guardarOrdenAgenda,
  adicionalesObra,
  cambiarPrioridadAdicionalObra,
  cambiarEstatusAdicionalObra,
} from '../api/client.js'
import ComentariosObra from '../components/ComentariosObra.jsx'
import AdicionalesDeObra from '../components/AdicionalesDeObra.jsx'

// Espacio de trabajo de Geraldinne, también accesible para admin
// (Álvaro/Valentina) — antes exclusiva de ella por email, ahora cualquiera
// con ver_todos o ver_seguimiento entra (ver AppLayout.jsx). Los campos que
// son trabajo operativo puntual de ella (fecha límite de entrega, gestión
// de ofertas a proveedor) siguen siendo de solo lectura para quien no
// tenga ver_seguimiento específicamente — ver puedeGestionarOfertas más abajo.
const ESTATUS_OPCIONES = ['En Estudio', 'En Valoración', 'En Revisión', 'Enviado', 'Alvarada', 'Aceptado', 'Descartado']
// Vista "Orden del día": la agenda diaria de Geraldinne, TODAS las obras
// todavía en trabajo activo de presupuesto (una vez Enviada ya no es algo
// que ella tenga que "atacar" hoy) — no solo las de prioridad Alta. La
// prioridad Alta (la da Álvaro) decide el bloque de arriba, no si aparece o no.
const ESTATUS_AGENDA = ['En Estudio', 'En Valoración', 'En Revisión', 'Alvarada']
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

// Del Vademecum (Z:\DRIVE GALVI\Vademecum.xlsx, hoja "Proveedores") — solo
// como sugerencias del campo de texto libre (datalist), no como opción
// cerrada: son demasiados para un desplegable y a veces se pide valoración a
// alguien que todavía no está en la lista.
const PROVEEDORES_SUGERIDOS = [
  'Accesorios y perfiles Villa', 'Airmetal', 'Aerocrom lacado', 'Alegor Obras', 'Instalaciones SGGP',
  'Aliste y Alonso (Albañiles)', 'Altex', 'Alu y PVC', 'Alucenter', 'Alucoil', 'Alugal', 'Alugom',
  'Alumespa', 'Alumisan', 'Alumital', 'Alu-Stock', 'Aluporta', 'Aluterms(Joel)', 'Aluminios Ordax',
  'Angel Ramos Ondero', 'Antea', 'Aramar', 'Aranluz', 'Armycon', 'Azulejos Hermanos Herrero, S.L.',
  'Becker', 'Berner', 'Bigmat', 'Brisa', 'Bur 2000', 'Carpinteria Caraballo', 'Cerrajeria Marquez',
  'Clandes', 'Codalmha', 'Comercial arteplastica', 'Compresores Madrid', 'Cortizo', 'Crimasa',
  'Cristalerias Morales', 'Cristian Herraiz Muñoz', 'Curvados técnicos', 'Cyper', 'Dimeca',
  'Decometalisteria', 'Decoraciones Rodrisol', 'Exlabesa', 'Extrugasa', 'Fachadas Alumital',
  'Ferreteria Eurofer', 'Ferreteria Ibermadrid', 'Ferreteria Ortiz', 'Ferreteria Leonesa',
  'GEZE Iberica,', 'Gradhermetic', 'Gradual', 'Gruas Lozano', 'Unic Rentals', 'Grupo Ferditrans',
  'Hierros y Tubos Lorca', 'Hiper Hierros', 'IDF Suministros Industriales', 'Imelsa', 'Intertoldo',
  'Inmotec Proyectos', 'Jofebar', 'Julmosa', 'Jose Miguel Groux Cespedes', 'K-Line', 'Koryak',
  'Lacados San José', 'LaFermu', 'Leroy Merlin', 'Linealtec', 'Markus de Beker', 'Materiales Rueda',
  'Metracom', 'Miguel Angel Peris(Gradual)', 'Mont. Alumitech', 'Mont. Alvarado (Lucho)',
  'Mont. Evaristo', 'Mont. Fernando Recalde FRS', 'Mont. Jesus Galan', 'Mont. Jorge Luis Rodriguez Reyes',
  'Jose A. Bueno', 'Mont. Marcin', 'Mont. Miguel A. Martinez', 'Mont. Montero&Antequera',
  'Mont. Oscar Gomez-Lobo Atienza', 'Mont. Pinar Glass', 'Mont. Vivero Cantillo',
  'Mont. Frank Lery Serrano Urquizo', 'Nazan', 'Obramat', 'Pension Oasis', 'Pers. El Parque',
  'Persycom', 'Persyvex', 'Pinturas Aerocrom', 'Pilar Bolaños', 'Prometall', 'Prowalum',
  'Ramig Reformas y Constr.', 'Ramos Escudero', 'Recar', 'Represanvi', 'Resopal', 'Robinco',
  'Santi Electricista', 'Schüco', 'Sellados RpVertical,S.L.U', 'Serenur', 'Sermanpro', 'Strugal',
  'Sum. Illescas', 'Transp Javier Rodriguez Morales', 'Transp M Angel', 'Tecrosa', 'Upama',
  'V.Arandina', 'V.Glassolutions', 'V.Orgaz', 'V.Orozco', 'V.Ramos', 'V.Rodas', 'Winlux', 'Würth',
  'Algave', 'V.Manufacturas Recamar', 'Stacbond', 'Galvi', 'Comercial de Industria y Representacion,S.L',
  'Zorelor', 'SunClear', 'Roberto Jiménez', 'Ferreteria de Frutos S.A', 'Ferreteria Santos', 'Arialac',
]

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

// "Enviado" puesto a mano sin que exista un PDF en la carpeta Enviados de
// la obra es un estado inconsistente — igual que en Presupuestos en
// Estudio, se avisa pero no se bloquea.
function faltaEnvio(presupuesto) {
  return presupuesto.estatus === 'Enviado' && !presupuesto.fecha_ultimo_envio
}

// Filtro rápido, no un estatus real (no se guarda en la base ni aparece en
// el select de Estatus para editar) — junta los presupuestos que ya se
// enviaron hace rato y siguen sin decisión, candidatos a descartar a mano.
// Geraldinne decide caso por caso, esto solo se los junta en una vista para
// no tener que buscarlos uno por uno.
const PROX_DESCARTAR = 'Prox. Descartar'
const MESES_PROX_DESCARTAR = 2

function esProximoADescartar(presupuesto) {
  if (!presupuesto.fecha_ultimo_envio) return false
  if (presupuesto.estatus === 'Aceptado' || presupuesto.estatus === 'Descartado') return false
  const limite = new Date()
  limite.setMonth(limite.getMonth() - MESES_PROX_DESCARTAR)
  return new Date(presupuesto.fecha_ultimo_envio) <= limite
}

// Una obra con varias alternativas de presupuesto (ej. "Alfonso XIII, Bajo
// 2 — Opción A" / "— Opción B") vive en Drive y en el panel como filas
// separadas — cada opción tiene vida propia, puede aceptarse o descartarse
// en momentos distintos. Pero para Geraldinne es UNA obra con pestañas
// adentro, no dos tarjetas repetidas: nombreBase() quita el sufijo para
// agruparlas, etiquetaOpcion() lo recupera para nombrar cada pestaña.
function nombreBase(obra) {
  return (obra || '').replace(/\s*—\s*Opci[oó]n\s+\w+\s*$/i, '')
}

function etiquetaOpcion(obra) {
  const m = (obra || '').match(/—\s*(Opci[oó]n\s+\w+)\s*$/i)
  return m ? m[1] : null
}

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

// Geraldinne no puede cambiar la prioridad (eso es de Álvaro/Valentina,
// permiso presupuestos.gestionar_prioridad) — acá es solo lectura, y solo se
// muestra cuando es "Alta" para no llenar cada tarjeta con una insignia
// "Normal" que no aporta nada. Se usa en el resumen de un GRUPO de opciones
// (prioridadAlta = alguna de ellas), donde no hay una sola fila a la que
// aplicarle el select de abajo.
function InsigniaPrioridad({ presupuesto }) {
  if (presupuesto.prioridad !== 'Alta') return null
  return <span className="badge badge-rechazado">Alta</span>
}

// Control editable de prioridad, igual al de Presupuestos en Estudio (misma
// fuente de verdad, presupuestos.gestionar_prioridad — solo admin). Antes
// esta vista solo tenía la insignia de solo lectura porque era exclusiva de
// Geraldinne; ahora que admin también entra acá, puede marcar/desmarcar
// prioridad Alta directamente desde esta página sin tener que ir a
// Presupuestos en Estudio.
function SelectPrioridad({ presupuesto, onCambio, puedeCambiar }) {
  if (!puedeCambiar) {
    if (presupuesto.prioridad !== 'Alta') return null
    return <span className="badge badge-rechazado">Alta</span>
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
      etiqueta: 'Ficha',
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

// Alta de una solicitud de valoración: Geraldinne registra a mano a quién le
// pidió precio y cuándo. Cuando la sincronización con Drive encuentre el PDF
// correspondiente en la carpeta "Valoración", esta fila pasa sola a
// "Recibido" con el valor y la fecha de llegada — no hace falta que ella
// vuelva a tocarla.
function FormularioSolicitudOferta({ onAgregar }) {
  const [proveedor, setProveedor] = useState('')
  const [fecha, setFecha] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!proveedor.trim() || guardando) return
    setGuardando(true)
    try {
      await onAgregar(proveedor.trim(), fecha)
      setProveedor('')
      setFecha('')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form className="seguimiento-oferta-form" onClick={(e) => e.stopPropagation()} onSubmit={enviar}>
      <input
        type="text"
        className="input-filtro"
        list="seguimiento-proveedores-sugeridos"
        placeholder="Proveedor al que se le pidió valoración…"
        value={proveedor}
        onChange={(e) => setProveedor(e.target.value)}
      />
      <datalist id="seguimiento-proveedores-sugeridos">
        {PROVEEDORES_SUGERIDOS.map((p) => <option key={p} value={p} />)}
      </datalist>
      <input
        type="date"
        className="input-filtro input-fecha-limite"
        title="Fecha de la solicitud"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
      />
      <button
        type="submit"
        className="boton-icono boton-icono-agregar"
        title="Agregar solicitud"
        disabled={guardando || !proveedor.trim()}
      >
        +
      </button>
    </form>
  )
}

// "Recibido" nunca se toca desde acá a propósito — esa lo pone solo la
// sincronización con Drive cuando encuentra de verdad el PDF. Lo único que
// Geraldinne puede decidir a mano es si sigue "Pendiente" o si el proveedor
// ya la rechazó / nunca contestó ("No recibido").
function SelectEstatusOferta({ oferta, onCambiar, puedeGestionar }) {
  if (oferta.estatus === 'Recibido' || !puedeGestionar) {
    return <span className={`badge-estatus-oferta badge-estatus-oferta-${oferta.estatus === 'Recibido' ? 'recibido' : oferta.estatus === 'No recibido' ? 'no-recibido' : 'pendiente'}`}>{oferta.estatus}</span>
  }
  return (
    <select
      className={`select-inline badge-estatus-oferta-select ${oferta.estatus === 'No recibido' ? 'badge-estatus-oferta-select-no-recibido' : 'badge-estatus-oferta-select-pendiente'}`}
      value={oferta.estatus}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambiar(oferta.id, e.target.value)}
    >
      <option value="Pendiente">Pendiente</option>
      <option value="No recibido">No recibido</option>
    </select>
  )
}

function FilaOferta({ oferta, onEliminar, onCambiarEstatus, puedeGestionar }) {
  const recibido = oferta.estatus === 'Recibido'
  return (
    <tr>
      <td><SelectEstatusOferta oferta={oferta} onCambiar={onCambiarEstatus} puedeGestionar={puedeGestionar} /></td>
      <td className="seguimiento-oferta-proveedor">{oferta.proveedor || 'Sin detectar'}</td>
      <td>{formatoFecha(oferta.fecha_solicitud) || '—'}</td>
      <td className="seguimiento-oferta-valor">{recibido ? (oferta.valor != null ? formatoMoneda(oferta.valor) : 'Sin detectar') : '—'}</td>
      <td>{recibido ? (formatoFecha(oferta.fecha_llegada) || '—') : '—'}</td>
      <td className="seguimiento-oferta-archivo" title={oferta.archivo || ''}>{recibido ? (oferta.archivo || '—') : '—'}</td>
      <td>
        {puedeGestionar && (
          <button
            type="button"
            className="boton-icono boton-icono-eliminar"
            title="Eliminar esta solicitud"
            onClick={(e) => {
              e.stopPropagation()
              onEliminar(oferta.id)
            }}
          >
            −
          </button>
        )}
      </td>
    </tr>
  )
}

// Una sola tabla para Pendiente/No recibido/Recibido (en vez de listas
// separadas) con las abiertas primero — así se ve de un vistazo a quién se
// le está esperando respuesta y a quién ya llegó, sin repetir encabezados.
// puedeGestionar: gestionar las solicitudes de valoración a proveedor sigue
// siendo trabajo operativo de Geraldinne (permiso ver_seguimiento) — quien
// entra a esta vista solo con ver_todos (Álvaro/Valentina) ve la tabla
// igual, pero de solo lectura, sin el formulario ni las acciones.
function ListaOfertas({ ofertas, onAgregar, onEliminar, onCambiarEstatus, puedeGestionar }) {
  const ordenadas = [...ofertas].sort((a, b) => {
    if (a.estatus === 'Recibido' && b.estatus !== 'Recibido') return 1
    if (a.estatus !== 'Recibido' && b.estatus === 'Recibido') return -1
    return (a.proveedor || '').localeCompare(b.proveedor || '', 'es')
  })

  return (
    <div className="seguimiento-ofertas-contenido">
      {puedeGestionar && <FormularioSolicitudOferta onAgregar={onAgregar} />}

      {ordenadas.length === 0 ? (
        <p className="seguimiento-ofertas-vacio">Todavía no hay ninguna solicitud de valoración registrada para esta obra.</p>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-ofertas">
            <thead>
              <tr>
                <th>Estatus</th>
                <th>Proveedor</th>
                <th>Solicitud</th>
                <th>Valor</th>
                <th>Llegada</th>
                <th>Archivo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((o) => (
                <FilaOferta key={o.id} oferta={o} onEliminar={onEliminar} onCambiarEstatus={onCambiarEstatus} puedeGestionar={puedeGestionar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LineaTiempo({ presupuesto, ofertas, ofertasAbiertas, onToggleOfertas, onAgregarOferta, onEliminarOferta, onCambiarEstatusOferta, puedeGestionarOfertas }) {
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
          <ListaOfertas ofertas={ofertas} onAgregar={onAgregarOferta} onEliminar={onEliminarOferta} onCambiarEstatus={onCambiarEstatusOferta} puedeGestionar={puedeGestionarOfertas} />
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

// Fecha límite que Geraldinne le pone a la obra para organizar su propio
// trabajo — el backend solo deja editarla con el permiso ver_seguimiento,
// así que acá se refleja lo mismo: Álvaro/Valentina (ver_todos, sin
// ver_seguimiento) la ven pero no la editan.
function FechaLimiteEntrega({ presupuesto, onCambio, puedeEditar }) {
  if (!puedeEditar) {
    return <span className="input-fecha-limite-solo-lectura">{formatoFecha(presupuesto.fecha_limite_entrega) || '—'}</span>
  }
  return (
    <input
      type="date"
      className="input-filtro input-fecha-limite"
      value={presupuesto.fecha_limite_entrega || ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambio(presupuesto.id, { fecha_limite_entrega: e.target.value })}
    />
  )
}


// Estrella para marcar una obra de alto interés — antes exclusiva de
// Álvaro/Valentina (permiso presupuestos.marcar_interesante), ahora
// también disponible para Geraldinne. Igual que en Presupuestos en
// Estudio: ni se renderiza si no se tiene el permiso, no solo se deshabilita.
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
// mensaje nuevo sin abrir cada ficha una por una.
function InsigniaMensajes({ presupuesto }) {
  if (!presupuesto.tiene_mensajes_sin_leer) return null
  return (
    <span className="obra-card-insignia-mensajes" title="Tiene mensajes nuevos en la conversación">
      💬
    </span>
  )
}

function TarjetaSeguimiento({ presupuesto, onAbrir, onCambio, puedeMarcarInteresante, puedeCambiarPrioridad }) {
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
      {presupuesto.fecha_creacion_carpeta && (
        <div className="obra-card-fecha-solicitud">Solicitud {formatoFecha(presupuesto.fecha_creacion_carpeta)}</div>
      )}
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

// Tarjeta de una obra con varias opciones vivas: mismo look que
// TarjetaSeguimiento (de hecho lo reusa cuando hay una sola opción, caso más
// común y sin cambios visuales) pero cuando hay más de una, en vez de un
// único select de Estatus muestra una insignia por opción — cada una con su
// propio color de estatus — porque acá no hay un solo estatus que mostrar.
function TarjetaGrupoSeguimiento({ grupo, onAbrir, onCambio, puedeMarcarInteresante, puedeCambiarPrioridad }) {
  const { base, opciones } = grupo
  if (opciones.length === 1) {
    return (
      <TarjetaSeguimiento
        presupuesto={opciones[0]}
        onAbrir={onAbrir}
        onCambio={onCambio}
        puedeMarcarInteresante={puedeMarcarInteresante}
        puedeCambiarPrioridad={puedeCambiarPrioridad}
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
      {opciones[0].fecha_creacion_carpeta && (
        <div className="obra-card-fecha-solicitud">Solicitud {formatoFecha(opciones[0].fecha_creacion_carpeta)}</div>
      )}
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

function DetalleSeguimiento({ base, opciones, ofertas, onCerrar, onCambio, onAgregarOferta, onEliminarOferta, onCambiarEstatusOferta, puedeMarcarInteresante, puedeCambiarPrioridad, puedeGestionarOfertas, accessToken, usuarioEmail, onLeido }) {
  const [ofertasAbiertas, setOfertasAbiertas] = useState(false)
  const [pestanaActivaId, setPestanaActivaId] = useState(opciones[0]?.id)
  const [chatAbierto, setChatAbierto] = useState(false)

  // Se resetea a la primera pestaña solo cuando se abre una obra distinta
  // (por base, no por el array de opciones, que cambia de referencia cada
  // vez que se guarda algo aunque sea la misma obra).
  useEffect(() => {
    setPestanaActivaId(opciones[0]?.id)
    setOfertasAbiertas(false)
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
  const ofertasDelActivo = ofertas.filter((o) => o.obra === activo.obra)

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja modal-caja-ancha" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{base}</h2>
            <p>{activo.cliente || 'Sin cliente'}</p>
          </div>
          <div className="modal-header-acciones">
            <SelectPrioridad presupuesto={activo} onCambio={onCambio} puedeCambiar={puedeCambiarPrioridad} />
            <BotonInteresante presupuesto={activo} onCambio={onCambio} puedeMarcar={puedeMarcarInteresante} />
            <button
              type="button"
              className={`chat-obra-boton ${chatAbierto ? 'chat-obra-boton-activo' : ''} ${activo.tiene_mensajes_sin_leer ? 'chat-obra-boton-nuevo' : ''}`}
              onClick={() => setChatAbierto((v) => !v)}
              aria-label="Conversación con Álvaro"
              title="Conversación con Álvaro"
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
                onClick={() => {
                  setPestanaActivaId(o.id)
                  setOfertasAbiertas(false)
                }}
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
            <span>Fecha límite de entrega</span>
            <FechaLimiteEntrega presupuesto={activo} onCambio={onCambio} puedeEditar={puedeGestionarOfertas} />
          </div>
        </div>

        <LineaTiempo
          presupuesto={activo}
          ofertas={ofertasDelActivo}
          ofertasAbiertas={ofertasAbiertas}
          onToggleOfertas={() => setOfertasAbiertas((v) => !v)}
          onAgregarOferta={(proveedor, fechaSolicitud) => onAgregarOferta(activo.obra, proveedor, fechaSolicitud)}
          onEliminarOferta={onEliminarOferta}
          onCambiarEstatusOferta={onCambiarEstatusOferta}
          puedeGestionarOfertas={puedeGestionarOfertas}
        />

        {!ofertasAbiertas && (
          <dl className="modal-detalle">
            <div><dt>Nº Ppto</dt><dd>{activo.numero_ppto || '—'}</dd></div>
            <div><dt>Nº Ventanas</dt><dd>{activo.no_ventanas ?? '—'}</dd></div>
            <div><dt>Carpintería</dt><dd>{activo.carpinteria || '—'}</dd></div>
            <div><dt>Proveedor</dt><dd>{activo.proveedor || '—'}</dd></div>
            <div><dt>RAL / Color</dt><dd>{activo.ral || '—'}</dd></div>
            <div><dt>Persiana</dt><dd>{activo.persiana || '—'}</dd></div>
            <div><dt>Vidrio</dt><dd>{activo.vidrio || '—'}</dd></div>
            <div><dt>Precio/m²</dt><dd>{formatoMoneda(activo.precio_m2)}</dd></div>
            <div><dt>Precio total oferta</dt><dd>{formatoMoneda(activo.precio_ultimo_presupuesto)}</dd></div>
            <div><dt>Presupuesto persianas/motores</dt><dd>{formatoMoneda(activo.precio_complementario)}</dd></div>
            <div><dt>% Ganancia</dt><dd>{formatoPorcentaje(activo.porcentaje_ganancia)}</dd></div>
            <div><dt>Fecha solicitud</dt><dd>{formatoFecha(activo.fecha_creacion_carpeta) || '—'}</dd></div>
            <div><dt>Fecha última oferta</dt><dd>{formatoFecha(activo.fecha_ultimo_envio) || '—'}</dd></div>
          </dl>
        )}
      </div>
    </div>
  )
}

// Fila de la vista "Orden del día" — mismo look que ObraItemCompacto de
// Obras Aceptadas (lista vertical numerada), pero con flechas para mover el
// orden a mano en vez de un badge de estatus fijo: acá el orden ES el dato,
// no un detalle secundario.
function ItemAgenda({ grupo, numero, deshabilitarArriba, deshabilitarAbajo, onAbrir, onMover, onCambio, puedeCambiarPrioridad }) {
  const primero = grupo.opciones[0]
  return (
    <div
      className="obra-item-compacto"
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(grupo.base)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir(grupo.base)
      }}
    >
      <span className="obra-item-compacto-numero">{numero}.</span>
      <span className="obra-item-compacto-nombre" title={grupo.base}>{grupo.base}</span>
      <InsigniaMensajes presupuesto={primero} />
      <SelectPrioridad presupuesto={primero} onCambio={onCambio} puedeCambiar={puedeCambiarPrioridad} />
      <span className="obra-item-compacto-proveedor">{primero.cliente || 'Sin cliente'}</span>
      {primero.fecha_creacion_carpeta && (
        <span className="obra-item-compacto-fecha-solicitud" title="Fecha de solicitud">
          Solicitud {formatoFecha(primero.fecha_creacion_carpeta)}
        </span>
      )}
      <SelectEstatus presupuesto={primero} onCambio={onCambio} />
      <div className="obra-item-agenda-flechas">
        <button
          type="button"
          className="boton-icono boton-icono-chico boton-icono-mover"
          title="Subir"
          disabled={deshabilitarArriba}
          onClick={(e) => {
            e.stopPropagation()
            onMover(grupo.base, -1)
          }}
        >
          ▲
        </button>
        <button
          type="button"
          className="boton-icono boton-icono-chico boton-icono-mover"
          title="Bajar"
          disabled={deshabilitarAbajo}
          onClick={(e) => {
            e.stopPropagation()
            onMover(grupo.base, 1)
          }}
        >
          ▼
        </button>
      </div>
    </div>
  )
}

const ESTATUS_ADICIONAL_OPCIONES = ['En Valoración', 'Enviado']
// Mismas clases que ya usa el select de Estatus de Presupuesto — no hace
// falta CSS nuevo.
const CLASE_ESTATUS_ADICIONAL = {
  'En Valoración': 'select-estatus-en-valoracion',
  Enviado: 'select-estatus-enviado',
}

// Estatus de un adicional — Geraldinne lo gestiona (presupuestos.ver_seguimiento,
// igual que en la pestaña Adicionales de Obra); Álvaro lo ve pero no lo cambia.
function SelectEstatusAdicional({ adicional, onCambio, puedeCambiar }) {
  if (!puedeCambiar) {
    return <span className={`badge-estatus-adicional badge-estatus-adicional-${adicional.estatus === 'Enviado' ? 'enviado' : 'en-valoracion'}`}>{adicional.estatus}</span>
  }
  return (
    <select
      className={`select-inline select-estatus ${CLASE_ESTATUS_ADICIONAL[adicional.estatus] || ''}`}
      value={adicional.estatus}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambio(adicional.id, e.target.value)}
    >
      {ESTATUS_ADICIONAL_OPCIONES.map((op) => (
        <option key={op} value={op}>{op}</option>
      ))}
    </select>
  )
}

// Fila de un adicional de obra dentro de "Orden del día" — mismo look e
// info que ItemAgenda (fecha de solicitud, estatus, flechas de orden
// manual) más la etiqueta "Adicional de Obra" para distinguirlo de una
// obra en estudio normal. El orden manual comparte mecanismo con las obras
// de siempre (tabla orden_agenda, clave "adicional:<id>") — se puede
// intercalar libremente con ellas dentro del mismo bloque de prioridad.
// Clic lleva a la pestaña Adicionales de Obra, que es donde se gestiona el
// resto (detalle, solicitante).
function ItemAgendaAdicional({ adicional, numero, deshabilitarArriba, deshabilitarAbajo, onAbrir, onMover, onCambiarPrioridad, onCambiarEstatus, puedeCambiarPrioridad, puedeCambiarEstatus }) {
  return (
    <div
      className="obra-item-compacto"
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir()
      }}
    >
      <span className="obra-item-compacto-numero">{numero}.</span>
      <span className="obra-item-compacto-nombre" title={adicional.obra}>{adicional.obra}</span>
      <span className="badge-adicional-obra">Adicional de Obra</span>
      <SelectPrioridad
        presupuesto={adicional}
        onCambio={(id, cambios) => onCambiarPrioridad(id, cambios.prioridad)}
        puedeCambiar={puedeCambiarPrioridad}
      />
      <span className="obra-item-compacto-proveedor">{adicional.obra_cliente || 'Sin cliente'}</span>
      {adicional.fecha_solicitud && (
        <span className="obra-item-compacto-fecha-solicitud" title="Fecha de solicitud">
          Solicitud {formatoFecha(adicional.fecha_solicitud)}
        </span>
      )}
      <SelectEstatusAdicional adicional={adicional} onCambio={onCambiarEstatus} puedeCambiar={puedeCambiarEstatus} />
      <div className="obra-item-agenda-flechas">
        <button
          type="button"
          className="boton-icono boton-icono-chico boton-icono-mover"
          title="Subir"
          disabled={deshabilitarArriba}
          onClick={(e) => {
            e.stopPropagation()
            onMover(-1)
          }}
        >
          ▲
        </button>
        <button
          type="button"
          className="boton-icono boton-icono-chico boton-icono-mover"
          title="Bajar"
          disabled={deshabilitarAbajo}
          onClick={(e) => {
            e.stopPropagation()
            onMover(1)
          }}
        >
          ▼
        </button>
      </div>
    </div>
  )
}

export default function SeguimientoPage() {
  const { usuario, accessToken, tienePermiso } = useAuth()
  const [filas, setFilas] = useState([])
  const [ofertas, setOfertas] = useState([])
  const [adicionales, setAdicionales] = useState([])
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
  // "Orden del día" es la agenda de trabajo diaria de Geraldinne — arranca
  // ahí en vez de en "General" porque es lo primero que necesita mirar al
  // entrar a organizar el día.
  const [vista, setVista] = useState('orden_dia')
  const puedeMarcarInteresante = tienePermiso('presupuestos.marcar_interesante')
  // Marcar prioridad Alta sigue siendo exclusivo de admin (Álvaro/Valentina)
  // — antes esta vista solo tenía la insignia de solo lectura porque era
  // exclusiva de Geraldinne; ahora que admin entra acá también, puede
  // editarla directo sin ir a Presupuestos en Estudio.
  const puedeCambiarPrioridad = tienePermiso('presupuestos.gestionar_prioridad')
  // Gestionar ofertas a proveedor y editar la fecha límite de entrega sigue
  // siendo trabajo operativo puntual de Geraldinne — quien entra a esta
  // vista solo con ver_todos (Álvaro/Valentina) la ve completa, pero de
  // solo lectura en esos dos puntos (ver FechaLimiteEntrega/ListaOfertas).
  const puedeGestionarOfertas = tienePermiso('presupuestos.ver_seguimiento')
  const tieneAccesoPresupuesto = tienePermiso('presupuestos.ver_todos') || puedeGestionarOfertas

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => {
        setFilas(data.presupuestos)
        setOfertas(data.ofertas || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
    // Se trae junto con lo demás (no solo al abrir la pestaña Adicionales de
    // Obra) porque "Orden del día" también necesita mostrar los adicionales
    // "En Valoración" mezclados con las obras de siempre.
    adicionalesObra(accessToken)
      .then((data) => setAdicionales(data.adicionales || []))
      .catch(() => {}) // si falla, Orden del día sigue funcionando sin adicionales
  }, [accessToken])

  // Ya no se excluyen las Descartadas de acá — Geraldinne también necesita
  // poder verlas y filtrar por ellas, igual que Aceptado. El nombre queda
  // igual (se usa en varios lugares más abajo) aunque ahora no filtre nada
  // por estatus.
  const filasVivas = filas

  const proxADescartar = useMemo(() => filasVivas.filter(esProximoADescartar), [filasVivas])

  // Vista "Orden del día": TODAS las obras en estatus de trabajo activo
  // (ver ESTATUS_AGENDA), agrupadas por obra base igual que gruposObra, más
  // los adicionales de obra que todavía no se marcaron "Enviado" (uno ya
  // enviado sale de la lista, igual que un presupuesto enviado). Las de
  // prioridad Alta (la da Álvaro) van siempre como bloque arriba — dentro
  // de cada bloque el orden es el que Geraldinne/Álvaro fueron armando a
  // mano con las flechas: obras y adicionales comparten el mismo mecanismo
  // de orden manual (tabla orden_agenda; un adicional usa la clave
  // "adicional:<id>" en vez del nombre de la obra), así que se pueden
  // intercalar libremente entre sí — no tendría sentido que un adicional
  // urgente quedara siempre al final solo por ser adicional. Las que
  // todavía no tienen posición asignada caen al final de su bloque.
  const gruposAgenda = useMemo(() => {
    const relevantes = filasVivas.filter((p) => ESTATUS_AGENDA.includes(p.estatus))
    const mapa = new Map()
    for (const p of relevantes) {
      const base = nombreBase(p.obra)
      if (!mapa.has(base)) mapa.set(base, [])
      mapa.get(base).push(p)
    }
    return Array.from(mapa.entries()).map(([base, opciones]) => ({
      base,
      opciones,
      prioridadAlta: opciones.some((o) => o.prioridad === 'Alta'),
      orden: opciones[0]?.orden_agenda ?? null,
    }))
  }, [filasVivas])

  const adicionalesPendientes = useMemo(() => adicionales.filter((a) => a.estatus !== 'Enviado'), [adicionales])

  // Combina obras + adicionales de un mismo nivel de prioridad en una sola
  // lista ordenable — "clave" es lo que identifica la posición manual de
  // cada fila ante orden_agenda (nombre base de obra, o "adicional:<id>").
  function construirItemsAgenda(prioridadAlta) {
    const deObras = gruposAgenda
      .filter((g) => g.prioridadAlta === prioridadAlta)
      .map((g) => ({ tipo: 'presupuesto', clave: g.base, etiqueta: g.base, orden: g.orden, grupo: g }))
    const deAdicionales = adicionalesPendientes
      .filter((a) => (a.prioridad === 'Alta') === prioridadAlta)
      .map((a) => ({ tipo: 'adicional', clave: `adicional:${a.id}`, etiqueta: a.obra, orden: a.orden_agenda ?? null, adicional: a }))
    return [...deObras, ...deAdicionales].sort((a, b) => {
      if (a.orden != null && b.orden != null) return a.orden - b.orden
      if (a.orden != null) return -1
      if (b.orden != null) return 1
      return a.etiqueta.localeCompare(b.etiqueta, 'es')
    })
  }
  const itemsAgendaAlta = useMemo(() => construirItemsAgenda(true), [gruposAgenda, adicionalesPendientes])
  const itemsAgendaNormal = useMemo(() => construirItemsAgenda(false), [gruposAgenda, adicionalesPendientes])

  async function handleMoverItemAgenda(items, clave, direccion) {
    const idx = items.findIndex((it) => it.clave === clave)
    const destino = idx + direccion
    if (idx === -1 || destino < 0 || destino >= items.length) return

    const reordenado = [...items]
    ;[reordenado[idx], reordenado[destino]] = [reordenado[destino], reordenado[idx]]
    const clavesEnOrden = reordenado.map((it) => it.clave)

    const anterioresFilas = filas
    const anterioresAdicionales = adicionales
    setFilas((f) => f.map((p) => {
      const i = clavesEnOrden.indexOf(nombreBase(p.obra))
      return i === -1 ? p : { ...p, orden_agenda: i }
    }))
    setAdicionales((ads) => ads.map((a) => {
      const i = clavesEnOrden.indexOf(`adicional:${a.id}`)
      return i === -1 ? a : { ...a, orden_agenda: i }
    }))
    try {
      await guardarOrdenAgenda(accessToken, clavesEnOrden)
    } catch (err) {
      setFilas(anterioresFilas)
      setAdicionales(anterioresAdicionales)
      setError(err.message)
    }
  }

  async function handleCambiarPrioridadAdicional(id, prioridad) {
    const anteriores = adicionales
    setAdicionales((prev) => prev.map((a) => (a.id === id ? { ...a, prioridad } : a)))
    try {
      await cambiarPrioridadAdicionalObra(accessToken, id, prioridad)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  async function handleCambiarEstatusAdicional(id, estatus) {
    const anteriores = adicionales
    setAdicionales((prev) => prev.map((a) => (a.id === id ? { ...a, estatus } : a)))
    try {
      await cambiarEstatusAdicionalObra(accessToken, id, estatus)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  function handleToggleProxDescartar() {
    setSoloProxDescartar((v) => !v)
    setFiltroEstatus('Todos')
  }

  function handleCambioFiltroEstatus(valor) {
    setFiltroEstatus(valor)
    setSoloProxDescartar(false)
  }

  // "Todos" oculta "Enviado" y "Descartado" — a Geraldinne solo le
  // interesan esos estatus cuando los busca a propósito (filtrando por
  // ellos), no como parte del vistazo general del día a día. Mismo patrón
  // que Descartado en Presupuestos en Estudio.
  const filasSegunEstatus = useMemo(() => {
    if (soloProxDescartar) return proxADescartar
    if (filtroEstatus === 'Todos') return filasVivas.filter((p) => p.estatus !== 'Enviado' && p.estatus !== 'Descartado')
    return filasVivas.filter((p) => p.estatus === filtroEstatus)
  }, [filasVivas, filtroEstatus, soloProxDescartar, proxADescartar])

  const contactosDisponibles = useMemo(() => {
    if (filtroCategoria === 'Todos') return []
    const unicos = new Set(
      filasVivas.filter((p) => p.categoria === filtroCategoria && p.contacto).map((p) => p.contacto),
    )
    return Array.from(unicos).sort((a, b) => a.localeCompare(b, 'es'))
  }, [filasVivas, filtroCategoria])

  const filasFiltradas = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return filasSegunEstatus
      .filter((p) => !texto || p.obra?.toLowerCase().includes(texto))
      .filter((p) => filtroCategoria === 'Todos' || p.categoria === filtroCategoria)
      .filter((p) => filtroContacto === 'Todos' || p.contacto === filtroContacto)
  }, [filasSegunEstatus, busquedaObra, filtroCategoria, filtroContacto])

  // Agrupa las opciones de una misma obra ("— Opción A"/"— Opción B") bajo
  // una sola tarjeta. El estatus que decide en qué sección aparece el grupo
  // es el menos avanzado entre sus opciones vivas (el orden de
  // ESTATUS_OPCIONES) — si una opción sigue "En Estudio" y otra ya está
  // "Aceptado", la obra sigue necesitando trabajo activo, así que se queda
  // en la sección de "En Estudio" en vez de esconderse en "Aceptado".
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
      .sort((a, b) => {
        // Cuando Álvaro marca alguna opción como prioridad "Alta" desde su
        // panel, la obra entera sube al principio de su grupo — es la señal
        // de que Geraldinne debe atenderla primero.
        if (a.prioridadAlta && !b.prioridadAlta) return -1
        if (!a.prioridadAlta && b.prioridadAlta) return 1
        return a.base.localeCompare(b.base, 'es')
      })
  }, [filasFiltradas])

  const totalGruposSegunEstatus = useMemo(
    () => new Set(filasSegunEstatus.map((p) => nombreBase(p.obra))).size,
    [filasSegunEstatus],
  )

  // Agrupadas por estatus para que el grid tenga secciones claras en vez de
  // una sola pared de tarjetas (mismo patrón que Presupuestos en Estudio).
  // "Enviado" y "Descartado" quedan fuera del agrupamiento por defecto
  // porque filasSegunEstatus ya los excluyó de "Todos"; al filtrar
  // puntualmente por alguno de los dos no hace falta agrupar, ya es un
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
    return ESTATUS_OPCIONES.filter((e) => e !== 'Enviado' && e !== 'Descartado')
      .map((estatus) => ({ estatus, items: gruposObra.filter((g) => g.estatusRepresentativo === estatus) }))
      .filter((g) => g.items.length > 0)
  }, [gruposObra, filtroEstatus, soloProxDescartar])

  function handleCambioCategoria(valor) {
    setFiltroCategoria(valor)
    setFiltroContacto('Todos')
  }

  // Todas las opciones vivas de la obra abierta (no solo las que pasan los
  // filtros del grid) para que, una vez adentro, las pestañas no dependan
  // de qué se estaba filtrando afuera cuando se abrió la tarjeta.
  const opcionesSeleccionadas = useMemo(
    () => (obraSeleccionadaBase ? filasVivas.filter((p) => nombreBase(p.obra) === obraSeleccionadaBase) : []),
    [filasVivas, obraSeleccionadaBase],
  )
  const ofertasDeSeleccionada = obraSeleccionadaBase
    ? ofertas.filter((o) => nombreBase(o.obra) === obraSeleccionadaBase)
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

  // Solo local: el backend ya marcó la conversación como leída al abrir el
  // hilo. Se limpia la insignia en TODAS las opciones que comparten la misma
  // obra base (la conversación es una sola para todas, ver ComentariosObra),
  // no solo en la pestaña que estaba activa.
  function handleLeido(base) {
    setFilas((f) => f.map((p) => (nombreBase(p.obra) === base ? { ...p, tiene_mensajes_sin_leer: false } : p)))
  }

  async function handleAgregarOferta(obra, proveedor, fechaSolicitud) {
    try {
      const { id } = await agregarSolicitudOferta(accessToken, obra, proveedor, fechaSolicitud)
      setOfertas((o) => [
        ...o,
        { id, obra, proveedor, estatus: 'Pendiente', fecha_solicitud: fechaSolicitud || null, valor: null, fecha: null, fecha_llegada: null, archivo: null },
      ])
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleEliminarOferta(ofertaId) {
    const anteriores = ofertas
    setOfertas((o) => o.filter((x) => x.id !== ofertaId))
    try {
      await eliminarOferta(accessToken, ofertaId)
    } catch (err) {
      setOfertas(anteriores)
      setError(err.message)
    }
  }

  async function handleCambiarEstatusOferta(ofertaId, estatus) {
    const anteriores = ofertas
    setOfertas((o) => o.map((x) => (x.id === ofertaId ? { ...x, estatus } : x)))
    try {
      await cambiarEstatusOferta(accessToken, ofertaId, estatus)
    } catch (err) {
      setOfertas(anteriores)
      setError(err.message)
    }
  }

  if (!tieneAccesoPresupuesto) {
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

      <div className="pestanas-vista">
        <button
          type="button"
          className={`pestanas-vista-boton ${vista === 'orden_dia' ? 'pestanas-vista-boton-activa' : ''}`}
          onClick={() => setVista('orden_dia')}
        >
          Orden del día
        </button>
        <button
          type="button"
          className={`pestanas-vista-boton ${vista === 'general' ? 'pestanas-vista-boton-activa' : ''}`}
          onClick={() => setVista('general')}
        >
          General
        </button>
        <button
          type="button"
          className={`pestanas-vista-boton ${vista === 'adicionales' ? 'pestanas-vista-boton-activa' : ''}`}
          onClick={() => setVista('adicionales')}
        >
          Adicionales de Obra
        </button>
      </div>

      {vista === 'adicionales' ? (
        <AdicionalesDeObra />
      ) : (
        <>
      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {vista === 'orden_dia' && !cargando && !error && (
        <>
          <p className="dashboard-nota">
            Todas las obras en estudio, valoración, revisión o Alvarada — las de prioridad Alta (Álvaro) van siempre arriba; dentro de cada bloque el orden es el que le vayas dando con las flechas.
          </p>
          {itemsAgendaAlta.length === 0 && itemsAgendaNormal.length === 0 ? (
            <p className="dashboard-nota">No hay ninguna obra en trabajo activo ahora mismo.</p>
          ) : (
            <div className="obras-lista-compacta">
              {itemsAgendaAlta.map((item, i) => (
                item.tipo === 'presupuesto' ? (
                  <ItemAgenda
                    key={item.clave}
                    grupo={item.grupo}
                    numero={i + 1}
                    deshabilitarArriba={i === 0}
                    deshabilitarAbajo={i === itemsAgendaAlta.length - 1}
                    onAbrir={setObraSeleccionadaBase}
                    onMover={(clave, dir) => handleMoverItemAgenda(itemsAgendaAlta, clave, dir)}
                    onCambio={handleCambio}
                    puedeCambiarPrioridad={puedeCambiarPrioridad}
                  />
                ) : (
                  <ItemAgendaAdicional
                    key={item.clave}
                    adicional={item.adicional}
                    numero={i + 1}
                    deshabilitarArriba={i === 0}
                    deshabilitarAbajo={i === itemsAgendaAlta.length - 1}
                    onAbrir={() => setVista('adicionales')}
                    onMover={(dir) => handleMoverItemAgenda(itemsAgendaAlta, item.clave, dir)}
                    onCambiarPrioridad={handleCambiarPrioridadAdicional}
                    onCambiarEstatus={handleCambiarEstatusAdicional}
                    puedeCambiarPrioridad={puedeCambiarPrioridad}
                    puedeCambiarEstatus={puedeGestionarOfertas}
                  />
                )
              ))}
              {itemsAgendaNormal.map((item, i) => (
                item.tipo === 'presupuesto' ? (
                  <ItemAgenda
                    key={item.clave}
                    grupo={item.grupo}
                    numero={itemsAgendaAlta.length + i + 1}
                    deshabilitarArriba={i === 0}
                    deshabilitarAbajo={i === itemsAgendaNormal.length - 1}
                    onAbrir={setObraSeleccionadaBase}
                    onMover={(clave, dir) => handleMoverItemAgenda(itemsAgendaNormal, clave, dir)}
                    onCambio={handleCambio}
                    puedeCambiarPrioridad={puedeCambiarPrioridad}
                  />
                ) : (
                  <ItemAgendaAdicional
                    key={item.clave}
                    adicional={item.adicional}
                    numero={itemsAgendaAlta.length + i + 1}
                    deshabilitarArriba={i === 0}
                    deshabilitarAbajo={i === itemsAgendaNormal.length - 1}
                    onAbrir={() => setVista('adicionales')}
                    onMover={(dir) => handleMoverItemAgenda(itemsAgendaNormal, item.clave, dir)}
                    onCambiarPrioridad={handleCambiarPrioridadAdicional}
                    onCambiarEstatus={handleCambiarEstatusAdicional}
                    puedeCambiarPrioridad={puedeCambiarPrioridad}
                    puedeCambiarEstatus={puedeGestionarOfertas}
                  />
                )
              ))}
            </div>
          )}
        </>
      )}

      {vista === 'general' && !cargando && !error && filas.length > 0 && (
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
              <option value="Todos">Todos</option>
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

      {vista === 'general' && !cargando && !error && gruposObra.length === 0 && (
        <p className="dashboard-nota">Ninguna obra coincide con los filtros aplicados.</p>
      )}

      {vista === 'general' && !cargando && !error && gruposObra.length > 0 && gruposVisibles.map((grupo) => (
        <section key={grupo.estatus} className="obras-seccion">
          {filtroEstatus === 'Todos' && !soloProxDescartar && (
            <h2 className={`obras-seccion-titulo ${CLASE_ESTATUS[grupo.estatus] || ''}`}>
              {grupo.estatus}
              <span className="obras-seccion-contador">{grupo.items.length}</span>
            </h2>
          )}
          <div className="obras-grid">
            {grupo.items.map((g) => (
              <TarjetaGrupoSeguimiento key={g.base} grupo={g} onAbrir={setObraSeleccionadaBase} onCambio={handleCambio} puedeMarcarInteresante={puedeMarcarInteresante} puedeCambiarPrioridad={puedeCambiarPrioridad} />
            ))}
          </div>
        </section>
      ))}

      {obraSeleccionadaBase && opcionesSeleccionadas.length > 0 && (
        <DetalleSeguimiento
          base={obraSeleccionadaBase}
          opciones={opcionesSeleccionadas}
          ofertas={ofertasDeSeleccionada}
          onCerrar={() => setObraSeleccionadaBase(null)}
          onCambio={handleCambio}
          onAgregarOferta={handleAgregarOferta}
          onEliminarOferta={handleEliminarOferta}
          onCambiarEstatusOferta={handleCambiarEstatusOferta}
          puedeMarcarInteresante={puedeMarcarInteresante}
          puedeCambiarPrioridad={puedeCambiarPrioridad}
          puedeGestionarOfertas={puedeGestionarOfertas}
          accessToken={accessToken}
          usuarioEmail={usuario.email}
          onLeido={() => handleLeido(obraSeleccionadaBase)}
        />
      )}
        </>
      )}
    </div>
  )
}
