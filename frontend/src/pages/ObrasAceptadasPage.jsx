import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import {
  obrasAceptadas,
  seguimientoMateriales,
  confirmarCampoObraAceptada,
  quitarConfirmacionObraAceptada,
  actualizarMaterialObraAceptada,
  cambiarEstatusObraAceptada,
  marcarObraAceptadaVista,
  guardarDireccionObra,
  planosObra,
  guardarPosicionPlano,
  quitarPosicionPlano,
  medidasObra,
  confirmarMedidaObra,
  solicitarEnvioMedidasTaller,
} from '../api/client.js'
import NotasObraAceptada from '../components/NotasObraAceptada.jsx'
import DireccionContactoObra from '../components/DireccionContactoObra.jsx'
import BitacoraObra from '../components/BitacoraObra.jsx'

// Espacio de trabajo de Gestión de Obras — la lista de obras que
// Geraldinne ya movió a "Aceptadas". Según la entrevista de Fase 1, desde
// ahí Alfredo coordina pedidos de material y confirma medidas antes de
// pasarlas a Taller; no se le muestra precio ni % de ganancia (información
// comercial, no operativa) — solo lo que él necesita para su parte del
// proceso. Álvaro (admin) también puede entrar acá (mismo permiso
// obras.ver_aceptadas, ver AppLayout.jsx) para ver el seguimiento sin
// depender de Alfredo — el control de acceso real vive en el permiso, no
// en esta página (igual que Diario General), así que no hace falta
// filtrar por email acá también.
const CATEGORIAS_CLIENTE = ['Arquitecto', 'Constructor', 'Particular', 'Proveedor', 'Reformista']

// Estatus de seguimiento de la obra (no confundir con los estatus de
// Presupuestos en Estudio) — puesto siempre a mano por Alfredo/Álvaro
// desde la lista, "Activo" por defecto en cuanto llega una obra nueva.
const ESTATUS_ACEPTADA_OPCIONES = ['Activo', 'Repasos', 'Terminada']
const CLASE_ESTATUS_ACEPTADA = {
  Activo: 'select-estatus-en-valoracion',
  Repasos: 'select-estatus-enviado',
  Terminada: 'select-estatus-aceptado',
}

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Sin tildes/mayúsculas/espacios de más, para agrupar por Cliente sin
// depender de que dos carpetas de Drive se hayan escrito letra por letra
// igual (ver gruposPorCliente) — mismo criterio que normalizarProveedor en
// presupuestos_en_estudio.php.
function normalizarClienteParaAgrupar(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
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

function SelectEstatusObraAceptada({ presupuesto, onCambiar }) {
  return (
    <select
      className={`select-inline select-estatus ${CLASE_ESTATUS_ACEPTADA[presupuesto.estatus] || ''}`}
      value={presupuesto.estatus || 'Activo'}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCambiar(presupuesto.obra, e.target.value)}
    >
      {ESTATUS_ACEPTADA_OPCIONES.map((op) => (
        <option key={op} value={op}>{op}</option>
      ))}
    </select>
  )
}

// Reemplaza la tarjeta ancha (TarjetaObraAceptada) en la lista principal —
// a pedido de Alfredo: agrupada por Cliente (ver gruposPorCliente), cada
// obra queda como un renglón chico y numerado, uno debajo del otro, en vez
// de una tarjeta grande en grilla. El indicador de mensajes sin leer va
// inline (no la insignia circular absoluta de la tarjeta grande, no entra
// bien en un renglón angosto).
function ObraItemCompacto({ presupuesto, numero, onAbrir, onCambiarEstatus }) {
  return (
    <div
      className="obra-item-compacto"
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(presupuesto.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onAbrir(presupuesto.id)
      }}
    >
      <span className="obra-item-compacto-numero">{numero}.</span>
      <span className="obra-item-compacto-nombre" title={presupuesto.obra}>{presupuesto.obra}</span>
      {Boolean(presupuesto.es_nueva) && (
        <span className="badge-obra-nueva" title="Recién traspasada, todavía no la abriste">Nueva</span>
      )}
      {presupuesto.tiene_mensajes_sin_leer && (
        <span className="obra-item-compacto-mensaje" title="Tiene mensajes nuevos en la conversación">💬</span>
      )}
      <span className="obra-item-compacto-proveedor">{presupuesto.proveedor || 'Sin proveedor'}</span>
      <SelectEstatusObraAceptada presupuesto={presupuesto} onCambiar={onCambiarEstatus} />
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

function FilaMaterial({ m, estadosDisponibles, onCambiar, camposExtra }) {
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
      {/* Columnas propias del proyecto (extra_campos) — de solo lectura,
          igual que Posición/Material/etc., no son cosas que Alfredo edite
          desde el panel. */}
      {camposExtra.map(({ campo, valor }) => (
        <td key={campo}>{valor(m)}</td>
      ))}
    </tr>
  )
}

