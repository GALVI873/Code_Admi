import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useDeshacer, idVigente, marcarRecreado } from '../context/DeshacerContext.jsx'
import { prioridades, accionPrioridades } from '../api/client.js'
import DiagramaGantt, { diaANumero, numeroADia, hoyIso, lunesDe, formatoCorto } from '../components/DiagramaGantt.jsx'
import { COLOR_TERMINADO } from '../components/PlanificacionComun.jsx'
import { descargarPdfPrioridades } from '../components/PdfPrioridades.js'

// Prioridades — obras en fase de finalización (a pedido de Álvaro,
// 2026-09-30), solo admin. Reemplaza su planilla "Cronograma de obra —
// Vallehermoso, CEA, Manipa y Archanda".
//
// Un solo Gantt con todas las obras (segunda versión, a pedido de Álvaro):
//   - Cada OBRA es una fila que se despliega con un click; su barra es el
//     tiempo total de cierre (de la primera a la última tarea pendiente) y
//     arrastrarla corre todas sus tareas juntas.
//   - Adentro, sus FACHADAS (zonas, ej. Cea Bermudez → CEA y Vallehermoso),
//     también desplegables y con su propia barra de tiempo total.
//   - Debajo, las TAREAS: categoría, descripción (con marcas Falta
//     material / Pend. Ppto / En curso y el resaltado amarillo de
//     "Destacada"), responsable y fechas; la barra se arrastra/estira y un
//     click abre la tarea para editarla.
// Categorías y fachadas son de cada obra (se agregan, renombran y borran
// desde "Categorías y fachadas"). Datos: public/api/prioridades.php.

const ESCALAS = {
  Semana: { dias: 14, anchoDia: 56, paso: 7 },
  Mes: { dias: 35, anchoDia: 26, paso: 14 },
  Trimestre: { dias: 91, anchoDia: 12, paso: 28 },
}
const ANCHO_ETIQUETA = 720
const CLAVE_DESPLEGADAS = 'prioridades.obrasDesplegadas'

function conIds(d) {
  return {
    ...d,
    obras: d.obras.map((o) => ({ ...o, id: Number(o.id) })),
    categorias: d.categorias.map((c) => ({ ...c, id: Number(c.id), obra_id: Number(c.obra_id) })),
    zonas: (d.zonas || []).map((z) => ({ ...z, id: Number(z.id), obra_id: Number(z.obra_id) })),
    acciones: (d.acciones || []).map((a) => ({ ...a, id: Number(a.id), obra_id: Number(a.obra_id) })),
    tareas: d.tareas.map(tareaConIds),
  }
}

function tareaConIds(t) {
  return {
    ...t,
    id: Number(t.id),
    obra_id: Number(t.obra_id),
    categoria_id: t.categoria_id ? Number(t.categoria_id) : null,
    zona_id: t.zona_id ? Number(t.zona_id) : null,
    accion_id: t.accion_id ? Number(t.accion_id) : null,
    falta_material: Number(t.falta_material),
    pendiente_ppto: Number(t.pendiente_ppto),
    destacada: Number(t.destacada),
  }
}

function textoFechas(t) {
  if (!t.fecha_inicio) return 'Sin fecha'
  return t.fecha_fin && t.fecha_fin !== t.fecha_inicio ? `${formatoCorto(t.fecha_inicio)} → ${formatoCorto(t.fecha_fin)}` : formatoCorto(t.fecha_inicio)
}

function formatoLargo(iso) {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function diasHabiles(ini, fin) {
  let n = 0
  for (let d = ini; d <= fin; d++) {
    const dia = new Date(d * 86400000).getUTCDay()
    if (dia !== 0 && dia !== 6) n++
  }
  return n
}

// Tramo total de un grupo de tareas (obra o fachada): de la primera a la
// última PENDIENTE con fecha (si ya están todas terminadas, de todas).
function tramo(tareas) {
  const pendientes = tareas.filter((t) => t.estado !== 'Terminado' && t.fecha_inicio)
  const base = pendientes.length ? pendientes : tareas.filter((t) => t.fecha_inicio)
  if (base.length === 0) return null
  const ini = Math.min(...base.map((t) => diaANumero(t.fecha_inicio)))
  const fin = Math.max(...base.map((t) => diaANumero(t.fecha_fin || t.fecha_inicio)))
  return { ini, fin, ids: pendientes.map((t) => t.id), habiles: diasHabiles(ini, fin), terminado: pendientes.length === 0 }
}

function resumenObra(obra, tareas) {
  const pendientes = tareas.filter((t) => t.estado !== 'Terminado')
  const t = tramo(tareas)
  const partes = [`${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} de ${tareas.length}`]
  let clase = ''
  if (t && !t.terminado) {
    partes.push(`cierre ${formatoLargo(numeroADia(t.fin))} (${t.habiles} días háb.)`)
    if (obra.fecha_objetivo) {
      const diff = t.fin - diaANumero(obra.fecha_objetivo)
      if (diff > 0) {
        partes.push(`${diff} día${diff === 1 ? '' : 's'} por encima del objetivo`)
        clase = 'prio-resumen-tarde'
      } else {
        partes.push(diff === 0 ? 'justo en el objetivo' : `${-diff} día${diff === -1 ? '' : 's'} antes del objetivo`)
        clase = 'prio-resumen-bien'
      }
    }
  } else if (tareas.length > 0 && pendientes.length === 0) {
    partes.push('todo terminado')
    clase = 'prio-resumen-bien'
  }
  const sinFecha = pendientes.filter((x) => !x.fecha_inicio).length
  if (sinFecha) partes.push(`${sinFecha} sin fecha`)
  return { texto: partes.join(' · '), clase }
}

// Personas de un responsable escrito a mano ("Miguel / German",
// "Ever, Javi") — para el filtro por encargado.
function personasDe(responsable) {
  return String(responsable || '').split(/[/,]/).map((x) => x.trim()).filter(Boolean)
}

function leerDesplegadas() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE_DESPLEGADAS) || '[]'))
  } catch {
    return new Set()
  }
}

