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

// Una categoría escrita a mano (ver categoriaPlanificacion en
// planificacion.php) sale con el color de "Varios".
export function colorCategoria(categoria) {
  return COLOR_CATEGORIA[categoria] || COLOR_CATEGORIA.Varios
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
// marcarSolapes: borde rojo cuando un montador tiene dos obras a la vez —
// solo entre obras con situación "Obra" (a pedido de Álvaro, 2026-10-01):
// un remate/repaso/aviso suele ser un par de horas, puede convivir con una
// obra sin que sea un conflicto.
// ordenCascadaDesde (fecha ISO, opcional): ordena los montadores "en
// cascada" (a pedido de Álvaro, 2026-10-02): primero el que tiene el montaje
// que empieza antes (entre los que siguen en curso a partir de esa fecha) y,
// a igual fecha, por orden alfabético. Sin ella, orden alfabético.
// "Sin asignar" va siempre al final.
export function filasMontajePorMontador(tareas, obrasPorId, { incluirTerminadas = false, ordenCascadaDesde = null } = {}) {
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
        texto: t.ayudante ? `${obra.nombre} · ${t.ayudante}` : obra.nombre,
        obraNombre: obra.nombre,
        titulo: `${obra.nombre}${obra.constructora ? ` (${obra.constructora})` : ''} — ${obra.situacion || 'Obra'}\nMontador: ${t.responsable || 'sin asignar'}${t.ayudante ? ` · Ayudante: ${t.ayudante}` : ''}`,
        color: t.estado === 'Terminado' ? COLOR_TERMINADO : COLOR_SITUACION[obra.situacion] || COLOR_SITUACION.Obra,
        atenuada: t.estado === 'Terminado',
        cuentaSolape: (obra.situacion || 'Obra') === 'Obra',
        tarea: t,
      })
    }
  }
  // Primer inicio de cada montador entre las barras que terminan desde
  // ordenCascadaDesde (las ya pasadas no cuentan); '~' = sin ninguna, al final.
  const primerInicio = (barras) => barras
    .filter((b) => (b.fin || b.inicio) >= ordenCascadaDesde)
    .reduce((min, b) => (b.inicio < min ? b.inicio : min), '~')
  return [...porResponsable.entries()]
    .sort(([a, barrasA], [b, barrasB]) => (a === 'Sin asignar') - (b === 'Sin asignar')
      || (ordenCascadaDesde ? primerInicio(barrasA).localeCompare(primerInicio(barrasB)) : 0)
      || a.localeCompare(b))
    .map(([nombre, barras]) => ({
      id: `montador-${nombre}`,
      etiqueta: nombre,
      subetiqueta: `${barras.length} ${barras.length === 1 ? 'obra' : 'obras'}`,
      marcarSolapes: nombre !== 'Sin asignar',
      barras,
    }))
}

// Vista detallada de Montaje (a pedido de Álvaro, 2026-10-02): en lugar de
// una fila por montador con todas sus obras juntas, el montador queda como
// encabezado y debajo va cada obra en su propia línea, con sus fechas de
// montaje. Los solapes entre obras del mismo montador se siguen marcando en
// rojo (mismo criterio que marcarSolapes: los remates/repasos no cuentan).
export function detallarFilasMontaje(filas) {
  const resultado = []
  for (const fila of filas) {
    const barras = [...fila.barras].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.obraNombre.localeCompare(b.obraNombre))
    const solapadas = new Set()
    if (fila.marcarSolapes) {
      for (let i = 0; i < barras.length; i++) {
        for (let j = i + 1; j < barras.length; j++) {
          const a = barras[i]
          const b = barras[j]
          if (a.cuentaSolape === false || b.cuentaSolape === false) continue
          if (b.inicio <= (a.fin || a.inicio) && a.inicio <= (b.fin || b.inicio)) {
            solapadas.add(a.id)
            solapadas.add(b.id)
          }
        }
      }
    }
    resultado.push({ id: fila.id, etiqueta: fila.etiqueta, esGrupo: true, barras: [] })
    for (const b of barras) {
      const fechas = b.fin && b.fin !== b.inicio ? `${formatoCorto(b.inicio)} → ${formatoCorto(b.fin)}` : formatoCorto(b.inicio)
      resultado.push({
        id: `${fila.id}-${b.id}`,
        etiqueta: b.obraNombre,
        subetiqueta: `${fechas}${b.tarea.ayudante ? ` · ${b.tarea.ayudante}` : ''}`,
        barras: [{ ...b, texto: b.tarea.ayudante || b.obraNombre, clase: solapadas.has(b.id) ? 'gantt-barra-solape' : b.clase }],
      })
    }
  }
  return resultado
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