// Todas las columnas de la tabla, cada una con su función de valor para
// mostrar/agrupar/filtrar. "Tipo" ya no es un caso aparte fijo — es una
// más de la lista, elegible como agrupador igual que cualquier otra (ver
// selector "Agrupar por" en SeguimientoPorPosicion, a pedido de Alfredo/
// Álvaro: antes solo se podía agrupar por Tipo).
const CAMPOS_MATERIAL = [
  { campo: 'tipo', etiqueta: 'Tipo', valor: (m) => m.tipo || '(sin tipo)' },
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
// Agrupar por Descripción/Fecha/Comentario no suele tener sentido (texto
// casi siempre distinto fila a fila) — se deja igual la posibilidad, a
// pedido explícito de "por cualquier otra celda", pero el desplegable
// ofrece primero las que sí son categorías reales.
const CAMPOS_AGRUPABLES_SUGERIDOS = ['tipo', 'posicion', 'material', 'estado', 'proveedor'];

function agruparPorCampo(materiales, campoInfo) {
  const mapa = new Map()
  for (const m of materiales) {
    const clave = campoInfo.valor(m)
    if (!mapa.has(clave)) mapa.set(clave, [])
    mapa.get(clave).push(m)
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([clave, items]) => ({ clave, items }))
}

function pasaFiltros(m, filtros, campos) {
  return campos.every(({ campo, valor }) => {
    const seleccionados = filtros[campo] || EMPTY_SET
    return seleccionados.size === 0 || seleccionados.has(valor(m))
  })
}

const EMPTY_SET = new Set()

// Sin tilde/mayúsculas/espacios sueltos — para poder comparar el nombre de
// columna real del Excel ("Posición", "TIPO"...) contra las etiquetas fijas
// de CAMPOS_MATERIAL sin que un acento o un espacio de más cuente como
// "distinta columna".
function normalizarNombreColumna(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const ETIQUETAS_CAMPOS_FIJOS = new Set(CAMPOS_MATERIAL.map((c) => normalizarNombreColumna(c.etiqueta)))

// Columnas propias del proyecto (extra_campos, ver
// extract_seguimiento_materiales.js) — de la A hasta "Ancho Proy." del
// Excel de ESTA obra puntual, distintas entre un edificio y una vivienda
// de particular. Se descubren leyendo qué claves realmente trae el JSON de
// cada fila (no hay una lista fija posible, cada obra puede traer otras) y
// se ofrecen como agrupador/filtro adicional a Tipo/Posición/Material/
// Estado/Proveedor. Si el Excel de esta obra ya trae una columna con ese
// mismo nombre en su rango fijo (ej. "Posición" o "Tipo" repetidos: una
// vez en la zona de datos del proyecto y otra en la de seguimiento), se
// descarta acá — si no, salía duplicada como agrupador y como columna de
// tabla (caso real: Manipa, 89).
function camposExtraDeMateriales(materiales) {
  const nombres = new Set()
  for (const m of materiales) {
    if (m.extra_campos) {
      let extra
      try {
        extra = JSON.parse(m.extra_campos)
      } catch {
        continue
      }
      Object.keys(extra).forEach((n) => nombres.add(n))
    }
  }
  return [...nombres]
    .filter((nombre) => !ETIQUETAS_CAMPOS_FIJOS.has(normalizarNombreColumna(nombre)))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((nombre) => ({
      campo: `extra:${nombre}`,
      etiqueta: nombre,
      valor: (m) => {
        if (!m.extra_campos) return '—'
        try {
          const extra = JSON.parse(m.extra_campos)
          return extra[nombre] || '—'
        } catch {
          return '—'
        }
      },
    }))
}

function SeguimientoPorPosicion({ materiales, onCambiarMaterial, filtroInicial }) {
  // Qué campo arma las cajas — elegible por Alfredo/Álvaro (antes fijo en
  // "tipo"). A propósito NO controla qué filtros se ven en la barra de
  // arriba (antes sí, y quedaba confuso: cambiaba el filtro visible según
  // qué se hubiera elegido acá) — los filtros rápidos son siempre
  // Material/Estado/Posición, fijos, sin importar el agrupador elegido.
  const [campoAgrupador, setCampoAgrupador] = useState('tipo')
  // Precargado al llegar desde un clic en la leyenda de "Estatus" (ver
  // onVerEnSeguimiento en DetalleObraAceptada) — como esta pestaña se
  // desmonta al cambiar de pestaña, el valor inicial se vuelve a leer cada
  // vez que se entra de nuevo, tomando el último clic hecho en Estatus.
  const [filtros, setFiltros] = useState(() => (filtroInicial ? { ...filtroInicial } : {}))

  // Se recalculan por obra (materiales cambia al abrir otra obra) — no se
  // puede armar una lista fija de antemano, cada obra puede traer columnas
  // de proyecto distintas.
  const camposExtra = useMemo(() => camposExtraDeMateriales(materiales), [materiales])
  const camposTodos = useMemo(() => [...CAMPOS_MATERIAL, ...camposExtra], [camposExtra])

  // Filtros rápidos fijos en la barra de arriba — independientes de qué se
  // haya elegido en "Agrupar por" (antes el filtro de esa barra cambiaba
  // según el agrupador, confuso: quedaba "Vivienda" en vez de algo
  // predecible). Cualquier otro campo (incluidas las columnas propias de
  // la obra) se sigue pudiendo filtrar desde su propio encabezado en la
  // tabla, ver columnasEnTabla.
  const materialesDisponibles = useMemo(
    () => [...new Set(materiales.map((m) => m.material).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [materiales],
  )
  const estadosDisponibles = useMemo(
    () => [...new Set(materiales.map((m) => m.estado).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [materiales],
  )
  const posicionesDisponibles = useMemo(
    () => [...new Set(materiales.map((m) => m.posicion).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    [materiales],
  )

  const infoAgrupador = camposTodos.find((c) => c.campo === campoAgrupador) || camposTodos[0]

  const materialesFiltrados = useMemo(
    () => materiales.filter((m) => pasaFiltros(m, filtros, camposTodos)),
    [materiales, filtros, camposTodos],
  )

  const grupos = useMemo(
    () => agruparPorCampo(materialesFiltrados, infoAgrupador),
    [materialesFiltrados, infoAgrupador],
  )

  if (materiales.length === 0) {
    return <p className="seguimiento-ofertas-vacio">Todavía no hay seguimiento de material cargado para esta obra.</p>
  }

  function cambiarFiltroColumna(campo, valores) {
    setFiltros((f) => ({ ...f, [campo]: valores }))
  }

  // La tabla (FilaMaterial) siempre tiene las mismas 9 celdas fijas más las
  // columnas extra de esta obra al final — "Tipo" es la única que nunca es
  // columna (por eso queda afuera siempre, no solo cuando se agrupa por
  // Tipo). Cuando se agrupa por cualquier otro campo, esa columna se ve dos
  // veces (en el título de cada caja y en su propia celda) — redundante
  // pero no un error; sacarla de la tabla rompería la alineación con las
  // filas, que siempre traen esa celda.
  const columnasEnTabla = camposTodos.filter((c) => c.campo !== 'tipo')

  return (
    <div className="posiciones-seguimiento">
      <div className="filtro-tabla">
        <div className="filtro-campo">
          <label htmlFor="seguimiento-agrupar-por">Agrupar por</label>
          <select
            id="seguimiento-agrupar-por"
            className="select-inline"
            value={campoAgrupador}
            onChange={(e) => setCampoAgrupador(e.target.value)}
          >
            {CAMPOS_AGRUPABLES_SUGERIDOS.map((campo) => (
              <option key={campo} value={campo}>{CAMPOS_MATERIAL.find((c) => c.campo === campo).etiqueta}</option>
            ))}
            {camposExtra.length > 0 && (
              <optgroup label="Columnas de esta obra">
                {camposExtra.map(({ campo, etiqueta }) => (
                  <option key={campo} value={campo}>{etiqueta}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="filtro-campo">
          <label>Material</label>
          <SelectorMultipleGenerico
            valores={materialesDisponibles}
            seleccionados={filtros.material || EMPTY_SET}
            onCambiar={(valores) => cambiarFiltroColumna('material', valores)}
          />
        </div>
        <div className="filtro-campo">
          <label>Estado</label>
          <SelectorMultipleGenerico
            valores={estadosDisponibles}
            seleccionados={filtros.estado || EMPTY_SET}
            onCambiar={(valores) => cambiarFiltroColumna('estado', valores)}
          />
        </div>
        <div className="filtro-campo">
          <label>Posición</label>
          <SelectorMultipleGenerico
            valores={posicionesDisponibles}
            seleccionados={filtros.posicion || EMPTY_SET}
            onCambiar={(valores) => cambiarFiltroColumna('posicion', valores)}
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
        <div key={grupo.clave} className="tipo-caja">
          <div className="tipo-titulo">{infoAgrupador.etiqueta} {grupo.clave} <span className="obras-seccion-contador">{grupo.items.length}</span></div>
          <div className="tabla-scroll">
            <table className="tabla-ofertas">
              <thead>
                <tr>
                  {columnasEnTabla.map(({ campo, etiqueta, valor }) => (
                    <th key={campo}>
                      <FiltroColumna
                        etiqueta={etiqueta}
                        valores={[...new Set(materiales.map(valor))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))}
                        seleccionados={filtros[campo] || EMPTY_SET}
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
                    camposExtra={camposExtra}
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

// El plano dibuja una sola vez la posición física ("2") aunque en BD esté
// partida en varios ítems ("2.1"/"2.2", ej. dos hojas de una misma
// ventana) — se calibra y se pinta por esta base, no por el código exacto
// del Excel.
function posicionBaseDe(posicion) {
  if (!posicion) return null
  const punto = posicion.indexOf('.')
  return punto === -1 ? posicion : posicion.slice(0, punto)
}

// El color de cada marca del plano sale del Estado del material elegido en
// esa posición — Carpintería (naranja) o Vidrio (azul), elegible desde el
// selector de la pestaña Planos (antes fijo en Vidrio). Tolerante a
// variantes del texto libre que viene del Excel ("EN FABRICACION" sin
// tilde, etc.), por eso busca la palabra suelta en vez de comparar exacto.
// "Medir" va aparte de los otros dos: es rojo sin importar qué material se
// esté mirando (valores reales confirmados en producción: "EN OBRA",
// "MEDIR", "FABRICACIÓN", más otros como "PEDIR MATERIAL"/"EN PROVEEDOR"
// que quedan sin resaltar a propósito, no los pidieron).
const PATRON_MATERIAL_PLANO = {
  carpinteria: /carpinter/i,
  vidrio: /vidrio/i,
}

function posicionesPorEstadoMaterial(materiales, material) {
  const patron = PATRON_MATERIAL_PLANO[material]
  const enObra = new Set()
  const enFabricacion = new Set()
  const medir = new Set()
  for (const m of materiales) {
    if (!patron.test(m.material || '')) continue
    const base = posicionBaseDe(m.posicion)
    if (!base) continue
    const estado = (m.estado || '').toUpperCase()
    if (estado.includes('MEDIR')) medir.add(base)
    else if (estado.includes('OBRA')) enObra.add(base)
    else if (estado.includes('FABRICA')) enFabricacion.add(base)
  }
  return { enObra, enFabricacion, medir }
}

// Verde cuando la posición está "En obra" en LOS DOS materiales a la vez
// (Carpintería y Vidrio) — la ventana quedó completa, sin importar cuál de
// los dos esté eligiendo Alfredo/Álvaro en el selector. Pisa a cualquier
// otro color (incluido "A medir": si ya están las dos en obra, no tiene
// sentido seguir mostrando rojo).
function posicionesConAmbosEnObra(materiales) {
  const enObraCarpinteria = new Set()
  const enObraVidrio = new Set()
  for (const m of materiales) {
    const base = posicionBaseDe(m.posicion)
    if (!base) continue
    if (!(m.estado || '').toUpperCase().includes('OBRA')) continue
    if (PATRON_MATERIAL_PLANO.carpinteria.test(m.material || '')) enObraCarpinteria.add(base)
    else if (PATRON_MATERIAL_PLANO.vidrio.test(m.material || '')) enObraVidrio.add(base)
  }
  return new Set([...enObraCarpinteria].filter((base) => enObraVidrio.has(base)))
}

// El Tipo real de la obra suele venir con cero de relleno ("V01", "V09"),
// pero los dibujos recortados de la memoria se guardan con el código tal
// cual lo escribe la propia plancha ("V1", "V9") — se normaliza así en vez
// de subir el dibujo con dos claves, para no duplicar guardado.
function normalizarTipoDibujo(tipo) {
  if (!tipo) return tipo
  const m = /^V0*(\d+)$/i.exec(tipo.trim())
  return m ? `V${m[1]}` : tipo
}

// Los planos son un escaneo con la numeración de posición escrita a mano
// (no hay texto embebido en el PDF, ver sync_planos.js) — no hay forma de
// calcular sola la coordenada de cada una, así que se calibra una vez a
// mano desde acá (modo "Calibrar posiciones": elegir la posición, click en
// el plano) y queda guardada para las próximas veces. El color se recalcula
// solo con lo que ya está cargado en `materiales` — no hace falta releer
// nada cuando Alfredo cambia el Estado de una posición en la pestaña
// Seguimiento, por eso se ve reflejado al toque.
// Detalle de una posición al hacer clic en el plano (fuera del modo
// Calibrar) — a pedido de Álvaro: quiere ver el dibujo del tipo con sus
// medidas de proyecto y poder cargar la medida REAL que confirma en obra
// (distinta a la de proyecto), sin tener que entrar y salir para pasar de
// una posición a la siguiente — de ahí las flechas ‹ › que recorren las
// posiciones ya calibradas de esta misma página del plano, en orden.
// El dibujo (recorte de la memoria de carpintería) es opcional: solo existe
// para las obras donde ya se cargó a mano (hoy, únicamente José Abascal) —
// sin él, igual se puede confirmar la medida.
function DetalleMedicionPosicion({ posicionBase, tipo, dibujoBase64, medida, puedeConfirmar, onGuardar, onCerrar, onAnterior, onSiguiente }) {
  const [ancho, setAncho] = useState('')
  const [alto, setAlto] = useState('')
  const [comentario, setComentario] = useState('')

  useEffect(() => {
    setAncho(medida?.ancho_real != null ? String(medida.ancho_real) : '')
    setAlto(medida?.alto_real != null ? String(medida.alto_real) : '')
    setComentario(medida?.comentario || '')
  }, [posicionBase, medida])

  useEffect(() => {
    function alTeclado(e) {
      if (e.key === 'Escape') onCerrar()
      else if (e.key === 'ArrowLeft') onAnterior()
      else if (e.key === 'ArrowRight') onSiguiente()
    }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [onCerrar, onAnterior, onSiguiente])

  // Los tres campos se mandan siempre juntos (el backend reemplaza la fila
  // entera) — al guardar uno se usa el valor recién tipeado para ese campo
  // y el resto tal cual está en pantalla, no el que traía la medida vieja.
  function guardarSiCambio(campo, valorCrudo) {
    const valor = valorCrudo.trim()
    const actual = { ancho, alto, comentario, [campo]: valor }
    if (campo === 'ancho') setAncho(valor)
    else if (campo === 'alto') setAlto(valor)
    else setComentario(valor)
    onGuardar(posicionBase, actual.ancho, actual.alto, actual.comentario)
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja medicion-caja" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="medicion-flecha medicion-flecha-izq" onClick={onAnterior} aria-label="Posición anterior">‹</button>
        <button type="button" className="medicion-flecha medicion-flecha-der" onClick={onSiguiente} aria-label="Posición siguiente">›</button>
        <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>

        <div className="modal-header">
          <div>
            <h2>Posición {posicionBase}{tipo ? ` — ${tipo}` : ''}</h2>
          </div>
        </div>

        <div className="medicion-cuerpo">
          <div className="medicion-dibujo">
            {dibujoBase64 ? (
              <img src={dibujoBase64} alt={`Dibujo tipo ${tipo}`} />
            ) : (
              <p className="dashboard-nota">Todavía no hay dibujo cargado para el tipo {tipo || 'de esta posición'}.</p>
            )}
          </div>

          <div className="medicion-panel-derecho">
            <div className="medicion-campos">
              <div className="filtro-campo medicion-campo">
                <label htmlFor={`ancho-real-${posicionBase}`}>Ancho real (m)</label>
                <input
                  id={`ancho-real-${posicionBase}`}
                  type="number"
                  step="0.01"
                  className="input-filtro"
                  value={ancho}
                  disabled={!puedeConfirmar}
                  onChange={(e) => setAncho(e.target.value)}
                  onBlur={(e) => guardarSiCambio('ancho', e.target.value)}
                />
              </div>
              <div className="filtro-campo medicion-campo">
                <label htmlFor={`alto-real-${posicionBase}`}>Alto real (m)</label>
                <input
                  id={`alto-real-${posicionBase}`}
                  type="number"
                  step="0.01"
                  className="input-filtro"
                  value={alto}
                  disabled={!puedeConfirmar}
                  onChange={(e) => setAlto(e.target.value)}
                  onBlur={(e) => guardarSiCambio('alto', e.target.value)}
                />
              </div>
            </div>

            <div className="filtro-campo medicion-campo medicion-campo-comentario">
              <label htmlFor={`comentario-medicion-${posicionBase}`}>Comentario</label>
              <textarea
                id={`comentario-medicion-${posicionBase}`}
                className="input-filtro medicion-comentario-textarea"
                rows={4}
                placeholder="Notas de la medición…"
                value={comentario}
                disabled={!puedeConfirmar}
                onChange={(e) => setComentario(e.target.value)}
                onBlur={(e) => guardarSiCambio('comentario', e.target.value)}
              />
            </div>

            {medida?.confirmado_por && (
              <p className="medicion-confirmado-por">Confirmado por {medida.confirmado_por}</p>
            )}
            {!puedeConfirmar && <p className="dashboard-nota">Solo Álvaro puede confirmar medidas de obra por ahora.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlanosObra({ obra, materiales }) {
  const { accessToken, usuario } = useAuth()
  const puedeConfirmarMedida = usuario?.roles?.includes('admin')
  const [medidas, setMedidas] = useState([])
  const [dibujosPorTipo, setDibujosPorTipo] = useState({})
  const [envioTaller, setEnvioTaller] = useState(null)
  const [enviandoTaller, setEnviandoTaller] = useState(false)
  const [posicionSeleccionada, setPosicionSeleccionada] = useState(null)
  const [paginas, setPaginas] = useState([])
  const [posiciones, setPosiciones] = useState([])
  const [paginaActiva, setPaginaActiva] = useState(1)
  // Qué material colorea las marcas — Carpintería (naranja) o Vidrio
  // (azul), a elección de Alfredo/Álvaro.
  const [materialPlano, setMaterialPlano] = useState('carpinteria')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modoCalibrar, setModoCalibrar] = useState(false)
  const [posicionArmada, setPosicionArmada] = useState('')

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError('')
    setModoCalibrar(false)
    setPosicionArmada('')
    setPosicionSeleccionada(null)
    planosObra(accessToken, obra)
      .then((data) => {
        if (cancelado) return
        setPaginas(data.paginas || [])
        setPosiciones(data.posiciones || [])
        setPaginaActiva((data.paginas || [])[0]?.pagina || 1)
      })
      .catch((err) => !cancelado && setError(err.message))
      .finally(() => !cancelado && setCargando(false))
    medidasObra(accessToken, obra)
      .then((data) => {
        if (cancelado) return
        setMedidas(data.medidas || [])
        setDibujosPorTipo(data.dibujos || {})
        setEnvioTaller(data.envio || null)
      })
      .catch(() => {}) // opcional: si falla, el plano sigue funcionando igual sin medidas/dibujos
    return () => {
      cancelado = true
    }
  }, [obra, accessToken])

  const posicionesBase = useMemo(() => {
    const set = new Set()
    materiales.forEach((m) => {
      const base = posicionBaseDe(m.posicion)
      if (base) set.add(base)
    })
    return [...set].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
  }, [materiales])

  // Algunos planos (ej. Manipa) escriben el número de Posición tal cual en
  // el dibujo — ahí alcanza con el número solo. Otros (ej. Archanda, un
  // plano de arquitecto real) no muestran la Posición en ningún lado, solo
  // el código de Tipo (V01, V17...) de cada hueco, y un mismo Tipo puede
  // repetirse en más de una Posición (una por vivienda, por ejemplo) — por
  // eso el selector muestra los dos datos juntos, así se puede calibrar
  // igual sin importar qué numeración use el plano real.
  const tipoPorPosicionBase = useMemo(() => {
    const map = new Map()
    materiales.forEach((m) => {
      const base = posicionBaseDe(m.posicion)
      if (base && m.tipo && !map.has(base)) map.set(base, m.tipo)
    })
    return map
  }, [materiales])

  const { enObra, enFabricacion, medir } = useMemo(
    () => posicionesPorEstadoMaterial(materiales, materialPlano),
    [materiales, materialPlano],
  )
  const completo = useMemo(() => posicionesConAmbosEnObra(materiales), [materiales])
  const posicionesCalibradas = useMemo(() => new Set(posiciones.map((p) => p.posicion_base)), [posiciones])
  const posicionesSinCalibrar = posicionesBase.filter((p) => !posicionesCalibradas.has(p))
  const paginaImagen = paginas.find((p) => p.pagina === paginaActiva)
  const posicionesDeEstaPagina = posiciones.filter((p) => p.pagina === paginaActiva)
  // Orden para las flechas ‹ › del detalle de medición — mismo orden en que
  // se recorrería el plano a mano, numérico/alfabético por posición.
  const ordenPosicionesPagina = useMemo(
    () => [...posicionesDeEstaPagina].sort((a, b) => a.posicion_base.localeCompare(b.posicion_base, 'es', { numeric: true })),
    [posicionesDeEstaPagina],
  )
  const medidasPorPosicion = useMemo(() => new Map(medidas.map((m) => [m.posicion, m])), [medidas])

  function moverSeleccion(direccion) {
    if (!posicionSeleccionada || ordenPosicionesPagina.length === 0) return
    const idx = ordenPosicionesPagina.findIndex((p) => p.posicion_base === posicionSeleccionada)
    if (idx === -1) return
    const siguiente = (idx + direccion + ordenPosicionesPagina.length) % ordenPosicionesPagina.length
    setPosicionSeleccionada(ordenPosicionesPagina[siguiente].posicion_base)
  }

  async function handleGuardarMedida(posicionBase, anchoStr, altoStr, comentarioStr) {
    const anteriores = medidas
    const nuevaMedida = {
      posicion: posicionBase,
      ancho_real: anchoStr === '' ? null : Number(anchoStr),
      alto_real: altoStr === '' ? null : Number(altoStr),
      comentario: comentarioStr === '' ? null : comentarioStr,
      confirmado_por: usuario?.nombre,
    }
    setMedidas((ms) => [...ms.filter((m) => m.posicion !== posicionBase), nuevaMedida])
    try {
      await confirmarMedidaObra(accessToken, obra, posicionBase, nuevaMedida.ancho_real, nuevaMedida.alto_real, nuevaMedida.comentario)
    } catch (err) {
      setMedidas(anteriores)
      setError(err.message)
    }
  }

  // "Enviar medidas" no sube nada al toque (el panel no tiene acceso
  // directo a Drive) — solo deja pedido el envío; el .xlsx se arma y sube a
  // la carpeta "medición" de la obra en la próxima sincronización
  // (backend/drive_sync/enviar_medidas_taller.js).
  async function handleEnviarMedidas() {
    setEnviandoTaller(true)
    setError('')
    try {
      await solicitarEnvioMedidasTaller(accessToken, obra)
      setEnvioTaller({ solicitado_por: usuario?.nombre, solicitado_en: new Date().toISOString(), enviado_en: null })
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviandoTaller(false)
    }
  }

  async function handleClickImagen(e) {
    if (!modoCalibrar || !posicionArmada) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    const posicionGuardada = posicionArmada
    try {
      await guardarPosicionPlano(accessToken, obra, posicionGuardada, paginaActiva, xPct, yPct)
      setPosiciones((ps) => [
        ...ps.filter((p) => p.posicion_base !== posicionGuardada),
        { posicion_base: posicionGuardada, pagina: paginaActiva, x_pct: xPct, y_pct: yPct },
      ])
      setPosicionArmada('')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleQuitarMarca(posicionBase) {
    try {
      await quitarPosicionPlano(accessToken, obra, posicionBase)
      setPosiciones((ps) => ps.filter((p) => p.posicion_base !== posicionBase))
    } catch (err) {
      setError(err.message)
    }
  }

  if (cargando) return <p className="dashboard-nota">Cargando planos…</p>
  if (error) return <div className="auth-error">{error}</div>
  if (paginas.length === 0) return <p className="dashboard-nota">Todavía no hay planos sincronizados para esta obra.</p>

  return (
    <div className="planos-obra">
      <div className="planos-barra">
        <div className="seguimiento-pestanas">
          {paginas.map((p) => (
            <button
              key={p.pagina}
              type="button"
              className={`seguimiento-pestana ${p.pagina === paginaActiva ? 'seguimiento-pestana-activa' : ''}`}
              onClick={() => setPaginaActiva(p.pagina)}
            >
              Página {p.pagina}
            </button>
          ))}
        </div>
        <div className="planos-material-toggle">
          <button
            type="button"
            className={`planos-material-boton planos-material-boton-carpinteria ${materialPlano === 'carpinteria' ? 'planos-material-boton-activo' : ''}`}
            onClick={() => setMaterialPlano('carpinteria')}
          >
            Carpintería
          </button>
          <button
            type="button"
            className={`planos-material-boton planos-material-boton-vidrio ${materialPlano === 'vidrio' ? 'planos-material-boton-activo' : ''}`}
            onClick={() => setMaterialPlano('vidrio')}
          >
            Vidrio
          </button>
        </div>
        <label className="planos-calibrar-toggle">
          <input
            type="checkbox"
            checked={modoCalibrar}
            onChange={(e) => {
              setModoCalibrar(e.target.checked)
              setPosicionArmada('')
            }}
          />
          Calibrar posiciones
        </label>
        <div className="planos-enviar-taller">
          <button
            type="button"
            className="btn-secundario"
            onClick={handleEnviarMedidas}
            disabled={enviandoTaller}
          >
            📤 {envioTaller ? 'Reenviar medidas' : 'Enviar medidas'}
          </button>
          {envioTaller && (
            <span className="planos-enviar-taller-estado">
              {envioTaller.enviado_en
                ? `Enviado el ${formatoFechaHora(envioTaller.enviado_en)}`
                : `Pedido por ${envioTaller.solicitado_por} el ${formatoFechaHora(envioTaller.solicitado_en)} — se sube en la próxima sincronización`}
            </span>
          )}
        </div>
      </div>

      <div className="planos-leyenda">
        <span className={`planos-leyenda-item planos-leyenda-${materialPlano}-en-obra`}>En obra</span>
        <span className={`planos-leyenda-item planos-leyenda-${materialPlano}-en-fabricacion`}>En fabricación</span>
        <span className="planos-leyenda-item planos-leyenda-medir">A medir</span>
        <span className="planos-leyenda-item planos-leyenda-completo">Completo (los dos en obra)</span>
      </div>

      {modoCalibrar && (
        <div className="planos-calibrar-panel">
          <p className="dashboard-nota">
            {posicionArmada
              ? `Hacé click en el plano donde está dibujada la posición "${posicionArmada}". Click sobre una marca ya puesta la quita.`
              : 'Elegí abajo la posición que vas a ubicar y después hacé click sobre el plano. Click sobre una marca ya puesta la quita.'}
          </p>
          <div className="planos-calibrar-lista">
            {posicionesSinCalibrar.length === 0 && <span className="dashboard-nota">Todas las posiciones ya están ubicadas.</span>}
            {posicionesSinCalibrar.map((p) => (
              <button
                key={p}
                type="button"
                className={`chip-obra ${p === posicionArmada ? 'chip-obra-activo' : ''}`}
                onClick={() => setPosicionArmada(p === posicionArmada ? '' : p)}
              >
                {p}
                {tipoPorPosicionBase.has(p) && ` · ${tipoPorPosicionBase.get(p)}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {paginaImagen && (
        <div
          className="planos-lienzo"
          onClick={handleClickImagen}
          style={{ cursor: modoCalibrar && posicionArmada ? 'crosshair' : 'default' }}
        >
          <img src={paginaImagen.imagen_base64} alt={`Plano página ${paginaActiva}`} draggable={false} />
          {posicionesDeEstaPagina.map((p) => {
            // "Medir" pisa a los otros dos si por algún motivo coincidieran
            // (no debería pasar, son valores de Estado mutuamente
            // excluyentes) — es la que más urge que salte a la vista.
            const completoAqui = completo.has(p.posicion_base)
            const medirAqui = !completoAqui && medir.has(p.posicion_base)
            const enObraAqui = !completoAqui && !medirAqui && enObra.has(p.posicion_base)
            const enFabricacionAqui = !completoAqui && !medirAqui && !enObraAqui && enFabricacion.has(p.posicion_base)
            const tipo = tipoPorPosicionBase.get(p.posicion_base)
            const estadoTexto = completoAqui
              ? ' — COMPLETO (Carpintería y Vidrio en obra)'
              : medirAqui
                ? ' — A MEDIR'
                : enObraAqui
                  ? ' — EN OBRA'
                  : enFabricacionAqui
                    ? ' — FABRICACIÓN'
                    : ''
            const claseEstado = completoAqui
              ? 'planos-marca-completo'
              : medirAqui
                ? 'planos-marca-medir'
                : enObraAqui
                  ? `planos-marca-${materialPlano}-en-obra`
                  : enFabricacionAqui
                    ? `planos-marca-${materialPlano}-en-fabricacion`
                    : ''
            return (
              <span
                key={p.posicion_base}
                className="planos-marca-grupo"
                style={{ left: `${p.x_pct}%`, top: `${p.y_pct}%` }}
                title={`Posición ${p.posicion_base}${tipo ? ` (${tipo})` : ''}${estadoTexto}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (modoCalibrar) {
                    handleQuitarMarca(p.posicion_base)
                  } else {
                    setPosicionSeleccionada(p.posicion_base)
                  }
                }}
              >
                <span className={`planos-marca ${claseEstado}`} />
                <span className="planos-marca-etiqueta">
                  {tipo && <span className="planos-marca-etiqueta-tipo">{tipo}</span>}
                  <span className="planos-marca-etiqueta-posicion">{p.posicion_base}</span>
                </span>
              </span>
            )
          })}
        </div>
      )}

      {posicionSeleccionada && (
        <DetalleMedicionPosicion
          posicionBase={posicionSeleccionada}
          tipo={tipoPorPosicionBase.get(posicionSeleccionada)}
          dibujoBase64={dibujosPorTipo[normalizarTipoDibujo(tipoPorPosicionBase.get(posicionSeleccionada))]}
          medida={medidasPorPosicion.get(posicionSeleccionada)}
          puedeConfirmar={puedeConfirmarMedida}
          onGuardar={handleGuardarMedida}
          onCerrar={() => setPosicionSeleccionada(null)}
          onAnterior={() => moverSeleccion(-1)}
          onSiguiente={() => moverSeleccion(1)}
        />
      )}
    </div>
  )
}

// Informe rápido de estatus (a pedido de Álvaro): por cada categoría de
// material, cuántas ventanas (=posiciones, igual criterio que Planos) hay
// en total y cuántas están en cada estatus real — no solo los 3 que se
// colorean en Planos (En obra/Fabricación/Medir), sino cualquier valor que
// tenga esta obra en Seguimiento (ej. "Pedir material", "En proveedor").
// "Extras" queda como una categoría más para sumar después (a definir).
const CATEGORIAS_ESTATUS = [
  { clave: 'carpinteria', etiqueta: 'Carpintería', patron: PATRON_MATERIAL_PLANO.carpinteria },
  { clave: 'vidrio', etiqueta: 'Vidrio', patron: PATRON_MATERIAL_PLANO.vidrio },
]

// Paleta fija asignada por orden alfabético de estatus (no por frecuencia)
// para que el mismo estatus tenga siempre el mismo color entre categorías y
// entre una obra y otra — más fácil de leer de un vistazo.
const PALETA_ESTATUS = ['#2563eb', '#f97316', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04', '#64748b']

function resumenEstatusPorCategoria(materiales, patron) {
  const estadoPorPosicion = new Map()
  // Valores reales de "material" que matchean esta categoría (ej. podría
  // haber más de un texto exacto para "Carpintería" según el Excel) — se
  // guardan para poder armar el filtro exacto de Seguimiento al hacer clic
  // en un ítem de la leyenda (ver onVerEnSeguimiento).
  const materialesReales = new Set()
  for (const m of materiales) {
    if (!patron.test(m.material || '')) continue
    materialesReales.add(m.material)
    const base = posicionBaseDe(m.posicion)
    if (!base) continue
    estadoPorPosicion.set(base, (m.estado || '').trim() || 'Sin estado')
  }
  const conteos = new Map()
  for (const estado of estadoPorPosicion.values()) {
    conteos.set(estado, (conteos.get(estado) || 0) + 1)
  }
  return { total: estadoPorPosicion.size, conteos, materialesReales }
}

function DonutEstatus({ total, segmentos }) {
  if (total === 0) {
    return <div className="estatus-donut estatus-donut-vacio" />
  }
  let acumulado = 0
  const stops = segmentos.map(({ color, cantidad }) => {
    const desde = (acumulado / total) * 100
    acumulado += cantidad
    const hasta = (acumulado / total) * 100
    return `${color} ${desde}% ${hasta}%`
  })
  return (
    <div className="estatus-donut" style={{ backgroundImage: `conic-gradient(${stops.join(', ')})` }}>
      <div className="estatus-donut-centro">
        <strong>{total}</strong>
        <span>ventanas</span>
      </div>
    </div>
  )
}

function TarjetaEstatusCategoria({ etiqueta, total, conteos, colorDeEstado, materialesReales, onVerEnSeguimiento }) {
  const segmentos = [...conteos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([estado, cantidad]) => ({ estado, cantidad, color: colorDeEstado(estado) }))

  return (
    <div className="estatus-tarjeta">
      <h3>{etiqueta}</h3>
      {total === 0 ? (
        <p className="estatus-sin-datos">Sin datos de {etiqueta.toLowerCase()} en esta obra.</p>
      ) : (
        <div className="estatus-tarjeta-cuerpo">
          <DonutEstatus total={total} segmentos={segmentos} />
          <ul className="estatus-leyenda">
            {segmentos.map(({ estado, cantidad, color }) => (
              <li
                key={estado}
                className="estatus-leyenda-clicable"
                onClick={() => onVerEnSeguimiento(materialesReales, estado)}
                title={`Ver estas posiciones en Seguimiento (${etiqueta} · ${estado})`}
              >
                <span className="estatus-leyenda-punto" style={{ background: color }} />
                <span className="estatus-leyenda-etiqueta">{estado}</span>
                <span className="estatus-leyenda-cantidad">
                  {cantidad} <small>({Math.round((cantidad / total) * 100)}%)</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Avance de obra (a pedido de Álvaro): cada ventana (posición) pesa igual
// dentro del total, pero SU propio avance es ponderado por cuánto de sus
// categorías de material —Carpintería, Vidrio, Persiana, Precerco,
// cualquier otra que tenga esa posición, no solo las dos que se muestran
// como tarjetas— ya están "en obra" (ej. una ventana con Precerco y
// Carpintería en obra pero el Vidrio en fabricación pesa 2/3 = 67%, no 0%
// como si nada estuviera hecho). El avance de la obra completa es el
// promedio de esos avances por ventana. "Completas" (100%) son las que
// tienen TODAS sus filas en obra — distinto del verde de Planos
// (posicionesConAmbosEnObra), que solo mira Carpintería+Vidrio.
function avanceObraDe(materiales) {
  const filasPorPosicion = new Map()
  for (const m of materiales) {
    const base = posicionBaseDe(m.posicion)
    if (!base) continue
    if (!filasPorPosicion.has(base)) filasPorPosicion.set(base, [])
    filasPorPosicion.get(base).push(m)
  }
  let completas = 0
  let sumaAvances = 0
  for (const filas of filasPorPosicion.values()) {
    const enObra = filas.filter((m) => (m.estado || '').toUpperCase().includes('OBRA')).length
    if (enObra === filas.length) completas += 1
    sumaAvances += enObra / filas.length
  }
  const total = filasPorPosicion.size
  return { total, completas, equivalente: sumaAvances, porcentaje: total > 0 ? Math.round((sumaAvances / total) * 100) : 0 }
}

function AvanceObra({ total, completas, equivalente, porcentaje }) {
  return (
    <div className="estatus-avance">
      <div className="estatus-avance-encabezado">
        <span>Avance de obra</span>
        <strong>{porcentaje}%</strong>
      </div>
      <div className="estatus-avance-barra">
        <div className="estatus-avance-barra-relleno" style={{ width: `${porcentaje}%` }} />
      </div>
      <p className="estatus-avance-detalle">
        {equivalente.toFixed(1)} de {total} ventanas equivalentes en obra ({completas} completas al 100% — el resto pondera lo que ya tiene cada una: carpintería, vidrio, persiana, etc.)
      </p>
    </div>
  )
}

function EstatusObra({ materiales, onVerEnSeguimiento }) {
  const resumenes = useMemo(
    () => CATEGORIAS_ESTATUS.map((c) => ({ ...c, ...resumenEstatusPorCategoria(materiales, c.patron) })),
    [materiales],
  )

  const avanceObra = useMemo(() => avanceObraDe(materiales), [materiales])

  // Mismo color para el mismo estatus en todas las categorías — se asigna
  // por orden alfabético de todos los estatus que aparecen en la obra, no
  // por categoría (si no, "En obra" de Carpintería podría salir de un color
  // distinto que "En obra" de Vidrio).
  const colorDeEstado = useMemo(() => {
    const todos = new Set()
    resumenes.forEach((r) => r.conteos.forEach((_, estado) => todos.add(estado)))
    const ordenados = [...todos].sort((a, b) => a.localeCompare(b, 'es'))
    const mapa = new Map(ordenados.map((estado, i) => [estado, PALETA_ESTATUS[i % PALETA_ESTATUS.length]]))
    return (estado) => mapa.get(estado) || '#94a3b8'
  }, [resumenes])

  return (
    <div className="estatus-obra">
      <AvanceObra
        total={avanceObra.total}
        completas={avanceObra.completas}
        equivalente={avanceObra.equivalente}
        porcentaje={avanceObra.porcentaje}
      />
      <p className="estatus-total-obra">
        <strong>{avanceObra.total}</strong> ventanas en total en esta obra
      </p>
      <div className="estatus-tarjetas">
        {resumenes.map((r) => (
          <TarjetaEstatusCategoria
            key={r.clave}
            etiqueta={r.etiqueta}
            total={r.total}
            conteos={r.conteos}
            colorDeEstado={colorDeEstado}
            materialesReales={r.materialesReales}
            onVerEnSeguimiento={onVerEnSeguimiento}
          />
        ))}
      </div>
    </div>
  )
}

const PESTANAS_DETALLE = ['Ficha', 'Estatus', 'Seguimiento', 'Planos', 'Bitácora', 'Notas']

// Página propia (no modal): la información de una obra aceptada —
// especialmente Seguimiento, con su tabla ancha y filtros por columna —
// necesita todo el ancho de la pantalla, no el espacio acotado de un
// modal encima de la lista. Tiene su propia URL (/obras-aceptadas/:id) para
// poder volver a abrirla o pasarla por link.
//
// "Notas" (NotasObraAceptada.jsx) — a pedido de Álvaro: lo que saca de una
// reunión o visita a obra, en forma de lista de pendientes (no chat como
// en Presupuestos en Estudio/Presupuesto) para que Alfredo los vaya
// tildando. La pestaña muestra un punto cuando hay mensajes sin leer,
// además de la insignia en la tarjeta de la lista (InsigniaMensajes, mismo
// criterio que las otras vistas).
function DetalleObraAceptada({ presupuesto, materiales, confirmaciones, direccion, onCerrar, onConfirmar, onQuitar, onCambiarMaterial, onLeido, onVista, onGuardarDireccion }) {
  const { accessToken, usuario } = useAuth()
  // La vista "Pendientes" enlaza directo a la pestaña Notas de una obra
  // (?pestana=Notas, ver PendientesObrasPage.jsx) para no obligar a un
  // click de más — se lee una sola vez al entrar/cambiar de obra, no se
  // vuelve a mirar si después se cambia de pestaña a mano.
  const [searchParams] = useSearchParams()
  const [pestana, setPestana] = useState(() => searchParams.get('pestana') || 'Ficha')
  // A pedido de Álvaro: clic en un ítem de la leyenda de "Estatus" (ej.
  // "Carpintería · EN OBRA") salta a la pestaña Seguimiento ya filtrada por
  // ese material y ese estado, para ver de una las posiciones puntuales.
  const [filtroInicialSeguimiento, setFiltroInicialSeguimiento] = useState(null)

  function handleVerEnSeguimiento(materialesReales, estado) {
    setFiltroInicialSeguimiento({ material: materialesReales, estado: new Set([estado]) })
    setPestana('Seguimiento')
  }

  useEffect(() => {
    setPestana(searchParams.get('pestana') || 'Ficha')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presupuesto.id])

  // Apaga la insignia "Nueva" apenas Alfredo entra al detalle — solo si
  // todavía la tenía puesta, para no mandar un PATCH de más cada vez que
  // reabre una obra que ya vio antes.
  useEffect(() => {
    if (presupuesto.es_nueva) onVista(presupuesto.obra)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {p === 'Notas' && presupuesto.tiene_mensajes_sin_leer && <span className="seguimiento-pestana-punto" />}
          </button>
        ))}
      </div>

      {pestana === 'Ficha' && (
        <>
          <DireccionContactoObra
            obra={presupuesto.obra}
            datos={direccion}
            colapsable
            onGuardar={(datos) => onGuardarDireccion(presupuesto.obra, datos)}
          />
          <FichaObraAceptada presupuesto={presupuesto} confirmaciones={confirmaciones} onConfirmar={onConfirmar} onQuitar={onQuitar} />
        </>
      )}
      {pestana === 'Estatus' && <EstatusObra materiales={materiales} onVerEnSeguimiento={handleVerEnSeguimiento} />}
      {pestana === 'Seguimiento' && (
        <SeguimientoPorPosicion
          materiales={materiales}
          onCambiarMaterial={(m, campo, valor) => onCambiarMaterial(presupuesto.obra, m, campo, valor)}
          filtroInicial={filtroInicialSeguimiento}
        />
      )}
      {pestana === 'Planos' && <PlanosObra obra={presupuesto.obra} materiales={materiales} />}
      {pestana === 'Bitácora' && (
        <BitacoraObra obra={presupuesto.obra} accessToken={accessToken} usuario={usuario} />
      )}
      {pestana === 'Notas' && (
        <NotasObraAceptada
          obra={presupuesto.obra}
          accessToken={accessToken}
          usuario={usuario}
          onLeido={() => onLeido(presupuesto.obra)}
        />
      )}
    </div>
  )
}

export default function ObrasAceptadasPage() {
  const { accessToken } = useAuth()
  const { id: obraSeleccionadaId } = useParams()
  const navigate = useNavigate()
  const [filas, setFilas] = useState([])
  const [materiales, setMateriales] = useState([])
  const [confirmaciones, setConfirmaciones] = useState([])
  const [direcciones, setDirecciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todos')
  const [filtroContacto, setFiltroContacto] = useState('Todos')
  // A pedido de Álvaro: las obras "Terminada" quedan fuera de la vista por
  // defecto (ya no hay nada que gestionar ahí) — solo vuelven a aparecer si
  // se elige a propósito el estatus "Terminada" (o "Todos").
  const [filtroEstatus, setFiltroEstatus] = useState('Activas')
  // A pedido de Álvaro: filtro rápido para encontrar de un vistazo qué
  // obras tienen algo cargado en "Notas" (con o sin leer, no solo las
  // nuevas) — botón aparte de los desplegables normales, mismo patrón que
  // "Prox. Descartar" en Presupuestos en Estudio/Seguimiento.
  const [soloConNotas, setSoloConNotas] = useState(false)

  useEffect(() => {
    Promise.all([obrasAceptadas(accessToken), seguimientoMateriales(accessToken)])
      .then(([datosObras, datosMateriales]) => {
        setFilas(datosObras.obras)
        setConfirmaciones(datosObras.confirmaciones || [])
        setDirecciones(datosObras.direcciones || [])
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

  const direccionesPorObra = useMemo(() => new Map(direcciones.map((d) => [d.obra, d])), [direcciones])

  async function handleGuardarDireccion(obra, datos) {
    setDirecciones((ds) => [...ds.filter((d) => d.obra !== obra), { obra, ...datos }])
    try {
      await guardarDireccionObra(accessToken, obra, datos)
    } catch (err) {
      setError(err.message)
    }
  }

  // Cada fila de obras_aceptadas.php ya es, por definición, una obra
  // aceptada (la tabla solo existe para eso) — a diferencia de
  // Presupuestos en Estudio/Presupuesto, acá no se agrupa por estatus, pero
  // sí se filtra (ver filtroEstatus) para poder ocultar las Terminada.
  const aceptadas = filas

  const contactosDisponibles = useMemo(() => {
    if (filtroCategoria === 'Todos') return []
    const unicos = new Set(
      aceptadas.filter((p) => p.categoria === filtroCategoria && p.contacto).map((p) => p.contacto),
    )
    return Array.from(unicos).sort((a, b) => a.localeCompare(b, 'es'))
  }, [aceptadas, filtroCategoria])

  const conNotas = useMemo(() => aceptadas.filter((p) => p.tiene_mensajes), [aceptadas])

  const filasFiltradas = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return aceptadas
      .filter((p) => !texto || p.obra?.toLowerCase().includes(texto))
      .filter((p) => filtroCategoria === 'Todos' || p.categoria === filtroCategoria)
      .filter((p) => filtroContacto === 'Todos' || p.contacto === filtroContacto)
      .filter((p) => {
        const estatus = p.estatus || 'Activo'
        if (filtroEstatus === 'Todos') return true
        if (filtroEstatus === 'Activas') return estatus !== 'Terminada'
        return estatus === filtroEstatus
      })
      .filter((p) => !soloConNotas || p.tiene_mensajes)
      .sort((a, b) => (a.obra || '').localeCompare(b.obra || '', 'es'))
  }, [aceptadas, busquedaObra, filtroCategoria, filtroContacto, filtroEstatus, soloConNotas])

  // Agrupado por Cliente a pedido de Alfredo — antes era una sola grilla
  // de tarjetas anchas, ahora cada cliente es un encabezado con sus obras
  // en una lista compacta y numerada debajo, para poder escanear muchos
  // clientes sin que cada obra ocupe tanto espacio.
  //
  // Se agrupa por CONTACTO (la carpeta Categoría/Contacto de Drive, ver
  // sync_obras_aceptadas.js), no por el campo "cliente" del Excel, aunque
  // acá se lo siga llamando "Cliente" — mismo criterio que el filtro
  // "Cliente" que ya existía en esta página (filtroContacto, más abajo,
  // también filtra por p.contacto). El campo "cliente" es texto libre que
  // cada Ficha reescribe a mano por su cuenta (typos y variantes: "Pila
  // Bolaños"/"Pilar Bolaños", "Silvia San Martin"/"Martín", "...- PI 2")
  // mientras que el contacto es UNA sola carpeta real, siempre el mismo
  // texto — agrupando por ahí esas variantes dejan de aparecer como
  // clientes distintos. cliente solo se usa como respaldo para las
  // categorías sin contacto (Particulares). Igual se normaliza (sin
  // tildes/mayúsculas/espacios de más, mismo criterio que
  // normalizarProveedor en presupuestos_en_estudio.php) por si dos
  // carpetas de contacto distintas terminan escritas ligeramente distinto.
  const gruposPorCliente = useMemo(() => {
    const mapa = new Map()
    for (const p of filasFiltradas) {
      const nombreCrudo = p.contacto || p.cliente || 'Sin cliente'
      const clave = normalizarClienteParaAgrupar(nombreCrudo)
      if (!mapa.has(clave)) mapa.set(clave, { nombres: new Set(), obras: [] })
      const grupo = mapa.get(clave)
      grupo.nombres.add(nombreCrudo)
      grupo.obras.push(p)
    }
    return Array.from(mapa.values())
      .map(({ nombres, obras }) => ({
        cliente: Array.from(nombres).sort((a, b) => a.localeCompare(b, 'es'))[0],
        obras,
      }))
      .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'))
  }, [filasFiltradas])

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

  async function handleCambiarEstatusObra(obra, estatus) {
    const anteriores = filas
    setFilas((fs) => fs.map((f) => (f.obra === obra ? { ...f, estatus } : f)))
    try {
      await cambiarEstatusObraAceptada(accessToken, obra, estatus)
    } catch (err) {
      setFilas(anteriores)
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

  function handleLeido(obra) {
    setFilas((fs) => fs.map((f) => (f.obra === obra ? { ...f, tiene_mensajes_sin_leer: false } : f)))
  }

  // Apaga la insignia "Nueva" al entrar al detalle por primera vez — no
  // hace falta esperar respuesta del PATCH para sacarla de la lista,
  // Alfredo ya la está viendo en este mismo momento.
  function handleVista(obra) {
    setFilas((fs) => fs.map((f) => (f.obra === obra ? { ...f, es_nueva: 0 } : f)))
    marcarObraAceptadaVista(accessToken, obra).catch(() => {})
  }

  if (obraSeleccionadaId) {
    if (obraSeleccionada) {
      return (
        <DetalleObraAceptada
          presupuesto={obraSeleccionada}
          materiales={materialesPorObra.get(obraSeleccionada.obra) || []}
          confirmaciones={confirmacionesPorObra.get(obraSeleccionada.obra) || []}
          direccion={direccionesPorObra.get(obraSeleccionada.obra)}
          onCerrar={() => navigate('/obras-aceptadas')}
          onConfirmar={handleConfirmarCampo}
          onQuitar={handleQuitarConfirmacion}
          onCambiarMaterial={handleCambiarMaterial}
          onLeido={handleLeido}
          onVista={handleVista}
          onGuardarDireccion={handleGuardarDireccion}
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
          <div className="filtro-campo">
            <label htmlFor="filtro-estatus-obra">Estatus</label>
            <select
              id="filtro-estatus-obra"
              className="select-inline"
              value={filtroEstatus}
              onChange={(e) => setFiltroEstatus(e.target.value)}
            >
              <option value="Activas">Activas (sin Terminada)</option>
              {ESTATUS_ACEPTADA_OPCIONES.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
              <option value="Todos">Todos</option>
            </select>
          </div>
          {conNotas.length > 0 && (
            <button
              type="button"
              className={`filtro-con-notas ${soloConNotas ? 'filtro-con-notas-activo' : ''}`}
              onClick={() => setSoloConNotas((v) => !v)}
            >
              💬 {conNotas.length} con Notas
            </button>
          )}
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

      {!cargando && !error && filasFiltradas.length > 0 && gruposPorCliente.map((grupo) => (
        <section key={grupo.cliente} className="obras-seccion">
          <h2 className="obras-seccion-titulo">
            {grupo.cliente}
            <span className="obras-seccion-contador">{grupo.obras.length}</span>
          </h2>
          <div className="obras-lista-compacta">
            {grupo.obras.map((p, i) => (
              <ObraItemCompacto
                key={p.id}
                presupuesto={p}
                numero={i + 1}
                onAbrir={(id) => navigate(`/obras-aceptadas/${id}`)}
                onCambiarEstatus={handleCambiarEstatusObra}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
