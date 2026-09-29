import { useState } from 'react'
import { formatoCorto } from './DiagramaGantt.jsx'

// Piezas compartidas entre Planificación (PlanificacionPage.jsx) e Inicio
// (InicioPage.jsx): colores por categoría/situación, cómo se arman las filas
// del Gantt de montaje (una por montador) y la ventanita para ver/editar una
// tarea al hacer click en su barra.

// Tonos pastel con texto oscuro encima (a pedido de Álvaro, 2026-09-29:
// los colores fuertes con letra blanca cansaban a la vista).
export const COLOR_CATEGORIA = {
  'Medición': '#dccbf0',
  'Material': '#bfdcf3',
  'Fabricación': '#bde6d9',
  'Chapas': '#dde2e7',
  'Composite': '#cbd3de',
  'Transporte': '#f8d7bc',
  'Grúa': '#f5c9c9',
  'Montaje': '#c6e9cc',
  'Facturar': '#f4e5ad',
  'Varios': '#e6e9eb',
}

// Barras/filas de tareas ya terminadas.
export const COLOR_TERMINADO = '#eceff3'

// Situación de la obra (Notion "Situación Actual") — colorea las barras del
// Gantt de montaje para distinguir obra nueva de remates/repasos/avisos.
export const SITUACIONES = ['Obra', 'Remates', 'Repasos', 'Avisos']
export const COLOR_SITUACION = {
  Obra: '#c6e9cc',
  Remates: '#f6e4a4',
  Repasos: '#dccbf0',
  Avisos: '#bfdcf3',
}

// Según la versión de PHP del hosting, SQLite puede devolver los id como
// texto — se pasan a número para que las comparaciones (Map por id,
// ?obra= de la URL) funcionen siempre igual.
export function obraNum(o) {
  return { ...o, id: Number(o.id) }
}

export function tareaNum(t) {
  return { ...t, id: Number(t.id), obra_id: Number(t.obra_id) }
}

export function datosNum(datos) {
  return { ...datos, obras: datos.obras.map(obraNum), tareas: datos.tareas.map(tareaNum) }
}

