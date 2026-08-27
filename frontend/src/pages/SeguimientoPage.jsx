import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import {
  presupuestosEnEstudio,
  actualizarPresupuestoEnEstudio,
  agregarSolicitudOferta,
  eliminarOferta,
  cambiarEstatusOferta,
} from '../api/client.js'

// Espacio de trabajo personal de Geraldinne. Nunca muestra Descartadas —a
// diferencia de Presupuestos en Estudio, acá ni siquiera es una opción de
// filtro, porque a ella no le interesan las obras cerradas.
const EMAIL_AUTORIZADO = 'presupuestos@galvi.es'
const ESTATUS_OPCIONES = ['En Estudio', 'En Valoración', 'En Revisión', 'Pdt Aprobación', 'Aceptado']
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
  'Pdt Aprobación': 'select-estatus-pdt-aprobacion',
  Aceptado: 'select-estatus-aceptado',
}

// "Pdt Aprobación" puesto a mano sin que exista un PDF en la carpeta
// Enviados de la obra es un estado inconsistente — igual que en
// Presupuestos en Estudio, se avisa pero no se bloquea.
function faltaEnvio(presupuesto) {
  return presupuesto.estatus === 'Pdt Aprobación' && !presupuesto.fecha_ultimo_envio
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
      title="Pdt Aprobación sin ningún presupuesto enviado registrado en Drive"
      onClick={(e) => e.stopPropagation()}
    >
      ⚠
    </span>
  )
}