// Campo de texto que guarda al salir, no en cada tecla.
function CampoTexto({ valor, onGuardar, placeholder, className = 'input-filtro' }) {
  const [texto, setTexto] = useState(valor || '')
  useEffect(() => setTexto(valor || ''), [valor])
  return (
    <input
      type="text"
      className={className}
      value={texto}
      placeholder={placeholder}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if (texto.trim() !== (valor || '')) onGuardar(texto.trim()) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

// Lista de nombres con color de una obra (Categorías y Acciones funcionan
// igual: agregar, renombrar, cambiar color, borrar).
function ListaConColor({ obra, items, colores, tipo, etiqueta, placeholder, onAccion }) {
  const [nuevo, setNuevo] = useState('')
  return (
    <div className="prio-categorias">
      {items.map((c) => (
        <div key={c.id} className="prio-categoria">
          <span className="prio-categoria-color" style={{ background: c.color }} />
          <CampoTexto className="input-filtro prio-categoria-nombre" valor={c.nombre}
            onGuardar={(v) => v && onAccion('PATCH', `actualizar_${tipo}`, { id: c.id, nombre: v })} />
          <div className="prio-colores">
            {colores.map((col) => (
              <button key={col} type="button" className={`prio-color${col === c.color ? ' prio-color-activo' : ''}`} style={{ background: col }}
                title="Cambiar color" onClick={() => onAccion('PATCH', `actualizar_${tipo}`, { id: c.id, color: col })} />
            ))}
          </div>
          <button type="button" className="boton-icono boton-icono-eliminar" title={`Eliminar ${etiqueta}`}
            onClick={() => { if (window.confirm(`¿Eliminar "${c.nombre}"? Las tareas que la usan quedan sin ${etiqueta}.`)) onAccion('DELETE', `eliminar_${tipo}`, { id: c.id }) }}>−</button>
        </div>
      ))}
      <form className="prio-categoria-nueva" onSubmit={(e) => {
        e.preventDefault()
        if (nuevo.trim()) onAccion('POST', `agregar_${tipo}`, { obra_id: obra.id, nombre: nuevo.trim() }).then(() => setNuevo(''))
      }}>
        <input type="text" className="input-filtro" placeholder={placeholder} value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button type="submit" className="btn-secundario" disabled={!nuevo.trim()}>+ Agregar</button>
      </form>
    </div>
  )
}

// Ventana para administrar fachadas, categorías y acciones de una obra.
function VentanaCategoriasFachadas({ obra, categorias, acciones, zonas, colores, onAccion, onCerrar }) {
  const [nuevaZona, setNuevaZona] = useState('')
  return (
    <div className="plan-ventana-fondo" onClick={onCerrar}>
      <div className="plan-ventana prio-ventana-grande" onClick={(e) => e.stopPropagation()}>
        <div className="plan-ventana-encabezado">
          <h2>{obra.alias || obra.obra}</h2>
          <button type="button" className="plan-ventana-cerrar" onClick={onCerrar} title="Cerrar">✕</button>
        </div>

        <h3 className="montaje-subtitulo">Fachadas / zonas</h3>
        <p className="dashboard-nota plan-nota-sin-margen">Dividen la obra en partes (ej. CEA y Vallehermoso). Al borrar una, sus tareas quedan en la obra.</p>
        <div className="prio-categorias">
          {zonas.map((z) => (
            <div key={z.id} className="prio-categoria">
              <CampoTexto className="input-filtro prio-categoria-nombre" valor={z.nombre}
                onGuardar={(v) => v && onAccion('PATCH', 'actualizar_zona', { id: z.id, nombre: v })} />
              <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar fachada"
                onClick={() => { if (window.confirm(`¿Eliminar la fachada "${z.nombre}"? Sus tareas quedan en la obra.`)) onAccion('DELETE', 'eliminar_zona', { id: z.id }) }}>−</button>
            </div>
          ))}
          <form className="prio-categoria-nueva" onSubmit={(e) => {
            e.preventDefault()
            if (nuevaZona.trim()) onAccion('POST', 'agregar_zona', { obra_id: obra.id, nombre: nuevaZona.trim() }).then(() => setNuevaZona(''))
          }}>
            <input type="text" className="input-filtro" placeholder="Nueva fachada (ej. Fachada norte, Portal 2…)" value={nuevaZona} onChange={(e) => setNuevaZona(e.target.value)} />
            <button type="submit" className="btn-secundario" disabled={!nuevaZona.trim()}>+ Agregar</button>
          </form>
        </div>

        <h3 className="montaje-subtitulo">Categorías</h3>
        <ListaConColor obra={obra} items={categorias} colores={colores} tipo="categoria" etiqueta="categoría"
          placeholder="Nueva categoría (ej. Cristalería, Limpieza…)" onAccion={onAccion} />

        <h3 className="montaje-subtitulo">Acciones</h3>
        <ListaConColor obra={obra} items={acciones} colores={colores} tipo="accion" etiqueta="acción"
          placeholder="Nueva acción (ej. Esperando cliente, Pedir material…)" onAccion={onAccion} />
      </div>
    </div>
  )
}

// Desplegable con opción "+ Nueva…" al final (a pedido de Álvaro,
// 2026-10-01): crear una categoría/acción/fachada desde la misma tarea, sin
// ir a "Categorías, acciones y fachadas". onCrear(nombre) devuelve el id
// nuevo, que queda elegido.
const NUEVA = '__nueva__'
function SelectConNueva({ etiqueta, valor, opciones, textoVacio, placeholder, onCambio, onCrear }) {
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function crear() {
    const n = nombre.trim()
    if (!n || enviando) return
    setEnviando(true)
    const id = await onCrear(n)
    setEnviando(false)
    if (id) {
      onCambio(id)
      setCreando(false)
      setNombre('')
    }
  }

  return (
    <label>
      {etiqueta}
      {creando ? (
        <span className="prio-nueva-inline">
          <input
            autoFocus
            type="text"
            className="input-filtro"
            placeholder={placeholder}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); crear() }
              if (e.key === 'Escape') { e.preventDefault(); setCreando(false) }
            }}
          />
          <button type="button" className="btn-secundario plan-boton-principal" disabled={!nombre.trim() || enviando} onClick={crear}>Crear</button>
          <button type="button" className="btn-secundario" title="Cancelar" onClick={() => setCreando(false)}>✕</button>
        </span>
      ) : (
        <select className="select-inline" value={valor} onChange={(e) => {
          if (e.target.value === NUEVA) setCreando(true)
          else onCambio(Number(e.target.value) || '')
        }}>
          <option value="">{textoVacio}</option>
          {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          <option value={NUEVA}>+ Nueva…</option>
        </select>
      )}
    </label>
  )
}