export function responsablesDe(tarea) {
  return String(tarea.responsable || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
}

// Una fila por montador con sus obras (categoría Montaje) como barras; si
// una tarea tiene dos responsables ("Ever, Javi") aparece en las dos filas.
// marcarSolapes: borde rojo cuando un montador tiene dos obras a la vez.
export function filasMontajePorMontador(tareas, obrasPorId, { incluirTerminadas = false } = {}) {
  const porResponsable = new Map()
  for (const t of tareas) {
    if (t.categoria !== 'Montaje' || !t.fecha_inicio) continue
    if (!incluirTerminadas && t.estado === 'Terminado') continue
    const obra = obrasPorId.get(t.obra_id)
    if (!obra || (!incluirTerminadas && obra.estado === 'Terminada')) continue
    const nombres = responsablesDe(t)
    for (const nombre of nombres.length ? nombres : ['Sin asignar']) {
      if (!porResponsable.has(nombre)) porResponsable.set(nombre, [])
      porResponsable.get(nombre).push({
        id: `${t.id}-${nombre}`,
        inicio: t.fecha_inicio,
        fin: t.fecha_fin,
        texto: obra.nombre,
        titulo: `${obra.nombre}${obra.constructora ? ` (${obra.constructora})` : ''} — ${obra.situacion || 'Obra'}`,
        color: t.estado === 'Terminado' ? COLOR_TERMINADO : COLOR_SITUACION[obra.situacion] || COLOR_SITUACION.Obra,
        atenuada: t.estado === 'Terminado',
        tarea: t,
      })
    }
  }
  return [...porResponsable.entries()]
    .sort(([a], [b]) => (a === 'Sin asignar') - (b === 'Sin asignar') || a.localeCompare(b))
    .map(([nombre, barras]) => ({
      id: `montador-${nombre}`,
      etiqueta: nombre,
      subetiqueta: `${barras.length} ${barras.length === 1 ? 'obra' : 'obras'}`,
      marcarSolapes: nombre !== 'Sin asignar',
      barras,
    }))
}

export function LeyendaColores({ colores }) {
  return (
    <div className="plan-leyenda">
      {Object.entries(colores).map(([nombre, color]) => (
        <span key={nombre} className="plan-leyenda-item">
          <span className="plan-leyenda-color" style={{ background: color }} />
          {nombre}
        </span>
      ))}
    </div>
  )
}

// Ventana de detalle de una tarea. Con puedeEditar (Álvaro) se editan
// fechas, responsable, estado y comentario; sin permiso es solo lectura.
export function VentanaTarea({ tarea, obra, responsables, puedeEditar, onGuardar, onCerrar, onAbrirObra }) {
  const [form, setForm] = useState({
    fecha_inicio: tarea.fecha_inicio || '',
    fecha_fin: tarea.fecha_fin || '',
    responsable: tarea.responsable || '',
    estado: tarea.estado || 'Pendiente',
    comentario: tarea.comentario || '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function handleGuardar(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await onGuardar(tarea.id, form)
      onCerrar()
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="plan-ventana-fondo" onClick={onCerrar}>
      <div className="plan-ventana" onClick={(e) => e.stopPropagation()}>
        <div className="plan-ventana-encabezado">
          <span className="plan-chip" style={{ background: COLOR_CATEGORIA[tarea.categoria] }}>{tarea.categoria}</span>
          <h2>{obra?.nombre}</h2>
          <button type="button" className="plan-ventana-cerrar" onClick={onCerrar} title="Cerrar">✕</button>
        </div>
        {obra?.constructora && <p className="plan-ventana-sub">{obra.constructora}{obra.situacion ? ` · ${obra.situacion}` : ''}</p>}

        {puedeEditar ? (
          <form className="plan-ventana-form" onSubmit={handleGuardar}>
            <label>
              Inicio
              <input type="date" className="input-filtro" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} />
            </label>
            <label>
              Fin
              <input type="date" className="input-filtro" value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
            </label>
            <label className="plan-ventana-ancho">
              Responsable
              <input
                type="text"
                className="input-filtro"
                list="plan-responsables"
                placeholder="Ej. Evaristo o Ever, Javi"
                value={form.responsable}
                onChange={(e) => setForm({ ...form, responsable: e.target.value })}
              />
            </label>
            <label>
              Estado
              <select className="select-inline" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                <option>Pendiente</option>
                <option>Terminado</option>
              </select>
            </label>
            <label className="plan-ventana-ancho">
              Comentario
              <textarea className="input-filtro" rows={3} value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} />
            </label>
            <datalist id="plan-responsables">
              {responsables.map((r) => <option key={r} value={r} />)}
            </datalist>
            {error && <div className="auth-error plan-ventana-ancho">{error}</div>}
            <div className="plan-ventana-acciones plan-ventana-ancho">
              {onAbrirObra && <button type="button" className="btn-secundario" onClick={() => onAbrirObra(obra)}>Ver obra completa</button>}
              <button type="submit" className="btn-secundario plan-boton-principal" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
        ) : (
          <table className="tabla-adicionales plan-ventana-tabla">
            <tbody>
              <tr><th>Fechas</th><td>{formatoCorto(tarea.fecha_inicio) || '—'}{tarea.fecha_fin && tarea.fecha_fin !== tarea.fecha_inicio ? ` → ${formatoCorto(tarea.fecha_fin)}` : ''}</td></tr>
              <tr><th>Responsable</th><td>{tarea.responsable || 'Sin asignar'}</td></tr>
              <tr><th>Estado</th><td>{tarea.estado}</td></tr>
              {tarea.comentario && <tr><th>Comentario</th><td>{tarea.comentario}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