// Desplegable de montador o ayudante (lista de montaje_personas, la misma
// de la pestaña Montaje de las obras aceptadas) con "+ Nuevo…" para sumar
// a alguien a la lista al momento. Si el valor actual no está en la lista
// (ej. "Ever, Javi" o un proveedor), se muestra igual como opción.
const NUEVA_PERSONA = '__nueva__'
function SelectPersona({ etiqueta, rol, valor, personas, onCambio, onCrear }) {
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState('')
  const nombres = personas.filter((p) => p.rol === rol).map((p) => p.nombre)
  if (valor && !nombres.includes(valor)) nombres.unshift(valor)

  async function crear() {
    const n = nombre.trim()
    if (!n) return
    setError('')
    try {
      await onCrear(n, rol)
      onCambio(n)
      setCreando(false)
      setNombre('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <label>
      {etiqueta}
      {creando ? (
        <span className="prio-nueva-inline">
          <input autoFocus type="text" className="input-filtro" placeholder={`Nombre del ${rol}`} value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); crear() }
              if (e.key === 'Escape') { e.preventDefault(); setCreando(false) }
            }} />
          <button type="button" className="btn-secundario plan-boton-principal" disabled={!nombre.trim()} onClick={crear}>Crear</button>
          <button type="button" className="btn-secundario" title="Cancelar" onClick={() => setCreando(false)}>✕</button>
        </span>
      ) : (
        <select className="select-inline" value={valor} onChange={(e) => (e.target.value === NUEVA_PERSONA ? setCreando(true) : onCambio(e.target.value))}>
          <option value="">Sin asignar</option>
          {nombres.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value={NUEVA_PERSONA}>+ Nuevo…</option>
        </select>
      )}
      {error && <span className="auth-error">{error}</span>}
    </label>
  )
}

// Ayudantes de un montaje: varios a la vez (a pedido de Álvaro, 2026-10-02).
// Una etiqueta por cada ayudante de la lista (montaje_personas, rol
// ayudante) que se marca/desmarca, más un campo visible para sumar a
// alguien nuevo a la lista. Se guarda como texto "German, Ivan".
function SelectorAyudantes({ valor, personas, onCambio, onCrear }) {
  const elegidos = String(valor || '').split(',').map((x) => x.trim()).filter(Boolean)
  const lista = personas.filter((x) => x.rol === 'ayudante').map((x) => x.nombre)
  for (const e of elegidos) if (!lista.includes(e)) lista.push(e)
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState('')

  function alternar(nombre) {
    const siguientes = elegidos.includes(nombre) ? elegidos.filter((x) => x !== nombre) : [...elegidos, nombre]
    onCambio(siguientes.join(', '))
  }

  async function agregar() {
    const n = nuevo.trim()
    if (!n) return
    setError('')
    try {
      if (!lista.includes(n)) await onCrear(n, 'ayudante')
      if (!elegidos.includes(n)) onCambio([...elegidos, n].join(', '))
      setNuevo('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="plan-ventana-ancho plan-ayudantes">
      <span className="plan-ayudantes-titulo">Ayudantes</span>
      <div className="plan-ayudantes-chips">
        {lista.map((n) => (
          <button key={n} type="button" className={`plan-ayudante-chip${elegidos.includes(n) ? ' plan-ayudante-chip-activo' : ''}`} onClick={() => alternar(n)}>
            {elegidos.includes(n) ? '✓ ' : ''}{n}
          </button>
        ))}
        {lista.length === 0 && <span className="dashboard-nota plan-nota-sin-margen">Todavía no hay ayudantes en la lista.</span>}
      </div>
      <div className="plan-ayudantes-nuevo">
        <input type="text" className="input-filtro" placeholder="Añadir ayudante nuevo…" value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar() } }} />
        <button type="button" className="btn-secundario" disabled={!nuevo.trim()} onClick={agregar}>+ Añadir</button>
      </div>
      {error && <span className="auth-error">{error}</span>}
    </div>
  )
}

