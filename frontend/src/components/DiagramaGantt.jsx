import { Fragment, useEffect, useRef, useState } from 'react'

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
//
// cambiarFila (a pedido de Álvaro, 2026-10-01, Gantt de montaje): una barra
// también se puede arrastrar en vertical y soltar en OTRA fila; la fila
// destino se resalta y onMoverBarra recibe un cuarto parámetro con su id
// (o null si quedó en la misma). Solo se aceptan filas con aceptaSoltar.
// onClickBarra recibe además la posición del puntero ({ x, y }) para
// poder abrir un menú junto a la barra.
//
// onIrAFecha(iso) (a pedido de Álvaro, 2026-10-01): si se pasa, cada fila
// con barras fuera de la vista muestra una flecha en el borde ("05/11 ▶"
// hacia adelante, "◀ 15/09" hacia atrás) que lleva a la fecha de inicio de
// la más cercana; y una barra cortada por la izquierda lleva un "◀" para ir
// a su inicio.
//
// onDesplazar(dias) (a pedido de Álvaro, 2026-10-02): al arrastrar una
// barra hasta el borde derecho/izquierdo, primero se desplaza la zona con
// scroll y, si ya no hay más, se le pide a la página que corra la vista
// "dias" días; la barra sigue bajo el puntero, así una obra se puede llevar
// a cualquier fecha sin soltarla.
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
  // Una barra con cuentaSolape === false (ej. un repaso o remate de un par
  // de horas) nunca cuenta como solape — a pedido de Álvaro, 2026-10-01.
  for (let i = 0; i < ordenadas.length; i++) {
    for (let j = i + 1; j < ordenadas.length && ordenadas[j]._ini <= ordenadas[i]._fin; j++) {
      if (ordenadas[i].cuentaSolape === false || ordenadas[j].cuentaSolape === false) continue
      conSolape.add(ordenadas[i].id)
      conSolape.add(ordenadas[j].id)
    }
  }
  return { carriles: Math.max(finCarril.length, 1), conSolape }
}

// anchoEtiqueta / encabezadoEtiqueta / fila.etiquetaNode: para vistas que
// necesitan más que un nombre en la columna izquierda (ej. Prioridades:
// categoría, tarea, responsable y fechas, como su planilla de Excel).
// Se ajusta a la pantalla (a pedido de Álvaro, 2026-10-02: ordenador,
// tablet o teléfono): el ancho de cada día reparte todo el ancho disponible
// entre los días visibles (nunca menos que anchoDia; en tablet o teléfono
// el mínimo baja a 18 px y, si aun así no entra, queda el scroll lateral), y
// en esas pantallas la columna de nombres se achica. Se recalcula si
// cambia el tamaño (girar la tablet, abrir el menú...). llenarAncho queda
// por compatibilidad: ahora es siempre así.
// En pantallas táctiles una barra se arrastra MANTENIENDO el dedo pulsado
// un instante (como en el móvil); un toque corto la abre y deslizar sin
// esperar desplaza el diagrama.
const ANCHO_ESTRECHO = 1100
const ESPERA_TACTIL_MS = 350

