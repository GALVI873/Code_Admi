import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { planificacion, actualizarTareaPlanificacion, agregarPersonaMontaje } from '../api/client.js'
import DiagramaGantt, { diaANumero, numeroADia, hoyIso, lunesDe, formatoCorto } from '../components/DiagramaGantt.jsx'
import { COLOR_CATEGORIA, COLOR_SITUACION, LeyendaColores, VentanaTarea, filasMontajePorMontador, datosNum, tareaNum } from '../components/PlanificacionComun.jsx'

// Página de Inicio para TODOS los usuarios — a pedido de Álvaro,
// 2026-09-29: el Gantt semanal de montaje (qué montador está en qué obra
// esta semana) más el resto de tareas de la semana (mediciones,
// transportes, fabricación…) por categoría. Los datos son los de
// Planificación (public/api/planificacion.php); acá es solo para mirar —
// las fechas se asignan en Planificación (solo admin), aunque admin puede
// corregir una tarea desde el click en su barra.

const DIAS_VISIBLES = 7

export default function InicioPage() {
  const { accessToken, usuario } = useAuth()
  const navigate = useNavigate()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [desde, setDesde] = useState(() => lunesDe(hoyIso()))
  const [tareaAbierta, setTareaAbierta] = useState(null)

  useEffect(() => {
    planificacion(accessToken)
      .then((d) => setDatos(datosNum(d)))
      .catch((err) => setError(err.message))
  }, [accessToken])

  const obrasPorId = useMemo(() => new Map((datos?.obras || []).map((o) => [o.id, o])), [datos])
  const inicioVentana = diaANumero(desde)
  const finVentana = inicioVentana + DIAS_VISIBLES - 1

  function enLaSemana(t) {
    if (!t.fecha_inicio) return false
    const ini = diaANumero(t.fecha_inicio)
    const fin = t.fecha_fin ? diaANumero(t.fecha_fin) : ini
    return fin >= inicioVentana && ini <= finVentana
  }

  const filasMontaje = useMemo(() => {
    if (!datos) return []
    return filasMontajePorMontador(datos.tareas.filter(enLaSemana), obrasPorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, obrasPorId, inicioVentana])

  const filasOtras = useMemo(() => {
    if (!datos) return []
    const porCategoria = new Map()
    for (const t of datos.tareas) {
      if (t.categoria === 'Montaje' || t.estado === 'Terminado' || !enLaSemana(t)) continue
      const obra = obrasPorId.get(t.obra_id)
      if (!obra || obra.estado === 'Terminada') continue
      if (!porCategoria.has(t.categoria)) porCategoria.set(t.categoria, [])
      porCategoria.get(t.categoria).push({
        id: t.id,
        inicio: t.fecha_inicio,
        fin: t.fecha_fin,
        texto: t.responsable ? `${obra.nombre} · ${t.responsable}` : obra.nombre,
        titulo: `${obra.nombre} — ${t.categoria}${t.responsable ? ` (${t.responsable})` : ''}`,
        color: COLOR_CATEGORIA[t.categoria],
        tarea: t,
      })
    }
    return datos.categorias
      .filter((c) => porCategoria.has(c))
      .map((c) => ({ id: `cat-${c}`, etiqueta: c, subetiqueta: `${porCategoria.get(c).length}`, barras: porCategoria.get(c) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, obrasPorId, inicioVentana])

  // Mismo criterio que el borde rojo: solo cuentan dos obras ("Obra"), no
  // una obra con un remate/repaso/aviso.
  const solapes = filasMontaje.filter((f) => f.marcarSolapes && f.barras.length > 1 && f.barras.some((a, i) => f.barras.some((b, j) => i < j
    && a.cuentaSolape !== false && b.cuentaSolape !== false
    && diaANumero(a.inicio) <= diaANumero(b.fin || b.inicio) && diaANumero(b.inicio) <= diaANumero(a.fin || a.inicio))))

  async function actualizarTarea(id, cambios) {
    const tarea = tareaNum((await actualizarTareaPlanificacion(accessToken, id, cambios)).tarea)
    setDatos((prev) => ({ ...prev, tareas: prev.tareas.map((t) => (t.id === id ? tarea : t)) }))
  }

  const tareaSeleccionada = tareaAbierta && datos ? datos.tareas.find((t) => t.id === tareaAbierta) : null
  const esEstaSemana = desde === lunesDe(hoyIso())

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Hola{usuario?.nombre ? `, ${usuario.nombre.split(' ')[0]}` : ''}</h1>
          <p>Montajes y tareas de la semana del {formatoCorto(desde)} al {formatoCorto(numeroADia(finVentana))}</p>
        </div>
        {datos?.puede_editar && (
          <button type="button" className="btn-secundario" onClick={() => navigate('/planificacion')}>Ir a Planificación →</button>
        )}
      </header>

      <div className="plan-navegacion plan-navegacion-inicio">
        <button type="button" className="btn-secundario" onClick={() => setDesde(numeroADia(inicioVentana - 7))}>◀ Semana anterior</button>
        <button type="button" className="btn-secundario" disabled={esEstaSemana} onClick={() => setDesde(lunesDe(hoyIso()))}>Esta semana</button>
        <button type="button" className="btn-secundario" onClick={() => setDesde(numeroADia(inicioVentana + 7))}>Semana siguiente ▶</button>
      </div>

      {error && <div className="auth-error">{error}</div>}
      {!datos && !error && <p className="dashboard-nota">Cargando…</p>}

      {datos && (
        <>
          <div className="plan-seccion-titulo">
            <h2>🔧 Montaje por montador</h2>
            <LeyendaColores colores={COLOR_SITUACION} />
          </div>
          {solapes.length > 0 && (
            <div className="plan-aviso-solape">
              ⚠ {solapes.map((f) => f.etiqueta).join(', ')} {solapes.length === 1 ? 'tiene' : 'tienen'} dos obras el mismo día esta semana (barras con borde rojo).
            </div>
          )}
          <DiagramaGantt
            filas={filasMontaje}
            desde={desde}
            dias={DIAS_VISIBLES}
            anchoDia={130}
            llenarAncho
            onClickBarra={(b) => setTareaAbierta(b.tarea.id)}
            vacio="No hay montajes planificados esta semana."
          />

          <div className="plan-seccion-titulo">
            <h2>📋 Otras tareas de la semana</h2>
          </div>
          <DiagramaGantt
            filas={filasOtras}
            desde={desde}
            dias={DIAS_VISIBLES}
            anchoDia={130}
            llenarAncho
            onClickBarra={(b) => setTareaAbierta(b.tarea.id)}
            vacio="No hay otras tareas planificadas esta semana."
          />
        </>
      )}

      {tareaSeleccionada && (
        <VentanaTarea
          tarea={tareaSeleccionada}
          obra={obrasPorId.get(tareaSeleccionada.obra_id)}
          responsables={datos.responsables}
          personas={datos.personas || []}
          onCrearPersona={async (nombre, rol) => {
            const r = await agregarPersonaMontaje(accessToken, nombre, rol)
            setDatos((prev) => ({ ...prev, personas: r.personas }))
          }}
          puedeEditar={datos.puede_editar}
          onGuardar={actualizarTarea}
          onCerrar={() => setTareaAbierta(null)}
          onAbrirObra={(o) => navigate(`/planificacion?pestana=Obras&obra=${o.id}`)}
        />
      )}
    </div>
  )
}
