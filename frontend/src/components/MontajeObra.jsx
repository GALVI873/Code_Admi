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
  planosObra,
} from '../api/client.js'

// Pestaña "Montaje" de una obra aceptada — a pedido de Álvaro, 2026-09-21:
// todo lo relacionado a la instalación en sí, separado de Planos/
// Seguimiento (que son sobre el pedido/fabricación) y de Bitácora/Notas
// (registro y pendientes generales). Tres sub-pestañas, mismo patrón visual
// que la barra principal (seguimiento-pestanas), un solo GET a
// montaje_obra.php trae todo y cada sub-pestaña opera sobre su parte:
//   - Detalle de obra: montador/ayudante (de una lista que crece sola,
//     no hay rol de usuario "montador"), rango de fechas estimado del
//     montaje, si la carpintería viene acristalada, y fecha estimada de
//     llegada por material (Vidrio/Carpintería/Precercos/Persianas/
//     Composite).
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

function formatoFecha(iso) {
  if (!iso) return ''
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onload = () => resolve(lector.result)
    lector.onerror = () => reject(new Error('No se pudo leer el archivo'))
    lector.readAsDataURL(archivo)
  })
}

// Espera a que TODAS las imágenes del resumen para el montador (planos,
// medición, fotos) terminen de decodificar antes de imprimir — un plano
// real puede pesar varios MB en base64, y que el <img> ya esté en el DOM
// no garantiza que el navegador ya lo haya pintado (ver comentario en el
// useEffect que la usa). img.decode() espera la decodificación real, no
// solo el evento "load" (que en un data: URI puede dispararse casi al
// toque, antes de que la imagen esté lista para imprimirse).
async function esperarImagenesResumen() {
  const contenedor = document.querySelector('.montaje-resumen-imprimir')
  if (!contenedor) return
  const imagenes = Array.from(contenedor.querySelectorAll('img'))
  await Promise.all(
    imagenes.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())),
  )
}

function SelectPersona({ valor, personas, rol, onCambio, placeholder }) {
  return (
    <select className="select-inline" value={valor || ''} onChange={(e) => onCambio(e.target.value)}>
      <option value="">{placeholder}</option>
      {personas.filter((p) => p.rol === rol).map((p) => (
        <option key={p.id} value={p.nombre}>{p.nombre}</option>
      ))}
    </select>
  )
}