// Ventana de detalle de una tarea. Con puedeEditar (Álvaro) se editan
// fechas, responsable, estado y comentario; sin permiso es solo lectura.
// En las tareas de Montaje el responsable se elige como Montador + Ayudante
// (a pedido de Álvaro, 2026-10-01) desde la lista de montaje_personas.
// La categoría también se cambia desde aquí (a pedido de Álvaro, 2026-10-02:
// pasar una tarea de Montaje a Facturar u otra sin ir a la obra).
export function VentanaTarea({ tarea, obra, responsables, categorias = [], personas = [], puedeEditar, onGuardar, onCerrar, onAbrirObra, onCrearPersona }) {
  const [form, setForm] = useState({
    categoria: tarea.categoria,
    fecha_inicio: tarea.fecha_inicio || '',
    fecha_fin: tarea.fecha_fin || '',
    responsable: tarea.responsable || '',
    ayudante: tarea.ayudante || '',
    estado: tarea.estado || 'Pendiente',
    comentario: tarea.comentario || '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const esMontaje = (puedeEditar ? form.categoria : tarea.categoria) === 'Montaje'
  const opcionesCategoria = categorias.includes(tarea.categoria) ? categorias : [tarea.categoria, ...categorias]

  async function handleGuardar(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      // Solo los campos que cambiaron (así "Deshacer" vuelve atrás justo eso).
      const cambios = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== (tarea[k] || (k === 'estado' ? 'Pendiente' : ''))))
      if (Object.keys(cambios).length > 0) await onGuardar(tarea.id, cambios)
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
          <span className="plan-chip" style={{ background: colorCategoria(tarea.categoria) }}>{tarea.categoria}</span>
          <h2>{obra?.nombre}</h2>
          <button type="button" className="plan-ventana-cerrar" onClick={onCerrar} title="Cerrar">✕</button>
        </div>
        {obra?.constructora && <p className="plan-ventana-sub">{obra.constructora}{obra.situacion ? ` · ${obra.situacion}` : ''}</p>}

        {puedeEditar ? (
          <form className="plan-ventana-form" onSubmit={handleGuardar}>
            <label className="plan-ventana-ancho">
              Categoría
              <select className="select-inline" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {opcionesCategoria.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Inicio
              <input type="date" className="input-filtro" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} />
            </label>
            <label>
              Fin
              <input type="date" className="input-filtro" value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
            </label>
            {esMontaje ? (
              <>
                <SelectPersona etiqueta="Montador" rol="montador" valor={form.responsable} personas={personas}
                  onCambio={(v) => setForm((f) => ({ ...f, responsable: v }))} onCrear={onCrearPersona} />
                <SelectorAyudantes valor={form.ayudante} personas={personas}
                  onCambio={(v) => setForm((f) => ({ ...f, ayudante: v }))} onCrear={onCrearPersona} />
              </>
            ) : (
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
            )}
            <label>
              Estado
              <select className="select-inline" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                <option>Pendiente</option>
                <option>Terminado</option>
              </select>
            </label>
            <label className="plan-ventana-ancho">
              Comentario
              <textarea className="input-filtro" rows={5} value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} />
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
              <tr><th>{esMontaje ? 'Montador' : 'Responsable'}</th><td>{tarea.responsable || 'Sin asignar'}</td></tr>
              {esMontaje && <tr><th>Ayudantes</th><td>{tarea.ayudante || 'Sin asignar'}</td></tr>}
              <tr><th>Estado</th><td>{tarea.estado}</td></tr>
              {tarea.comentario && <tr><th>Comentario</th><td>{tarea.comentario}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
