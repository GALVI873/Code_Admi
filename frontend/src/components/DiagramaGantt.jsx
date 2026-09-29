import { useRef, useState } from 'react'

// Diagrama de Gantt interactivo (Planificación e Inicio) — a pedido de
// Álvaro, 2026-09-29, para reemplazar la línea de tiempo de Notion. Hecho a
// mano con divs posicionados (sin librería nueva, igual que el resto del
// panel): una columna fija de etiquetas a la izquierda y la línea de tiempo
// con scroll horizontal. Si "editable", cada barra se arrastra entera para
// moverla o desde sus bordes para cambiar inicio/fin (onMoverBarra recibe
// las fechas nuevas al soltar); un click sin arrastrar llama a onClickBarra.
//
// filas: [{ id, etiqueta, subetiqueta?, esGrupo?, marcarSolapes?, barras:
//   [{ id, inicio, fin, texto, color, titulo?, atenuada?, clase?, ... }] }]
// (cualquier otro dato de la barra — ej. la tarea o la obra — vuelve tal
// cual en onMoverBarra/onClickBarra).
// Las fechas son 'AAAA-MM-DD'; fin null = un solo día. Dentro de una fila,
// las barras que se pisan se apilan en carriles; con marcarSolapes además
// se les pone borde rojo (ej. un montador con dos obras el mismo día).

const MS_DIA = 86400000
const ALTO_BARRA = 28
const SEPARACION = 4
const DIAS_SEMANA = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export function diaANumero(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(a, m - 1, d) / MS_DIA)
}

export function numeroADia(n) {
  return new Date(n * MS_DIA).toISOString().slice(0, 10)
}

