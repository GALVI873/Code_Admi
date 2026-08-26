import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { presupuestosEnEstudio } from '../api/client.js'

// Espacio de trabajo personal de Geraldinne: línea de tiempo por obra con
// los 4 pasos del flujo real hasta el envío del presupuesto. Solo tiene
// sentido para obras vivas — las Descartadas se excluyen siempre, sin
// filtro para desactivarlo (a diferencia de Presupuestos en Estudio).
const EMAIL_AUTORIZADO = 'presupuestos@galvi.es'

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

// "Solicitud" toma como fecha el día que se creó la carpeta de la obra en
// Drive — es lo más cercano a "cuándo pidieron el presupuesto" que se puede
// derivar automáticamente, ya que no hay un campo de solicitud separado.
function construirPasos(p) {
  const hojaCalculoConValores = p.precio_ultimo_presupuesto != null && p.precio_m2 != null
  const fichaDiligenciada = Boolean(p.numero_ppto && p.carpinteria && p.vidrio)
  const tieneOfertas = Boolean(p.fecha_ultimo_envio)

  return [
    { clave: 'solicitud', etiqueta: 'Solicitud', hecho: Boolean(p.fecha_creacion_carpeta), fecha: formatoFecha(p.fecha_creacion_carpeta) },
    { clave: 'hoja_calculo', etiqueta: 'Hoja de cálculo con valores', hecho: hojaCalculoConValores, fecha: null },
    { clave: 'ficha', etiqueta: 'Ficha diligenciada', hecho: fichaDiligenciada, fecha: null },
    { clave: 'ofertas', etiqueta: 'Ofertas', hecho: tieneOfertas, fecha: formatoFecha(p.fecha_ultimo_envio) },
  ]
}

function LineaTiempo({ presupuesto }) {
  const pasos = construirPasos(presupuesto)
  return (
    <ol className="seguimiento-timeline">
      {pasos.map((paso, i) => (
        <li key={paso.clave} className={`seguimiento-paso ${paso.hecho ? 'seguimiento-paso-hecho' : 'seguimiento-paso-pendiente'}`}>
          <div className="seguimiento-paso-punto">{paso.hecho ? '✓' : i + 1}</div>
          <div className="seguimiento-paso-texto">
            <span className="seguimiento-paso-etiqueta">{paso.etiqueta}</span>
            {paso.fecha && <span className="seguimiento-paso-fecha">{paso.fecha}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function FilaObra({ presupuesto }) {
  return (
    <div className="seguimiento-fila">
      <div className="seguimiento-fila-header">
        <span className="seguimiento-fila-obra">{presupuesto.obra}</span>
        <span className="seguimiento-fila-cliente">{presupuesto.cliente || 'Sin cliente'}</span>
        <span className={`badge ${presupuesto.estatus === 'Aceptado' ? 'badge-aceptado' : 'badge-borrador'}`}>
          {presupuesto.estatus}
        </span>
      </div>
      <LineaTiempo presupuesto={presupuesto} />
    </div>
  )
}

export default function SeguimientoPage() {
  const { usuario, accessToken } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busquedaObra, setBusquedaObra] = useState('')

  useEffect(() => {
    presupuestosEnEstudio(accessToken)
      .then((data) => setFilas(data.presupuestos))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const filasVivas = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return filas
      .filter((p) => p.estatus !== 'Descartado')
      .filter((p) => !texto || p.obra.toLowerCase().includes(texto))
  }, [filas, busquedaObra])

  // Defensa además de ocultar el link del menú: si alguien entra directo a
  // la URL sin ser Geraldinne, no ve el contenido igual.
  if (usuario?.email !== EMAIL_AUTORIZADO) {
    return (
      <div className="dashboard">
        <p className="dashboard-nota">No tienes acceso a este espacio de trabajo.</p>
      </div>
    )
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Presupuesto</h1>
          <p>Línea de tiempo por obra — desde la solicitud hasta el envío del presupuesto</p>
        </div>
      </header>

      <div className="filtro-tabla">
        <div className="filtro-campo">
          <input
            className="input-filtro"
            type="text"
            placeholder="Buscar obra..."
            value={busquedaObra}
            onChange={(e) => setBusquedaObra(e.target.value)}
          />
        </div>
      </div>

      {cargando && <p className="dashboard-nota">Cargando...</p>}
      {error && <p className="auth-error">{error}</p>}
      {!cargando && !error && filasVivas.length === 0 && (
        <p className="dashboard-nota">Ninguna obra coincide.</p>
      )}

      {!cargando && !error && (
        <div className="seguimiento-lista">
          {filasVivas.map((p) => (
            <FilaObra key={p.id} presupuesto={p} />
          ))}
        </div>
      )}
    </div>
  )
}
