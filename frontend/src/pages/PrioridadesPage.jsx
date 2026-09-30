import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { prioridades, accionPrioridades } from '../api/client.js'
import DiagramaGantt, { diaANumero, numeroADia, hoyIso, lunesDe, formatoCorto } from '../components/DiagramaGantt.jsx'
import { COLOR_TERMINADO } from '../components/PlanificacionComun.jsx'

// Prioridades — obras en fase de finalización (a pedido de Álvaro,
// 2026-09-30), solo admin. Reemplaza su planilla "Cronograma de obra —
// Vallehermoso, CEA, Manipa y Archanda": cada obra aceptada que se agrega
// acá tiene sus propias categorías (arranca con Mano de obra y Composite,
// se agregan/renombran/colorean por obra) y sus tareas de cierre con
// responsable, fechas, estado y marcas de "Falta material", "Pend. Ppto" y
// "Destacada" (el resaltado amarillo de la planilla). Un Gantt por obra con
// la tarea a la izquierda (mismo DiagramaGantt de Planificación, columna
// izquierda más ancha) y, arriba de cada obra, el fin previsto contra la
// fecha objetivo ("N días por encima del objetivo"). Datos:
// public/api/prioridades.php.

const ESCALAS = {
  Semana: { dias: 14, anchoDia: 56, paso: 7 },
  Mes: { dias: 35, anchoDia: 26, paso: 14 },
  Trimestre: { dias: 91, anchoDia: 12, paso: 28 },
}
const ANCHO_ETIQUETA = 560

function conIds(d) {
  return {
    ...d,
    obras: d.obras.map((o) => ({ ...o, id: Number(o.id) })),
    categorias: d.categorias.map((c) => ({ ...c, id: Number(c.id), obra_id: Number(c.obra_id) })),
    tareas: d.tareas.map(tareaConIds),
  }
}

