import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useDeshacer, idVigente, marcarRecreado } from '../context/DeshacerContext.jsx'
import {
  planificacion,
  crearObraPlanificacion,
  actualizarObraPlanificacion,
  eliminarObraPlanificacion,
  agregarTareaPlanificacion,
  actualizarTareaPlanificacion,
  eliminarTareaPlanificacion,
  calcularFechasPlanificacion,
  agregarPersonaMontaje,
} from '../api/client.js'
import DiagramaGantt, { diaANumero, numeroADia, hoyIso, lunesDe, formatoCorto } from '../components/DiagramaGantt.jsx'
import {
  colorCategoria,
  COLOR_TERMINADO,
  COLOR_SITUACION,
  SITUACIONES,
  LeyendaColores,
  VentanaTarea,
  responsablesDe,
  filasMontajePorMontador,
  detallarFilasMontaje,
  datosNum,
  obraNum,
  tareaNum,
} from '../components/PlanificacionComun.jsx'

// Planificación de obras — a pedido de Álvaro, 2026-09-29: reemplaza la
// base "Seguimiento Obras" de Notion (ver public/api/planificacion.php).
// Cuatro pestañas:
//   - Cronograma: Gantt de todas las tareas, agrupado por obra (una fila
//     por categoría, o una fila por obra en modo compacto).
//   - Montaje: Gantt de la categoría Montaje agrupado por montador, con una
//     línea por obra; los solapes de un mismo montador salen en rojo.
//   - Obras: alta de obra (se crea con todas las categorías vacías) y
//     edición de cada una — fechas, responsable, estado y comentario por
//     categoría, más el vínculo opcional a la obra aceptada del panel.
//   - Facturación: tareas "Facturar" sin terminar, con su comentario.
// Todos pueden verla; solo admin (Álvaro) edita — las barras del Gantt se
// arrastran para mover/estirar fechas, igual que en Notion.

const PESTANAS = ['Cronograma', 'Montaje', 'Obras', 'Facturación']
const ESCALAS = {
  Semana: { dias: 14, anchoDia: 64, paso: 7 },
  Mes: { dias: 42, anchoDia: 30, paso: 14 },
  Trimestre: { dias: 91, anchoDia: 14, paso: 28 },
}

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Al vincular una obra aceptada, la obra de planificación pasa a llamarse
// igual que en el panel (a pedido de Álvaro, 2026-09-29) — así se busca con
// el mismo nombre en todas las vistas. Desvincular no toca el nombre.
//
// Obras aceptadas del panel cuyo nombre se parece al de la obra de
// planificación — los nombres de Notion no coinciden exacto con los del
// panel ("Jose Abascal" vs "8 Viv. Jose Abascal, 57"), así que se sugieren
// por palabras en común y Álvaro elige.
function sugerirObrasPanel(nombre, obrasPanel) {
  const palabras = normalizar(nombre).split(' ').filter((p) => p.length >= 3)
  if (palabras.length === 0) return []
  return obrasPanel
    .map((o) => {
      const destino = ` ${normalizar(o.obra)} `
      const coincidencias = palabras.filter((p) => destino.includes(` ${p}`)).length
      return { ...o, puntaje: coincidencias / palabras.length }
    })
    .filter((o) => o.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, 5)
}

// Orden de las categorías en la lista; las escritas a mano van al final.
function posicionCategoria(categorias, categoria) {
  const i = categorias.indexOf(categoria)
  return i < 0 ? categorias.length : i
}

function seCruzaConVentana(tarea, inicioVentana, finVentana) {
  if (!tarea.fecha_inicio) return false
  const ini = diaANumero(tarea.fecha_inicio)
  const fin = tarea.fecha_fin ? diaANumero(tarea.fecha_fin) : ini
  return fin >= inicioVentana && ini <= finVentana
}

// Barra "obra completa": va de la primera a la última tarea pendiente con
// fecha de la obra. Arrastrarla corre TODAS esas tareas los mismos días
// (a pedido de Álvaro, 2026-09-29: deslizar la obra entera cuando se atrasa
// o adelanta). Solo se mueve, no se estira (soloMover).
function barraObraCompleta(obra, tareasObra, texto) {
  const pendientes = tareasObra.filter((t) => t.estado !== 'Terminado' && t.fecha_inicio)
  if (pendientes.length === 0) return null
  const ini = Math.min(...pendientes.map((t) => diaANumero(t.fecha_inicio)))
  const fin = Math.max(...pendientes.map((t) => diaANumero(t.fecha_fin || t.fecha_inicio)))
  return {
    id: `obra-completa-${obra.id}`,
    inicio: numeroADia(ini),
    fin: numeroADia(fin),
    texto,
    titulo: `${obra.nombre} — arrastrar para mover todas sus tareas pendientes`,
    clase: 'gantt-barra-obra',
    soloMover: true,
    obraId: obra.id,
  }
}

function textoFechas(tarea) {
  if (!tarea.fecha_inicio) return 'Sin fecha'
  return tarea.fecha_fin && tarea.fecha_fin !== tarea.fecha_inicio
    ? `${formatoCorto(tarea.fecha_inicio)} → ${formatoCorto(tarea.fecha_fin)}`
    : formatoCorto(tarea.fecha_inicio)
}

// Columna izquierda de la fila de una obra en el Cronograma: Situación ·
// Obra. Con permiso, pulsar la etiqueta de situación abre un mini menú con
// las 4 opciones (un clic y queda guardada) — a pedido de Álvaro,
// 2026-10-02 (le costaba cambiarla).
function EtiquetaObraCronograma({ obra, puedeEditar, onAbrirSituacion }) {
  const chip = obra.situacion
    ? <span className="plan-chip" style={{ background: COLOR_SITUACION[obra.situacion] }}>{obra.situacion}</span>
    : <span className="plan-chip plan-chip-vacio">Sin situación</span>
  return (
    <div className="plan-fila-cronograma">
      <span>
        {puedeEditar ? (
          <button type="button" className="plan-chip-boton-situacion" title="Cambiar situación"
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              onAbrirSituacion(obra.id, r.left, r.bottom + 4)
            }}>
            {chip}<span className="plan-chip-flecha">▾</span>
          </button>
        ) : chip}
      </span>
      <span className="plan-cronograma-obra">
        <span className="gantt-etiqueta-texto">{obra.nombre}</span>
        {obra.constructora && <span className="gantt-etiqueta-sub">{obra.constructora}</span>}
      </span>
    </div>
  )
}

// Texto de la barra de una tarea: quién la hace (en Montaje, montador y
// ayudante); si no tiene responsable, la categoría. Igual en la vista
// normal y en "Una fila por obra" — a pedido de Álvaro (2026-10-01) para no
// perder quién monta al compactar.
function textoBarraTarea(t) {
  const quien = [t.responsable, t.categoria === 'Montaje' ? t.ayudante : null].filter(Boolean).join(' · ')
  return quien || t.categoria
}

