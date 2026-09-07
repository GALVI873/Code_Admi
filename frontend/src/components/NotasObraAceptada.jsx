import { useEffect, useState } from 'react'
import {
  comentariosObra,
  agregarComentarioObra,
  marcarComentarioHecho,
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

export default function NotasObraAceptada({ obra, accessToken, usuario, onLeido }) {
  const obraBase = nombreBaseObra(obra)
  const puedeMarcarHecho = usuario?.roles?.includes('gestion_obras')
  const puedeEliminar = usuario?.roles?.includes('admin')

  const [notas, setNotas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let activo = true
    setCargando(true)
    comentariosObra(accessToken, obraBase)
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

  async function enviar(e) {
    e.preventDefault()
    const texto = mensaje.trim()
    if (!texto || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarComentarioObra(accessToken, obraBase, texto)
      setNotas((prev) => [...prev, data.comentario])
      setMensaje('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
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

  return (
    <div className="notas-obra">
      <div className="notas-obra-encabezado">
        <span className="chat-obra-titulo">Notas</span>
        {puedeEliminar && (
          <button type="button" className="notas-obra-vaciar" onClick={handleVaciarConversacion}>
            🗑 Vaciar (prueba)
          </button>
        )}
      </div>

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {!cargando && notas.length === 0 && (
        <p className="dashboard-nota">Todavía no hay notas en esta obra.</p>
      )}

      <ul className="notas-obra-lista">
        {notas.map((n) => (
          <li key={n.id} className={`notas-obra-item ${n.hecho ? 'notas-obra-item-hecho' : ''}`}>
            <input
              type="checkbox"
              className="notas-obra-checkbox"
              checked={!!n.hecho}
              disabled={!puedeMarcarHecho}
              onChange={() => handleToggleHecho(n)}
              title={puedeMarcarHecho ? 'Marcar como hecho' : 'Solo Alfredo puede marcar esto como hecho'}
            />
            <div className="notas-obra-item-cuerpo">
              <p className="notas-obra-item-texto">{n.mensaje}</p>
              <span className="notas-obra-item-meta">{n.autor_nombre} · {formatoFechaHora(n.creado_en)}</span>
            </div>
          </li>
        ))}
      </ul>

      {error && <div className="auth-error">{error}</div>}
      <form className="chat-obra-form" onSubmit={enviar}>
        <input
          type="text"
          className="input-filtro"
          placeholder="Agregar una nota…"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
        <button type="submit" className="btn-secundario" disabled={enviando || !mensaje.trim()}>
          Agregar
        </button>
      </form>
    </div>
  )
}
