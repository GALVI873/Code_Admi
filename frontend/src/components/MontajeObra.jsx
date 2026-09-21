import { useEffect, useRef, useState } from 'react'
import {
  montajeObra,
  actualizarDetalleMontaje,
  actualizarMaterialMontaje,
  agregarPersonaMontaje,
  agregarTareaMontaje,
  marcarTareaMontaje,
  eliminarTareaMontaje,
  agregarDocumentoMontaje,
  eliminarDocumentoMontaje,
} from '../api/client.js'

// Pestaña "Montaje" de una obra aceptada — a pedido de Álvaro, 2026-09-21:
// todo lo relacionado a la instalación en sí, separado de Planos/
// Seguimiento (que son sobre el pedido/fabricación) y de Bitácora/Notas
// (registro y pendientes generales). Tres sub-pestañas, mismo patrón visual
// que la barra principal (seguimiento-pestanas), un solo GET a
// montaje_obra.php trae todo y cada sub-pestaña opera sobre su parte:
//   - Detalle de obra: montador/ayudante (de una lista que crece sola,
//     no hay rol de usuario "montador"), tiempo estimado, si la
//     carpintería viene acristalada, y fecha estimada de llegada por
//     material (Vidrio/Carpintería/Precercos/Persianas/Composite).
//   - Documentación de montaje: archivos por categoría (PDF/Planos/
//     Medición/Fotos) — el panel no sube a Drive al toque (igual que
//     Adicionales de Obra): el archivo queda en base64 y
//     backend/drive_sync/enviar_documentos_montaje.js lo manda en la
//     próxima sincronización.
//   - Tareas pendientes: checklist manual (tildable) + un documento de
//     referencia opcional (categoría "Tareas", mismo mecanismo de arriba)
//     — Álvaro pidió las dos cosas, no solo el PDF que cargaba antes.
const SUBPESTANAS = ['Detalle de obra', 'Documentación de montaje', 'Tareas pendientes']
const MATERIALES = ['Vidrio', 'Carpintería', 'Precercos', 'Persianas', 'Composite']
const CATEGORIAS_DOC = [
  { clave: 'PDF', titulo: 'PDF', accept: 'application/pdf' },
  { clave: 'Planos', titulo: 'Planos', accept: 'application/pdf,image/*' },
  { clave: 'Medición', titulo: 'Medición (de Álvaro)', accept: 'application/pdf,image/*' },
  { clave: 'Fotos', titulo: 'Fotos de obra', accept: 'image/*' },
]

