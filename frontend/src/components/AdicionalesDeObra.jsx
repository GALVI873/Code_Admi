import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import {
  adicionalesObra,
  agregarAdicionalObra,
  cambiarEstatusAdicionalObra,
  cambiarPrioridadAdicionalObra,
  eliminarAdicionalObra,
  subirPdfAdicionalObra,
} from '../api/client.js'

const ESTATUS_ADICIONAL_OPCIONES = ['En Valoración', 'Enviado', 'Modificando', 'Alvarada', 'Aceptado']
// Mismas clases que ya usa el select de Estatus en Orden del día/General —
// no hace falta CSS nuevo para "Alvarada"/"Aceptado" (reutilizan
// select-estatus-alvarada/select-estatus-aceptado).
const CLASE_ESTATUS_ADICIONAL = {
  'En Valoración': 'select-estatus-en-valoracion',
  Enviado: 'select-estatus-enviado',
  Modificando: 'select-estatus-modificando',
  Alvarada: 'select-estatus-alvarada',
  Aceptado: 'select-estatus-aceptado',
}
const CLASE_BADGE_ESTATUS_ADICIONAL = {
  'En Valoración': 'en-valoracion',
  Enviado: 'enviado',
  Modificando: 'modificando',
  Alvarada: 'alvarada',
  Aceptado: 'aceptado',
}
const CLASE_PRIORIDAD_ADICIONAL = {
  Alta: 'select-prioridad-alta',
  Normal: 'select-prioridad-normal',
}