// Geraldinne no puede cambiar la prioridad (eso es de Álvaro/Valentina,
// permiso presupuestos.gestionar_prioridad) — acá es solo lectura, y solo se
// muestra cuando es "Alta" para no llenar cada tarjeta con una insignia
// "Normal" que no aporta nada.
function InsigniaPrioridad({ presupuesto }) {
  if (presupuesto.prioridad !== 'Alta') return null
  return <span className="badge badge-rechazado">Alta</span>
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
function SelectEstatusOferta({ oferta, onCambiar }) {
  if (oferta.estatus === 'Recibido') {
    return <span className="badge-estatus-oferta badge-estatus-oferta-recibido">Recibido</span>
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

function FilaOferta({ oferta, onEliminar, onCambiarEstatus }) {
  const recibido = oferta.estatus === 'Recibido'
  return (
    <tr>
      <td><SelectEstatusOferta oferta={oferta} onCambiar={onCambiarEstatus} /></td>
      <td className="seguimiento-oferta-proveedor">{oferta.proveedor || 'Sin detectar'}</td>
      <td>{formatoFecha(oferta.fecha_solicitud) || '—'}</td>
      <td className="seguimiento-oferta-valor">{recibido ? (oferta.valor != null ? formatoMoneda(oferta.valor) : 'Sin detectar') : '—'}</td>
      <td>{recibido ? (formatoFecha(oferta.fecha_llegada) || '—') : '—'}</td>
      <td className="seguimiento-oferta-archivo" title={oferta.archivo || ''}>{recibido ? (oferta.archivo || '—') : '—'}</td>
      <td>
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
      </td>
    </tr>
  )
}

// Una sola tabla para Pendiente/No recibido/Recibido (en vez de listas
// separadas) con las abiertas primero — así se ve de un vistazo a quién se
// le está esperando respuesta y a quién ya llegó, sin repetir encabezados.
function ListaOfertas({ ofertas, onAgregar, onEliminar, onCambiarEstatus }) {
  const ordenadas = [...ofertas].sort((a, b) => {
    if (a.estatus === 'Recibido' && b.estatus !== 'Recibido') return 1
    if (a.estatus !== 'Recibido' && b.estatus === 'Recibido') return -1
    return (a.proveedor || '').localeCompare(b.proveedor || '', 'es')
  })

  return (
    <div className="seguimiento-ofertas-contenido">
      <FormularioSolicitudOferta onAgregar={onAgregar} />

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
                <FilaOferta key={o.id} oferta={o} onEliminar={onEliminar} onCambiarEstatus={onCambiarEstatus} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LineaTiempo({ presupuesto, ofertas, ofertasAbiertas, onToggleOfertas, onAgregarOferta, onEliminarOferta, onCambiarEstatusOferta }) {
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
          <ListaOfertas ofertas={ofertas} onAgregar={onAgregarOferta} onEliminar={onEliminarOferta} onCambiarEstatus={onCambiarEstatusOferta} />
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

// Fecha límite que Geraldinne le pone a la obra — a Álvaro no le sirve
// (por eso Presupuestos en Estudio ni la muestra), es solo para que ella
// organice su propio trabajo.
function FechaLimiteEntrega({ presupuesto, onCambio }) {
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

// Comentario libre de Geraldinne para Álvaro sobre la obra — a diferencia
// de los selects (que guardan en cada cambio), un textarea guarda recién al
// salir del campo para no mandar un PATCH por cada letra tecleada. Estado
// local propio porque el valor puede quedar "sucio" mientras se escribe,
// antes de confirmar con onBlur.
function ComentarioParaAlvaro({ presupuesto, onCambio }) {
  const [valor, setValor] = useState(presupuesto.comentario_geraldinne || '')

  useEffect(() => {
    setValor(presupuesto.comentario_geraldinne || '')
  }, [presupuesto.id, presupuesto.comentario_geraldinne])

  function guardar() {
    if (valor !== (presupuesto.comentario_geraldinne || '')) {
      onCambio(presupuesto.id, { comentario_geraldinne: valor })
    }
  }

  return (
    <textarea
      className="textarea-inline"
      rows={3}
      placeholder="Dejar un comentario para Álvaro sobre esta obra…"
      value={valor}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValor(e.target.value)}
      onBlur={guardar}
    />
  )
}

function TarjetaSeguimiento({ presupuesto, onAbrir, onCambio }) {
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
      <div className="obra-card-titulo" title={presupuesto.obra}>{presupuesto.obra}</div>
      <div className="obra-card-cliente" title={presupuesto.cliente || ''}>{presupuesto.cliente || 'Sin cliente'}</div>
      <div className="obra-card-meta">
        <SelectEstatus presupuesto={presupuesto} onCambio={onCambio} />
        <InsigniaPrioridad presupuesto={presupuesto} />
      </div>
    </div>
  )
}

// Tarjeta de una obra con varias opciones vivas: mismo look que
// TarjetaSeguimiento (de hecho lo reusa cuando hay una sola opción, caso más
// común y sin cambios visuales) pero cuando hay más de una, en vez de un
// único select de Estatus muestra una insignia por opción — cada una con su
// propio color de estatus — porque acá no hay un solo estatus que mostrar.
function TarjetaGrupoSeguimiento({ grupo, onAbrir, onCambio }) {
  const { base, opciones } = grupo
  if (opciones.length === 1) {
    return <TarjetaSeguimiento presupuesto={opciones[0]} onAbrir={onAbrir} onCambio={onCambio} />
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

function DetalleSeguimiento({ base, opciones, ofertas, onCerrar, onCambio, onAgregarOferta, onEliminarOferta, onCambiarEstatusOferta }) {
  const [ofertasAbiertas, setOfertasAbiertas] = useState(false)
  const [pestanaActivaId, setPestanaActivaId] = useState(opciones[0]?.id)

  // Se resetea a la primera pestaña solo cuando se abre una obra distinta
  // (por base, no por el array de opciones, que cambia de referencia cada
  // vez que se guarda algo aunque sea la misma obra).
  useEffect(() => {
    setPestanaActivaId(opciones[0]?.id)
    setOfertasAbiertas(false)
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
          <InsigniaPrioridad presupuesto={activo} />
          <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

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
          <p className="modal-aviso">⚠ "Pdt Aprobación" sin ningún presupuesto enviado registrado en Drive.</p>
        )}

        <div className="modal-meta">
          <div className="modal-campo">
            <span>Estatus</span>
            <SelectEstatus presupuesto={activo} onCambio={onCambio} />
          </div>
          <div className="modal-campo">
            <span>Fecha límite de entrega</span>
            <FechaLimiteEntrega presupuesto={activo} onCambio={onCambio} />
          </div>
        </div>

        <div className="modal-campo modal-campo-ancho">
          <span>Comentario para Álvaro</span>
          <ComentarioParaAlvaro presupuesto={activo} onCambio={onCambio} />
        </div>

        <LineaTiempo
          presupuesto={activo}
          ofertas={ofertasDelActivo}
          ofertasAbiertas={ofertasAbiertas}
          onToggleOfertas={() => setOfertasAbiertas((v) => !v)}
          onAgregarOferta={(proveedor, fechaSolicitud) => onAgregarOferta(activo.obra, proveedor, fechaSolicitud)}
          onEliminarOferta={onEliminarOferta}
          onCambiarEstatusOferta={onCambiarEstatusOferta}
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
            <div><dt>% Ganancia</dt><dd>{formatoPorcentaje(activo.porcentaje_ganancia)}</dd></div>
            <div><dt>Fecha solicitud</dt><dd>{formatoFecha(activo.fecha_creacion_carpeta) || '—'}</dd></div>
            <div><dt>Fecha última oferta</dt><dd>{formatoFecha(activo.fecha_ultimo_envio) || '—'}</dd></div>
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
  const [obraSeleccionadaBase, setObraSeleccionadaBase] = useState(null)

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

  // "Todos" oculta además "Pdt Aprobación" — a Geraldinne solo le interesa
  // ese estatus cuando lo busca a propósito (filtrando por él), no como
  // parte del vistazo general del día a día. Mismo patrón que Descartado en
  // Presupuestos en Estudio, aplicado acá solo a este estatus y solo en
  // esta página.
  const filasSegunEstatus = useMemo(
    () => filasVivas.filter((p) => (filtroEstatus === 'Todos' ? p.estatus !== 'Pdt Aprobación' : p.estatus === filtroEstatus)),
    [filasVivas, filtroEstatus],
  )

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
  // "Pdt Aprobación" queda fuera del agrupamiento por defecto porque
  // filasSegunEstatus ya lo excluyó de "Todos"; al filtrar puntualmente por
  // ese estatus no hace falta agrupar, ya es un solo grupo (y solo entran
  // las obras que tengan AL MENOS una opción en ese estatus puntual).
  const gruposVisibles = useMemo(() => {
    if (filtroEstatus !== 'Todos') {
      return [{ estatus: filtroEstatus, items: gruposObra.filter((g) => g.opciones.some((o) => o.estatus === filtroEstatus)) }]
    }
    return ESTATUS_OPCIONES.filter((e) => e !== 'Pdt Aprobación')
      .map((estatus) => ({ estatus, items: gruposObra.filter((g) => g.estatusRepresentativo === estatus) }))
      .filter((g) => g.items.length > 0)
  }, [gruposObra, filtroEstatus])

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
            {gruposObra.length} de {totalGruposSegunEstatus}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}
      {!cargando && !error && gruposObra.length === 0 && (
        <p className="dashboard-nota">Ninguna obra coincide con los filtros aplicados.</p>
      )}

      {!cargando && !error && gruposObra.length > 0 && gruposVisibles.map((grupo) => (
        <section key={grupo.estatus} className="obras-seccion">
          {filtroEstatus === 'Todos' && (
            <h2 className={`obras-seccion-titulo ${CLASE_ESTATUS[grupo.estatus] || ''}`}>
              {grupo.estatus}
              <span className="obras-seccion-contador">{grupo.items.length}</span>
            </h2>
          )}
          <div className="obras-grid">
            {grupo.items.map((g) => (
              <TarjetaGrupoSeguimiento key={g.base} grupo={g} onAbrir={setObraSeleccionadaBase} onCambio={handleCambio} />
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
        />
      )}
    </div>
  )
}