function NavegacionFechas({ desde, setDesde, escala, setEscala }) {
  const { paso } = ESCALAS[escala]
  return (
    <div className="plan-navegacion">
      <button type="button" className="btn-secundario" onClick={() => setDesde(numeroADia(diaANumero(desde) - paso))}>◀</button>
      <button type="button" className="btn-secundario" onClick={() => setDesde(lunesDe(hoyIso()))}>Hoy</button>
      <button type="button" className="btn-secundario" onClick={() => setDesde(numeroADia(diaANumero(desde) + paso))}>▶</button>
      <div className="seguimiento-pestanas plan-escalas">
        {Object.keys(ESCALAS).map((e) => (
          <button key={e} type="button" className={`seguimiento-pestana ${e === escala ? 'seguimiento-pestana-activa' : ''}`} onClick={() => setEscala(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}

function FiltroCategorias({ categorias, seleccionadas, onCambiar }) {
  function alternar(c) {
    const nuevas = new Set(seleccionadas)
    if (nuevas.has(c)) nuevas.delete(c)
    else nuevas.add(c)
    onCambiar(nuevas)
  }
  return (
    <div className="plan-chips">
      {categorias.map((c) => {
        const activa = seleccionadas.size === 0 || seleccionadas.has(c)
        return (
          <button
            key={c}
            type="button"
            className={`plan-chip plan-chip-boton${activa ? '' : ' plan-chip-apagada'}`}
            style={{ background: activa ? colorCategoria(c) : undefined }}
            onClick={() => alternar(c)}
          >
            {c}
          </button>
        )
      })}
      {seleccionadas.size > 0 && (
        <button type="button" className="btn-secundario plan-chip-limpiar" onClick={() => onCambiar(new Set())}>Todas</button>
      )}
    </div>
  )
}

function NuevaObra({ obrasPanel, onCrear, onCancelar }) {
  const [form, setForm] = useState({ nombre: '', constructora: '', situacion: 'Obra', obra_panel: '', fecha_aceptacion: hoyIso() })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const sugeridas = useMemo(() => sugerirObrasPanel(form.nombre, obrasPanel), [form.nombre, obrasPanel])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.nombre.trim() || enviando) return
    setEnviando(true)
    setError('')
    try {
      await onCrear(form)
    } catch (err) {
      setError(err.message)
      setEnviando(false)
    }
  }

  return (
    <form className="plan-nueva-obra" onSubmit={handleSubmit}>
      <h3 className="montaje-subtitulo">Nueva obra</h3>
      <p className="dashboard-nota plan-nota-sin-margen">Se crea con todas las categorías (Medición, Material, Fabricación, Chapas, Composite, Transporte, Grúa, Montaje y Facturar). Con fecha de aceptación, las fechas se calculan solas con el cronograma tipo; sin ella, quedan vacías.</p>
      <div className="plan-form-grilla">
        <label>
          Nombre *
          <input autoFocus type="text" className="input-filtro" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </label>
        <label>
          Constructora / cliente
          <input type="text" className="input-filtro" value={form.constructora} onChange={(e) => setForm({ ...form, constructora: e.target.value })} />
        </label>
        <label>
          Situación
          <select className="select-inline" value={form.situacion} onChange={(e) => setForm({ ...form, situacion: e.target.value })}>
            {SITUACIONES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Fecha de aceptación
          <input type="date" className="input-filtro" value={form.fecha_aceptacion} onChange={(e) => setForm({ ...form, fecha_aceptacion: e.target.value })} />
        </label>
        <label>
          Obra aceptada del panel
          <SelectObraPanel valor={form.obra_panel} sugeridas={sugeridas} obrasPanel={obrasPanel} onCambio={(v) => setForm({ ...form, obra_panel: v, nombre: v || form.nombre })} />
        </label>
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="plan-ventana-acciones">
        <button type="button" className="btn-secundario" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn-secundario plan-boton-principal" disabled={enviando || !form.nombre.trim()}>{enviando ? 'Creando…' : 'Crear obra'}</button>
      </div>
    </form>
  )
}

function SelectObraPanel({ valor, sugeridas, obrasPanel, onCambio, disabled }) {
  return (
    <select className="select-inline plan-select-obra-panel" value={valor || ''} onChange={(e) => onCambio(e.target.value)} disabled={disabled}>
      <option value="">— Sin vincular —</option>
      {sugeridas.length > 0 && (
        <optgroup label="Sugeridas por el nombre">
          {sugeridas.map((o) => <option key={`s-${o.id}`} value={o.obra}>{o.obra}</option>)}
        </optgroup>
      )}
      <optgroup label="Todas las obras aceptadas">
        {obrasPanel.map((o) => <option key={o.id} value={o.obra}>{o.obra}</option>)}
      </optgroup>
    </select>
  )
}

// Campo de texto que guarda al salir (no en cada tecla) — mismo criterio
// que el resto de los campos editables en línea del panel.
function CampoTexto({ valor, onGuardar, disabled, placeholder, list, className = 'input-filtro', estilo }) {
  const [texto, setTexto] = useState(valor || '')
  useEffect(() => setTexto(valor || ''), [valor])
  return (
    <input
      type="text"
      className={className}
      style={estilo}
      value={texto}
      placeholder={placeholder}
      list={list}
      disabled={disabled}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if (texto.trim() !== (valor || '')) onGuardar(texto.trim()) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

// Comentario de una tarea en la tabla de la obra: crece con el texto para
// leerlo entero (a pedido de Álvaro, 2026-10-02 — antes era una línea
// cortada). Guarda al salir, como CampoTexto.
function CampoTextoLargo({ valor, onGuardar, disabled, placeholder }) {
  const [texto, setTexto] = useState(valor || '')
  const ref = useRef(null)
  useEffect(() => setTexto(valor || ''), [valor])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [texto])
  return (
    <textarea
      ref={ref}
      rows={1}
      className="input-filtro plan-comentario-largo"
      value={texto}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if (texto.trim() !== (valor || '')) onGuardar(texto.trim()) }}
    />
  )
}

function EditorObra({ obra, tareas, datos, puedeEditar, onMoverObra, onCalcularFechas, onActualizarObra, onEliminarObra, onActualizarTarea, onAgregarTarea, onEliminarTarea, onVolver }) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [categoriaNueva, setCategoriaNueva] = useState('Varios')
  const [fechaAceptacion, setFechaAceptacion] = useState(obra.fecha_aceptacion || '')
  useEffect(() => setFechaAceptacion(obra.fecha_aceptacion || ''), [obra.fecha_aceptacion])
  const sugeridas = useMemo(() => sugerirObrasPanel(obra.nombre, datos.obras_panel), [obra.nombre, datos.obras_panel])
  const obraPanel = datos.obras_panel.find((o) => o.obra === obra.obra_panel)

  const tareasOrdenadas = useMemo(() => {
    const orden = datos.categorias
    return [...tareas].sort((a, b) => posicionCategoria(orden, a.categoria) - posicionCategoria(orden, b.categoria) || (a.fecha_inicio || '').localeCompare(b.fecha_inicio || '') || a.id - b.id)
  }, [tareas, datos.categorias])

  // El cronograma de la obra muestra solo lo que sigue vivo: al marcar una
  // tarea como terminada sale del diagrama (a pedido de Álvaro, 2026-10-02).
  // Sigue en la tabla de abajo, y "Ver terminadas" la vuelve a mostrar.
  const [verTerminadasMini, setVerTerminadasMini] = useState(false)
  const tareasMini = useMemo(
    () => (verTerminadasMini ? tareasOrdenadas : tareasOrdenadas.filter((t) => t.estado !== 'Terminado')),
    [tareasOrdenadas, verTerminadasMini],
  )
  const cantidadTerminadas = tareas.length - tareas.filter((t) => t.estado !== 'Terminado').length

  // Ventana del mini-cronograma: desde la tarea más temprana hasta la más
  // tardía que se muestra (con un margen), o las próximas semanas si no hay fechas.
  const ventana = useMemo(() => {
    const conFecha = tareasMini.filter((t) => t.fecha_inicio)
    if (conFecha.length === 0) return { desde: lunesDe(hoyIso()), dias: 42 }
    const ini = Math.min(...conFecha.map((t) => diaANumero(t.fecha_inicio)))
    const fin = Math.max(...conFecha.map((t) => diaANumero(t.fecha_fin || t.fecha_inicio)))
    const desde = lunesDe(numeroADia(ini - 3))
    return { desde, dias: Math.max(fin - diaANumero(desde) + 8, 28) }
  }, [tareasMini])
  const anchoMini = ventana.dias > 120 ? 8 : ventana.dias > 60 ? 14 : 24

  async function ejecutar(promesa) {
    setError('')
    try {
      await promesa
    } catch (err) {
      setError(err.message)
    }
  }

  const barraObra = barraObraCompleta(obra, tareas, 'Obra completa')
  const filasMini = (barraObra ? [{ id: 'obra-completa', etiqueta: 'Obra completa', esGrupo: true, barras: [barraObra] }] : []).concat(tareasMini.map((t) => ({
    id: t.id,
    etiqueta: t.categoria,
    subetiqueta: t.responsable || '',
    barras: t.fecha_inicio ? [{
      id: t.id,
      inicio: t.fecha_inicio,
      fin: t.fecha_fin,
      texto: t.responsable || t.categoria,
      color: t.estado === 'Terminado' ? COLOR_TERMINADO : colorCategoria(t.categoria),
      atenuada: t.estado === 'Terminado',
      tarea: t,
    }] : [],
  })))

  return (
    <div className="plan-editor">
      <div className="plan-editor-encabezado">
        <button type="button" className="btn-secundario" onClick={onVolver}>← Obras</button>
        <h2>{obra.nombre}</h2>
        {obraPanel && (
          <button type="button" className="btn-secundario" onClick={() => navigate(`/obras-aceptadas/${obraPanel.id}`)}>Abrir en Obras Aceptadas</button>
        )}
        {puedeEditar && (
          <button
            type="button"
            className="btn-secundario plan-boton-peligro"
            onClick={() => { if (window.confirm(`¿Eliminar "${obra.nombre}" y todas sus tareas? No se puede deshacer.`)) ejecutar(onEliminarObra(obra.id)) }}
          >
            Eliminar obra
          </button>
        )}
      </div>

      <div className="plan-form-grilla">
        <label>
          Nombre
          <CampoTexto valor={obra.nombre} disabled={!puedeEditar} onGuardar={(v) => ejecutar(onActualizarObra(obra.id, { nombre: v }))} />
        </label>
        <label>
          Constructora / cliente
          <CampoTexto valor={obra.constructora} disabled={!puedeEditar} onGuardar={(v) => ejecutar(onActualizarObra(obra.id, { constructora: v }))} />
        </label>
        <label>
          Situación
          <select className="select-inline" value={obra.situacion || ''} disabled={!puedeEditar} onChange={(e) => ejecutar(onActualizarObra(obra.id, { situacion: e.target.value }))}>
            <option value="">—</option>
            {SITUACIONES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Estado de la obra
          <select className="select-inline" value={obra.estado} disabled={!puedeEditar} onChange={(e) => ejecutar(onActualizarObra(obra.id, { estado: e.target.value }))}>
            <option>Activa</option>
            <option>Terminada</option>
          </select>
        </label>
        <label>
          Tipo
          <CampoTexto valor={obra.tipo} disabled={!puedeEditar} onGuardar={(v) => ejecutar(onActualizarObra(obra.id, { tipo: v }))} />
        </label>
        <label>
          Silicona
          <CampoTexto valor={obra.silicona} disabled={!puedeEditar} placeholder="Ej. 7022, Blanco…" onGuardar={(v) => ejecutar(onActualizarObra(obra.id, { silicona: v }))} />
        </label>
        <label>
          Fecha de aceptación
          <input type="date" className="input-filtro" value={fechaAceptacion} disabled={!puedeEditar}
            onChange={(e) => {
              setFechaAceptacion(e.target.value)
              ejecutar(onActualizarObra(obra.id, { fecha_aceptacion: e.target.value }))
            }} />
        </label>
        {puedeEditar && (
          <div className="plan-calcular-fechas">
            <button
              type="button"
              className="btn-secundario plan-boton-principal"
              disabled={!fechaAceptacion}
              title={fechaAceptacion ? '' : 'Primero pon la fecha de aceptación'}
              onClick={() => {
                if (window.confirm('Se van a reemplazar las fechas de todas las tareas PENDIENTES de esta obra con el cronograma tipo desde la fecha de aceptación. Las terminadas no se tocan. ¿Seguir?')) {
                  ejecutar(onCalcularFechas(obra.id, fechaAceptacion))
                }
              }}
            >
              Calcular fechas
            </button>
          </div>
        )}
        <label className="plan-form-ancho">
          Obra aceptada del panel
          <SelectObraPanel valor={obra.obra_panel} sugeridas={sugeridas} obrasPanel={datos.obras_panel} disabled={!puedeEditar} onCambio={(v) => ejecutar(onActualizarObra(obra.id, v ? { obra_panel: v, nombre: v } : { obra_panel: v }))} />
        </label>
        <label className="plan-form-ancho">
          Comentario
          <CampoTexto valor={obra.comentario} disabled={!puedeEditar} onGuardar={(v) => ejecutar(onActualizarObra(obra.id, { comentario: v }))} />
        </label>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="plan-titulo-con-check">
        <h3 className="montaje-subtitulo">Cronograma de la obra</h3>
        {cantidadTerminadas > 0 && (
          <label className="plan-check">
            <input type="checkbox" checked={verTerminadasMini} onChange={(e) => setVerTerminadasMini(e.target.checked)} />
            Ver terminadas ({cantidadTerminadas})
          </label>
        )}
      </div>
      <DiagramaGantt
        filas={filasMini}
        desde={ventana.desde}
        dias={ventana.dias}
        anchoDia={anchoMini}
        editable={puedeEditar}
        onMoverBarra={(b, inicio, fin) => ejecutar(
          b.obraId
            ? onMoverObra(b.obraId, diaANumero(inicio) - diaANumero(b.inicio))
            : onActualizarTarea(b.tarea.id, { fecha_inicio: inicio, fecha_fin: fin }),
        )}
        vacio={cantidadTerminadas === tareas.length && tareas.length > 0 ? 'Todas las tareas de esta obra están terminadas.' : 'Sin tareas con fecha.'}
      />

      <h3 className="montaje-subtitulo">Tareas por categoría</h3>
      <div className="tabla-scroll">
        <table className="tabla-adicionales plan-tabla-tareas">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Responsable</th>
              <th>Terminado</th>
              <th>Comentario</th>
              {puedeEditar && <th />}
            </tr>
          </thead>
          <tbody>
            {tareasOrdenadas.map((t) => (
              <tr key={t.id} className={t.estado === 'Terminado' ? 'plan-tarea-terminada' : ''}>
                <td>
                  {puedeEditar ? (
                    <CampoTexto valor={t.categoria} list="plan-categorias-editor" className="input-filtro plan-categoria-editable"
                      estilo={{ background: colorCategoria(t.categoria) }}
                      onGuardar={(v) => { if (v) ejecutar(onActualizarTarea(t.id, { categoria: v })) }} />
                  ) : (
                    <span className="plan-chip" style={{ background: colorCategoria(t.categoria) }}>{t.categoria}</span>
                  )}
                </td>
                <td>
                  <input type="date" className="input-filtro input-fecha-limite" value={t.fecha_inicio || ''} disabled={!puedeEditar}
                    onChange={(e) => ejecutar(onActualizarTarea(t.id, { fecha_inicio: e.target.value, ...(t.fecha_fin && e.target.value > t.fecha_fin ? { fecha_fin: e.target.value } : {}) }))} />
                </td>
                <td>
                  <input type="date" className="input-filtro input-fecha-limite" value={t.fecha_fin || ''} min={t.fecha_inicio || undefined} disabled={!puedeEditar}
                    onChange={(e) => ejecutar(onActualizarTarea(t.id, { fecha_fin: e.target.value }))} />
                </td>
                <td>
                  <CampoTexto valor={t.responsable} disabled={!puedeEditar} list="plan-responsables-editor" placeholder="Sin asignar"
                    onGuardar={(v) => ejecutar(onActualizarTarea(t.id, { responsable: v }))} />
                </td>
                <td className="plan-celda-centro">
                  <input type="checkbox" checked={t.estado === 'Terminado'} disabled={!puedeEditar}
                    onChange={(e) => ejecutar(onActualizarTarea(t.id, { estado: e.target.checked ? 'Terminado' : 'Pendiente' }))} />
                </td>
                <td className="plan-celda-comentario">
                  <CampoTextoLargo valor={t.comentario} disabled={!puedeEditar} onGuardar={(v) => ejecutar(onActualizarTarea(t.id, { comentario: v }))} />
                </td>
                {puedeEditar && (
                  <td>
                    <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar tarea"
                      onClick={() => { if (window.confirm(`¿Eliminar la tarea ${t.categoria}?`)) ejecutar(onEliminarTarea(t.id)) }}>−</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="plan-responsables-editor">
        {datos.responsables.map((r) => <option key={r} value={r} />)}
      </datalist>
      <datalist id="plan-categorias-editor">
        {datos.categorias.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* La categoría de la tarea nueva se elige de la lista o se escribe
          (a pedido de Álvaro, 2026-10-02); también se puede cambiar después
          en la tabla. Un texto propio sale con el color de "Varios". */}
      {puedeEditar && (
        <div className="plan-agregar-tarea">
          <input type="text" className="input-filtro plan-categoria-nueva" list="plan-categorias-editor" placeholder="Categoría…"
            value={categoriaNueva} onChange={(e) => setCategoriaNueva(e.target.value)}
            onFocus={(e) => e.target.select()} />
          <button type="button" className="btn-secundario" disabled={!categoriaNueva.trim()}
            onClick={() => ejecutar(onAgregarTarea(obra.id, categoriaNueva.trim()))}>+ Agregar tarea</button>
          <span className="dashboard-nota plan-nota-sin-margen">Elige una categoría o escribe otro nombre (ej. "Montaje remates").</span>
        </div>
      )}
    </div>
  )
}

// Columnas de la tabla de obras que se pueden ordenar con un clic en la
// cabecera (a pedido de Álvaro, 2026-10-02); un segundo clic invierte.
const COLUMNAS_OBRAS = [
  { clave: 'obra', titulo: 'Obra' },
  { clave: 'constructora', titulo: 'Constructora' },
  { clave: 'situacion', titulo: 'Situación' },
  { clave: 'estado', titulo: 'Estado' },
  { clave: 'proxima', titulo: 'Próxima tarea' },
  { clave: 'montaje', titulo: 'Montaje' },
  { clave: 'pendientes', titulo: 'Pendientes' },
  { clave: 'panel', titulo: 'Panel', sinOrden: true },
]

function ListaObras({ obras, tareasPorObra, puedeEditar, obrasPanel, onAbrir, onCrear, onActualizarObra }) {
  const [buscar, setBuscar] = useState('')
  const [verTerminadas, setVerTerminadas] = useState(false)
  const [soloSinResponsable, setSoloSinResponsable] = useState(false)
  // Filtro por situación de la obra (a pedido de Álvaro, 2026-10-01).
  const [filtroSituacion, setFiltroSituacion] = useState('')
  // Filtro por tareas pendientes (a pedido de Álvaro, 2026-10-02).
  const [filtroPendientes, setFiltroPendientes] = useState('')
  const [orden, setOrden] = useState(null) // { clave, desc }
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState('')
  const hoy = hoyIso()

  // Tareas pendientes sin responsable — a pedido de Álvaro (2026-09-29):
  // las obras recién aceptadas se crean solas con todas las categorías sin
  // responsable, y este filtro las junta para asignarlas rápido.
  const sinResponsable = (o) => (tareasPorObra.get(o.id) || []).filter((t) => t.estado !== 'Terminado' && !t.responsable).length
  const activas = obras.filter((o) => o.estado !== 'Terminada')
  const cantidadSinResponsable = activas.filter((o) => sinResponsable(o) > 0).length

  // Datos de cada fila (también se usan para ordenar).
  const filas = obras.map((o) => {
    const tareas = tareasPorObra.get(o.id) || []
    const pendientes = tareas.filter((t) => t.estado !== 'Terminado')
    const proxima = pendientes
      .filter((t) => t.fecha_inicio && (t.fecha_fin || t.fecha_inicio) >= hoy)
      .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))[0]
    const montaje = tareas.find((t) => t.categoria === 'Montaje' && t.estado !== 'Terminado') || tareas.find((t) => t.categoria === 'Montaje')
    const vencidas = pendientes.filter((t) => t.fecha_inicio && (t.fecha_fin || t.fecha_inicio) < hoy).length
    const faltanResponsable = pendientes.filter((t) => !t.responsable).length
    return { o, pendientes, proxima, montaje, vencidas, faltanResponsable }
  })

  const filtradas = filas
    .filter(({ o }) => verTerminadas || o.estado !== 'Terminada')
    .filter(({ o }) => !buscar || normalizar(`${o.nombre} ${o.constructora} ${o.obra_panel}`).includes(normalizar(buscar)))
    .filter(({ o }) => !soloSinResponsable || sinResponsable(o) > 0)
    .filter(({ o }) => !filtroSituacion || (filtroSituacion === '__sin__' ? !o.situacion : o.situacion === filtroSituacion))
    .filter((f) => !filtroPendientes
      || (filtroPendientes === 'con' && f.pendientes.length > 0)
      || (filtroPendientes === 'vencidas' && f.vencidas > 0)
      || (filtroPendientes === 'sin' && f.pendientes.length === 0))

  if (orden) {
    // Vacíos siempre al final, en los dos sentidos.
    const valor = {
      obra: (f) => normalizar(f.o.nombre),
      constructora: (f) => normalizar(f.o.constructora),
      situacion: (f) => (f.o.situacion ? String(SITUACIONES.indexOf(f.o.situacion) + 10) : ''),
      estado: (f) => f.o.estado || 'Activa',
      proxima: (f) => f.proxima?.fecha_inicio || '',
      montaje: (f) => f.montaje?.fecha_inicio || '',
      pendientes: (f) => String(f.pendientes.length).padStart(4, '0'),
    }[orden.clave]
    filtradas.sort((a, b) => {
      const va = valor(a)
      const vb = valor(b)
      if (!va || !vb) return (!va) - (!vb)
      return (orden.desc ? -1 : 1) * va.localeCompare(vb, 'es', { numeric: true }) || a.o.nombre.localeCompare(b.o.nombre)
    })
  } else if (soloSinResponsable) {
    // Con el filtro activo, las más nuevas primero (las recién aceptadas).
    filtradas.sort((a, b) => String(b.o.creado_en).localeCompare(String(a.o.creado_en)))
  }

  function ordenarPor(clave) {
    setOrden((prev) => (prev?.clave === clave ? (prev.desc ? null : { clave, desc: true }) : { clave, desc: false }))
  }

  const hayFiltros = buscar || filtroSituacion || soloSinResponsable || filtroPendientes

  return (
    <div>
      <div className="filtro-tabla">
        <div className="filtro-campo">
          <label>Buscar</label>
          <input type="text" className="input-filtro" placeholder="Obra o constructora…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <div className="filtro-campo">
          <label>Situación</label>
          <select className="select-inline" value={filtroSituacion} onChange={(e) => setFiltroSituacion(e.target.value)}>
            <option value="">Todas</option>
            {SITUACIONES.map((x) => <option key={x}>{x}</option>)}
            <option value="__sin__">Sin situación</option>
          </select>
        </div>
        <div className="filtro-campo">
          <label>Pendientes</label>
          <select className="select-inline" value={filtroPendientes} onChange={(e) => setFiltroPendientes(e.target.value)}>
            <option value="">Todas</option>
            <option value="con">Con tareas pendientes</option>
            <option value="vencidas">Con tareas vencidas</option>
            <option value="sin">Sin pendientes</option>
          </select>
        </div>
        <label className="plan-check">
          <input type="checkbox" checked={verTerminadas} onChange={(e) => setVerTerminadas(e.target.checked)} /> Ver terminadas
        </label>
        <button
          type="button"
          className={`plan-filtro-sin-responsable${soloSinResponsable ? ' plan-filtro-sin-responsable-activo' : ''}`}
          onClick={() => setSoloSinResponsable((v) => !v)}
          title="Obras con tareas pendientes a las que todavía no se les asignó responsable"
        >
          👤 Sin responsable <span className="plan-filtro-contador">{cantidadSinResponsable}</span>
        </button>
        {puedeEditar && !creando && (
          <button type="button" className="btn-secundario plan-boton-principal" onClick={() => setCreando(true)}>+ Nueva obra</button>
        )}
      </div>

      {creando && (
        <NuevaObra
          obrasPanel={obrasPanel}
          onCancelar={() => setCreando(false)}
          onCrear={async (form) => {
            await onCrear(form)
            setCreando(false)
          }}
        />
      )}

      {error && <div className="auth-error plan-error">{error} <button type="button" className="btn-secundario" onClick={() => setError('')}>OK</button></div>}

      <div className="tabla-scroll">
        <table className="tabla-adicionales plan-tabla-obras">
          <thead>
            <tr>
              {COLUMNAS_OBRAS.map((c) => (
                <th key={c.clave}>
                  {c.sinOrden ? c.titulo : (
                    <button type="button" className={`plan-th-orden${orden?.clave === c.clave ? ' plan-th-orden-activo' : ''}`} onClick={() => ordenarPor(c.clave)}
                      title="Ordenar por esta columna">
                      {c.titulo}
                      <span className="plan-th-flecha">{orden?.clave === c.clave ? (orden.desc ? '▼' : '▲') : '↕'}</span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtradas.map(({ o, pendientes, proxima, montaje, vencidas, faltanResponsable }) => (
              <tr key={o.id} className="plan-fila-obra" onClick={() => onAbrir(o.id)}>
                <td className="adicionales-obra-col-obra">{o.nombre}{o.estado === 'Terminada' && <span className="plan-etiqueta-terminada">Terminada</span>}</td>
                <td>{o.constructora || '—'}</td>
                {/* La situación se cambia aquí mismo, sin entrar a la obra
                    (a pedido de Álvaro, 2026-10-02). */}
                <td onClick={(e) => { if (puedeEditar) e.stopPropagation() }}>
                  {puedeEditar ? (
                    <select className="select-inline plan-select-situacion" value={o.situacion || ''}
                      style={{ background: COLOR_SITUACION[o.situacion] || 'white' }}
                      onChange={(e) => onActualizarObra(o.id, { situacion: e.target.value }).catch((err) => setError(err.message))}>
                      <option value="">Sin situación</option>
                      {SITUACIONES.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  ) : o.situacion ? <span className="plan-chip" style={{ background: COLOR_SITUACION[o.situacion] || colorCategoria('Varios') }}>{o.situacion}</span> : '—'}
                </td>
                {/* Estado de la obra editable en la fila (a pedido de Álvaro,
                    2026-10-02). Al pasarla a Terminada sale de la lista salvo
                    con "Ver terminadas". */}
                <td onClick={(e) => { if (puedeEditar) e.stopPropagation() }}>
                  {puedeEditar ? (
                    <select className={`select-inline plan-select-estado${o.estado === 'Terminada' ? ' plan-select-estado-terminada' : ''}`} value={o.estado || 'Activa'}
                      onChange={(e) => onActualizarObra(o.id, { estado: e.target.value }).catch((err) => setError(err.message))}>
                      <option>Activa</option>
                      <option>Terminada</option>
                    </select>
                  ) : (o.estado || 'Activa')}
                </td>
                <td>{proxima ? `${proxima.categoria} · ${textoFechas(proxima)}` : '—'}</td>
                <td>{montaje ? `${textoFechas(montaje)}${montaje.responsable ? ` · ${montaje.responsable}` : ''}` : '—'}</td>
                <td>
                  {pendientes.length}
                  {vencidas > 0 && <span className="plan-vencidas" title="Tareas pendientes con la fecha ya pasada">{vencidas} vencida{vencidas === 1 ? '' : 's'}</span>}
                  {faltanResponsable > 0 && <span className="plan-sin-responsable" title="Tareas pendientes sin responsable asignado">{faltanResponsable} sin responsable</span>}
                </td>
                <td>{o.obra_panel ? '🔗' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length === 0 && <p className="dashboard-nota">{soloSinResponsable && !filtroSituacion && !buscar && !filtroPendientes ? 'Todas las obras activas tienen responsable asignado. 👍' : `No hay obras${hayFiltros ? ' que coincidan con los filtros' : ''}.`}</p>}
    </div>
  )
}

// Pestaña Facturación (a pedido de Álvaro, 2026-10-02): todas las tareas de
// "Facturar" que siguen sin terminar, de cualquier obra (también de obras
// ya marcadas Terminada, para que no se escape ninguna), con su comentario
// editable. Marcar "Facturado" la da por terminada y sale de la lista.
function ListaFacturacion({ datos, tareasPorObra, puedeEditar, onActualizarTarea, onAbrir }) {
  const [buscar, setBuscar] = useState('')
  const [soloMontajeTerminado, setSoloMontajeTerminado] = useState(false)
  const [error, setError] = useState('')
  const hoy = hoyIso()
  const obrasPorId = new Map(datos.obras.map((o) => [o.id, o]))

  // Montaje de la obra: terminado si todas sus tareas de Montaje lo están.
  const estadoMontaje = (obraId) => {
    const montajes = (tareasPorObra.get(obraId) || []).filter((t) => t.categoria === 'Montaje')
    if (montajes.length === 0) return { texto: '—', terminado: false }
    const pendientes = montajes.filter((t) => t.estado !== 'Terminado')
    if (pendientes.length === 0) return { texto: '✓ Terminado', terminado: true }
    const proximo = pendientes.sort((a, b) => (a.fecha_inicio || '9999').localeCompare(b.fecha_inicio || '9999'))[0]
    return { texto: textoFechas(proximo), terminado: false }
  }

  const filas = datos.tareas
    .filter((t) => t.categoria === 'Facturar' && t.estado !== 'Terminado')
    .map((t) => ({ t, o: obrasPorId.get(t.obra_id), montaje: estadoMontaje(t.obra_id) }))
    .filter(({ o }) => o)
    .filter(({ o }) => !buscar || normalizar(`${o.nombre} ${o.constructora}`).includes(normalizar(buscar)))
    .filter(({ montaje }) => !soloMontajeTerminado || montaje.terminado)
    .sort((a, b) => (a.t.fecha_inicio || '9999').localeCompare(b.t.fecha_inicio || '9999') || a.o.nombre.localeCompare(b.o.nombre))

  const guardar = (id, cambios) => onActualizarTarea(id, cambios).catch((err) => setError(err.message))

  return (
    <div>
      <div className="filtro-tabla">
        <div className="filtro-campo">
          <label>Buscar</label>
          <input type="text" className="input-filtro" placeholder="Obra o constructora…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <label className="plan-check">
          <input type="checkbox" checked={soloMontajeTerminado} onChange={(e) => setSoloMontajeTerminado(e.target.checked)} /> Solo con montaje terminado
        </label>
        <span className="dashboard-nota plan-nota-sin-margen">{filas.length} {filas.length === 1 ? 'facturación pendiente' : 'facturaciones pendientes'}</span>
      </div>

      {error && <div className="auth-error plan-error">{error} <button type="button" className="btn-secundario" onClick={() => setError('')}>OK</button></div>}

      <div className="tabla-scroll">
        <table className="tabla-adicionales plan-tabla-tareas plan-tabla-facturacion">
          <thead>
            <tr>
              <th>Obra</th>
              <th>Situación</th>
              <th>Montaje</th>
              <th>Facturar</th>
              <th>Responsable</th>
              <th>Comentario</th>
              <th>Facturado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ t, o, montaje }) => {
              const vencida = t.fecha_inicio && (t.fecha_fin || t.fecha_inicio) < hoy
              return (
                <tr key={t.id}>
                  <td>
                    <button type="button" className="plan-enlace" onClick={() => onAbrir(o.id)}>{o.nombre}</button>
                    {o.constructora && <span className="gantt-etiqueta-sub plan-sub-bloque">{o.constructora}</span>}
                    {o.estado === 'Terminada' && <span className="plan-etiqueta-terminada">Obra terminada</span>}
                  </td>
                  <td>{o.situacion ? <span className="plan-chip" style={{ background: COLOR_SITUACION[o.situacion] || colorCategoria('Varios') }}>{o.situacion}</span> : '—'}</td>
                  <td className={montaje.terminado ? 'plan-montaje-terminado' : ''}>{montaje.texto}</td>
                  <td>
                    {textoFechas(t)}
                    {vencida && <span className="plan-vencidas" title="La fecha de facturar ya pasó">vencida</span>}
                  </td>
                  <td>{t.responsable || '—'}</td>
                  <td className="plan-celda-comentario">
                    <CampoTextoLargo valor={t.comentario} disabled={!puedeEditar} placeholder="Sin comentario" onGuardar={(v) => guardar(t.id, { comentario: v })} />
                  </td>
                  <td className="plan-celda-centro">
                    <input type="checkbox" checked={false} disabled={!puedeEditar} title="Marcar como facturado (sale de la lista)"
                      onChange={() => guardar(t.id, { estado: 'Terminado' })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filas.length === 0 && <p className="dashboard-nota">{buscar || soloMontajeTerminado ? 'Ninguna facturación pendiente coincide con los filtros.' : 'No hay facturaciones pendientes. 👍'}</p>}
    </div>
  )
}

export default function PlanificacionPage() {
  const { accessToken } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [escala, setEscala] = useState('Mes')
  const [desde, setDesde] = useState(() => numeroADia(diaANumero(lunesDe(hoyIso())) - 7))
  const [categorias, setCategorias] = useState(() => new Set())
  const [responsable, setResponsable] = useState('')
  // Filtro por situación de la obra para Cronograma y Montaje (a pedido de
  // Álvaro, 2026-10-01).
  const [situacion, setSituacion] = useState('')
  const coincideSituacion = (o) => !situacion || (situacion === '__sin__' ? !o?.situacion : o?.situacion === situacion)
  // Obras "fijadas" del Cronograma (a pedido de Álvaro, 2026-10-01): al ir a
  // una fecha con la flecha de una barra, la lista de obras NO se vuelve a
  // filtrar por el nuevo período — se mantienen las mismas obras (en el mismo
  // orden) para poder ver esa obra sin perder las demás. Se suelta al
  // navegar con ◀ Hoy ▶, cambiar la escala o tocar un filtro.
  const [obrasFijadas, setObrasFijadas] = useState(null)
  // Mini menú de situación del Cronograma ({ obraId, x, y } en pantalla).
  const [menuSituacion, setMenuSituacion] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [compacto, setCompacto] = useState(false)
  const [verTerminadas, setVerTerminadas] = useState(false)
  // (soltar las obras fijadas al cambiar filtros o escala — ver obrasFijadas)
  useEffect(() => {
    setObrasFijadas(null)
  }, [buscar, categorias, responsable, situacion, verTerminadas, compacto, escala])
  const [tareaAbierta, setTareaAbierta] = useState(null)

  const pestana = PESTANAS.includes(searchParams.get('pestana')) ? searchParams.get('pestana') : 'Cronograma'
  const obraAbiertaId = Number(searchParams.get('obra')) || null

  useEffect(() => {
    planificacion(accessToken)
      .then((d) => setDatos(datosNum(d)))
      .catch((err) => setError(err.message))
  }, [accessToken])

  const obrasPorId = useMemo(() => new Map((datos?.obras || []).map((o) => [o.id, o])), [datos])
  const tareasPorObra = useMemo(() => {
    const m = new Map()
    for (const t of datos?.tareas || []) {
      if (!m.has(t.obra_id)) m.set(t.obra_id, [])
      m.get(t.obra_id).push(t)
    }
    return m
  }, [datos])

  const { dias, anchoDia } = ESCALAS[escala]
  const inicioVentana = diaANumero(desde)
  const finVentana = inicioVentana + dias - 1
  const puedeEditar = !!datos?.puede_editar

  function irA(nuevaPestana, obraId) {
    const params = { pestana: nuevaPestana }
    if (obraId) params.obra = String(obraId)
    setSearchParams(params)
  }

  // --- Deshacer (Ctrl+Z) — a pedido de Álvaro, 2026-10-02, común a todo el
  // panel (ver context/DeshacerContext.jsx). Cada acción registra cómo
  // volver atrás. Crear o eliminar una obra entera no se deshace (eso ya
  // pide confirmación).
  const { registrar } = useDeshacer()
  const datosRef = useRef(datos)
  useEffect(() => { datosRef.current = datos }, [datos])
  const idActual = (id) => idVigente('plan-tarea', id)
  const nombreObra = (obraId) => datosRef.current?.obras.find((o) => o.id === obraId)?.nombre || 'obra'
  const registrarDeshacer = (descripcion, fn) => registrar(`Planificación: ${descripcion}`, fn)

  // --- Acciones (optimistas donde tiene sentido: mover barras tiene que
  // sentirse instantáneo; si el servidor rechaza, se vuelve atrás).
  async function actualizarTarea(id, cambios, { registrar = true } = {}) {
    const anterior = datosRef.current.tareas.find((t) => t.id === id)
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? { ...t, ...cambios } : t)) }))
    try {
      const tarea = tareaNum((await actualizarTareaPlanificacion(accessToken, id, cambios)).tarea)
      setDatos((prev) => ({
        ...prev,
        tareas: prev.tareas.map((t) => (t.id === id ? tarea : t)),
        responsables: [...new Set([...prev.responsables, ...responsablesDe(tarea)])].sort((a, b) => a.localeCompare(b)),
      }))
      if (registrar && anterior) {
        const previos = Object.fromEntries(Object.keys(cambios).map((k) => [k, anterior[k] ?? null]))
        if (Object.keys(cambios).some((k) => (anterior[k] ?? '') !== (cambios[k] ?? ''))) {
          registrarDeshacer(`cambio en ${anterior.categoria} (${nombreObra(anterior.obra_id)})`, () => actualizarTarea(idActual(id), previos, { registrar: false }))
        }
      }
    } catch (err) {
      if (anterior) setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? anterior : t)) }))
      throw err
    }
  }

  async function actualizarObra(id, cambios, { registrar = true } = {}) {
    const anterior = datosRef.current.obras.find((o) => o.id === id)
    const obra = obraNum((await actualizarObraPlanificacion(accessToken, id, cambios)).obra)
    setDatos((prev) => ({ ...prev, obras: prev.obras.map((o) => (o.id === id ? obra : o)) }))
    if (registrar && anterior) {
      const previos = Object.fromEntries(Object.keys(cambios).map((k) => [k, anterior[k] ?? null]))
      registrarDeshacer(`cambio en la obra ${anterior.nombre}`, () => actualizarObra(id, previos, { registrar: false }))
    }
  }

  async function crearObra(form) {
    const creada = await crearObraPlanificacion(accessToken, form)
    const obra = obraNum(creada.obra)
    const tareas = creada.tareas.map(tareaNum)
    setDatos((prev) => ({ ...prev, obras: [...prev.obras, obra], tareas: [...prev.tareas, ...tareas] }))
    irA('Obras', obra.id)
  }

  // Guarda fechas (u otros campos) de varias tareas a la vez: pantalla
  // primero y después cada tarea; si algo falla se recarga todo del servidor
  // para no dejar la obra a medias. cambios: Map id → campos.
  async function guardarVariasTareas(cambios) {
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (cambios.has(t.id) ? { ...t, ...cambios.get(t.id) } : t)) }))
    try {
      await Promise.all([...cambios].map(([id, c]) => actualizarTareaPlanificacion(accessToken, id, c)))
    } catch (err) {
      planificacion(accessToken).then((d) => setDatos(datosNum(d)))
      throw err
    }
  }

  // Rellena las fechas de la obra con el cronograma tipo desde la fecha de
  // aceptación (lo calcula el servidor, ver backend/src/Planificacion.php).
  async function calcularFechas(obraId, fechaAceptacion) {
    const obraAntes = datosRef.current.obras.find((o) => o.id === obraId)
    const tareasAntes = datosRef.current.tareas.filter((t) => t.obra_id === obraId)
    const r = await calcularFechasPlanificacion(accessToken, obraId, fechaAceptacion)
    const obra = obraNum(r.obra)
    const tareas = r.tareas.map(tareaNum)
    setDatos((prev) => ({
      ...prev,
      obras: prev.obras.map((o) => (o.id === obraId ? obra : o)),
      tareas: [...prev.tareas.filter((t) => t.obra_id !== obraId), ...tareas],
    }))
    // Deshacer: quita las tareas que se crearon y devuelve las fechas.
    const idsAntes = new Set(tareasAntes.map((t) => t.id))
    const creadas = tareas.filter((t) => !idsAntes.has(t.id)).map((t) => t.id)
    registrarDeshacer(`calcular fechas de ${obra.nombre}`, async () => {
      await Promise.all(creadas.map((id) => eliminarTarea(idActual(id), { registrar: false })))
      await guardarVariasTareas(new Map(tareasAntes
        .filter((t) => t.estado !== 'Terminado')
        .map((t) => [idActual(t.id), { fecha_inicio: t.fecha_inicio ?? null, fecha_fin: t.fecha_fin ?? null }])))
      await actualizarObra(obraId, { fecha_aceptacion: obraAntes?.fecha_aceptacion ?? null }, { registrar: false })
    })
  }

  async function eliminarObra(id) {
    await eliminarObraPlanificacion(accessToken, id)
    setDatos((prev) => ({ ...prev, obras: prev.obras.filter((o) => o.id !== id), tareas: prev.tareas.filter((t) => t.obra_id !== id) }))
    irA('Obras')
  }

  async function agregarTarea(obraId, categoria, { registrar = true, campos = {} } = {}) {
    const tarea = tareaNum((await agregarTareaPlanificacion(accessToken, obraId, categoria, campos)).tarea)
    setDatos((prev) => ({ ...prev, tareas: [...prev.tareas, tarea] }))
    if (registrar) {
      registrarDeshacer(`agregar ${categoria} (${nombreObra(obraId)})`, () => eliminarTarea(idActual(tarea.id), { registrar: false }))
    }
    return tarea
  }

  async function eliminarTarea(id, { registrar = true } = {}) {
    const anterior = datosRef.current.tareas.find((t) => t.id === id)
    await eliminarTareaPlanificacion(accessToken, id)
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.filter((t) => t.id !== id) }))
    if (registrar && anterior) {
      registrarDeshacer(`eliminar ${anterior.categoria} (${nombreObra(anterior.obra_id)})`, async () => {
        const { fecha_inicio, fecha_fin, responsable, ayudante, estado, comentario } = anterior
        const nueva = await agregarTarea(anterior.obra_id, anterior.categoria, {
          registrar: false,
          campos: { fecha_inicio, fecha_fin, responsable, ayudante, estado, comentario },
        })
        marcarRecreado('plan-tarea', id, nueva.id)
      })
    }
  }

  // Corre todas las tareas pendientes con fecha de una obra "delta" días.
  async function moverObra(obraId, delta) {
    if (!delta) return
    const correr = (iso) => (iso ? numeroADia(diaANumero(iso) + delta) : iso)
    const movidas = datosRef.current.tareas.filter((t) => t.obra_id === obraId && t.estado !== 'Terminado' && t.fecha_inicio)
    await guardarVariasTareas(new Map(movidas.map((t) => [t.id, { fecha_inicio: correr(t.fecha_inicio), fecha_fin: correr(t.fecha_fin) }])))
    registrarDeshacer(`mover la obra ${nombreObra(obraId)}`, () => guardarVariasTareas(
      new Map(movidas.map((t) => [idActual(t.id), { fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin ?? null }])),
    ))
  }

  function moverBarra(barra, inicio, fin) {
    const guardado = barra.obraId
      ? moverObra(barra.obraId, diaANumero(inicio) - diaANumero(barra.inicio))
      : actualizarTarea(barra.tarea.id, { fecha_inicio: inicio, fecha_fin: fin })
    guardado.catch((err) => setError(err.message))
  }

  // --- Filas del Cronograma (todas las categorías, agrupado por obra).
  const filasCronograma = useMemo(() => {
    if (!datos) return []
    const filas = []
    const obras = datos.obras
      .filter((o) => verTerminadas || o.estado !== 'Terminada')
      .filter((o) => !buscar || normalizar(`${o.nombre} ${o.constructora}`).includes(normalizar(buscar)))
      .filter(coincideSituacion)
    const conFechaMasTemprana = []
    for (const o of obras) {
      if (obrasFijadas && !obrasFijadas.includes(o.id)) continue
      const tareas = (tareasPorObra.get(o.id) || [])
        .filter((t) => verTerminadas || t.estado !== 'Terminado')
        .filter((t) => categorias.size === 0 || categorias.has(t.categoria))
        .filter((t) => !responsable || responsablesDe(t).includes(responsable))
        .filter((t) => (obrasFijadas ? Boolean(t.fecha_inicio) : seCruzaConVentana(t, inicioVentana, finVentana)))
        .sort((a, b) => posicionCategoria(datos.categorias, a.categoria) - posicionCategoria(datos.categorias, b.categoria) || a.fecha_inicio.localeCompare(b.fecha_inicio))
      if (tareas.length === 0) continue
      conFechaMasTemprana.push({ o, tareas, primera: Math.min(...tareas.map((t) => diaANumero(t.fecha_inicio))) })
    }
    if (obrasFijadas) conFechaMasTemprana.sort((a, b) => obrasFijadas.indexOf(a.o.id) - obrasFijadas.indexOf(b.o.id))
    else conFechaMasTemprana.sort((a, b) => a.primera - b.primera || a.o.nombre.localeCompare(b.o.nombre))
    for (const { o, tareas } of conFechaMasTemprana) {
      const barra = (t) => ({
        id: t.id,
        inicio: t.fecha_inicio,
        fin: t.fecha_fin,
        texto: textoBarraTarea(t),
        titulo: `${o.nombre} — ${t.categoria}${t.responsable ? ` (${t.responsable}${t.categoria === 'Montaje' && t.ayudante ? ` · ${t.ayudante}` : ''})` : ''}${t.comentario ? `\n${t.comentario}` : ''}`,
        color: t.estado === 'Terminado' ? COLOR_TERMINADO : colorCategoria(t.categoria),
        atenuada: t.estado === 'Terminado',
        tarea: t,
      })
      const etiquetaObra = <EtiquetaObraCronograma obra={o} puedeEditar={puedeEditar} onAbrirSituacion={(id, x, y) => setMenuSituacion({ obraId: id, x, y })} />
      if (compacto) {
        filas.push({ id: `obra-${o.id}`, etiqueta: o.nombre, etiquetaNode: etiquetaObra, altoMinimo: 40, barras: tareas.map(barra) })
      } else {
        const barraObra = barraObraCompleta(o, tareasPorObra.get(o.id) || [], o.nombre)
        filas.push({ id: `obra-${o.id}`, etiqueta: o.nombre, etiquetaNode: etiquetaObra, altoMinimo: 40, esGrupo: true, barras: barraObra ? [barraObra] : [] })
        for (const t of tareas) {
          filas.push({ id: `tarea-${t.id}`, etiqueta: t.categoria, subetiqueta: t.responsable || '', barras: [barra(t)] })
        }
      }
    }
    return filas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, tareasPorObra, verTerminadas, buscar, categorias, responsable, situacion, inicioVentana, finVentana, compacto, obrasFijadas])

  // Montaje: una fila por montador (vuelve a como estaba, a pedido de
  // Álvaro 2026-10-01 — la tabla por obra va en el Cronograma).
  const filasMontaje = useMemo(() => {
    if (!datos) return []
    const tareas = datos.tareas.filter((t) => {
      const o = obrasPorId.get(t.obra_id)
      return (!buscar || normalizar(`${o?.nombre} ${o?.constructora}`).includes(normalizar(buscar))) && coincideSituacion(o)
    })
    return detallarFilasMontaje(
      filasMontajePorMontador(tareas, obrasPorId, { incluirTerminadas: verTerminadas, ordenCascadaDesde: desde })
        .filter((f) => !responsable || f.etiqueta === responsable),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, obrasPorId, buscar, responsable, situacion, verTerminadas, desde])

  // Montajes pendientes cuya fecha ya pasó — lo mismo que en Notion se veía
  // como barras "vencidas" sin marcar Terminado.
  const montajesVencidos = useMemo(() => {
    if (!datos) return []
    const hoy = hoyIso()
    return datos.tareas
      .filter((t) => t.categoria === 'Montaje' && t.estado !== 'Terminado' && t.fecha_inicio && (t.fecha_fin || t.fecha_inicio) < hoy)
      .filter((t) => obrasPorId.get(t.obra_id)?.estado !== 'Terminada')
      .sort((a, b) => (a.fecha_fin || a.fecha_inicio).localeCompare(b.fecha_fin || b.fecha_inicio))
  }, [datos, obrasPorId])

  const montajesSinFecha = useMemo(() => {
    if (!datos) return []
    return datos.tareas.filter((t) => t.categoria === 'Montaje' && t.estado !== 'Terminado' && !t.fecha_inicio && obrasPorId.get(t.obra_id)?.estado !== 'Terminada')
  }, [datos, obrasPorId])

  if (error && !datos) return <div className="dashboard"><div className="auth-error">{error}</div></div>
  if (!datos) return <div className="dashboard"><p className="dashboard-nota">Cargando…</p></div>

  const obraAbierta = obraAbiertaId ? obrasPorId.get(obraAbiertaId) : null
  const tareaSeleccionada = tareaAbierta ? datos.tareas.find((t) => t.id === tareaAbierta) : null
  // Categorías de la lista + las escritas a mano en alguna tarea (para el filtro).
  // En Montaje, el filtro de responsable lista solo a quienes tienen alguna
  // tarea de Montaje (a pedido de Álvaro, 2026-10-02); si el elegido no está,
  // se muestra igual para poder quitarlo.
  const responsablesMontaje = [...new Set([
    ...datos.tareas.filter((t) => t.categoria === 'Montaje').flatMap(responsablesDe),
    ...(responsable ? [responsable] : []),
  ])].sort((a, b) => a.localeCompare(b, 'es'))
  const categoriasTodas = [...datos.categorias, ...new Set(datos.tareas.map((t) => t.categoria).filter((c) => !datos.categorias.includes(c)))]

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Planificación de Obras</h1>
          <p>Cronograma por categoría y Gantt de montaje{puedeEditar ? ' — arrastra las barras para mover o estirar las fechas' : ''}</p>
        </div>
      </header>

      <div className="seguimiento-pestanas">
        {PESTANAS.map((p) => (
          <button key={p} type="button" className={`seguimiento-pestana ${p === pestana ? 'seguimiento-pestana-activa' : ''}`} onClick={() => irA(p)}>
            {p}
          </button>
        ))}
      </div>

      {error && <div className="auth-error plan-error">{error} <button type="button" className="btn-secundario" onClick={() => setError('')}>OK</button></div>}

      {(pestana === 'Cronograma' || pestana === 'Montaje') && (
        <div className="filtro-tabla plan-filtros">
          <NavegacionFechas desde={desde} setDesde={(d) => { setObrasFijadas(null); setDesde(d) }} escala={escala} setEscala={setEscala} />
          <div className="filtro-campo">
            <label>Obra</label>
            <input type="text" className="input-filtro" placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </div>
          <div className="filtro-campo">
            <label>Responsable</label>
            <select className="select-inline" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="">Todos</option>
              {(pestana === 'Montaje' ? responsablesMontaje : datos.responsables).map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="filtro-campo">
            <label>Situación</label>
            <select className="select-inline" value={situacion} onChange={(e) => setSituacion(e.target.value)}>
              <option value="">Todas</option>
              {SITUACIONES.map((x) => <option key={x}>{x}</option>)}
              <option value="__sin__">Sin situación</option>
            </select>
          </div>
          <label className="plan-check">
            <input type="checkbox" checked={verTerminadas} onChange={(e) => setVerTerminadas(e.target.checked)} /> Ver terminadas
          </label>
          {pestana === 'Cronograma' && (
            <label className="plan-check">
              <input type="checkbox" checked={compacto} onChange={(e) => setCompacto(e.target.checked)} /> Una fila por obra
            </label>
          )}
        </div>
      )}

      {pestana === 'Cronograma' && (
        <>
          <FiltroCategorias categorias={categoriasTodas} seleccionadas={categorias} onCambiar={setCategorias} />
          {obrasFijadas && (
            <div className="plan-aviso-fijadas">
              Mostrando las mismas obras que antes de saltar de fecha.
              <button type="button" className="btn-secundario" onClick={() => setObrasFijadas(null)}>Ver las del período</button>
            </div>
          )}
          <DiagramaGantt
            filas={filasCronograma}
            desde={desde}
            dias={dias}
            anchoDia={anchoDia}
            editable={puedeEditar}
            anchoEtiqueta={340}
            encabezadoEtiqueta={(
              <div className="plan-fila-cronograma plan-fila-montaje-encabezado">
                <span>Situación</span><span>Obra</span>
              </div>
            )}
            onMoverBarra={moverBarra}
            onClickBarra={(b) => (b.obraId ? irA('Obras', b.obraId) : setTareaAbierta(b.tarea.id))}
            onIrAFecha={(iso) => {
              // Mantener las mismas obras (ver comentario de obrasFijadas).
              setObrasFijadas((prev) => prev || [...new Set(filasCronograma.filter((f) => String(f.id).startsWith('obra-')).map((f) => Number(String(f.id).slice(5))))])
              setDesde(lunesDe(iso))
            }}
            onDesplazar={(d) => {
              // Al arrastrar una obra fuera de la vista: también se fijan las
              // obras, si no la fila que se está arrastrando podría desaparecer.
              setObrasFijadas((prev) => prev || [...new Set(filasCronograma.filter((f) => String(f.id).startsWith('obra-')).map((f) => Number(String(f.id).slice(5))))])
              setDesde((prev) => numeroADia(diaANumero(prev) + d))
            }}
            vacio="No hay tareas con fecha en este período con los filtros elegidos."
          />
        </>
      )}

      {pestana === 'Montaje' && (
        <>
          <LeyendaColores colores={COLOR_SITUACION} />
          <DiagramaGantt
            filas={filasMontaje}
            desde={desde}
            dias={dias}
            anchoDia={anchoDia}
            editable={puedeEditar}
            onMoverBarra={moverBarra}
            onClickBarra={(b) => setTareaAbierta(b.tarea.id)}
            onIrAFecha={(iso) => setDesde(lunesDe(iso))}
            onDesplazar={(d) => setDesde((prev) => numeroADia(diaANumero(prev) + d))}
            anchoEtiqueta={300}
            vacio="No hay montajes con fecha."
          />
          <div className="plan-avisos">
            {montajesVencidos.length > 0 && (
              <div className="plan-aviso-bloque">
                <h3 className="montaje-subtitulo">⚠ Montajes con la fecha pasada sin marcar Terminado ({montajesVencidos.length})</h3>
                <ul>
                  {montajesVencidos.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="plan-enlace" onClick={() => setTareaAbierta(t.id)}>{obrasPorId.get(t.obra_id)?.nombre}</button>
                      {' '}— {textoFechas(t)} · {t.responsable || 'sin responsable'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {montajesSinFecha.length > 0 && (
              <div className="plan-aviso-bloque">
                <h3 className="montaje-subtitulo">Montajes sin fecha ({montajesSinFecha.length})</h3>
                <ul>
                  {montajesSinFecha.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="plan-enlace" onClick={() => setTareaAbierta(t.id)}>{obrasPorId.get(t.obra_id)?.nombre}</button>
                      {t.responsable ? ` — ${t.responsable}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {pestana === 'Facturación' && (
        <ListaFacturacion
          datos={datos}
          tareasPorObra={tareasPorObra}
          puedeEditar={puedeEditar}
          onActualizarTarea={actualizarTarea}
          onAbrir={(id) => irA('Obras', id)}
        />
      )}

      {pestana === 'Obras' && (
        obraAbierta ? (
          <EditorObra
            obra={obraAbierta}
            tareas={tareasPorObra.get(obraAbierta.id) || []}
            datos={datos}
            puedeEditar={puedeEditar}
            onMoverObra={moverObra}
            onCalcularFechas={calcularFechas}
            onActualizarObra={actualizarObra}
            onEliminarObra={eliminarObra}
            onActualizarTarea={actualizarTarea}
            onAgregarTarea={agregarTarea}
            onEliminarTarea={eliminarTarea}
            onVolver={() => irA('Obras')}
          />
        ) : (
          <ListaObras
            obras={datos.obras}
            tareasPorObra={tareasPorObra}
            puedeEditar={puedeEditar}
            obrasPanel={datos.obras_panel}
            onAbrir={(id) => irA('Obras', id)}
            onCrear={crearObra}
            onActualizarObra={actualizarObra}
          />
        )
      )}

      {menuSituacion && (
        <div className="plan-menu-fondo" onClick={() => setMenuSituacion(null)}>
          <div className="plan-menu-situacion" style={{ left: menuSituacion.x, top: menuSituacion.y }} onClick={(e) => e.stopPropagation()}>
            {SITUACIONES.map((x) => (
              <button key={x} type="button" className="plan-menu-opcion"
                onClick={() => {
                  actualizarObra(menuSituacion.obraId, { situacion: x }).catch((err) => setError(err.message))
                  setMenuSituacion(null)
                }}>
                <span className="plan-chip" style={{ background: COLOR_SITUACION[x] }}>{x}</span>
              </button>
            ))}
            <button type="button" className="plan-menu-opcion plan-menu-quitar"
              onClick={() => {
                actualizarObra(menuSituacion.obraId, { situacion: '' }).catch((err) => setError(err.message))
                setMenuSituacion(null)
              }}>
              Quitar situación
            </button>
          </div>
        </div>
      )}

      {tareaSeleccionada && (
        <VentanaTarea
          tarea={tareaSeleccionada}
          obra={obrasPorId.get(tareaSeleccionada.obra_id)}
          responsables={datos.responsables}
          categorias={datos.categorias}
          personas={datos.personas || []}
          onCrearPersona={async (nombre, rol) => {
            const r = await agregarPersonaMontaje(accessToken, nombre, rol)
            setDatos((prev) => ({ ...prev, personas: r.personas }))
          }}
          puedeEditar={puedeEditar}
          onGuardar={actualizarTarea}
          onCerrar={() => setTareaAbierta(null)}
          onAbrirObra={(o) => { setTareaAbierta(null); irA('Obras', o.id) }}
        />
      )}
    </div>
  )
}