// Una persona es SOLO montador o SOLO ayudante (a pedido de Álvaro,
// 2026-09-21) — dos listas separadas (columna "rol" en montaje_personas),
// cada una con su propio "agregar nombre nuevo" al lado de su desplegable.
function AgregarPersona({ rol, accessToken, onAgregada }) {
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const n = nombre.trim()
    if (!n || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarPersonaMontaje(accessToken, n, rol)
      onAgregada(data.personas)
      setNombre('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="montaje-detalle-agregar-persona" onSubmit={handleSubmit}>
      <input
        type="text"
        className="input-filtro"
        placeholder={rol === 'montador' ? 'Nuevo montador…' : 'Nuevo ayudante…'}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      <button type="submit" className="btn-secundario" disabled={enviando || !nombre.trim()}>+ Agregar</button>
      {error && <span className="auth-error">{error}</span>}
    </form>
  )
}

function DetalleDeObra({ obra, accessToken, detalle, materiales, personas, onCambiado }) {
  const [error, setError] = useState('')

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
        <div className="montaje-detalle-persona-bloque">
          <div className="filtro-campo">
            <label>Montador</label>
            <SelectPersona valor={detalle?.montador} personas={personas} rol="montador" placeholder="Sin asignar" onCambio={(v) => guardarDetalle({ montador: v })} />
          </div>
          <AgregarPersona rol="montador" accessToken={accessToken} onAgregada={(personas) => onCambiado({ personas })} />
        </div>
        <div className="montaje-detalle-persona-bloque">
          <div className="filtro-campo">
            <label>Ayudante</label>
            <SelectPersona valor={detalle?.ayudante} personas={personas} rol="ayudante" placeholder="Sin asignar" onCambio={(v) => guardarDetalle({ ayudante: v })} />
          </div>
          <AgregarPersona rol="ayudante" accessToken={accessToken} onAgregada={(personas) => onCambiado({ personas })} />
        </div>
        <div className="filtro-campo">
          <label>Inicio estimado</label>
          <input
            type="date"
            className="input-filtro input-fecha-limite"
            value={detalle?.fecha_inicio_estimada || ''}
            onChange={(e) => guardarDetalle({ fecha_inicio_estimada: e.target.value })}
          />
        </div>
        <div className="filtro-campo">
          <label>Fin estimado</label>
          <input
            type="date"
            className="input-filtro input-fecha-limite"
            value={detalle?.fecha_fin_estimada || ''}
            onChange={(e) => guardarDetalle({ fecha_fin_estimada: e.target.value })}
          />
        </div>
      </div>

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

// Documento embebido en el resumen para el montador: si es una imagen se
// muestra directo (se imprime bien); si es un PDF, el navegador no lo puede
// embeber de forma confiable dentro de otra página impresa, así que se deja
// como referencia con un enlace para abrirlo aparte — el archivo en sí ya
// está guardado y se manda a Drive igual (ver Documentación de montaje).
function DocumentoResumen({ documento }) {
  const esImagen = (documento.tipo_mime || '').startsWith('image/')
  const url = `data:${documento.tipo_mime || 'application/octet-stream'};base64,${documento.archivo_base64}`
  if (esImagen) {
    return <img src={url} alt={documento.nombre_original || 'Documento'} className="montaje-resumen-imagen" />
  }
  return (
    <p className="montaje-resumen-doc-referencia">
      📎 {documento.nombre_original || `Documento #${documento.id}`} — adjunto aparte (
      <a href={url} target="_blank" rel="noreferrer">abrir</a>)
    </p>
  )
}

// Resumen imprimible para mandarle al montador (a pedido de Álvaro,
// 2026-09-21) — SIEMPRE está en el DOM pero oculto en pantalla
// (.montaje-resumen-imprimir, ver global.css); el botón "Descargar para el
// montador" solo dispara window.print() (mismo mecanismo que "Descargar
// PDF" en Pendientes, ninguna librería de PDF nueva). El CSS de impresión
// esconde el resto de la pestaña Montaje (.montaje-pantalla) y muestra solo
// esto, en el orden pedido: Detalle de obra, Planos (las páginas ya
// cargadas en la pestaña Planos de esta obra — no hace falta volver a
// subirlas), Medición, Tareas pendientes y Fotos de obra.
function ResumenMontador({ obra, detalle, materiales, documentos, tareas, paginasPlanos, posicionesPlanos }) {
  const medicion = documentos.filter((d) => d.categoria === 'Medición')
  const fotos = documentos.filter((d) => d.categoria === 'Fotos')

  return (
    <div className="montaje-resumen-imprimir">
      <h1>{obra} — Montaje</h1>

      <h2>1. Detalle de obra</h2>
      <table className="montaje-resumen-tabla">
        <tbody>
          <tr><th>Montador</th><td>{detalle?.montador || 'Sin asignar'}</td></tr>
          <tr><th>Ayudante</th><td>{detalle?.ayudante || 'Sin asignar'}</td></tr>
          <tr><th>Inicio estimado</th><td>{formatoFecha(detalle?.fecha_inicio_estimada) || '—'}</td></tr>
          <tr><th>Fin estimado</th><td>{formatoFecha(detalle?.fecha_fin_estimada) || '—'}</td></tr>
          <tr><th>Carpintería acristalada</th><td>{detalle?.carpinteria_acristalada ? 'Sí' : 'No'}</td></tr>
        </tbody>
      </table>
      <table className="montaje-resumen-tabla">
        <thead><tr><th>Material</th><th>Fecha estimada de llegada</th></tr></thead>
        <tbody>
          {materiales.map((m) => (
            <tr key={m.material}><td>{m.material}</td><td>{formatoFecha(m.fecha_estimada) || '—'}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>2. Planos</h2>
      {paginasPlanos === null ? (
        <p className="dashboard-nota">Cargando planos…</p>
      ) : paginasPlanos.length === 0 ? (
        <p className="dashboard-nota">Esta obra todavía no tiene planos cargados.</p>
      ) : (
        // Una página por planta — se muestran TODAS, no solo la que
        // estuviera activa en la pestaña Planos (ahí solo se ve una a la
        // vez con pestañas "Página 1"/"Página 2"). Cada marca de posición
        // (x_pct/y_pct, calibradas en Planos) se dibuja encima de SU
        // página — a pedido de Álvaro, 2026-09-21: antes el resumen
        // mostraba el plano pelado, sin las posiciones asignadas.
        paginasPlanos.map((p) => (
          <div key={p.pagina} className="montaje-resumen-plano-contenedor">
            <img src={p.imagen_base64} alt={`Plano página ${p.pagina}`} className="montaje-resumen-imagen" />
            {posicionesPlanos.filter((pos) => pos.pagina === p.pagina).map((pos) => (
              <span
                key={pos.posicion_base}
                className="montaje-resumen-marca"
                style={{ left: `${pos.x_pct}%`, top: `${pos.y_pct}%` }}
              >
                {pos.posicion_base}
              </span>
            ))}
          </div>
        ))
      )}

      <h2>3. Medición</h2>
      {medicion.length === 0 ? (
        <p className="dashboard-nota">Sin documento de medición cargado.</p>
      ) : (
        medicion.map((d) => <DocumentoResumen key={d.id} documento={d} />)
      )}

      <h2>4. Tareas pendientes</h2>
      {tareas.length === 0 ? (
        <p className="dashboard-nota">Sin tareas pendientes.</p>
      ) : (
        <ul className="montaje-resumen-tareas">
          {tareas.map((t) => (
            <li key={t.id}>{t.hecho ? '☑' : '☐'} {t.texto}</li>
          ))}
        </ul>
      )}

      <h2>5. Fotos de obra</h2>
      {fotos.length === 0 ? (
        <p className="dashboard-nota">Sin fotos cargadas.</p>
      ) : (
        <div className="montaje-resumen-fotos">
          {fotos.map((d) => (
            <img
              key={d.id}
              src={`data:${d.tipo_mime || 'image/jpeg'};base64,${d.archivo_base64}`}
              alt={d.nombre_original || 'Foto de obra'}
              className="montaje-resumen-foto"
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function MontajeObra({ obra, accessToken }) {
  const [subpestana, setSubpestana] = useState('Detalle de obra')
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [paginasPlanos, setPaginasPlanos] = useState(null)
  const [posicionesPlanos, setPosicionesPlanos] = useState([])
  const [cargandoDescarga, setCargandoDescarga] = useState(false)
  const [quiereImprimir, setQuiereImprimir] = useState(false)

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

  // El botón "Descargar para el montador" carga los planos (si todavía no
  // se pidieron) y recién imprime cuando ya están en el DOM — window.print()
  // llamado antes de que React termine de pintar las imágenes las dejaría
  // afuera del PDF, por eso se espera al próximo render vía este efecto en
  // vez de llamarlo justo después de setPaginasPlanos. Pero que el <img> ya
  // esté en el DOM no alcanza: un plano real puede pesar varios MB en
  // base64 y todavía estar decodificando cuando el navegador dispara la
  // impresión — ahí sale la página del plano en blanco (solo se ven las
  // marcas de posición, que son position:absolute y no dependen de que la
  // imagen haya terminado de cargar). Por eso se espera explícitamente a
  // que cada <img> del resumen termine de cargar/decodificar antes de
  // llamar a window.print() (reportado 2026-09-21, obra "8 Viv. Jose
  // Abascal, 57").
  useEffect(() => {
    if (quiereImprimir && paginasPlanos !== null) {
      setQuiereImprimir(false)
      esperarImagenesResumen()
        .then(() => window.print())
        .finally(() => setCargandoDescarga(false))
    }
  }, [quiereImprimir, paginasPlanos])

  async function handleDescargarMontador() {
    setCargandoDescarga(true)
    setError('')
    if (paginasPlanos !== null) {
      // Ya se habían traído los planos en una descarga anterior — igual se
      // espera a que las imágenes estén decodificadas antes de imprimir de
      // nuevo (deberían estar en caché del navegador, pero no cuesta nada
      // asegurarse).
      esperarImagenesResumen()
        .then(() => window.print())
        .finally(() => setCargandoDescarga(false))
      return
    }
    try {
      const data = await planosObra(accessToken, obra)
      setPaginasPlanos(data.paginas || [])
      setPosicionesPlanos(data.posiciones || [])
      setQuiereImprimir(true)
    } catch (err) {
      setError(err.message)
      setCargandoDescarga(false)
    }
  }

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
      <ResumenMontador
        obra={obra}
        detalle={datos.detalle}
        materiales={datos.materiales}
        documentos={datos.documentos}
        tareas={datos.tareas}
        paginasPlanos={paginasPlanos}
        posicionesPlanos={posicionesPlanos}
      />

      <div className="montaje-pantalla">
      <div className="montaje-subpestanas-fila">
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
        <button type="button" className="btn-secundario" onClick={handleDescargarMontador} disabled={cargandoDescarga}>
          {cargandoDescarga ? 'Preparando…' : '🖨 Descargar para el montador'}
        </button>
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
    </div>
  )
}