function formatoFechaHora(iso) {
  if (!iso) return ''
  const fecha = new Date(iso.replace(' ', 'T') + 'Z')
  const dia = String(fecha.getDate()).padStart(2, '0')
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}/${fecha.getFullYear()}`
}

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onload = () => resolve(lector.result)
    lector.onerror = () => reject(new Error('No se pudo leer el archivo'))
    lector.readAsDataURL(archivo)
  })
}

function SelectPersona({ valor, personas, onCambio, placeholder }) {
  return (
    <select className="select-inline" value={valor || ''} onChange={(e) => onCambio(e.target.value)}>
      <option value="">{placeholder}</option>
      {personas.map((p) => (
        <option key={p.id} value={p.nombre}>{p.nombre}</option>
      ))}
    </select>
  )
}

function DetalleDeObra({ obra, accessToken, detalle, materiales, personas, onCambiado }) {
  const [tiempoEstimado, setTiempoEstimado] = useState(detalle?.tiempo_estimado || '')
  const [nuevaPersona, setNuevaPersona] = useState('')
  const [agregandoPersona, setAgregandoPersona] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setTiempoEstimado(detalle?.tiempo_estimado || '')
  }, [detalle?.tiempo_estimado])

  // Cada handler manda solo lo que cambió (nunca el "detalle"/"materiales"
  // completo capturado en este render) — así dos ediciones seguidas (ej.
  // elegir montador y al toque ayudante) no se pisan entre sí con un valor
  // viejo mientras la primera todavía no terminó de guardar. El merge real
  // pasa en MontajeObra vía setDatos(prev => ...), siempre sobre el estado
  // más reciente, no sobre lo que este componente tenía en sus props al
  // momento del click.
  async function guardarDetalle(campos) {
    setError('')
    try {
      await actualizarDetalleMontaje(accessToken, obra, campos)
      onCambiado({ campos })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAgregarPersona(e) {
    e.preventDefault()
    const nombre = nuevaPersona.trim()
    if (!nombre || agregandoPersona) return
    setAgregandoPersona(true)
    setError('')
    try {
      const data = await agregarPersonaMontaje(accessToken, nombre)
      onCambiado({ personas: data.personas })
      setNuevaPersona('')
    } catch (err) {
      setError(err.message)
    } finally {
      setAgregandoPersona(false)
    }
  }

  async function handleCambiarMaterial(material, fechaEstimada) {
    setError('')
    try {
      await actualizarMaterialMontaje(accessToken, obra, material, fechaEstimada)
      onCambiado({ material: { material, fecha_estimada: fechaEstimada || null } })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="montaje-detalle">
      <div className="montaje-detalle-fila">
        <div className="filtro-campo">
          <label>Montador</label>
          <SelectPersona valor={detalle?.montador} personas={personas} placeholder="Sin asignar" onCambio={(v) => guardarDetalle({ montador: v })} />
        </div>
        <div className="filtro-campo">
          <label>Ayudante</label>
          <SelectPersona valor={detalle?.ayudante} personas={personas} placeholder="Sin asignar" onCambio={(v) => guardarDetalle({ ayudante: v })} />
        </div>
        <div className="filtro-campo montaje-detalle-campo-tiempo">
          <label>Tiempo estimado de montaje</label>
          <input
            type="text"
            className="input-filtro"
            placeholder="Ej: 3 días"
            value={tiempoEstimado}
            onChange={(e) => setTiempoEstimado(e.target.value)}
            onBlur={() => {
              if (tiempoEstimado !== (detalle?.tiempo_estimado || '')) guardarDetalle({ tiempo_estimado: tiempoEstimado })
            }}
          />
        </div>
      </div>

      <form className="montaje-detalle-agregar-persona" onSubmit={handleAgregarPersona}>
        <input
          type="text"
          className="input-filtro"
          placeholder="Agregar un nombre nuevo a la lista…"
          value={nuevaPersona}
          onChange={(e) => setNuevaPersona(e.target.value)}
        />
        <button type="submit" className="btn-secundario" disabled={agregandoPersona || !nuevaPersona.trim()}>
          + Agregar a la lista
        </button>
      </form>

      <label className="montaje-detalle-acristalada">
        <input
          type="checkbox"
          checked={!!detalle?.carpinteria_acristalada}
          onChange={(e) => guardarDetalle({ carpinteria_acristalada: e.target.checked })}
        />
        La carpintería viene acristalada de fábrica
      </label>

      <h3 className="montaje-subtitulo">Fecha estimada de llegada por material</h3>
      <table className="tabla-adicionales montaje-tabla-materiales">
        <thead>
          <tr>
            <th>Material</th>
            <th>Fecha estimada</th>
          </tr>
        </thead>
        <tbody>
          {MATERIALES.map((mat) => {
            const fila = materiales.find((m) => m.material === mat)
            return (
              <tr key={mat}>
                <td>{mat}</td>
                <td>
                  <input
                    type="date"
                    className="input-filtro input-fecha-limite"
                    value={fila?.fecha_estimada || ''}
                    onChange={(e) => handleCambiarMaterial(mat, e.target.value)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {error && <div className="auth-error">{error}</div>}
    </div>
  )
}

function ListaDocumentos({ documentos, onEliminar }) {
  if (documentos.length === 0) {
    return <p className="dashboard-nota montaje-doc-vacio">Sin archivos todavía.</p>
  }
  return (
    <ul className="montaje-doc-lista">
      {documentos.map((d) => {
        const url = `data:${d.tipo_mime || 'application/octet-stream'};base64,${d.archivo_base64}`
        return (
          <li key={d.id} className="montaje-doc-item">
            <a href={url} target="_blank" rel="noreferrer" className="montaje-doc-nombre">
              {d.nombre_original || `Documento #${d.id}`}
            </a>
            <span className="montaje-doc-meta">
              {d.subido_por} · {formatoFechaHora(d.subido_en)} · {d.enviado_en ? 'Enviado a Drive' : 'Pendiente de enviar'}
            </span>
            <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar" onClick={() => onEliminar(d.id)}>−</button>
          </li>
        )
      })}
    </ul>
  )
}