// Marcar prioridad Alta es exclusivo de Álvaro/Valentina (permiso
// presupuestos.gestionar_prioridad, mismo control que en Presupuesto) — un
// adicional Alta aparece en el bloque de arriba de "Orden del día", junto
// con las obras prioritarias de siempre.
function SelectPrioridadAdicional({ adicional, onCambio, puedeCambiar }) {
  if (!puedeCambiar) {
    if (adicional.prioridad !== 'Alta') return null
    return <span className="badge badge-rechazado">Alta</span>
  }
  return (
    <select
      className={`select-inline select-prioridad ${CLASE_PRIORIDAD_ADICIONAL[adicional.prioridad] || ''}`}
      value={adicional.prioridad}
      onChange={(e) => onCambio(adicional.id, e.target.value)}
    >
      <option value="Normal">Normal</option>
      <option value="Alta">Alta</option>
    </select>
  )
}

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Un adicional arranca siempre "En Valoración" (recién cargado, todavía sin
// mandar) — el flujo típico es En Valoración → Enviado → Modificando (si el
// cliente pide cambios sobre lo ya enviado) → Alvarada → Aceptado, aunque el
// select no obliga ese orden. Cambiar el estatus es trabajo operativo de
// Geraldinne (requiere presupuestos.ver_seguimiento) — puede ponerlo en
// cualquiera de los cinco.
//
// "Alvarada" (a pedido de Álvaro, 2026-09-21) es la excepción: Álvaro/
// Valentina (permiso presupuestos.gestionar_prioridad, sin ver_seguimiento)
// puede marcarla él mismo con un botón puntual — significa que a él el
// cliente ya se lo aceptó (de palabra), pero el trámite formal (mandar el
// correo de aceptación y cargar el PDF, ver PdfAdicional) lo sigue llevando
// Geraldinne. No tiene acceso al resto de los estatus. Si se equivocó (o el
// cliente se volvió atrás), puede "Deshacer" mientras siga en "Alvarada" —
// vuelve al estatus que tenía justo antes de marcarla (estatus_antes_de_
// alvarada, ver adicionales_obra.php); en cuanto Geraldinne avanza el
// trámite, esa posibilidad se pierde (ya no aparece el botón).
function SelectEstatusAdicional({ adicional, onCambio, puedeCambiar, puedeMarcarAlvarada, onMarcarAlvarada, onDeshacerAlvarada }) {
  if (puedeCambiar) {
    return (
      <select
        className={`select-inline select-estatus ${CLASE_ESTATUS_ADICIONAL[adicional.estatus] || ''}`}
        value={adicional.estatus}
        onChange={(e) => onCambio(adicional.id, e.target.value)}
      >
        {ESTATUS_ADICIONAL_OPCIONES.map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
    )
  }

  const clase = CLASE_BADGE_ESTATUS_ADICIONAL[adicional.estatus] || 'en-valoracion'
  const badge = <span className={`badge-estatus-adicional badge-estatus-adicional-${clase}`}>{adicional.estatus}</span>
  const puedeMarcarAhora = puedeMarcarAlvarada && adicional.estatus !== 'Alvarada' && adicional.estatus !== 'Aceptado'
  const puedeDeshacerAhora = puedeMarcarAlvarada && adicional.estatus === 'Alvarada' && !!adicional.estatus_antes_de_alvarada
  if (!puedeMarcarAhora && !puedeDeshacerAhora) return badge

  return (
    <span className="adicionales-obra-estatus-con-alvarada">
      {badge}
      {puedeMarcarAhora && (
        <button
          type="button"
          className="adicionales-obra-pdf-boton"
          onClick={() => onMarcarAlvarada(adicional.id)}
          title="A vos el cliente ya te lo aceptó — Geraldinne se encarga del correo y del PDF"
        >
          Marcar Alvarada
        </button>
      )}
      {puedeDeshacerAhora && (
        <button
          type="button"
          className="adicionales-obra-pdf-boton"
          onClick={() => onDeshacerAlvarada(adicional.id, adicional.estatus_antes_de_alvarada)}
          title={`Volver a "${adicional.estatus_antes_de_alvarada}" — deshace la marca de Alvarada`}
        >
          Deshacer
        </button>
      )}
    </span>
  )
}

// PDF del adicional ya aceptado por el cliente — a pedido de Álvaro
// (2026-09-21): en cuanto un adicional pasa a "Aceptado", hace falta que
// Geraldinne suba el PDF firmado para dejarlo guardado con la obra. No se
// exige subirlo al mismo momento de cambiar el estatus (puede quedar
// pendiente un rato) — ver adicionales_obra.php y
// enviar_adicionales_aceptados.js (el panel no sube a Drive al toque, el
// PDF viaja como base64 y un script aparte lo manda en la próxima
// sincronización).
//
// "Reemplazar" (a pedido de Álvaro, 2026-09-24): por si se cargó el PDF
// equivocado — el PATCH de adicionales_obra.php ya soportaba pisar el
// archivo (vuelve a marcarlo pendiente de enviar aunque ya se hubiera
// mandado uno antes), pero acá no había forma de disparlo una vez que
// "tiene_pdf" quedaba en true. enviar_adicionales_aceptados.js de paso
// borra (a la papelera, no en forma permanente) cualquier PDF viejo con
// el mismo nombre en Drive antes de subir el nuevo, para que no queden
// los dos archivos juntos si el reemplazo pasa después de que ya se
// había sincronizado el primero.
function PdfAdicional({ adicional, puedeSubir, onSubir }) {
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')

  if (adicional.estatus !== 'Aceptado') return null

  async function handleElegirArchivo(e) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    if (archivo.type !== 'application/pdf') {
      setError('Tiene que ser un PDF')
      return
    }
    setSubiendo(true)
    setError('')
    try {
      const base64 = await new Promise((resolve, reject) => {
        const lector = new FileReader()
        lector.onload = () => resolve(lector.result)
        lector.onerror = () => reject(new Error('No se pudo leer el archivo'))
        lector.readAsDataURL(archivo)
      })
      await onSubir(adicional.id, base64, archivo.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo(false)
    }
  }

  if (adicional.tiene_pdf) {
    if (!puedeSubir) {
      return <span className="adicionales-obra-pdf-subido" title={adicional.pdf_nombre_original || undefined}>✓ PDF cargado</span>
    }
    return (
      <div className="adicionales-obra-pdf-subido-con-reemplazo">
        <span className="adicionales-obra-pdf-subido" title={adicional.pdf_nombre_original || undefined}>✓ PDF cargado</span>
        <button
          type="button"
          className="adicionales-obra-pdf-boton"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          title="Por si se cargó el PDF equivocado"
        >
          {subiendo ? 'Subiendo…' : 'Reemplazar'}
        </button>
        <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={handleElegirArchivo} />
        {error && <span className="auth-error">{error}</span>}
      </div>
    )
  }

  if (!puedeSubir) {
    return <span className="adicionales-obra-pdf-falta">Falta subir el PDF</span>
  }

  return (
    <div className="adicionales-obra-pdf-falta">
      Falta el PDF
      <button
        type="button"
        className="adicionales-obra-pdf-boton"
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
      >
        {subiendo ? 'Subiendo…' : 'Subir PDF'}
      </button>
      <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={handleElegirArchivo} />
      {error && <span className="auth-error">{error}</span>}
    </div>
  )
}

// Adicionales de obra: trabajo extra que un cliente pide sobre una obra ya
// aceptada — Geraldinne (o Álvaro) lo carga a mano acá, no viene de ninguna
// sincronización. "Nombre" es un desplegable de las obras aceptadas
// (obras_disponibles, ver adicionales_obra.php); en cuanto se elige una,
// "Cliente" se completa solo (siempre el mismo que tiene esa obra aceptada,
// no se puede escribir a mano) — el resto son campos de texto libre.
export default function AdicionalesDeObra() {
  const { accessToken, tienePermiso } = useAuth()
  const puedeCambiarEstatus = tienePermiso('presupuestos.ver_seguimiento')
  const puedeCambiarPrioridad = tienePermiso('presupuestos.gestionar_prioridad')
  // Mismo permiso que la prioridad (exclusivo de Álvaro/Valentina) — ver
  // comentario de SelectEstatusAdicional.
  const puedeMarcarAlvarada = puedeCambiarPrioridad
  const [adicionales, setAdicionales] = useState([])
  const [obrasDisponibles, setObrasDisponibles] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [obra, setObra] = useState('')
  const [fechaSolicitud, setFechaSolicitud] = useState('')
  const [detalle, setDetalle] = useState('')
  const [solicitadoPor, setSolicitadoPor] = useState('')

  useEffect(() => {
    adicionalesObra(accessToken)
      .then((data) => {
        setAdicionales(data.adicionales || [])
        setObrasDisponibles(data.obras_disponibles || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const clienteDeObraSeleccionada = useMemo(
    () => obrasDisponibles.find((o) => o.obra === obra)?.cliente || '',
    [obrasDisponibles, obra],
  )

  async function enviar(e) {
    e.preventDefault()
    if (!obra || !detalle.trim() || guardando) return
    setGuardando(true)
    setError('')
    try {
      const { adicional } = await agregarAdicionalObra(accessToken, {
        obra,
        fecha_solicitud: fechaSolicitud,
        detalle: detalle.trim(),
        solicitado_por: solicitadoPor.trim(),
      })
      setAdicionales((prev) => [adicional, ...prev])
      setObra('')
      setFechaSolicitud('')
      setDetalle('')
      setSolicitadoPor('')
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  async function handleCambiarEstatus(id, estatus) {
    if (!puedeCambiarEstatus && !(puedeMarcarAlvarada && estatus === 'Alvarada')) return
    const anteriores = adicionales
    setAdicionales((prev) => prev.map((a) => {
      if (a.id !== id) return a
      // Mismo criterio que el backend: al ENTRAR a "Alvarada" guarda el
      // estatus anterior (para poder deshacerla); cualquier otro cambio lo
      // limpia.
      const estatusAntesDeAlvarada = estatus === 'Alvarada' && a.estatus !== 'Alvarada' ? a.estatus : null
      return { ...a, estatus, estatus_antes_de_alvarada: estatusAntesDeAlvarada }
    }))
    try {
      await cambiarEstatusAdicionalObra(accessToken, id, estatus)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  async function handleDeshacerAlvarada(id, estatusPrevio) {
    if (!puedeMarcarAlvarada || !estatusPrevio) return
    const anteriores = adicionales
    setAdicionales((prev) => prev.map((a) => (a.id === id ? { ...a, estatus: estatusPrevio, estatus_antes_de_alvarada: null } : a)))
    try {
      await cambiarEstatusAdicionalObra(accessToken, id, estatusPrevio)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  async function handleCambiarPrioridad(id, prioridad) {
    if (!puedeCambiarPrioridad) return
    const anteriores = adicionales
    setAdicionales((prev) => prev.map((a) => (a.id === id ? { ...a, prioridad } : a)))
    try {
      await cambiarPrioridadAdicionalObra(accessToken, id, prioridad)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  async function handleSubirPdf(id, pdfBase64, nombreArchivo) {
    const anteriores = adicionales
    setAdicionales((prev) => prev.map((a) => (a.id === id ? { ...a, tiene_pdf: true, pdf_nombre_original: nombreArchivo } : a)))
    try {
      await subirPdfAdicionalObra(accessToken, id, pdfBase64, nombreArchivo)
    } catch (err) {
      setAdicionales(anteriores)
      throw err
    }
  }

  async function handleEliminar(id) {
    if (!window.confirm('¿Eliminar este adicional? No se puede deshacer.')) return
    const anteriores = adicionales
    setAdicionales((prev) => prev.filter((a) => a.id !== id))
    try {
      await eliminarAdicionalObra(accessToken, id)
    } catch (err) {
      setAdicionales(anteriores)
      setError(err.message)
    }
  }

  return (
    <div className="adicionales-obra">
      <form className="adicionales-obra-form" onSubmit={enviar}>
        <div className="filtro-campo">
          <label htmlFor="adicional-obra">Nombre</label>
          <select
            id="adicional-obra"
            className="select-inline"
            value={obra}
            onChange={(e) => setObra(e.target.value)}
          >
            <option value="">Seleccionar obra aceptada…</option>
            {obrasDisponibles.map((o) => (
              <option key={o.obra} value={o.obra}>{o.obra}</option>
            ))}
          </select>
        </div>
        <div className="filtro-campo">
          <label>Cliente</label>
          <span className="adicionales-obra-cliente-derivado">{clienteDeObraSeleccionada || '—'}</span>
        </div>
        <div className="filtro-campo">
          <label htmlFor="adicional-fecha">Fecha de solicitud</label>
          <input
            id="adicional-fecha"
            type="date"
            className="input-filtro input-fecha-limite"
            value={fechaSolicitud}
            onChange={(e) => setFechaSolicitud(e.target.value)}
          />
        </div>
        <div className="filtro-campo adicionales-obra-campo-solicitante">
          <label htmlFor="adicional-solicitado-por">Solicitante</label>
          <input
            id="adicional-solicitado-por"
            type="text"
            className="input-filtro"
            placeholder="Nombre de quien lo pidió…"
            value={solicitadoPor}
            onChange={(e) => setSolicitadoPor(e.target.value)}
          />
        </div>
        <div className="filtro-campo adicionales-obra-campo-detalle">
          <label htmlFor="adicional-detalle">Detalle</label>
          <input
            id="adicional-detalle"
            type="text"
            className="input-filtro"
            placeholder="Descripción del adicional…"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="adicionales-obra-boton-agregar"
          disabled={guardando || !obra || !detalle.trim()}
        >
          Agregar
        </button>
      </form>

      {error && <div className="auth-error">{error}</div>}
      {cargando && <p className="dashboard-nota">Cargando…</p>}

      {!cargando && adicionales.length === 0 && (
        <p className="dashboard-nota">Todavía no se cargó ningún adicional.</p>
      )}

      {!cargando && adicionales.length > 0 && (
        <div className="tabla-scroll">
          <table className="tabla-adicionales">
            <thead>
              <tr>
                <th>Obra</th>
                <th>Cliente</th>
                <th>Estatus</th>
                <th>Prioridad</th>
                <th>Fecha solicitud</th>
                <th>Detalle</th>
                <th>Solicitante</th>
                <th>PDF aceptado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {adicionales.map((a) => (
                <tr key={a.id}>
                  <td className="adicionales-obra-col-obra">{a.obra}</td>
                  <td>{a.obra_cliente || 'Sin cliente'}</td>
                  <td>
                    <SelectEstatusAdicional
                      adicional={a}
                      onCambio={handleCambiarEstatus}
                      puedeCambiar={puedeCambiarEstatus}
                      puedeMarcarAlvarada={puedeMarcarAlvarada}
                      onMarcarAlvarada={(id) => handleCambiarEstatus(id, 'Alvarada')}
                      onDeshacerAlvarada={handleDeshacerAlvarada}
                    />
                  </td>
                  <td><SelectPrioridadAdicional adicional={a} onCambio={handleCambiarPrioridad} puedeCambiar={puedeCambiarPrioridad} /></td>
                  <td>{formatoFecha(a.fecha_solicitud) || '—'}</td>
                  <td className="adicionales-obra-col-detalle">{a.detalle}</td>
                  <td>{a.solicitado_por || '—'}</td>
                  <td><PdfAdicional adicional={a} puedeSubir={puedeCambiarEstatus} onSubir={handleSubirPdf} /></td>
                  <td>
                    <button
                      type="button"
                      className="boton-icono boton-icono-eliminar"
                      title="Eliminar este adicional"
                      onClick={() => handleEliminar(a.id)}
                    >
                      −
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
