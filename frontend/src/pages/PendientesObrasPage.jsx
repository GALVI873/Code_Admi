import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import {
  pendientesObrasAceptadas,
  marcarComentarioHecho,
  categorizarComentarioObra,
  archivarComentarioObra,
  agregarRespuestaNota,
} from '../api/client.js'

// Control general de pendientes para Alfredo — junta, de TODAS las obras
// aceptadas, las notas que Álvaro dejó en la pestaña "Notas" de cada obra
// y que todavía no se marcaron como "Hecho" (ver comentarios_obra.php,
// acción ?pendientes=1). Antes tenía que entrar obra por obra a buscar qué
// le habían dejado; acá lo ve todo junto, agrupado por obra, mismo patrón
// visual que Diario General. Se puede tildar directo desde acá (mismo
// PATCH que en la pestaña Notas) — desaparece de la lista al toque, ya no
// está pendiente.
//
// A pedido de Álvaro: tablero de Tareas/Recordatorios (ver
// NotasObraAceptada.jsx) — Alfredo arrastra la burbuja de un lado a otro
// para categorizarla. A diferencia de esa pestaña (una obra a la vez), acá
// se ven todas juntas — por eso cada obra es su propia fila con las dos
// columnas adentro (en vez de dos columnas globales, cada una agrupada por
// obra por separado): así "Tareas" y "Recordatorios" de la MISMA obra
// quedan a la misma altura, uno al lado del otro, en vez de desalinearse
// según cuántos ítems tenga cada obra en cada lado (2026-09-15, reportado
// con "Avutarda, 38" desalineada entre las dos columnas).
//
// A pedido de Álvaro (2026-09-21): poder archivar una nota y responderla
// directo desde acá, sin tener que entrar al detalle de la obra (pestaña
// Notas) una por una — mismo botón de archivar y mismo hilo de respuestas
// que ya existían en NotasObraAceptada.jsx, reutilizados tal cual.
//
// "Descargar PDF" (a pedido de Álvaro, 2026-09-21): no genera un PDF propio
// — dispara el diálogo de impresión del navegador (window.print) sobre esta
// misma vista ("Guardar como PDF" ahí lo resuelve en cualquier navegador,
// sin agregar ninguna librería nueva). El CSS de impresión (ver
// "@media print" en global.css) oculta el menú lateral, los filtros y los
// controles que no tienen sentido en papel (responder, archivar, arrastrar)
// y deja solo lo que se está viendo — tal cual quedó filtrado en pantalla
// (obra elegida, pestaña Pendientes/Hechas).
function formatoFechaHora(iso) {
  if (!iso) return ''
  const fecha = new Date(iso.replace(' ', 'T') + 'Z')
  const dia = String(fecha.getDate()).padStart(2, '0')
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const horas = String(fecha.getHours()).padStart(2, '0')
  const minutos = String(fecha.getMinutes()).padStart(2, '0')
  return `${dia}/${mes}/${fecha.getFullYear()} ${horas}:${minutos}`
}