function SeccionDocumentos({ categoria, titulo, accept, documentos, accessToken, obra, onSubido, onEliminar }) {
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')

  async function handleElegirArchivo(e) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setSubiendo(true)
    setError('')
    try {
      const base64 = await leerArchivoComoBase64(archivo)
      const data = await agregarDocumentoMontaje(accessToken, obra, categoria, base64, archivo.name, archivo.type)
      onSubido(data.documento)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="montaje-doc-seccion">
      <div className="montaje-doc-seccion-encabezado">
        <h3 className="montaje-subtitulo">{titulo}</h3>
        <button type="button" className="btn-secundario" onClick={() => inputRef.current?.click()} disabled={subiendo}>
          {subiendo ? 'Subiendo…' : `Subir`}
        </button>
        <input ref={inputRef} type="file" accept={accept} hidden onChange={handleElegirArchivo} />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <ListaDocumentos documentos={documentos} onEliminar={onEliminar} />
    </div>
  )
}

function DocumentacionDeMontaje({ obra, accessToken, documentos, onCambiarDocumentos }) {
  function handleSubido(nuevo) {
    onCambiarDocumentos([nuevo, ...documentos])
  }

  async function handleEliminar(id) {
    if (!window.confirm('¿Eliminar este archivo? No se puede deshacer.')) return
    const anteriores = documentos
    onCambiarDocumentos(documentos.filter((d) => d.id !== id))
    try {
      await eliminarDocumentoMontaje(accessToken, id)
    } catch (err) {
      onCambiarDocumentos(anteriores)
    }
  }

  return (
    <div className="montaje-documentacion">
      {CATEGORIAS_DOC.map(({ clave, titulo, accept }) => (
        <SeccionDocumentos
          key={clave}
          categoria={clave}
          titulo={titulo}
          accept={accept}
          documentos={documentos.filter((d) => d.categoria === clave)}
          accessToken={accessToken}
          obra={obra}
          onSubido={handleSubido}
          onEliminar={handleEliminar}
        />
      ))}
    </div>
  )
}

function TareaItem({ tarea, onMarcar, onEliminar }) {
  return (
    <li className={`notas-obra-item ${tarea.hecho ? 'notas-obra-item-hecho' : ''}`}>
      <input
        type="checkbox"
        className="notas-obra-checkbox"
        checked={!!tarea.hecho}
        onChange={() => onMarcar(tarea)}
      />
      <div className="notas-obra-item-cuerpo">
        <p className="notas-obra-item-texto">{tarea.texto}</p>
        <span className="notas-obra-item-meta">{tarea.creado_por} · {formatoFechaHora(tarea.creado_en)}</span>
      </div>
      <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar tarea" onClick={() => onEliminar(tarea.id)}>−</button>
    </li>
  )
}