function fechaHora(sqlUtc) {
  if (!sqlUtc) return ''
  const f = new Date(sqlUtc.replace(' ', 'T') + 'Z')
  return `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')} ${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`
}

// Pasarle la tarea a Alfredo como nota URGENTE en Seguimiento → Notas (a
// pedido de Álvaro, 2026-10-01) — ver "enviar_a_alfredo" en prioridades.php.
function EnviarAAlfredo({ tarea, onEnviar }) {
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const yaEnviada = Boolean(tarea.alfredo_enviado_en)

  async function enviar(reenviar) {
    setEnviando(true)
    setError('')
    try {
      await onEnviar(tarea.id, nota.trim(), reenviar)
      setNota('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="plan-ventana-ancho prio-enviar-alfredo">
      {yaEnviada && <span>Enviada a Alfredo el {fechaHora(tarea.alfredo_enviado_en)}</span>}
      <input type="text" className="input-filtro" placeholder="Mensaje para Alfredo (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
      <button type="button" className="btn-secundario prio-boton-urgente" disabled={enviando} onClick={() => enviar(yaEnviada)}>
        {enviando ? 'Enviando…' : yaEnviada ? 'Reenviar a Alfredo' : 'Enviar a Alfredo (urgente)'}
      </button>
      {error && <span className="auth-error">{error}</span>}
    </div>
  )
}

function VentanaTarea({ tarea, obra, categorias, acciones, zonas, estados, responsables, puedeEditar, puedeEnviarAlfredo, onGuardar, onEliminar, onCrear, onEnviarAlfredo, onCerrar }) {
  const [form, setForm] = useState({
    descripcion: tarea.descripcion || '',
    categoria_id: tarea.categoria_id || '',
    zona_id: tarea.zona_id || '',
    accion_id: tarea.accion_id || '',
    responsable: tarea.responsable || '',
    fecha_inicio: tarea.fecha_inicio || '',
    fecha_fin: tarea.fecha_fin || '',
    estado: tarea.estado,
    destacada: !!tarea.destacada,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function handleGuardar(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await onGuardar(tarea.id, { ...form, categoria_id: form.categoria_id || null, zona_id: form.zona_id || null, accion_id: form.accion_id || null })
      onCerrar()
    } catch (err) {
      setError(err.message)
      setGuardando(false)
    }
  }

  return (
    <div className="plan-ventana-fondo" onClick={onCerrar}>
      <div className="plan-ventana prio-ventana" onClick={(e) => e.stopPropagation()}>
        <div className="plan-ventana-encabezado">
          <h2>{obra.alias || obra.obra}</h2>
          <button type="button" className="plan-ventana-cerrar" onClick={onCerrar} title="Cerrar">✕</button>
        </div>
        <form className="plan-ventana-form" onSubmit={handleGuardar}>
          {/* Sin permiso de edición, todo deshabilitado (hoy admin y Alfredo editan). */}
          <fieldset className="prio-fieldset plan-ventana-ancho" disabled={!puedeEditar}>
          <div className="plan-ventana-form prio-fieldset-interior">
          <label className="plan-ventana-ancho">
            Tarea
            <textarea autoFocus className="input-filtro" rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </label>
          <SelectConNueva etiqueta="Fachada / zona" valor={form.zona_id} opciones={zonas} textoVacio="— Obra en general —"
            placeholder="Nombre de la fachada" onCambio={(v) => setForm((f) => ({ ...f, zona_id: v }))} onCrear={(n) => onCrear('zona', obra.id, n)} />
          <SelectConNueva etiqueta="Categoría" valor={form.categoria_id} opciones={categorias} textoVacio="— Sin categoría —"
            placeholder="Nombre de la categoría" onCambio={(v) => setForm((f) => ({ ...f, categoria_id: v }))} onCrear={(n) => onCrear('categoria', obra.id, n)} />
          <SelectConNueva etiqueta="Acción" valor={form.accion_id} opciones={acciones} textoVacio="— Ninguna —"
            placeholder="Nombre de la acción" onCambio={(v) => setForm((f) => ({ ...f, accion_id: v }))} onCrear={(n) => onCrear('accion', obra.id, n)} />
          <label>
            Estado
            <select className="select-inline" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
              {estados.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Montador / Responsable
            <input type="text" className="input-filtro" list="prio-responsables" placeholder="Ej. Miguel / German" value={form.responsable}
              onChange={(e) => setForm({ ...form, responsable: e.target.value })} />
          </label>
          <label>
            Inicio
            <input type="date" className="input-filtro" value={form.fecha_inicio}
              onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value, fecha_fin: form.fecha_fin && e.target.value > form.fecha_fin ? e.target.value : form.fecha_fin })} />
          </label>
          <label>
            Fin
            <input type="date" className="input-filtro" value={form.fecha_fin} min={form.fecha_inicio || undefined} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
          </label>
          <div className="plan-ventana-ancho prio-marcas">
            <label className="plan-check"><input type="checkbox" checked={form.destacada} onChange={(e) => setForm({ ...form, destacada: e.target.checked })} /> Destacar (resaltado amarillo)</label>
          </div>
          </div>
          </fieldset>
          {puedeEnviarAlfredo && <EnviarAAlfredo tarea={tarea} onEnviar={onEnviarAlfredo} />}
          <datalist id="prio-responsables">
            {responsables.map((r) => <option key={r} value={r} />)}
          </datalist>
          {error && <div className="auth-error plan-ventana-ancho">{error}</div>}
          {puedeEditar ? (
            <div className="plan-ventana-acciones plan-ventana-ancho prio-ventana-acciones">
              <button type="button" className="btn-secundario plan-boton-peligro"
                onClick={() => { if (window.confirm('¿Eliminar esta tarea?')) onEliminar(tarea.id).then(onCerrar) }}>Eliminar</button>
              <span className="prio-espaciador" />
              <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn-secundario plan-boton-principal" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          ) : (
            <div className="plan-ventana-acciones plan-ventana-ancho">
              <button type="button" className="btn-secundario" onClick={onCerrar}>Cerrar</button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

function EtiquetaTarea({ tarea, categoria, accion, nivel, onAbrir }) {
  return (
    <button type="button" className={`prio-fila prio-nivel-${nivel}${tarea.estado === 'Terminado' ? ' prio-fila-terminada' : ''}`} onClick={onAbrir} title="Editar tarea">
      <span className="prio-col-categoria">
        <span className="plan-chip" style={{ background: categoria?.color || '#e6e9eb' }}>{categoria?.nombre || 'Sin categoría'}</span>
      </span>
      {/* Columna "Acción" (a pedido de Álvaro, 2026-10-01): las marcas van
          aparte de la descripción, como en su planilla. */}
      <span className="prio-col-accion">
        {accion && <span className="prio-marca prio-marca-accion" style={{ background: accion.color }}>{accion.nombre}</span>}
        {tarea.alfredo_enviado_en && <span className="prio-marca prio-marca-alfredo" title={`Enviada a Alfredo el ${fechaHora(tarea.alfredo_enviado_en)}`}>Enviada a Alfredo</span>}
      </span>
      <span className={`prio-col-tarea${tarea.destacada ? ' prio-destacada' : ''}`}>
        <span className="prio-descripcion">{tarea.descripcion || <em>Sin descripción</em>}</span>
      </span>
      {/* Estado en lugar de Responsable (a pedido de Álvaro, 2026-10-01):
          el responsable ya se lee en la barra del diagrama. */}
      <span className="prio-col-estado">
        <span className={`prio-estado prio-estado-${(tarea.estado || 'Pendiente').toLowerCase().replace(' ', '-')}`}>{tarea.estado}</span>
      </span>
      <span className="prio-col-fechas">{textoFechas(tarea)}</span>
    </button>
  )
}

export default function PrioridadesPage() {
  const { accessToken, usuario } = useAuth()
  const navigate = useNavigate()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [escala, setEscala] = useState('Mes')
  const [desde, setDesde] = useState(() => numeroADia(diaANumero(lunesDe(hoyIso())) - 7))
  const [verTerminadas, setVerTerminadas] = useState(true)
  const [obraNueva, setObraNueva] = useState('')
  const [tareaAbierta, setTareaAbierta] = useState(null)
  const [obraConfigurando, setObraConfigurando] = useState(null)
  const [desplegadas, setDesplegadas] = useState(leerDesplegadas)
  const [zonasPlegadas, setZonasPlegadas] = useState(() => new Set())
  const [generandoPdf, setGenerandoPdf] = useState(false)
  // Filtros (a pedido de Álvaro, 2026-10-01): por nombre de categoría (las
  // categorías son de cada obra, se agrupan por nombre) y por encargado.
  // Aplican al diagrama y al PDF; con un filtro activo solo aparecen las
  // obras/fachadas que tienen alguna tarea que coincida, y sus barras de
  // tiempo total se calculan sobre esas tareas.
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroEncargado, setFiltroEncargado] = useState('')

  // Ver: admin y Alfredo (gestion_obras); editar: lo dice el servidor
  // (puede_editar, solo admin).
  const esAdmin = usuario?.roles?.includes('admin') || usuario?.roles?.includes('gestion_obras')

  function recargar() {
    return prioridades(accessToken).then((d) => setDatos(conIds(d)))
  }

  useEffect(() => {
    if (!esAdmin) return
    recargar().catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, esAdmin])

  function alternarObra(id) {
    setDesplegadas((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      try { localStorage.setItem(CLAVE_DESPLEGADAS, JSON.stringify([...n])) } catch { /* sin almacenamiento */ }
      return n
    })
  }

  function alternarZona(id) {
    setZonasPlegadas((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // --- Deshacer (Ctrl+Z, común a todo el panel — ver
  // context/DeshacerContext.jsx). Cada escritura registra su paso inverso;
  // después de deshacer se vuelve a leer todo. Quitar una obra entera y
  // "Enviar a Alfredo" no se deshacen (lo primero pide confirmación, lo
  // segundo ya le llegó a Alfredo).
  const { registrar } = useDeshacer()
  const datosRef = useRef(datos)
  useEffect(() => { datosRef.current = datos }, [datos])
  const api = (metodo, nombre, cuerpo) => accionPrioridades(accessToken, metodo, nombre, cuerpo)
  const nombreObraPrio = (d, obraId) => {
    const o = d.obras.find((x) => x.id === obraId)
    return o ? o.alias || o.obra : 'obra'
  }
  function registrarDeshacer(descripcion, fn) {
    registrar(`Prioridades: ${descripcion}`, async () => {
      try {
        await fn()
      } finally {
        await recargar().catch(() => {})
      }
    })
  }
  const LISTAS = {
    categoria: { lista: 'categorias', campo: 'categoria_id', texto: 'categoría' },
    accion: { lista: 'acciones', campo: 'accion_id', texto: 'acción' },
    zona: { lista: 'zonas', campo: 'zona_id', texto: 'fachada' },
  }
  const CAMPOS_TAREA = ['descripcion', 'responsable', 'categoria_id', 'zona_id', 'accion_id', 'fecha_inicio', 'fecha_fin', 'estado', 'falta_material', 'pendiente_ppto', 'destacada']
  const normalizarCampo = (v) => (typeof v === 'boolean' ? Number(v) : v ?? '')

  // Vuelve a crear una tarea borrada tal como estaba (dos llamadas: alta y
  // resto de campos) y anota su id nuevo.
  async function recrearTarea(t) {
    const r = await api('POST', 'agregar_tarea', {
      obra_id: t.obra_id,
      categoria_id: t.categoria_id ? idVigente('prio-categoria', t.categoria_id) : null,
      zona_id: t.zona_id ? idVigente('prio-zona', t.zona_id) : null,
      descripcion: t.descripcion,
    })
    const nuevoId = Number(r.tarea.id)
    await api('PATCH', 'actualizar_tarea', {
      id: nuevoId,
      responsable: t.responsable,
      accion_id: t.accion_id ? idVigente('prio-accion', t.accion_id) : null,
      fecha_inicio: t.fecha_inicio || '',
      fecha_fin: t.fecha_fin || '',
      estado: t.estado,
      falta_material: t.falta_material,
      pendiente_ppto: t.pendiente_ppto,
      destacada: t.destacada,
    })
    marcarRecreado('prio-tarea', t.id, nuevoId)
  }

  // Paso inverso de una escritura de accion(): d = datos de ANTES, r = respuesta.
  function registrarInverso(nombre, cuerpo, r, d) {
    const [verbo, tipo] = nombre.split('_')
    if (nombre === 'agregar_obra' && r?.obra) {
      const id = Number(r.obra.id)
      registrarDeshacer(`agregar ${cuerpo.obra}`, () => api('DELETE', 'eliminar_obra', { id }))
    } else if (nombre === 'actualizar_obra') {
      const o = d.obras.find((x) => x.id === cuerpo.id)
      if (!o) return
      const previos = Object.fromEntries(Object.keys(cuerpo).filter((k) => k !== 'id').map((k) => [k, o[k] ?? '']))
      registrarDeshacer(`cambio en ${nombreObraPrio(d, o.id)}`, () => api('PATCH', 'actualizar_obra', { id: o.id, ...previos }))
    } else if (LISTAS[tipo]) {
      const { lista, campo, texto } = LISTAS[tipo]
      const espacio = `prio-${tipo}`
      if (verbo === 'agregar' && r?.[tipo]) {
        const id = Number(r[tipo].id)
        registrarDeshacer(`agregar ${texto} "${cuerpo.nombre}"`, () => api('DELETE', `eliminar_${tipo}`, { id: idVigente(espacio, id) }))
      } else if (verbo === 'actualizar') {
        const previo = d[lista].find((x) => x.id === cuerpo.id)
        if (!previo) return
        const previos = Object.fromEntries(Object.keys(cuerpo).filter((k) => k !== 'id').map((k) => [k, previo[k]]))
        registrarDeshacer(`cambiar ${texto} "${previo.nombre}"`, () => api('PATCH', `actualizar_${tipo}`, { id: idVigente(espacio, previo.id), ...previos }))
      } else if (verbo === 'eliminar') {
        const previo = d[lista].find((x) => x.id === cuerpo.id)
        if (!previo) return
        const tareas = d.tareas.filter((t) => t[campo] === previo.id).map((t) => t.id)
        registrarDeshacer(`eliminar ${texto} "${previo.nombre}"`, async () => {
          const rr = await api('POST', `agregar_${tipo}`, { obra_id: previo.obra_id, nombre: previo.nombre, ...(previo.color ? { color: previo.color } : {}) })
          const nuevoId = Number(rr[tipo].id)
          marcarRecreado(espacio, previo.id, nuevoId)
          await Promise.all(tareas.map((id) => api('PATCH', 'actualizar_tarea', { id: idVigente('prio-tarea', id), [campo]: nuevoId })))
        })
      }
    } else if (nombre === 'agregar_tarea' && r?.tarea) {
      const id = Number(r.tarea.id)
      registrarDeshacer(`agregar tarea en ${nombreObraPrio(d, cuerpo.obra_id)}`, () => api('DELETE', 'eliminar_tarea', { id: idVigente('prio-tarea', id) }))
    } else if (nombre === 'eliminar_tarea') {
      const t = d.tareas.find((x) => x.id === cuerpo.id)
      if (t) registrarDeshacer(`eliminar tarea "${t.descripcion || 'sin descripción'}"`, () => recrearTarea(t))
    }
  }

  // Todas las escrituras de estructura pasan por acá y después se vuelve a
  // leer todo: son pocas obras y pocas tareas, así nunca queda desfasado.
  async function accion(metodo, nombre, cuerpo) {
    setError('')
    const antes = datosRef.current
    try {
      const r = await accionPrioridades(accessToken, metodo, nombre, cuerpo)
      await recargar()
      if (antes) registrarInverso(nombre, cuerpo, r, antes)
      return r
    } catch (err) {
      setError(err.message)
      return null
    }
  }

  // Crea una categoría/acción/fachada desde la ventana de una tarea y
  // devuelve su id (la lista se recarga sola en accion()).
  async function crearDesdeTarea(tipo, obraId, nombre) {
    const r = await accion('POST', `agregar_${tipo}`, { obra_id: obraId, nombre })
    const nuevo = r && r[tipo]
    return nuevo ? Number(nuevo.id) : null
  }

  async function enviarAAlfredo(id, nota, reenviar) {
    const r = await accionPrioridades(accessToken, 'POST', 'enviar_a_alfredo', { id, nota, reenviar })
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? tareaConIds(r.tarea) : t)) }))
  }

  async function guardarTarea(id, cambios) {
    const anterior = datosRef.current?.tareas.find((t) => t.id === id)
    const r = await accionPrioridades(accessToken, 'PATCH', 'actualizar_tarea', { id, ...cambios })
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? tareaConIds(r.tarea) : t)) }))
    if (cambios.responsable) recargar()
    const claves = Object.keys(cambios).filter((k) => CAMPOS_TAREA.includes(k))
    if (anterior && claves.some((k) => normalizarCampo(anterior[k]) !== normalizarCampo(cambios[k]))) {
      const previos = Object.fromEntries(claves.map((k) => [k, k.startsWith('fecha') ? anterior[k] || '' : anterior[k]]))
      registrarDeshacer(`cambio en "${anterior.descripcion || 'tarea'}"`, () => api('PATCH', 'actualizar_tarea', { id: idVigente('prio-tarea', id), ...previos }))
    }
  }

  // Corre un conjunto de tareas "delta" días (barra de una tarea, de una
  // fachada o de la obra entera). Pantalla primero, servidor después; si
  // falla, se recarga todo.
  function moverTareas(ids, delta, estirar = null) {
    const correr = (iso) => (iso ? numeroADia(diaANumero(iso) + delta) : iso)
    const movidas = datos.tareas.filter((t) => ids.includes(t.id) && t.fecha_inicio)
    const cambios = new Map(
      movidas.map((t) => [
        t.id,
        estirar && estirar.id === t.id ? { fecha_inicio: estirar.inicio, fecha_fin: estirar.fin } : { fecha_inicio: correr(t.fecha_inicio), fecha_fin: correr(t.fecha_fin) },
      ]),
    )
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (cambios.has(t.id) ? { ...t, ...cambios.get(t.id) } : t)) }))
    Promise.all([...cambios].map(([id, c]) => accionPrioridades(accessToken, 'PATCH', 'actualizar_tarea', { id, ...c })))
      .then(() => {
        const descripcion = movidas.length === 1 ? `mover "${movidas[0].descripcion || 'tarea'}"` : `mover ${movidas.length} tareas`
        registrarDeshacer(descripcion, () => Promise.all(movidas.map((t) => api('PATCH', 'actualizar_tarea', {
          id: idVigente('prio-tarea', t.id),
          fecha_inicio: t.fecha_inicio || '',
          fecha_fin: t.fecha_fin || '',
        }))))
      })
      .catch((err) => {
        setError(err.message)
        recargar()
      })
  }

  function handleMoverBarra(b, inicio, fin) {
    if (b.grupo) {
      const delta = diaANumero(inicio) - diaANumero(b.inicio)
      if (delta) moverTareas(b.grupo, delta)
    } else {
      moverTareas([b.tarea.id], 0, { id: b.tarea.id, inicio, fin })
    }
  }

  const hayFiltro = Boolean(filtroCategoria || filtroEncargado)
  const datosFiltrados = useMemo(() => {
    if (!datos || !hayFiltro) return datos
    const nombreCategoria = new Map(datos.categorias.map((c) => [c.id, c.nombre]))
    const tareas = datos.tareas.filter((t) =>
      (!filtroCategoria || nombreCategoria.get(t.categoria_id) === filtroCategoria)
      && (!filtroEncargado || personasDe(t.responsable).includes(filtroEncargado)))
    const obrasConTareas = new Set(tareas.map((t) => t.obra_id))
    return { ...datos, tareas, obras: datos.obras.filter((o) => obrasConTareas.has(o.id)) }
  }, [datos, hayFiltro, filtroCategoria, filtroEncargado])

  const filas = useMemo(() => {
    if (!datos) return []
    const resultado = []
    const fuente = datosFiltrados
    for (const obra of fuente.obras) {
      const categoriasPorId = new Map(datos.categorias.filter((c) => c.obra_id === obra.id).map((c) => [c.id, c]))
      const accionesPorId = new Map(datos.acciones.filter((a) => a.obra_id === obra.id).map((a) => [a.id, a]))
      const zonas = datos.zonas.filter((z) => z.obra_id === obra.id)
      const todas = fuente.tareas.filter((t) => t.obra_id === obra.id)
      const visibles = todas
        .filter((t) => verTerminadas || t.estado !== 'Terminado')
        .sort((a, b) => (a.fecha_inicio || '9999').localeCompare(b.fecha_inicio || '9999') || a.id - b.id)
      const abierta = desplegadas.has(obra.id)
      const tObra = tramo(todas)
      const resumen = resumenObra(obra, todas)

      resultado.push({
        id: `obra-${obra.id}`,
        esGrupo: true,
        altoMinimo: 50,
        clase: 'prio-gantt-obra',
        etiquetaNode: (
          <button type="button" className="prio-fila-obra" onClick={() => alternarObra(obra.id)} title={abierta ? 'Plegar' : 'Desplegar tareas'}>
            <span className="prio-flecha">{abierta ? '▾' : '▸'}</span>
            <span className="prio-obra-textos">
              <span className="prio-obra-nombre">{obra.alias || obra.obra}{obra.nota ? <span className="prio-obra-nota-texto"> · {obra.nota}</span> : null}</span>
              <span className={`prio-obra-resumen ${resumen.clase}`}>{resumen.texto}</span>
            </span>
          </button>
        ),
        barras: tObra ? [{
          id: `obra-${obra.id}`,
          inicio: numeroADia(tObra.ini),
          fin: numeroADia(tObra.fin),
          texto: `Cierre: ${formatoCorto(numeroADia(tObra.ini))} → ${formatoCorto(numeroADia(tObra.fin))} · ${tObra.habiles} días háb.`,
          titulo: `${obra.alias || obra.obra} — tiempo total de cierre (arrastrar para mover todas sus tareas pendientes)`,
          clase: 'gantt-barra-obra',
          soloMover: true,
          grupo: tObra.ids,
        }] : [],
      })
      if (!abierta) continue

      if (datos.puede_editar) resultado.push({
        id: `acciones-${obra.id}`,
        altoMinimo: 44,
        clase: 'prio-gantt-acciones',
        etiquetaNode: (
          <div className="prio-acciones-obra">
            <button type="button" className="btn-secundario plan-boton-principal"
              onClick={() => accion('POST', 'agregar_tarea', { obra_id: obra.id, categoria_id: [...categoriasPorId.keys()][0] || null }).then((r) => r?.tarea && setTareaAbierta(Number(r.tarea.id)))}>
              + Tarea
            </button>
            <button type="button" className="btn-secundario" onClick={() => setObraConfigurando(obra.id)}>Categorías, acciones y fachadas</button>
            <label className="prio-objetivo-inline" title="Fecha objetivo de fin de obra">
              Objetivo
              <input type="date" className="input-filtro" value={obra.fecha_objetivo || ''}
                onChange={(e) => accion('PATCH', 'actualizar_obra', { id: obra.id, fecha_objetivo: e.target.value })} />
            </label>
            <span className="prio-espaciador" />
            <button type="button" className="btn-secundario" onClick={() => navigate(`/obras-aceptadas/${datos.obras_panel.find((p) => p.obra === obra.obra)?.id || ''}`)} title="Abrir en Obras Aceptadas">↗</button>
            <button type="button" className="btn-secundario plan-boton-peligro" title="Quitar de Prioridades"
              onClick={() => { if (window.confirm(`¿Quitar "${obra.alias || obra.obra}" de Prioridades? Se borran sus categorías, fachadas y tareas.`)) accion('DELETE', 'eliminar_obra', { id: obra.id }) }}>
              Quitar
            </button>
          </div>
        ),
        barras: [],
      })

      const filaTarea = (t, nivel) => {
        const categoria = categoriasPorId.get(t.categoria_id)
        return {
          id: `tarea-${t.id}`,
          altoMinimo: 38,
          clase: t.destacada ? 'prio-gantt-fila-destacada' : '',
          etiquetaNode: <EtiquetaTarea tarea={t} categoria={categoria} accion={accionesPorId.get(t.accion_id)} nivel={nivel} onAbrir={() => setTareaAbierta(t.id)} />,
          barras: t.fecha_inicio ? [{
            id: t.id,
            inicio: t.fecha_inicio,
            fin: t.fecha_fin,
            texto: t.responsable || '',
            titulo: `${t.descripcion}${t.responsable ? ` — ${t.responsable}` : ''}`,
            color: t.estado === 'Terminado' ? COLOR_TERMINADO : categoria?.color || '#dde2e7',
            atenuada: t.estado === 'Terminado',
            tarea: t,
          }] : [],
        }
      }

      for (const t of visibles.filter((x) => !x.zona_id || !zonas.some((z) => z.id === x.zona_id))) {
        resultado.push(filaTarea(t, 1))
      }
      for (const z of zonas) {
        const deZona = visibles.filter((t) => t.zona_id === z.id)
        if (hayFiltro && deZona.length === 0) continue
        const tZona = tramo(todas.filter((t) => t.zona_id === z.id))
        const zonaAbierta = !zonasPlegadas.has(z.id)
        const pendientesZona = deZona.filter((t) => t.estado !== 'Terminado').length
        resultado.push({
          id: `zona-${z.id}`,
          altoMinimo: 40,
          clase: 'prio-gantt-zona',
          etiquetaNode: (
            <div className="prio-fila-zona">
              <button type="button" className="prio-zona-boton" onClick={() => alternarZona(z.id)}>
                <span className="prio-flecha">{zonaAbierta ? '▾' : '▸'}</span>
                <span className="prio-zona-nombre">{z.nombre}</span>
                <span className="prio-zona-contador">{pendientesZona} pendiente{pendientesZona === 1 ? '' : 's'}</span>
              </button>
              {datos.puede_editar && <button type="button" className="prio-zona-agregar" title={`Agregar tarea en ${z.nombre}`}
                onClick={() => accion('POST', 'agregar_tarea', { obra_id: obra.id, zona_id: z.id, categoria_id: [...categoriasPorId.keys()][0] || null }).then((r) => r?.tarea && setTareaAbierta(Number(r.tarea.id)))}>
                + tarea
              </button>}
            </div>
          ),
          barras: tZona ? [{
            id: `zona-${z.id}`,
            inicio: numeroADia(tZona.ini),
            fin: numeroADia(tZona.fin),
            texto: `${z.nombre} · ${tZona.habiles} días háb.`,
            titulo: `${z.nombre} — tiempo total (arrastrar para mover sus tareas pendientes)`,
            clase: 'gantt-barra-zona',
            soloMover: true,
            grupo: tZona.ids,
          }] : [],
        })
        if (zonaAbierta) {
          for (const t of deZona) resultado.push(filaTarea(t, 2))
        }
      }
    }
    return resultado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, datosFiltrados, hayFiltro, verTerminadas, desplegadas, zonasPlegadas])
  // (datos.puede_editar va dentro de datos)

  if (!esAdmin) return <div className="dashboard"><p className="dashboard-nota">No tienes acceso a Prioridades.</p></div>
  if (error && !datos) return <div className="dashboard"><div className="auth-error">{error}</div></div>
  if (!datos) return <div className="dashboard"><p className="dashboard-nota">Cargando…</p></div>

  const puedeEditar = Boolean(datos.puede_editar)
  const yaAgregadas = new Set(datos.obras.map((o) => o.obra))
  const nombresCategorias = [...new Set(datos.categorias.map((c) => c.nombre))].sort((a, b) => a.localeCompare(b, 'es'))
  const encargados = [...new Set(datos.tareas.flatMap((t) => personasDe(t.responsable)))].sort((a, b) => a.localeCompare(b, 'es'))
  const { dias, anchoDia, paso } = ESCALAS[escala]
  const tareaSeleccionada = tareaAbierta ? datos.tareas.find((t) => t.id === tareaAbierta) : null
  const obraConfig = obraConfigurando ? datos.obras.find((o) => o.id === obraConfigurando) : null

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Prioridades</h1>
          <p>Obras en fase de finalización — despliega cada obra para ver sus fachadas y tareas; la barra de la obra es su tiempo total de cierre</p>
        </div>
        {/* Informe PDF de todo el cronograma (a pedido de Álvaro, 2026-10-01),
            ver PdfPrioridades.js. Respeta "Ver terminadas". */}
        <button
          type="button"
          className="btn-secundario"
          disabled={generandoPdf || datosFiltrados.obras.length === 0}
          onClick={() => {
            setGenerandoPdf(true)
            descargarPdfPrioridades(datosFiltrados, {
              verTerminadas,
              filtro: [filtroCategoria && `Categoría: ${filtroCategoria}`, filtroEncargado && `Encargado: ${filtroEncargado}`].filter(Boolean).join(' · '),
            })
              .catch((err) => setError(`No se pudo generar el PDF: ${err.message}`))
              .finally(() => setGenerandoPdf(false))
          }}
        >
          {generandoPdf ? 'Generando…' : '📄 Descargar PDF'}
        </button>
      </header>

      <div className="filtro-tabla plan-filtros">
        <div className="plan-navegacion">
          <button type="button" className="btn-secundario" onClick={() => setDesde(numeroADia(diaANumero(desde) - paso))}>◀</button>
          <button type="button" className="btn-secundario" onClick={() => setDesde(lunesDe(hoyIso()))}>Hoy</button>
          <button type="button" className="btn-secundario" onClick={() => setDesde(numeroADia(diaANumero(desde) + paso))}>▶</button>
          <div className="seguimiento-pestanas plan-escalas">
            {Object.keys(ESCALAS).map((e) => (
              <button key={e} type="button" className={`seguimiento-pestana ${e === escala ? 'seguimiento-pestana-activa' : ''}`} onClick={() => setEscala(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div className="filtro-campo">
          <label>Categoría</label>
          <select className="select-inline prio-filtro" value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
            <option value="">Todas</option>
            {nombresCategorias.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div className="filtro-campo">
          <label>Encargado</label>
          <select className="select-inline prio-filtro" value={filtroEncargado} onChange={(e) => setFiltroEncargado(e.target.value)}>
            <option value="">Todos</option>
            {encargados.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        {hayFiltro && (
          <button type="button" className="btn-secundario" onClick={() => { setFiltroCategoria(''); setFiltroEncargado('') }}>Quitar filtros</button>
        )}
        <label className="plan-check">
          <input type="checkbox" checked={verTerminadas} onChange={(e) => setVerTerminadas(e.target.checked)} /> Ver terminadas
        </label>
        {puedeEditar && <form className="prio-agregar-obra" onSubmit={(e) => {
          e.preventDefault()
          if (obraNueva) accion('POST', 'agregar_obra', { obra: obraNueva }).then((r) => {
            setObraNueva('')
            if (r?.obra) alternarObra(Number(r.obra.id))
          })
        }}>
          <select className="select-inline" value={obraNueva} onChange={(e) => setObraNueva(e.target.value)}>
            <option value="">Agregar obra aceptada…</option>
            {datos.obras_panel.filter((o) => !yaAgregadas.has(o.obra)).map((o) => <option key={o.id} value={o.obra}>{o.obra}</option>)}
          </select>
          <button type="submit" className="btn-secundario plan-boton-principal" disabled={!obraNueva}>+ Agregar</button>
        </form>}
      </div>

      {error && <div className="auth-error plan-error">{error} <button type="button" className="btn-secundario" onClick={() => setError('')}>OK</button></div>}

      {datos.obras.length === 0 ? (
        <p className="dashboard-nota">Todavía no hay obras en Prioridades. Elige una obra aceptada arriba para empezar.</p>
      ) : hayFiltro && datosFiltrados.obras.length === 0 ? (
        <p className="dashboard-nota">Ninguna tarea coincide con los filtros elegidos.</p>
      ) : (
        <DiagramaGantt
          filas={filas}
          desde={desde}
          dias={dias}
          anchoDia={anchoDia}
          editable={puedeEditar}
          anchoEtiqueta={ANCHO_ETIQUETA}
          encabezadoEtiqueta={(
            <div className="prio-fila prio-fila-encabezado prio-nivel-1">
              <span className="prio-col-categoria">Categoría</span>
              <span className="prio-col-accion">Acción</span>
              <span className="prio-col-tarea">Obra / fachada / tarea</span>
              <span className="prio-col-estado">Estado</span>
              <span className="prio-col-fechas">Inicio → Fin</span>
            </div>
          )}
          onMoverBarra={handleMoverBarra}
          onClickBarra={(b) => (b.tarea ? setTareaAbierta(b.tarea.id) : null)}
          onIrAFecha={(iso) => setDesde(lunesDe(iso))}
          onDesplazar={(d) => setDesde((prev) => numeroADia(diaANumero(prev) + d))}
        />
      )}

      {tareaSeleccionada && (
        <VentanaTarea
          tarea={tareaSeleccionada}
          obra={datos.obras.find((o) => o.id === tareaSeleccionada.obra_id)}
          categorias={datos.categorias.filter((c) => c.obra_id === tareaSeleccionada.obra_id)}
          acciones={datos.acciones.filter((a) => a.obra_id === tareaSeleccionada.obra_id)}
          zonas={datos.zonas.filter((z) => z.obra_id === tareaSeleccionada.obra_id)}
          estados={datos.estados}
          responsables={datos.responsables}
          puedeEditar={puedeEditar}
          puedeEnviarAlfredo={Boolean(datos.puede_enviar_alfredo)}
          onGuardar={guardarTarea}
          onEliminar={(id) => accion('DELETE', 'eliminar_tarea', { id })}
          onCrear={crearDesdeTarea}
          onEnviarAlfredo={enviarAAlfredo}
          onCerrar={() => setTareaAbierta(null)}
        />
      )}

      {obraConfig && (
        <VentanaCategoriasFachadas
          obra={obraConfig}
          categorias={datos.categorias.filter((c) => c.obra_id === obraConfig.id)}
          acciones={datos.acciones.filter((a) => a.obra_id === obraConfig.id)}
          zonas={datos.zonas.filter((z) => z.obra_id === obraConfig.id)}
          colores={datos.colores}
          onAccion={accion}
          onCerrar={() => setObraConfigurando(null)}
        />
      )}
    </div>
  )
}
