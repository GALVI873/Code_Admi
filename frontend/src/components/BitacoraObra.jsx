import { useEffect, useState } from 'react'
import { bitacoraObra, agregarBitacoraObra, eliminarBitacoraObra } from '../api/client.js'

// Bitácora de obra — a pedido de Álvaro: diario cronológico de lo que hace
// en una obra aceptada (visitas, llamadas, decisiones...), con fecha propia
// (puede registrar algo de un día anterior, no siempre es "hoy"). Solo
// Álvaro (admin) escribe — es su registro personal — pero cualquiera con
// acceso a la obra puede leerlo completo. Al agregar una entrada puede
// marcar "Enviar también como nota a Alfredo": eso además crea el mismo
// texto en "Notas" (comentarios_obra) sin tener que escribirlo dos veces —
// ver bitacora_obra.php.
function formatoFecha(fecha) {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

function hoyISO() {
  const hoy = new Date()
  const y = hoy.getFullYear()
  const m = String(hoy.getMonth() + 1).padStart(2, '0')
  const d = String(hoy.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function BitacoraObra({ obra, accessToken, usuario }) {
  const puedeEscribir = usuario?.roles?.includes('admin')

  const [entradas, setEntradas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [texto, setTexto] = useState('')
  const [enviarComoNota, setEnviarComoNota] = useState(false)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let activo = true
    setCargando(true)
    bitacoraObra(accessToken, obra)
      .then((data) => {
        if (activo) setEntradas(data.entradas || [])
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
  }, [obra, accessToken])

  async function enviar(e) {
    e.preventDefault()
    if (!texto.trim() || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarBitacoraObra(accessToken, obra, fecha, texto.trim(), enviarComoNota)
      setEntradas((prev) => [data.entrada, ...prev])
      setTexto('')
      setEnviarComoNota(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  async function handleEliminar(id) {
    if (!window.confirm('¿Borrar esta entrada de la bitácora? No se puede deshacer.')) return
    const anteriores = entradas
    setEntradas((prev) => prev.filter((en) => en.id !== id))
    try {
      await eliminarBitacoraObra(accessToken, id)
    } catch (err) {
      setEntradas(anteriores)
      setError(err.message)
    }
  }

  return (
    <div className="bitacora-obra">
      {puedeEscribir && (
        <form className="bitacora-obra-form" onSubmit={enviar}>
          <div className="bitacora-obra-form-fila">
            <input
              type="date"
              className="input-filtro bitacora-obra-fecha"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
            <label className="bitacora-obra-nota-check">
              <input
                type="checkbox"
                checked={enviarComoNota}
                onChange={(e) => setEnviarComoNota(e.target.checked)}
              />
              📌 Enviar también como nota a Alfredo
            </label>
          </div>
          <textarea
            className="input-filtro bitacora-obra-textarea"
            placeholder="¿Qué hiciste en esta obra?"
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <button type="submit" className="btn-secundario" disabled={enviando || !texto.trim()}>
            Agregar
          </button>
        </form>
      )}

      {error && <div className="auth-error">{error}</div>}
      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {!cargando && entradas.length === 0 && (
        <p className="dashboard-nota">Todavía no hay entradas en la bitácora de esta obra.</p>
      )}

      <ul className="bitacora-obra-lista">
        {entradas.map((en) => (
          <li key={en.id} className="bitacora-obra-item">
            <div className="bitacora-obra-item-encabezado">
              <span className="bitacora-obra-item-fecha">{formatoFecha(en.fecha)}</span>
              {!!en.enviado_como_nota && <span className="bitacora-obra-item-badge">📌 Enviada como nota</span>}
              {puedeEscribir && (
                <button
                  type="button"
                  className="bitacora-obra-item-borrar"
                  onClick={() => handleEliminar(en.id)}
                  title="Borrar entrada"
                >
                  🗑
                </button>
              )}
            </div>
            <p className="bitacora-obra-item-texto">{en.texto}</p>
            <span className="bitacora-obra-item-autor">{en.autor_nombre}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