function TareasPendientes({ obra, accessToken, tareas, onCambiarTareas, documentos, onCambiarDocumentos }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function handleAgregar(e) {
    e.preventDefault()
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarTareaMontaje(accessToken, obra, t)
      onCambiarTareas([...tareas, data.tarea])
      setTexto('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  async function handleMarcar(tarea) {
    const nuevoHecho = tarea.hecho ? 0 : 1
    const anteriores = tareas
    onCambiarTareas(tareas.map((t) => (t.id === tarea.id ? { ...t, hecho: nuevoHecho } : t)))
    try {
      await marcarTareaMontaje(accessToken, tarea.id, nuevoHecho)
    } catch (err) {
      onCambiarTareas(anteriores)
      setError(err.message)
    }
  }

  async function handleEliminar(id) {
    const anteriores = tareas
    onCambiarTareas(tareas.filter((t) => t.id !== id))
    try {
      await eliminarTareaMontaje(accessToken, id)
    } catch (err) {
      onCambiarTareas(anteriores)
      setError(err.message)
    }
  }

  function handleSubidoDoc(nuevo) {
    onCambiarDocumentos([nuevo, ...documentos])
  }

  async function handleEliminarDoc(id) {
    if (!window.confirm('¿Eliminar este archivo? No se puede deshacer.')) return
    const anteriores = documentos
    onCambiarDocumentos(documentos.filter((d) => d.id !== id))
    try {
      await eliminarDocumentoMontaje(accessToken, id)
    } catch (err) {
      onCambiarDocumentos(anteriores)
    }
  }

  return (
    <div className="montaje-tareas">
      <form className="montaje-tareas-form" onSubmit={handleAgregar}>
        <input
          type="text"
          className="input-filtro"
          placeholder="Nueva tarea pendiente de montaje…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="btn-secundario" disabled={enviando || !texto.trim()}>Agregar</button>
      </form>

      {error && <div className="auth-error">{error}</div>}
      {tareas.length === 0 ? (
        <p className="dashboard-nota">Sin tareas pendientes de montaje.</p>
      ) : (
        <ul className="notas-obra-lista">
          {tareas.map((t) => (
            <TareaItem key={t.id} tarea={t} onMarcar={handleMarcar} onEliminar={handleEliminar} />
          ))}
        </ul>
      )}

      <SeccionDocumentos
        categoria="Tareas"
        titulo="Documento de referencia (opcional)"
        accept="application/pdf,image/*"
        documentos={documentos.filter((d) => d.categoria === 'Tareas')}
        accessToken={accessToken}
        obra={obra}
        onSubido={handleSubidoDoc}
        onEliminar={handleEliminarDoc}
      />
    </div>
  )
}

export default function MontajeObra({ obra, accessToken }) {
  const [subpestana, setSubpestana] = useState('Detalle de obra')
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true
    setCargando(true)
    montajeObra(accessToken, obra)
      .then((data) => {
        if (activo) setDatos(data)
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

  // Siempre mergea contra el estado MÁS RECIENTE (prev), nunca contra lo
  // que DetalleDeObra tenía en sus props al momento del click — ver
  // comentario en guardarDetalle/handleCambiarMaterial de más arriba.
  function handleCambiarDetalle({ campos, personas, material }) {
    setDatos((prev) => ({
      ...prev,
      detalle: campos ? { ...prev.detalle, ...campos } : prev.detalle,
      personas: personas ?? prev.personas,
      materiales: material
        ? prev.materiales.map((m) => (m.material === material.material ? { ...m, fecha_estimada: material.fecha_estimada } : m))
        : prev.materiales,
    }))
  }

  if (cargando) return <p className="dashboard-nota">Cargando…</p>
  if (error) return <div className="auth-error">{error}</div>
  if (!datos) return null

  return (
    <div className="montaje-obra">
      <div className="seguimiento-pestanas montaje-subpestanas">
        {SUBPESTANAS.map((p) => (
          <button
            key={p}
            type="button"
            className={`seguimiento-pestana ${p === subpestana ? 'seguimiento-pestana-activa' : ''}`}
            onClick={() => setSubpestana(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {subpestana === 'Detalle de obra' && (
        <DetalleDeObra
          obra={obra}
          accessToken={accessToken}
          detalle={datos.detalle}
          materiales={datos.materiales}
          personas={datos.personas}
          onCambiado={handleCambiarDetalle}
        />
      )}
      {subpestana === 'Documentación de montaje' && (
        <DocumentacionDeMontaje
          obra={obra}
          accessToken={accessToken}
          documentos={datos.documentos}
          onCambiarDocumentos={(documentos) => setDatos((prev) => ({ ...prev, documentos }))}
        />
      )}
      {subpestana === 'Tareas pendientes' && (
        <TareasPendientes
          obra={obra}
          accessToken={accessToken}
          tareas={datos.tareas}
          onCambiarTareas={(tareas) => setDatos((prev) => ({ ...prev, tareas }))}
          documentos={datos.documentos}
          onCambiarDocumentos={(documentos) => setDatos((prev) => ({ ...prev, documentos }))}
        />
      )}
    </div>
  )
}
