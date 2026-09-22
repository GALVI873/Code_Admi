import { useEffect, useState } from 'react'
import {
  comentariosObra,
  agregarComentarioObra,
  agregarRespuestaNota,
  marcarComentarioHecho,
  archivarComentarioObra,
  categorizarComentarioObra,
  eliminarConversacionObra,
} from '../api/client.js'

// Pestaña "Notas" de una obra aceptada — a diferencia de ComentariosObra.jsx
// (charla libre entre Álvaro y Geraldinne, estilo chat), acá cada mensaje
// de Álvaro funciona como un pendiente para Alfredo: se muestra como un
// renglón de lista con casillero, no como una burbuja de conversación.
// Alfredo (y solo Alfredo, rol gestion_obras) puede tildarlo como "Hecho"
// — a pedido explícito, Álvaro no tilda sus propios mensajes. Mismo
// backend que ComentariosObra (comentarios_obra.php), agrega el campo
// "hecho" y el PATCH para cambiarlo.
//
// Cada nota admite además un hilo corto de respuestas (comentario_id en
// comentarios_obra_respuestas) — a pedido de Álvaro, para que Alfredo
// pueda contestar puntualmente esa nota sin abrir una nota nueva aparte —
// y un estatus de "archivado", para que una nota ya resuelta deje de
// aparecer en la lista sin borrarla (Alfredo o Álvaro pueden archivar y
// desarchivar).
//
// "categoria" ('tarea' | 'recordatorio'): a pedido de Álvaro, Alfredo
// separa sus notas en dos paneles arrastrando la burbuja de uno a otro
// (drag & drop nativo, sin librería — un solo nivel de "soltar en esta
// columna", no hace falta reordenar adentro). Toda nota nueva arranca en
// "tarea" (default de la columna en el backend).
function nombreBaseObra(obra) {
  return (obra || '').replace(/\s*—\s*Opci[oó]n\s+\w+\s*$/i, '').trim()
}

function formatoFechaHora(iso) {
  if (!iso) return ''
  const fecha = new Date(iso.replace(' ', 'T') + 'Z')
  const dia = String(fecha.getDate()).padStart(2, '0')
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const horas = String(fecha.getHours()).padStart(2, '0')
  const minutos = String(fecha.getMinutes()).padStart(2, '0')
  return `${dia}/${mes}/${fecha.getFullYear()} ${horas}:${minutos}`
}

function NotaItem({ nota, obraBase, accessToken, puedeMarcarHecho, puedeArchivar, puedeCategorizar, onToggleHecho, onArchivar, onNuevaRespuesta }) {
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
      const data = await agregarRespuestaNota(accessToken, obraBase, nota.id, texto)
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
      className={`notas-obra-item ${nota.hecho ? 'notas-obra-item-hecho' : ''} ${nota.archivado ? 'notas-obra-item-archivado' : ''} ${puedeCategorizar ? 'notas-obra-item-arrastrable' : ''}`}
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
        onChange={() => onToggleHecho(nota)}
        title={puedeMarcarHecho ? 'Marcar como hecho' : 'Solo Alfredo puede marcar esto como hecho'}
      />
      <div className="notas-obra-item-cuerpo">
        <p className="notas-obra-item-texto">{nota.mensaje}</p>
        <span className="notas-obra-item-meta">
          {nota.autor_nombre} · {formatoFechaHora(nota.creado_en)}
          {nota.archivado && ' · Archivada'}
        </span>

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

        <form className="notas-obra-respuesta-form" onSubmit={enviarRespuesta}>
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
          onClick={() => onArchivar(nota, !nota.archivado)}
          title={nota.archivado ? 'Desarchivar' : 'Archivar — deja de aparecer en la lista'}
        >
          {nota.archivado ? '↩' : '🗄'}
        </button>
      )}
    </li>
  )
}

