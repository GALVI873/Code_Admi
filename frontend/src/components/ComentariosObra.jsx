import { useEffect, useState } from 'react'
import { comentariosObra, agregarComentarioObra } from '../api/client.js'

// Hilo de mensajes entre Álvaro y Geraldinne sobre una obra puntual —
// compartido por PresupuestosEnEstudioPage (vista de él) y SeguimientoPage
// (vista de ella), reemplaza el viejo campo "comentario_geraldinne" de un
// solo sentido. No es tiempo real: se carga al abrir el detalle de la obra.
//
// Se normaliza a nombre BASE (sin "— Opción A/B") para que ambas vistas
// lleguen siempre a la misma conversación sin importar qué opción tengan
// abierta — misma normalización que hace el backend en comentarios_obra.php.
function nombreBaseObra(obra) {
  return (obra || '').replace(/\s*—\s*Opci[oó]n\s+\w+\s*$/i, '').trim()
}

function formatoFechaHora(iso) {
  if (!iso) return ''
  // SQLite guarda "AAAA-MM-DD HH:MM:SS" en UTC.
  const [fecha, hora] = iso.split(' ')
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio} ${(hora || '').slice(0, 5)}`
}

// Se muestra como ventana flotante dentro de la ficha (ancla en
// modal-caja, que por eso tiene position:relative) en vez de quedar fija
// en el flujo normal — a pedido explícito: una conversación larga no debe
// empujar el resto de la ficha hacia abajo. onCerrar la abre/cierra el
// globo 💬 del header, acá adentro solo hace falta la X para cerrarla.
export default function ComentariosObra({ obra, accessToken, usuarioEmail, onCerrar }) {
  const obraBase = nombreBaseObra(obra)
  const [comentarios, setComentarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let activo = true
    setCargando(true)
    comentariosObra(accessToken, obraBase)
      .then((data) => {
        if (activo) setComentarios(data.comentarios || [])
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
  }, [obraBase, accessToken])

  async function enviar(e) {
    e.preventDefault()
    const texto = mensaje.trim()
    if (!texto || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarComentarioObra(accessToken, obraBase, texto)
      setComentarios((prev) => [...prev, data.comentario])
      setMensaje('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="chat-obra chat-obra-flotante" onClick={(e) => e.stopPropagation()}>
      <div className="chat-obra-encabezado">
        <span className="chat-obra-titulo">Conversación</span>
        <button type="button" className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar conversación">✕</button>
      </div>
      <div className="chat-obra-mensajes">
        {cargando && <p className="dashboard-nota">Cargando…</p>}
        {!cargando && comentarios.length === 0 && (
          <p className="dashboard-nota">Todavía no hay mensajes en esta obra.</p>
        )}
        {comentarios.map((c) => (
          <div
            key={c.id}
            className={`chat-obra-mensaje ${c.autor_email === usuarioEmail ? 'chat-obra-mensaje-propio' : ''}`}
          >
            <div className="chat-obra-mensaje-cabecera">
              <span className="chat-obra-mensaje-autor">{c.autor_nombre}</span>
              <span className="chat-obra-mensaje-fecha">{formatoFechaHora(c.creado_en)}</span>
            </div>
            <p className="chat-obra-mensaje-texto">{c.mensaje}</p>
          </div>
        ))}
      </div>
      {error && <div className="auth-error">{error}</div>}
      <form className="chat-obra-form" onSubmit={enviar}>
        <input
          type="text"
          className="input-filtro"
          placeholder="Escribir un mensaje…"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
        <button type="submit" className="btn-secundario" disabled={enviando || !mensaje.trim()}>
          Enviar
        </button>
      </form>
    </div>
  )
}