export function hoyIso() {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`
}

// Lunes de la semana de una fecha dada.
export function lunesDe(iso) {
  const n = diaANumero(iso)
  const diaSemana = new Date(n * MS_DIA).getUTCDay()
  return numeroADia(n - ((diaSemana + 6) % 7))
}

export function formatoCorto(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// Reparte las barras de una fila en carriles para que no se tapen entre sí.
function asignarCarriles(barras) {
  const ordenadas = [...barras].sort((a, b) => a._ini - b._ini || a._fin - b._fin)
  const finCarril = []
  const conSolape = new Set()
  for (const b of ordenadas) {
    let carril = finCarril.findIndex((f) => f < b._ini)
    if (carril === -1) {
      carril = finCarril.length
      finCarril.push(b._fin)
    } else {
      finCarril[carril] = b._fin
    }
    b._carril = carril
  }
  for (let i = 0; i < ordenadas.length; i++) {
    for (let j = i + 1; j < ordenadas.length && ordenadas[j]._ini <= ordenadas[i]._fin; j++) {
      conSolape.add(ordenadas[i].id)
      conSolape.add(ordenadas[j].id)
    }
  }
  return { carriles: Math.max(finCarril.length, 1), conSolape }
}

export default function DiagramaGantt({ filas, desde, dias, anchoDia, editable = false, onMoverBarra, onClickBarra, vacio }) {
  const [arrastre, setArrastre] = useState(null)
  const arrastreRef = useRef(null)

  const inicioVentana = diaANumero(desde)
  const finVentana = inicioVentana + dias - 1
  const hoy = diaANumero(hoyIso())
  const anchoTotal = dias * anchoDia

  const columnas = []
  for (let n = inicioVentana; n <= finVentana; n++) {
    const fecha = new Date(n * MS_DIA)
    columnas.push({ n, dia: fecha.getUTCDate(), diaSemana: fecha.getUTCDay(), mes: fecha.getUTCMonth(), anio: fecha.getUTCFullYear() })
  }
  const meses = []
  for (const c of columnas) {
    const ultimo = meses[meses.length - 1]
    if (ultimo && ultimo.mes === c.mes) ultimo.dias++
    else meses.push({ mes: c.mes, anio: c.anio, dias: 1 })
  }

  function desplazamiento(barra) {
    if (!arrastre || arrastre.id !== barra.id) return { ini: barra._ini, fin: barra._fin }
    const d = arrastre.delta
    if (arrastre.modo === 'mover') return { ini: barra._ini + d, fin: barra._fin + d }
    if (arrastre.modo === 'inicio') return { ini: Math.min(barra._ini + d, barra._fin), fin: barra._fin }
    return { ini: barra._ini, fin: Math.max(barra._fin + d, barra._ini) }
  }

  function handlePointerDown(e, barra, modo) {
    if (e.button !== 0) return
    e.stopPropagation()
    const estado = { id: barra.id, modo, x0: e.clientX, delta: 0, movio: false, barra }
    arrastreRef.current = estado
    if (!editable) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setArrastre(estado)
  }

  function handlePointerMove(e) {
    const estado = arrastreRef.current
    if (!estado || !editable) return
    const delta = Math.round((e.clientX - estado.x0) / anchoDia)
    if (Math.abs(e.clientX - estado.x0) > 3) estado.movio = true
    if (delta !== estado.delta) {
      estado.delta = delta
      setArrastre({ ...estado })
    }
  }

  function handlePointerUp() {
    const estado = arrastreRef.current
    arrastreRef.current = null
    setArrastre(null)
    if (!estado) return
    const { barra, delta, modo, movio } = estado
    if (editable && movio && delta !== 0) {
      let ini = barra._ini
      let fin = barra._fin
      if (modo === 'mover') { ini += delta; fin += delta }
      else if (modo === 'inicio') ini = Math.min(ini + delta, fin)
      else fin = Math.max(fin + delta, ini)
      onMoverBarra?.(barra, numeroADia(ini), numeroADia(fin))
    } else if (!movio) {
      onClickBarra?.(barra)
    }
  }

  const filasCalculadas = filas.map((fila) => {
    const barras = (fila.barras || [])
      .filter((b) => b.inicio)
      .map((b) => {
        const ini = diaANumero(b.inicio)
        const fin = b.fin ? Math.max(diaANumero(b.fin), ini) : ini
        return { ...b, _ini: ini, _fin: fin }
      })
    const { carriles, conSolape } = asignarCarriles(barras)
    return { ...fila, barras, carriles, conSolape }
  })

  return (
    <div className="gantt">
      <div className="gantt-scroll" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
        <div className="gantt-lienzo" style={{ width: 230 + anchoTotal }}>
          <div className="gantt-encabezado">
            <div className="gantt-etiqueta gantt-etiqueta-encabezado" />
            <div className="gantt-escala" style={{ width: anchoTotal }}>
              <div className="gantt-meses">
                {meses.map((m) => (
                  <div key={`${m.anio}-${m.mes}`} className="gantt-mes" style={{ width: m.dias * anchoDia }}>
                    {m.dias * anchoDia > 60 ? `${MESES[m.mes]} ${m.anio}` : ''}
                  </div>
                ))}
              </div>
              <div className="gantt-dias">
                {columnas.map((c) => (
                  <div
                    key={c.n}
                    className={`gantt-dia${c.diaSemana === 0 || c.diaSemana === 6 ? ' gantt-dia-finde' : ''}${c.n === hoy ? ' gantt-dia-hoy' : ''}`}
                    style={{ width: anchoDia }}
                  >
                    {anchoDia >= 26 && <span className="gantt-dia-letra">{DIAS_SEMANA[c.diaSemana]}</span>}
                    {(anchoDia >= 18 || c.diaSemana === 1) && <span>{c.dia}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {filasCalculadas.length === 0 && <p className="dashboard-nota gantt-vacio">{vacio || 'No hay nada para mostrar.'}</p>}

          {filasCalculadas.map((fila) => {
            const alto = fila.esGrupo ? 36 : fila.carriles * (ALTO_BARRA + SEPARACION) + SEPARACION * 2
            return (
              <div key={fila.id} className={`gantt-fila${fila.esGrupo ? ' gantt-fila-grupo' : ''}`} style={{ height: alto }}>
                <div className="gantt-etiqueta" title={fila.etiqueta}>
                  <span className="gantt-etiqueta-texto">{fila.etiqueta}</span>
                  {fila.subetiqueta && <span className="gantt-etiqueta-sub">{fila.subetiqueta}</span>}
                </div>
                <div className="gantt-pista" style={{ width: anchoTotal }}>
                  {columnas.map((c) => (
                    (c.diaSemana === 0 || c.diaSemana === 6) && (
                      <div key={c.n} className="gantt-pista-finde" style={{ left: (c.n - inicioVentana) * anchoDia, width: anchoDia }} />
                    )
                  ))}
                  {hoy >= inicioVentana && hoy <= finVentana && (
                    <div className="gantt-linea-hoy" style={{ left: (hoy - inicioVentana) * anchoDia + anchoDia / 2 }} />
                  )}
                  {fila.barras.map((b) => {
                    const { ini, fin } = desplazamiento(b)
                    if (fin < inicioVentana || ini > finVentana) return null
                    const iniVisible = Math.max(ini, inicioVentana)
                    const finVisible = Math.min(fin, finVentana)
                    const solapada = fila.marcarSolapes && fila.conSolape.has(b.id)
                    const enArrastre = arrastre?.id === b.id
                    return (
                      <div
                        key={b.id}
                        className={`gantt-barra${b.clase ? ` ${b.clase}` : ''}${b.atenuada ? ' gantt-barra-atenuada' : ''}${solapada ? ' gantt-barra-solape' : ''}${editable ? ' gantt-barra-editable' : ''}${enArrastre ? ' gantt-barra-arrastrando' : ''}`}
                        style={{
                          left: (iniVisible - inicioVentana) * anchoDia + 1,
                          width: (finVisible - iniVisible + 1) * anchoDia - 2,
                          top: SEPARACION + b._carril * (ALTO_BARRA + SEPARACION),
                          height: ALTO_BARRA,
                          background: b.color,
                        }}
                        title={`${b.titulo || b.texto}\n${formatoCorto(numeroADia(ini))}${fin !== ini ? ` → ${formatoCorto(numeroADia(fin))}` : ''}${solapada ? '\n⚠ Se pisa con otra tarea del mismo responsable' : ''}`}
                        onPointerDown={(e) => handlePointerDown(e, b, 'mover')}
                      >
                        {editable && !b.soloMover && <span className="gantt-barra-borde gantt-barra-borde-ini" onPointerDown={(e) => handlePointerDown(e, b, 'inicio')} />}
                        <span className="gantt-barra-texto">
                          {enArrastre ? `${formatoCorto(numeroADia(ini))} → ${formatoCorto(numeroADia(fin))}` : b.texto}
                        </span>
                        {editable && !b.soloMover && <span className="gantt-barra-borde gantt-barra-borde-fin" onPointerDown={(e) => handlePointerDown(e, b, 'fin')} />}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