function tareaConIds(t) {
  return {
    ...t,
    id: Number(t.id),
    obra_id: Number(t.obra_id),
    categoria_id: t.categoria_id ? Number(t.categoria_id) : null,
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

// Fin previsto = la fecha más tardía entre las tareas no terminadas con
// fecha; se compara con la fecha objetivo de la obra.
function resumenFin(obra, tareas) {
  const pendientes = tareas.filter((t) => t.estado !== 'Terminado')
  const conFecha = pendientes.filter((t) => t.fecha_inicio)
  const sinFecha = pendientes.length - conFecha.length
  if (conFecha.length === 0) return { texto: pendientes.length ? 'Sin fechas asignadas' : 'Sin tareas pendientes', clase: '', sinFecha }
  const fin = Math.max(...conFecha.map((t) => diaANumero(t.fecha_fin || t.fecha_inicio)))
  let texto = `Fin previsto: ${formatoLargo(numeroADia(fin))}`
  let clase = ''
  if (obra.fecha_objetivo) {
    const diff = fin - diaANumero(obra.fecha_objetivo)
    if (diff > 0) {
      texto += ` · ${diff} día${diff === 1 ? '' : 's'} por encima del objetivo`
      clase = 'prio-resumen-tarde'
    } else if (diff < 0) {
      texto += ` · ${-diff} día${diff === -1 ? '' : 's'} antes del objetivo`
      clase = 'prio-resumen-bien'
    } else {
      texto += ' · justo en el objetivo'
      clase = 'prio-resumen-bien'
    }
  }
  return { texto, clase, sinFecha }
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

function Categorias({ obra, categorias, colores, onAccion }) {
  const [nueva, setNueva] = useState('')
  return (
    <div className="prio-categorias">
      {categorias.map((c) => (
        <div key={c.id} className="prio-categoria">
          <span className="prio-categoria-color" style={{ background: c.color }} />
          <CampoTexto className="input-filtro prio-categoria-nombre" valor={c.nombre}
            onGuardar={(v) => v && onAccion('PATCH', 'actualizar_categoria', { id: c.id, nombre: v })} />
          <div className="prio-colores">
            {colores.map((col) => (
              <button key={col} type="button" className={`prio-color${col === c.color ? ' prio-color-activo' : ''}`} style={{ background: col }}
                title="Cambiar color" onClick={() => onAccion('PATCH', 'actualizar_categoria', { id: c.id, color: col })} />
            ))}
          </div>
          <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar categoría (sus tareas quedan sin categoría)"
            onClick={() => { if (window.confirm(`¿Eliminar la categoría "${c.nombre}"? Sus tareas quedan sin categoría.`)) onAccion('DELETE', 'eliminar_categoria', { id: c.id }) }}>−</button>
        </div>
      ))}
      <form className="prio-categoria-nueva" onSubmit={(e) => {
        e.preventDefault()
        if (!nueva.trim()) return
        onAccion('POST', 'agregar_categoria', { obra_id: obra.id, nombre: nueva.trim() }).then(() => setNueva(''))
      }}>
        <input type="text" className="input-filtro" placeholder="Nueva categoría (ej. Cristalería, Limpieza…)" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        <button type="submit" className="btn-secundario" disabled={!nueva.trim()}>+ Agregar</button>
      </form>
    </div>
  )
}

function VentanaTarea({ tarea, obra, categorias, estados, responsables, onGuardar, onEliminar, onCerrar }) {
  const [form, setForm] = useState({
    descripcion: tarea.descripcion || '',
    categoria_id: tarea.categoria_id || '',
    responsable: tarea.responsable || '',
    fecha_inicio: tarea.fecha_inicio || '',
    fecha_fin: tarea.fecha_fin || '',
    estado: tarea.estado,
    falta_material: !!tarea.falta_material,
    pendiente_ppto: !!tarea.pendiente_ppto,
    destacada: !!tarea.destacada,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function handleGuardar(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await onGuardar(tarea.id, { ...form, categoria_id: form.categoria_id || null })
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
          <label className="plan-ventana-ancho">
            Tarea
            <textarea autoFocus className="input-filtro" rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </label>
          <label>
            Categoría
            <select className="select-inline" value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: Number(e.target.value) || '' })}>
              <option value="">— Sin categoría —</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>
            Estado
            <select className="select-inline" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
              {estados.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="plan-ventana-ancho">
            Montador / Ayudante / Responsable
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
            <label className="plan-check"><input type="checkbox" checked={form.falta_material} onChange={(e) => setForm({ ...form, falta_material: e.target.checked })} /> Falta material</label>
            <label className="plan-check"><input type="checkbox" checked={form.pendiente_ppto} onChange={(e) => setForm({ ...form, pendiente_ppto: e.target.checked })} /> Pend. presupuesto</label>
            <label className="plan-check"><input type="checkbox" checked={form.destacada} onChange={(e) => setForm({ ...form, destacada: e.target.checked })} /> Destacar (resaltado amarillo)</label>
          </div>
          <datalist id="prio-responsables">
            {responsables.map((r) => <option key={r} value={r} />)}
          </datalist>
          {error && <div className="auth-error plan-ventana-ancho">{error}</div>}
          <div className="plan-ventana-acciones plan-ventana-ancho prio-ventana-acciones">
            <button type="button" className="btn-secundario plan-boton-peligro"
              onClick={() => { if (window.confirm('¿Eliminar esta tarea?')) onEliminar(tarea.id).then(onCerrar) }}>Eliminar</button>
            <span className="prio-espaciador" />
            <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-secundario plan-boton-principal" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EtiquetaTarea({ tarea, categoria, onAbrir }) {
  return (
    <button type="button" className={`prio-fila${tarea.estado === 'Terminado' ? ' prio-fila-terminada' : ''}`} onClick={onAbrir} title="Editar tarea">
      <span className="prio-col-categoria">
        <span className="plan-chip" style={{ background: categoria?.color || '#e6e9eb' }}>{categoria?.nombre || 'Sin categoría'}</span>
      </span>
      <span className={`prio-col-tarea${tarea.destacada ? ' prio-destacada' : ''}`}>
        {tarea.falta_material ? <span className="prio-marca prio-marca-material">Falta material</span> : null}
        {tarea.pendiente_ppto ? <span className="prio-marca prio-marca-ppto">Pend. Ppto</span> : null}
        {tarea.estado === 'En curso' && <span className="prio-marca prio-marca-curso">En curso</span>}
        <span className="prio-descripcion">{tarea.descripcion || <em>Sin descripción</em>}</span>
      </span>
      <span className="prio-col-responsable">{tarea.responsable || '—'}</span>
      <span className="prio-col-fechas">{textoFechas(tarea)}</span>
    </button>
  )
}

function SeccionObra({ obra, categorias, tareas, datos, verTerminadas, desde, escala, obraPanelId, onAccion, onAbrirTarea, onMoverTarea }) {
  const navigate = useNavigate()
  const [verCategorias, setVerCategorias] = useState(false)
  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])
  const resumen = resumenFin(obra, tareas)
  const visibles = tareas
    .filter((t) => verTerminadas || t.estado !== 'Terminado')
    .sort((a, b) => (a.fecha_inicio || '9999').localeCompare(b.fecha_inicio || '9999') || a.id - b.id)
  const { dias, anchoDia } = ESCALAS[escala]

  const filas = visibles.map((t) => {
    const categoria = categoriasPorId.get(t.categoria_id)
    return {
      id: t.id,
      altoMinimo: 40,
      clase: t.destacada ? 'prio-gantt-fila-destacada' : '',
      etiquetaNode: <EtiquetaTarea tarea={t} categoria={categoria} onAbrir={() => onAbrirTarea(t.id)} />,
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
  })

  return (
    <section className="prio-obra">
      <div className="prio-obra-encabezado">
        <div className="prio-obra-titulo">
          <CampoTexto className="input-filtro prio-obra-alias" valor={obra.alias || obra.obra}
            onGuardar={(v) => onAccion('PATCH', 'actualizar_obra', { id: obra.id, alias: v === obra.obra ? '' : v })} />
          <CampoTexto className="input-filtro prio-obra-nota" valor={obra.nota} placeholder="Nota (ej. cuadrilla de 2)"
            onGuardar={(v) => onAccion('PATCH', 'actualizar_obra', { id: obra.id, nota: v })} />
        </div>
        <label className="prio-objetivo">
          Objetivo
          <input type="date" className="input-filtro" value={obra.fecha_objetivo || ''}
            onChange={(e) => onAccion('PATCH', 'actualizar_obra', { id: obra.id, fecha_objetivo: e.target.value })} />
        </label>
        <div className="prio-obra-botones">
          <button type="button" className="btn-secundario plan-boton-principal"
            onClick={() => onAccion('POST', 'agregar_tarea', { obra_id: obra.id, categoria_id: categorias[0]?.id || null }).then((r) => r?.tarea && onAbrirTarea(Number(r.tarea.id)))}>
            + Tarea
          </button>
          <button type="button" className={`btn-secundario${verCategorias ? ' prio-boton-activo' : ''}`} onClick={() => setVerCategorias((v) => !v)}>Categorías</button>
          {obraPanelId && <button type="button" className="btn-secundario" onClick={() => navigate(`/obras-aceptadas/${obraPanelId}`)}>Abrir obra</button>}
          <button type="button" className="btn-secundario plan-boton-peligro"
            onClick={() => { if (window.confirm(`¿Quitar "${obra.alias || obra.obra}" de Prioridades? Se borran sus categorías y tareas.`)) onAccion('DELETE', 'eliminar_obra', { id: obra.id }) }}>
            Quitar
          </button>
        </div>
      </div>
      {obra.alias && <p className="prio-obra-panel">{obra.obra}</p>}
      <p className={`prio-resumen ${resumen.clase}`}>
        {resumen.texto}
        {resumen.sinFecha > 0 && <span className="prio-sin-fecha"> · {resumen.sinFecha} tarea{resumen.sinFecha === 1 ? '' : 's'} sin fecha</span>}
      </p>

      {verCategorias && <Categorias obra={obra} categorias={categorias} colores={datos.colores} onAccion={onAccion} />}

      <DiagramaGantt
        filas={filas}
        desde={desde}
        dias={dias}
        anchoDia={anchoDia}
        editable
        anchoEtiqueta={ANCHO_ETIQUETA}
        encabezadoEtiqueta={(
          <div className="prio-fila prio-fila-encabezado">
            <span className="prio-col-categoria">Categoría</span>
            <span className="prio-col-tarea">Tarea</span>
            <span className="prio-col-responsable">Responsable</span>
            <span className="prio-col-fechas">Inicio → Fin</span>
          </div>
        )}
        onMoverBarra={(b, inicio, fin) => onMoverTarea(b.tarea.id, inicio, fin)}
        onClickBarra={(b) => onAbrirTarea(b.tarea.id)}
        vacio="Sin tareas todavía — usa «+ Tarea»."
      />
    </section>
  )
}

export default function PrioridadesPage() {
  const { accessToken, usuario } = useAuth()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [escala, setEscala] = useState('Mes')
  const [desde, setDesde] = useState(() => numeroADia(diaANumero(lunesDe(hoyIso())) - 7))
  const [verTerminadas, setVerTerminadas] = useState(true)
  const [obraNueva, setObraNueva] = useState('')
  const [tareaAbierta, setTareaAbierta] = useState(null)

  const esAdmin = usuario?.roles?.includes('admin')

  function recargar() {
    return prioridades(accessToken).then((d) => setDatos(conIds(d)))
  }

  useEffect(() => {
    if (!esAdmin) return
    recargar().catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, esAdmin])

  // Todas las escrituras pasan por acá y después se vuelve a leer todo: son
  // pocas obras y pocas tareas, así el estado nunca queda desfasado del
  // servidor (categorías borradas, tareas nuevas, etc.).
  async function accion(metodo, nombre, cuerpo) {
    setError('')
    try {
      const r = await accionPrioridades(accessToken, metodo, nombre, cuerpo)
      await recargar()
      return r
    } catch (err) {
      setError(err.message)
      return null
    }
  }

  async function guardarTarea(id, cambios) {
    const r = await accionPrioridades(accessToken, 'PATCH', 'actualizar_tarea', { id, ...cambios })
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? tareaConIds(r.tarea) : t)) }))
    if (cambios.responsable) recargar()
  }

  function moverTarea(id, inicio, fin) {
    const anteriores = datos.tareas
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? { ...t, fecha_inicio: inicio, fecha_fin: fin } : t)) }))
    accionPrioridades(accessToken, 'PATCH', 'actualizar_tarea', { id, fecha_inicio: inicio, fecha_fin: fin }).catch((err) => {
      setDatos((prev) => ({ ...prev, tareas: anteriores }))
      setError(err.message)
    })
  }

  if (!esAdmin) return <div className="dashboard"><p className="dashboard-nota">Prioridades es solo para administradores.</p></div>
  if (error && !datos) return <div className="dashboard"><div className="auth-error">{error}</div></div>
  if (!datos) return <div className="dashboard"><p className="dashboard-nota">Cargando…</p></div>

  const yaAgregadas = new Set(datos.obras.map((o) => o.obra))
  const obraPanelPorNombre = new Map(datos.obras_panel.map((o) => [o.obra, o.id]))
  const { paso } = ESCALAS[escala]
  const tareaSeleccionada = tareaAbierta ? datos.tareas.find((t) => t.id === tareaAbierta) : null

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Prioridades</h1>
          <p>Obras en fase de finalización — tareas de cierre con responsable, fechas y fin previsto contra el objetivo</p>
        </div>
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
        <label className="plan-check">
          <input type="checkbox" checked={verTerminadas} onChange={(e) => setVerTerminadas(e.target.checked)} /> Ver terminadas
        </label>
        <form className="prio-agregar-obra" onSubmit={(e) => {
          e.preventDefault()
          if (obraNueva) accion('POST', 'agregar_obra', { obra: obraNueva }).then(() => setObraNueva(''))
        }}>
          <select className="select-inline" value={obraNueva} onChange={(e) => setObraNueva(e.target.value)}>
            <option value="">Agregar obra aceptada…</option>
            {datos.obras_panel.filter((o) => !yaAgregadas.has(o.obra)).map((o) => <option key={o.id} value={o.obra}>{o.obra}</option>)}
          </select>
          <button type="submit" className="btn-secundario plan-boton-principal" disabled={!obraNueva}>+ Agregar</button>
        </form>
      </div>

      {error && <div className="auth-error plan-error">{error} <button type="button" className="btn-secundario" onClick={() => setError('')}>OK</button></div>}

      {datos.obras.length === 0 && (
        <p className="dashboard-nota">Todavía no hay obras en Prioridades. Elige una obra aceptada arriba para empezar.</p>
      )}

      {datos.obras.map((o) => (
        <SeccionObra
          key={o.id}
          obra={o}
          categorias={datos.categorias.filter((c) => c.obra_id === o.id)}
          tareas={datos.tareas.filter((t) => t.obra_id === o.id)}
          datos={datos}
          verTerminadas={verTerminadas}
          desde={desde}
          escala={escala}
          obraPanelId={obraPanelPorNombre.get(o.obra)}
          onAccion={accion}
          onAbrirTarea={setTareaAbierta}
          onMoverTarea={moverTarea}
        />
      ))}

      {tareaSeleccionada && (
        <VentanaTarea
          tarea={tareaSeleccionada}
          obra={datos.obras.find((o) => o.id === tareaSeleccionada.obra_id)}
          categorias={datos.categorias.filter((c) => c.obra_id === tareaSeleccionada.obra_id)}
          estados={datos.estados}
          responsables={datos.responsables}
          onGuardar={guardarTarea}
          onEliminar={(id) => accion('DELETE', 'eliminar_tarea', { id })}
          onCerrar={() => setTareaAbierta(null)}
        />
      )}
    </div>
  )
}