// Una columna del tablero (Tareas o Recordatorios) — acepta que se suelte
// encima una nota arrastrada desde cualquiera de las dos columnas.
function ColumnaNotas({ titulo, categoria, notas, puedeCategorizar, onSoltarNota, ...propsNota }) {
  const [sobrevuelo, setSobrevuelo] = useState(false)

  return (
    <div
      className={`notas-obra-columna ${sobrevuelo ? 'notas-obra-columna-sobrevuelo' : ''}`}
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
      <h3 className="notas-obra-columna-titulo">
        {titulo} <span className="obras-seccion-contador">{notas.length}</span>
      </h3>
      {notas.length === 0 && <p className="dashboard-nota notas-obra-columna-vacia">Sin notas acá.</p>}
      <ul className="notas-obra-lista">
        {notas.map((n) => (
          <NotaItem key={n.id} nota={n} puedeCategorizar={puedeCategorizar} {...propsNota} />
        ))}
      </ul>
    </div>
  )
}

export default function NotasObraAceptada({ obra, accessToken, usuario, onLeido }) {
  const obraBase = nombreBaseObra(obra)
  const puedeMarcarHecho = usuario?.roles?.includes('gestion_obras')
  const puedeArchivar = usuario?.roles?.includes('gestion_obras') || usuario?.roles?.includes('admin')
  const puedeCategorizar = puedeArchivar
  const puedeEliminar = usuario?.roles?.includes('admin')

  const [notas, setNotas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verArchivadas, setVerArchivadas] = useState(false)

  useEffect(() => {
    let activo = true
    setCargando(true)
    // Trae también las archivadas (incluirArchivadas=true) — se filtran acá
    // nomás según verArchivadas, así alternar el toggle no pide de nuevo.
    comentariosObra(accessToken, obraBase, true)
      .then((data) => {
        if (!activo) return
        setNotas(data.comentarios || [])
        onLeido?.()
      })
      .catch((err) => {
        if (activo) setError(err.message)
      })
      .finally(() => {
        if (activo) setCargando(false)
      })
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraBase, accessToken])

  // Una línea = un pendiente aparte: si Álvaro escribe varias tareas de
  // una sentada (una por renglón), cada una sale como su propio casillero
  // en vez de quedar todo mezclado en un solo ítem que Alfredo no puede
  // tildar por partes. Se mandan en orden, una petición por línea (no hay
  // endpoint de "varias de una" — el volumen típico, unas pocas líneas por
  // nota, no lo justifica).
  async function enviar(e) {
    e.preventDefault()
    const lineas = mensaje.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lineas.length === 0 || enviando) return
    setEnviando(true)
    setError('')
    try {
      const nuevas = []
      for (const linea of lineas) {
        const data = await agregarComentarioObra(accessToken, obraBase, linea)
        nuevas.push({ ...data.comentario, respuestas: [] })
      }
      setNotas((prev) => [...prev, ...nuevas])
      setMensaje('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  // Enter solo agrega un renglón nuevo (comportamiento normal de un
  // textarea) — para enviar sin tocar el botón, Ctrl+Enter (o Cmd+Enter en
  // Mac).
  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      enviar(e)
    }
  }

  async function handleToggleHecho(nota) {
    if (!puedeMarcarHecho) return
    const anteriores = notas
    const hecho = nota.hecho ? 0 : 1
    setNotas((prev) => prev.map((n) => (n.id === nota.id ? { ...n, hecho } : n)))
    try {
      await marcarComentarioHecho(accessToken, nota.id, hecho)
    } catch (err) {
      setNotas(anteriores)
      setError(err.message)
    }
  }

  async function handleArchivar(nota, archivado) {
    if (!puedeArchivar) return
    const anteriores = notas
    setNotas((prev) => prev.map((n) => (n.id === nota.id ? { ...n, archivado: archivado ? 1 : 0 } : n)))
    try {
      await archivarComentarioObra(accessToken, nota.id, archivado)
    } catch (err) {
      setNotas(anteriores)
      setError(err.message)
    }
  }

  async function handleSoltarNota(id, categoria) {
    if (!puedeCategorizar) return
    const nota = notas.find((n) => n.id === id)
    if (!nota || nota.categoria === categoria) return
    const anteriores = notas
    setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, categoria } : n)))
    try {
      await categorizarComentarioObra(accessToken, id, categoria)
    } catch (err) {
      setNotas(anteriores)
      setError(err.message)
    }
  }

  // notaHecho viene del backend (comentarios_obra.php) — si Álvaro le
  // vuelve a escribir a una nota que Alfredo ya había tildado, se destilda
  // sola ahí (no acá): esto solo refleja en pantalla lo que ya pasó en la
  // base, sin repetir esa lógica del lado del cliente.
  function handleNuevaRespuesta(notaId, respuesta, notaHecho) {
    setNotas((prev) => prev.map((n) => (n.id === notaId
      ? { ...n, respuestas: [...(n.respuestas || []), respuesta], hecho: notaHecho ?? n.hecho }
      : n)))
  }

  async function handleVaciarConversacion() {
    if (!puedeEliminar) return
    if (!window.confirm(`¿Vaciar toda la conversación de "${obraBase}"? Esto borra todos los mensajes, no se puede deshacer.`)) {
      return
    }
    setError('')
    try {
      await eliminarConversacionObra(accessToken, obraBase)
      setNotas([])
    } catch (err) {
      setError(err.message)
    }
  }

  const archivadas = notas.filter((n) => n.archivado)
  const notasVisibles = verArchivadas ? notas : notas.filter((n) => !n.archivado)
  const tareas = notasVisibles.filter((n) => (n.categoria || 'tarea') !== 'recordatorio')
  const recordatorios = notasVisibles.filter((n) => n.categoria === 'recordatorio')

  const propsNota = {
    obraBase,
    accessToken,
    puedeMarcarHecho,
    puedeArchivar,
    onToggleHecho: handleToggleHecho,
    onArchivar: handleArchivar,
    onNuevaRespuesta: handleNuevaRespuesta,
  }

  return (
    <div className="notas-obra">
      <div className="notas-obra-encabezado">
        <span className="chat-obra-titulo">Notas</span>
        <div className="notas-obra-encabezado-acciones">
          {puedeArchivar && archivadas.length > 0 && (
            <button type="button" className="notas-obra-ver-archivadas" onClick={() => setVerArchivadas((v) => !v)}>
              {verArchivadas ? 'Ocultar archivadas' : `Ver archivadas (${archivadas.length})`}
            </button>
          )}
          {puedeEliminar && (
            <button type="button" className="notas-obra-vaciar" onClick={handleVaciarConversacion}>
              🗑 Vaciar (prueba)
            </button>
          )}
        </div>
      </div>

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {!cargando && notasVisibles.length === 0 && (
        <p className="dashboard-nota">Todavía no hay notas en esta obra.</p>
      )}

      {!cargando && notasVisibles.length > 0 && (
        <div className="notas-obra-columnas">
          <ColumnaNotas titulo="Tareas" categoria="tarea" notas={tareas} puedeCategorizar={puedeCategorizar} onSoltarNota={handleSoltarNota} {...propsNota} />
          <ColumnaNotas titulo="Recordatorios" categoria="recordatorio" notas={recordatorios} puedeCategorizar={puedeCategorizar} onSoltarNota={handleSoltarNota} {...propsNota} />
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}
      <form className="notas-obra-form" onSubmit={enviar}>
        <textarea
          className="input-filtro notas-obra-textarea"
          placeholder={'Agregar una o más notas… una tarea por línea\n(Ctrl+Enter para agregar — arranca en "Tareas", arrastrala a Recordatorios si hace falta)'}
          rows={2}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" className="btn-secundario" disabled={enviando || !mensaje.trim()}>
          Agregar
        </button>
      </form>
    </div>
  )
}