// Filtro de obra por selección múltiple — un botón que abre un panel de
// checkboxes (una obra puede tener muchas notas, y con muchas obras
// activas a la vez conviene poder mirar solo un subconjunto). Ninguna
// seleccionada = sin filtro, se ven todas.
function FiltroObrasMultiple({ obrasDisponibles, seleccionadas, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function alClickAfuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alClickAfuera)
    return () => document.removeEventListener('mousedown', alClickAfuera)
  }, [])

  function alternar(obra) {
    const yaEsta = seleccionadas.includes(obra)
    onCambiar(yaEsta ? seleccionadas.filter((o) => o !== obra) : [...seleccionadas, obra])
  }

  const etiqueta =
    seleccionadas.length === 0
      ? 'Todas las obras'
      : seleccionadas.length === 1
        ? seleccionadas[0]
        : `${seleccionadas.length} obras seleccionadas`

  return (
    <div className="filtro-obras" ref={ref}>
      <button type="button" className="filtro-obras-boton" onClick={() => setAbierto((a) => !a)}>
        {etiqueta} <span className="filtro-obras-flecha">▾</span>
      </button>
      {abierto && (
        <div className="filtro-obras-panel">
          <div className="filtro-obras-acciones">
            <button type="button" onClick={() => onCambiar([])}>Ver todas</button>
          </div>
          <ul className="filtro-obras-lista">
            {obrasDisponibles.map((obra) => (
              <li key={obra}>
                <label className="filtro-obras-item">
                  <input
                    type="checkbox"
                    checked={seleccionadas.includes(obra)}
                    onChange={() => alternar(obra)}
                  />
                  {obra}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NotaPendiente({ nota, accessToken, puedeMarcarHecho, puedeCategorizar, puedeArchivar, onMarcarHecho, onAbrir, onArchivar, onNuevaRespuesta }) {
  const [respuesta, setRespuesta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function enviarRespuesta(e) {
    e.preventDefault()
    const texto = respuesta.trim()
    if (!texto || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarRespuestaNota(accessToken, nota.obra, nota.id, texto)
      onNuevaRespuesta(nota.id, data.respuesta, data.nota_hecho)
      setRespuesta('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li
      className={`notas-obra-item ${nota.hecho ? 'notas-obra-item-hecho' : ''} ${puedeCategorizar ? 'notas-obra-item-arrastrable' : ''}`}
      draggable={puedeCategorizar}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(nota.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      title={puedeCategorizar ? 'Arrastrá esta nota a Tareas o Recordatorios para categorizarla' : undefined}
    >
      <input
        type="checkbox"
        className="notas-obra-checkbox"
        checked={!!nota.hecho}
        disabled={!puedeMarcarHecho}
        onChange={() => onMarcarHecho(nota)}
        title={puedeMarcarHecho ? (nota.hecho ? 'Volver a pendiente' : 'Marcar como hecho') : 'Solo Alfredo puede marcar esto como hecho'}
      />
      <div className="notas-obra-item-cuerpo" role="button" tabIndex={0} onClick={() => onAbrir(nota)}>
        <p className="notas-obra-item-texto">{nota.mensaje}</p>
        <span className="notas-obra-item-meta">{nota.autor_nombre} · {formatoFechaHora(nota.creado_en)}</span>

        {nota.respuestas?.length > 0 && (
          <ul className="notas-obra-respuestas">
            {nota.respuestas.map((r) => (
              <li key={r.id} className="notas-obra-respuesta">
                <p className="notas-obra-respuesta-texto">{r.mensaje}</p>
                <span className="notas-obra-respuesta-meta">{r.autor_nombre} · {formatoFechaHora(r.creado_en)}</span>
              </li>
            ))}
          </ul>
        )}

        <form className="notas-obra-respuesta-form" onSubmit={enviarRespuesta} onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            className="input-filtro notas-obra-respuesta-input"
            placeholder="Responder esta nota…"
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
          />
          <button type="submit" className="notas-obra-respuesta-boton" disabled={enviando || !respuesta.trim()}>
            Responder
          </button>
        </form>
        {error && <div className="auth-error">{error}</div>}
      </div>

      {puedeArchivar && (
        <button
          type="button"
          className="notas-obra-archivar"
          onClick={() => onArchivar(nota)}
          title="Archivar — deja de aparecer en la lista"
        >
          🗄
        </button>
      )}
    </li>
  )
}

// Una celda (Tareas o Recordatorios) DENTRO de la fila de una obra puntual
// — el drop target es esta celda nomás, no toda la columna: soltar acá
// categoriza la nota sin importar de qué obra sea (la obra no cambia,
// nunca se mueve de fila, solo su categoría).
function CeldaPendientes({ categoria, items, puedeMarcarHecho, puedeCategorizar, onMarcarHecho, onAbrir, onSoltarNota, ...propsNota }) {
  const [sobrevuelo, setSobrevuelo] = useState(false)
  const etiquetaVacia = categoria === 'recordatorio' ? 'Sin recordatorios.' : 'Sin tareas.'

  return (
    <div
      className={`notas-obra-columna pendientes-celda ${sobrevuelo ? 'notas-obra-columna-sobrevuelo' : ''}`}
      onDragOver={(e) => {
        if (!puedeCategorizar) return
        e.preventDefault()
        setSobrevuelo(true)
      }}
      onDragLeave={() => setSobrevuelo(false)}
      onDrop={(e) => {
        if (!puedeCategorizar) return
        e.preventDefault()
        setSobrevuelo(false)
        const id = Number(e.dataTransfer.getData('text/plain'))
        if (id) onSoltarNota(id, categoria)
      }}
    >
      {items.length === 0 ? (
        <p className="dashboard-nota pendientes-celda-vacia">{etiquetaVacia}</p>
      ) : (
        <ul className="notas-obra-lista">
          {items.map((n) => (
            <NotaPendiente key={n.id} nota={n} puedeMarcarHecho={puedeMarcarHecho} puedeCategorizar={puedeCategorizar} onMarcarHecho={onMarcarHecho} onAbrir={onAbrir} {...propsNota} />
          ))}
        </ul>
      )}
    </div>
  )
}

// Fila de una obra: título con el total, y las dos celdas (Tareas |
// Recordatorios) de esa obra una al lado de la otra.
function FilaObraPendientes({ grupo, puedeMarcarHecho, puedeCategorizar, onMarcarHecho, onAbrir, onSoltarNota, ...propsNota }) {
  return (
    <section className="obras-seccion pendientes-fila-obra">
      <h2 className="obras-seccion-titulo">
        {grupo.obra}
        <span className="obras-seccion-contador">{grupo.tareas.length + grupo.recordatorios.length}</span>
      </h2>
      <div className="notas-obra-columnas pendientes-columnas">
        <CeldaPendientes categoria="tarea" items={grupo.tareas} puedeMarcarHecho={puedeMarcarHecho} puedeCategorizar={puedeCategorizar} onMarcarHecho={onMarcarHecho} onAbrir={onAbrir} onSoltarNota={onSoltarNota} {...propsNota} />
        <CeldaPendientes categoria="recordatorio" items={grupo.recordatorios} puedeMarcarHecho={puedeMarcarHecho} puedeCategorizar={puedeCategorizar} onMarcarHecho={onMarcarHecho} onAbrir={onAbrir} onSoltarNota={onSoltarNota} {...propsNota} />
      </div>
    </section>
  )
}

export default function PendientesObrasPage() {
  const { accessToken, usuario } = useAuth()
  const navigate = useNavigate()
  const puedeMarcarHecho = usuario?.roles?.includes('gestion_obras')
  const puedeCategorizar = usuario?.roles?.includes('gestion_obras') || usuario?.roles?.includes('admin')
  const puedeArchivar = puedeCategorizar

  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [obrasFiltradas, setObrasFiltradas] = useState([])
  // Pestaña "Pendientes"/"Hechas" (a pedido de Álvaro) — el GET ya trae las
  // dos, acá solo se filtra cuál mostrar.
  const [vista, setVista] = useState('pendientes')

  useEffect(() => {
    pendientesObrasAceptadas(accessToken)
      .then((data) => setPendientes(data.comentarios || []))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const obrasDisponibles = useMemo(() => {
    return Array.from(new Set(pendientes.map((p) => p.obra))).sort((a, b) => a.localeCompare(b, 'es'))
  }, [pendientes])

  const segunVista = useMemo(
    () => pendientes.filter((p) => (vista === 'hechas' ? p.hecho : !p.hecho)),
    [pendientes, vista],
  )

  const visibles = useMemo(
    () => (obrasFiltradas.length === 0 ? segunVista : segunVista.filter((p) => obrasFiltradas.includes(p.obra))),
    [segunVista, obrasFiltradas],
  )

  // Una fila por obra, con sus tareas y recordatorios ya separados adentro
  // — así las dos columnas quedan alineadas por obra en vez de por
  // posición (ver comentario de cabecera).
  const gruposObra = useMemo(() => {
    const mapa = new Map()
    for (const p of visibles) {
      if (!mapa.has(p.obra)) mapa.set(p.obra, { obra: p.obra, tareas: [], recordatorios: [] })
      const grupo = mapa.get(p.obra)
      if (p.categoria === 'recordatorio') grupo.recordatorios.push(p)
      else grupo.tareas.push(p)
    }
    return Array.from(mapa.values()).sort((a, b) => a.obra.localeCompare(b.obra, 'es'))
  }, [visibles])

  const totalTareas = useMemo(() => gruposObra.reduce((acc, g) => acc + g.tareas.length, 0), [gruposObra])
  const totalRecordatorios = useMemo(() => gruposObra.reduce((acc, g) => acc + g.recordatorios.length, 0), [gruposObra])

  async function handleMarcarHecho(nota) {
    if (!puedeMarcarHecho) return
    const nuevoHecho = nota.hecho ? 0 : 1
    const anteriores = pendientes
    setPendientes((prev) => prev.map((n) => (n.id === nota.id ? { ...n, hecho: nuevoHecho } : n)))
    try {
      await marcarComentarioHecho(accessToken, nota.id, nuevoHecho)
    } catch (err) {
      setPendientes(anteriores)
      setError(err.message)
    }
  }

  async function handleSoltarNota(id, categoria) {
    if (!puedeCategorizar) return
    const nota = pendientes.find((n) => n.id === id)
    if (!nota || (nota.categoria || 'tarea') === categoria) return
    const anteriores = pendientes
    setPendientes((prev) => prev.map((n) => (n.id === id ? { ...n, categoria } : n)))
    try {
      await categorizarComentarioObra(accessToken, id, categoria)
    } catch (err) {
      setPendientes(anteriores)
      setError(err.message)
    }
  }

  async function handleArchivar(nota) {
    if (!puedeArchivar) return
    const anteriores = pendientes
    setPendientes((prev) => prev.filter((n) => n.id !== nota.id))
    try {
      await archivarComentarioObra(accessToken, nota.id, true)
    } catch (err) {
      setPendientes(anteriores)
      setError(err.message)
    }
  }

  // notaHecho viene del backend (comentarios_obra.php) — si Álvaro le
  // vuelve a escribir a una nota que Alfredo ya había tildado, se destilda
  // sola ahí; esto solo refleja en pantalla lo que ya pasó en la base (la
  // nota reaparece en la pestaña Pendientes al toque).
  function handleNuevaRespuesta(notaId, respuesta, notaHecho) {
    setPendientes((prev) => prev.map((n) => (n.id === notaId
      ? { ...n, respuestas: [...(n.respuestas || []), respuesta], hecho: notaHecho ?? n.hecho }
      : n)))
  }

  function handleAbrir(nota) {
    navigate(`/obras-aceptadas/${nota.obra_id}?pestana=Notas`)
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Pendientes</h1>
          <p>Notas que Álvaro dejó en Obras Aceptadas, juntas de todas las obras — se van sacando de acá a medida que se marcan como hechas.</p>
        </div>
        {!cargando && !error && gruposObra.length > 0 && (
          <button type="button" className="btn-secundario pendientes-boton-imprimir" onClick={() => window.print()}>
            🖨 Descargar PDF
          </button>
        )}
      </header>

      {!cargando && !error && pendientes.length > 0 && (
        <div className="filtro-tabla">
          <div className="filtro-campo">
            <label>Obra</label>
            <FiltroObrasMultiple
              obrasDisponibles={obrasDisponibles}
              seleccionadas={obrasFiltradas}
              onCambiar={setObrasFiltradas}
            />
          </div>
          <div className="pestanas-vista pendientes-pestanas-vista">
            <button
              type="button"
              className={`pestanas-vista-boton ${vista === 'pendientes' ? 'pestanas-vista-boton-activa' : ''}`}
              onClick={() => setVista('pendientes')}
            >
              Pendientes
            </button>
            <button
              type="button"
              className={`pestanas-vista-boton ${vista === 'hechas' ? 'pestanas-vista-boton-activa' : ''}`}
              onClick={() => setVista('hechas')}
            >
              Hechas
            </button>
          </div>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}
      {!cargando && !error && pendientes.length === 0 && (
        <p className="dashboard-nota">No hay pendientes — está todo al día.</p>
      )}
      {!cargando && !error && pendientes.length > 0 && segunVista.length === 0 && (
        <p className="dashboard-nota">{vista === 'hechas' ? 'Todavía no se marcó nada como hecho.' : '¡Está todo al día! No hay pendientes.'}</p>
      )}
      {!cargando && !error && segunVista.length > 0 && visibles.length === 0 && (
        <p className="dashboard-nota">Ninguna obra seleccionada tiene {vista === 'hechas' ? 'hechas' : 'pendientes'}.</p>
      )}

      {!cargando && !error && gruposObra.length > 0 && (
        <>
          <div className="notas-obra-columnas pendientes-columnas pendientes-encabezados">
            <h3 className="notas-obra-columna-titulo">Tareas <span className="obras-seccion-contador">{totalTareas}</span></h3>
            <h3 className="notas-obra-columna-titulo">Recordatorios <span className="obras-seccion-contador">{totalRecordatorios}</span></h3>
          </div>
          {gruposObra.map((grupo) => (
            <FilaObraPendientes
              key={grupo.obra}
              grupo={grupo}
              accessToken={accessToken}
              puedeMarcarHecho={puedeMarcarHecho}
              puedeCategorizar={puedeCategorizar}
              puedeArchivar={puedeArchivar}
              onMarcarHecho={handleMarcarHecho}
              onAbrir={handleAbrir}
              onSoltarNota={handleSoltarNota}
              onArchivar={handleArchivar}
              onNuevaRespuesta={handleNuevaRespuesta}
            />
          ))}
        </>
      )}
    </div>
  )
}
