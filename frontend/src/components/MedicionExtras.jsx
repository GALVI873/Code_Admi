import { useRef, useState } from 'react'

// Piezas de la medición en el plano (a pedido de Álvaro, 2026-10-02):
// galería de fotos (para notas y para posiciones) y la ventana de una nota.
// Ver public/api/medicion_obra.php.

// Reduce una imagen en el navegador antes de subirla: ~1600 px para el
// informe y ~320 px de miniatura, ambas JPEG — así una foto de la cámara de
// la tablet (varios MB) sube rápido y no llena la base.
function cargarImagen(archivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo)
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}

function aJpeg(img, ladoMax, calidad) {
  const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(img.naturalWidth * escala)
  lienzo.height = Math.round(img.naturalHeight * escala)
  const ctx = lienzo.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, lienzo.width, lienzo.height)
  ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height)
  return lienzo.toDataURL('image/jpeg', calidad)
}

export async function reducirImagen(archivo) {
  const { img, url } = await cargarImagen(archivo)
  try {
    return { archivo: aJpeg(img, 1600, 0.82), miniatura: aJpeg(img, 320, 0.7), nombre: archivo.name }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Galería de fotos con botón para subir (cámara o archivos, varias a la
// vez) y borrar. onSubir(archivo) sube una; onVer(foto) abre la grande.
export function GaleriaFotos({ fotos, puedeEditar, onSubir, onEliminar, onVer }) {
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(0)
  const [error, setError] = useState('')

  async function handleArchivos(e) {
    const archivos = [...(e.target.files || [])]
    e.target.value = ''
    if (archivos.length === 0) return
    setError('')
    setSubiendo(archivos.length)
    for (const a of archivos) {
      try {
        await onSubir(a)
      } catch (err) {
        setError(err.message)
      }
      setSubiendo((n) => n - 1)
    }
  }

  return (
    <div className="medicion-fotos">
      <div className="medicion-fotos-encabezado">
        <span className="medicion-fotos-titulo">Fotos ({fotos.length})</span>
        {puedeEditar && (
          <>
            <button type="button" className="btn-secundario" disabled={subiendo > 0} onClick={() => inputRef.current?.click()}>
              {subiendo > 0 ? `Subiendo… (${subiendo})` : '📷 Añadir fotos'}
            </button>
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleArchivos} />
          </>
        )}
      </div>
      {error && <div className="auth-error">{error}</div>}
      {fotos.length === 0 ? (
        <p className="dashboard-nota medicion-fotos-vacio">Sin fotos todavía.</p>
      ) : (
        <div className="medicion-fotos-grilla">
          {fotos.map((f) => (
            <div key={f.id} className="medicion-foto">
              <button type="button" className="medicion-foto-boton" onClick={() => onVer(f)} title={f.nombre || 'Ver foto'}>
                <img src={f.miniatura_base64 || f.archivo_base64} alt={f.nombre || 'Foto de obra'} />
              </button>
              {puedeEditar && (
                <button type="button" className="medicion-foto-quitar" title="Quitar foto"
                  onClick={() => { if (window.confirm('¿Quitar esta foto?')) onEliminar(f.id) }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Visor de una foto a pantalla completa (la grande se pide al abrir).
export function VisorFoto({ src, cargando, onCerrar }) {
  return (
    <div className="medicion-visor" onClick={onCerrar}>
      {cargando ? <p className="medicion-visor-cargando">Cargando foto…</p> : <img src={src} alt="Foto de obra" onClick={(e) => e.stopPropagation()} />}
      <button type="button" className="medicion-visor-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
    </div>
  )
}

// Ventana de una nota del plano: texto, fotos, mover y borrar.
export function VentanaNota({ nota, fotos, puedeEditar, onGuardarTexto, onEliminar, onMover, onSubirFoto, onEliminarFoto, onVerFoto, onCerrar }) {
  const [texto, setTexto] = useState(nota.texto || '')
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja medicion-nota-caja" onClick={(e) => e.stopPropagation()}>
        <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        <div className="modal-header">
          <h2><span className="medicion-nota-numero">N{nota.numero}</span> Nota de obra</h2>
        </div>
        <label className="medicion-nota-etiqueta" htmlFor={`nota-${nota.id}`}>Anotación</label>
        <textarea
          id={`nota-${nota.id}`}
          className="input-filtro medicion-comentario-textarea"
          rows={4}
          placeholder="Ej. Pilar que reduce el hueco, falta precerco, persiana existente a retirar…"
          value={texto}
          disabled={!puedeEditar}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => { if (texto.trim() !== (nota.texto || '')) onGuardarTexto(texto.trim()) }}
        />
        <GaleriaFotos fotos={fotos} puedeEditar={puedeEditar} onSubir={onSubirFoto} onEliminar={onEliminarFoto} onVer={onVerFoto} />
        {nota.creado_por && <p className="medicion-confirmado-por">Creada por {nota.creado_por}</p>}
        {puedeEditar && (
          <div className="medicion-nota-acciones">
            <button type="button" className="btn-secundario" onClick={onMover}>Mover en el plano</button>
            <button type="button" className="btn-secundario plan-boton-peligro"
              onClick={() => { if (window.confirm(`¿Borrar la nota N${nota.numero} y sus fotos?`)) onEliminar() }}>Borrar nota</button>
          </div>
        )}
      </div>
    </div>
  )
}