export default function DiagramaGantt({ filas, desde, dias, anchoDia: anchoDiaPedido, editable = false, onMoverBarra, onClickBarra, vacio, anchoEtiqueta: anchoEtiquetaPedido = 230, encabezadoEtiqueta = null, cambiarFila = false, onIrAFecha = null, onDesplazar = null }) {
  const [arrastre, setArrastre] = useState(null)
  const contenedorRef = useRef(null)
  const scrollRef = useRef(null)
  const autoRef = useRef(null)
  const anchoDiaRef = useRef(0)
  const [anchoContenedor, setAnchoContenedor] = useState(0)

  useEffect(() => {
    if (!contenedorRef.current || typeof ResizeObserver === 'undefined') return undefined
    const observador = new ResizeObserver(([entrada]) => setAnchoContenedor(entrada.contentRect.width))
    observador.observe(contenedorRef.current)
    return () => observador.disconnect()
  }, [])

  const estrecho = anchoContenedor > 0 && anchoContenedor < ANCHO_ESTRECHO
  const anchoEtiqueta = estrecho ? Math.min(anchoEtiquetaPedido, Math.max(110, Math.round(anchoContenedor * 0.34))) : anchoEtiquetaPedido
  const minimoDia = estrecho ? Math.min(anchoDiaPedido, 18) : anchoDiaPedido
  const anchoDia = anchoContenedor
    ? Math.max(minimoDia, Math.floor((anchoContenedor - anchoEtiqueta - 2) / dias))
    : anchoDiaPedido
  anchoDiaRef.current = anchoDia

  // Táctil: mientras hay un arrastre en curso, el dedo no desplaza la página
  // (touchmove con preventDefault, que solo funciona con passive: false).
  const esperaTactilRef = useRef(null)
  useEffect(() => {
    const zona = scrollRef.current
    if (!zona) return undefined
    const bloquear = (e) => { if (arrastreRef.current?.activo) e.preventDefault() }
    zona.addEventListener('touchmove', bloquear, { passive: false })
    return () => zona.removeEventListener('touchmove', bloquear)
  }, [])

  useEffect(() => () => clearInterval(autoRef.current), [])
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

  // Fila (id) que está debajo del puntero, si acepta que le suelten barras.
  function filaBajoPuntero(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('[data-fila-id]')
    return el && el.dataset.aceptaSoltar === '1' ? el.dataset.filaId : null
  }

  function handlePointerDown(e, barra, modo, filaId) {
    if (e.button !== 0) return
    e.stopPropagation()
    const tactil = e.pointerType === 'touch'
    const estado = { id: barra.id, modo, x0: e.clientX, y0: e.clientY, xActual: e.clientX, delta: 0, movio: false, barra, filaOrigen: filaId, filaDestino: null, scrollPx: 0, diasCorridos: 0, dirAuto: 0, tactil, activo: !tactil }
    arrastreRef.current = estado
    if (!editable) return
    const elemento = e.currentTarget
    const idPuntero = e.pointerId
    if (tactil) {
      // Recién al mantener pulsado empieza el arrastre (ver cabecera).
      clearTimeout(esperaTactilRef.current)
      esperaTactilRef.current = setTimeout(() => {
        if (arrastreRef.current !== estado || estado.cancelado) return
        estado.activo = true
        try { elemento.setPointerCapture?.(idPuntero) } catch { /* el dedo ya se levantó */ }
        navigator.vibrate?.(15)
        setArrastre({ ...estado })
      }, ESPERA_TACTIL_MS)
      return
    }
    elemento.setPointerCapture?.(idPuntero)
    setArrastre(estado)
  }

  // Delta en días de un arrastre: lo que se movió el puntero + lo que se
  // desplazó la zona con scroll + los días que se corrió la vista.
  function calcularDelta(estado) {
    return Math.round((estado.xActual - estado.x0 + estado.scrollPx) / anchoDiaRef.current) + estado.diasCorridos
  }

  function pararAuto() {
    clearInterval(autoRef.current)
    autoRef.current = null
  }

  // Desplazamiento automático al arrastrar cerca de un borde.
  function revisarAuto(estado) {
    const zona = scrollRef.current
    if (!zona || !estado.movio) return
    const r = zona.getBoundingClientRect()
    const margen = 40
    const dir = estado.xActual > r.right - margen ? 1 : estado.xActual < r.left + anchoEtiqueta + margen ? -1 : 0
    if (dir === estado.dirAuto) return
    estado.dirAuto = dir
    pararAuto()
    if (!dir) return
    autoRef.current = setInterval(() => {
      const actual = arrastreRef.current
      if (!actual) { pararAuto(); return }
      const paso = anchoDiaRef.current
      const antes = zona.scrollLeft
      zona.scrollLeft = antes + dir * paso
      const movido = zona.scrollLeft - antes
      if (movido !== 0) actual.scrollPx += movido
      else if (onDesplazar) {
        actual.diasCorridos += dir
        onDesplazar(dir)
      } else return
      actual.delta = calcularDelta(actual)
      setArrastre({ ...actual })
    }, 130)
  }

  function handlePointerMove(e) {
    const estado = arrastreRef.current
    if (!estado || !editable) return
    if (!estado.activo) {
      // Táctil antes de la espera: si el dedo se desliza, es para desplazar
      // el diagrama, no para arrastrar la barra.
      if (Math.abs(e.clientX - estado.x0) > 8 || Math.abs(e.clientY - estado.y0) > 8) {
        estado.cancelado = true
        estado.movio = true
        clearTimeout(esperaTactilRef.current)
      }
      return
    }
    estado.xActual = e.clientX
    const delta = calcularDelta(estado)
    if (Math.abs(e.clientX - estado.x0) > 3 || Math.abs(e.clientY - estado.y0) > 3) estado.movio = true
    let destino = null
    if (cambiarFila && estado.modo === 'mover' && Math.abs(e.clientY - estado.y0) > 8) {
      const f = filaBajoPuntero(e.clientX, e.clientY)
      destino = f && f !== estado.filaOrigen ? f : null
    }
    if (delta !== estado.delta || destino !== estado.filaDestino) {
      estado.delta = delta
      estado.filaDestino = destino
      setArrastre({ ...estado })
    }
    revisarAuto(estado)
  }

  function handlePointerUp(e) {
    pararAuto()
    clearTimeout(esperaTactilRef.current)
    const estado = arrastreRef.current
    arrastreRef.current = null
    setArrastre(null)
    if (!estado) return
    // Táctil: el navegador cancela el puntero al empezar a desplazar.
    if (e?.type === 'pointercancel' && !estado.activo) return
    const { barra, delta, modo, movio, filaDestino } = estado
    if (editable && movio && (delta !== 0 || filaDestino)) {
      let ini = barra._ini
      let fin = barra._fin
      if (modo === 'mover') { ini += delta; fin += delta }
      else if (modo === 'inicio') ini = Math.min(ini + delta, fin)
      else fin = Math.max(fin + delta, ini)
      onMoverBarra?.(barra, numeroADia(ini), numeroADia(fin), filaDestino)
    } else if (!movio) {
      onClickBarra?.(barra, { x: e?.clientX ?? 0, y: e?.clientY ?? 0 })
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
    <div className="gantt" ref={contenedorRef}>
      <div className="gantt-scroll" ref={scrollRef} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
        <div className="gantt-lienzo" style={{ width: anchoEtiqueta + anchoTotal }}>
          <div className="gantt-encabezado">
            <div className="gantt-etiqueta gantt-etiqueta-encabezado" style={{ width: anchoEtiqueta, flexBasis: anchoEtiqueta }}>{encabezadoEtiqueta}</div>
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
            const alto = Math.max(fila.esGrupo ? 36 : fila.carriles * (ALTO_BARRA + SEPARACION) + SEPARACION * 2, fila.altoMinimo || 0)
            return (
              <div key={fila.id} data-fila-id={fila.id} data-acepta-soltar={fila.aceptaSoltar ? '1' : '0'} className={`gantt-fila${fila.esGrupo ? ' gantt-fila-grupo' : ''}${fila.clase ? ` ${fila.clase}` : ''}${arrastre?.filaDestino === fila.id ? ' gantt-fila-destino' : ''}`} style={{ height: alto }}>
                <div className="gantt-etiqueta" title={fila.etiquetaNode ? undefined : fila.etiqueta} style={{ width: anchoEtiqueta, flexBasis: anchoEtiqueta }}>
                  {fila.etiquetaNode || (
                    <>
                      <span className="gantt-etiqueta-texto">{fila.etiqueta}</span>
                      {fila.subetiqueta && <span className="gantt-etiqueta-sub">{fila.subetiqueta}</span>}
                    </>
                  )}
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
                  {onIrAFecha && (() => {
                    const futuras = fila.barras.filter((b) => b._ini > finVentana).sort((a, b) => a._ini - b._ini)
                    const pasadas = fila.barras.filter((b) => b._fin < inicioVentana).sort((a, b) => b._fin - a._fin)
                    const lista = (bs) => bs.slice(0, 6).map((b) => `${formatoCorto(numeroADia(b._ini))} · ${b.texto}`).join('\n') + (bs.length > 6 ? `\n… y ${bs.length - 6} más` : '')
                    return (
                      <>
                        {pasadas.length > 0 && (
                          <button type="button" className="gantt-ir gantt-ir-atras" title={`Antes de esta vista:\n${lista(pasadas)}`}
                            onPointerDown={(e) => e.stopPropagation()} onClick={() => onIrAFecha(numeroADia(pasadas[0]._ini))}>
                            ◀ {formatoCorto(numeroADia(pasadas[0]._ini))}
                          </button>
                        )}
                        {futuras.length > 0 && (
                          <button type="button" className="gantt-ir gantt-ir-adelante" title={`Después de esta vista:\n${lista(futuras)}`}
                            onPointerDown={(e) => e.stopPropagation()} onClick={() => onIrAFecha(numeroADia(futuras[0]._ini))}>
                            {formatoCorto(numeroADia(futuras[0]._ini))} ▶{futuras.length > 1 ? ` (+${futuras.length - 1})` : ''}
                          </button>
                        )}
                      </>
                    )
                  })()}
                  {fila.barras.map((b) => {
                    const { ini, fin } = desplazamiento(b)
                    if (fin < inicioVentana || ini > finVentana) return null
                    const iniVisible = Math.max(ini, inicioVentana)
                    const finVisible = Math.min(fin, finVentana)
                    const solapada = fila.marcarSolapes && fila.conSolape.has(b.id)
                    const enArrastre = arrastre?.id === b.id
                    // Barra demasiado corta para su texto (ej. 1 día en vista Mes):
                    // el nombre se muestra al lado, a la derecha — a pedido de
                    // Álvaro, 2026-10-02.
                    const izquierda = (iniVisible - inicioVentana) * anchoDia + 1
                    const ancho = (finVisible - iniVisible + 1) * anchoDia - 2
                    const textoFuera = !enArrastre && b.texto && ancho < String(b.texto).length * 6.6 + 18
                    return (
                      <Fragment key={b.id}>
                      {textoFuera && (
                        <span className="gantt-barra-texto-fuera" style={{ left: izquierda + ancho + 4, top: SEPARACION + b._carril * (ALTO_BARRA + SEPARACION), height: ALTO_BARRA }}>
                          {b.texto}
                        </span>
                      )}
                      <div
                        className={`gantt-barra${b.clase ? ` ${b.clase}` : ''}${b.atenuada ? ' gantt-barra-atenuada' : ''}${solapada ? ' gantt-barra-solape' : ''}${editable ? ' gantt-barra-editable' : ''}${enArrastre ? ' gantt-barra-arrastrando' : ''}`}
                        style={{
                          left: izquierda,
                          width: ancho,
                          top: SEPARACION + b._carril * (ALTO_BARRA + SEPARACION),
                          height: ALTO_BARRA,
                          background: b.color,
                        }}
                        title={`${b.titulo || b.texto}\n${formatoCorto(numeroADia(ini))}${fin !== ini ? ` → ${formatoCorto(numeroADia(fin))}` : ''}${solapada ? '\n⚠ Se pisa con otra tarea del mismo responsable' : ''}`}
                        onPointerDown={(e) => handlePointerDown(e, b, 'mover', fila.id)}
                      >
                        {onIrAFecha && b._ini < inicioVentana && !enArrastre && (
                          <span className="gantt-barra-ir-inicio" title={`Ir al inicio (${formatoCorto(numeroADia(b._ini))})`}
                            onPointerDown={(e) => { e.stopPropagation(); onIrAFecha(numeroADia(b._ini)) }}>◀</span>
                        )}
                        {editable && !b.soloMover && b._ini >= inicioVentana && <span className="gantt-barra-borde gantt-barra-borde-ini" onPointerDown={(e) => handlePointerDown(e, b, 'inicio')} />}
                        <span className="gantt-barra-texto">
                          {enArrastre ? `${formatoCorto(numeroADia(ini))} → ${formatoCorto(numeroADia(fin))}` : textoFuera ? '' : b.texto}
                        </span>
                        {editable && !b.soloMover && <span className="gantt-barra-borde gantt-barra-borde-fin" onPointerDown={(e) => handlePointerDown(e, b, 'fin')} />}
                      </div>
                      </Fragment>
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
