import { Fragment, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { costesObra } from '../api/client.js'

// Vista "Costes" (2026-09-15, a pedido de Álvaro, exclusiva de admin) — por
// cada obra aceptada, compara el costo con el que se armó el presupuesto
// (precio de venta menos Beneficio, ver obras_aceptadas.costo_inicial)
// contra el gasto real acumulado en PAF.xlsx (backend/drive_sync/
// sync_costes_paf.js, corre en el cron nocturno junto con el resto). Sirve
// para ver de un vistazo en qué obras ya se pasaron del costo inicial.
//
// "Sin asignar": filas del PAF cuyo texto de obra (escrito a mano) no pudo
// emparejarse automáticamente contra ninguna obra aceptada conocida — no se
// pierden, se listan aparte para que un admin las revise (puede ser un
// typo real en el PAF, o gasto de una obra que no está en Obras Aceptadas).
//
// Detalle por categoría (a pedido de Álvaro): al hacer click en una obra se
// abre el desglose Material/Vidrio/Chapas/Transporte/Colocación/Comunes/
// Extra/Variable/Persianas/Composite/Comisión/Ingeniería — costo inicial
// (hoja Comparativa) vs costo real (PAF, con la categoría del PAF ya
// mapeada a estas mismas por sync_costes_paf.js). "Varios" del PAF queda
// fuera del desglose a propósito (informativo) — por eso se muestra aparte
// como "sin categorizar" en vez de simplemente no sumar en ningún lado.
const CATEGORIA_ORDEN = ['Material', 'Vidrio', 'Chapas', 'Transporte', 'Colocacion', 'Comunes', 'Extra', 'Variable', 'Persianas', 'Composite', 'Comision', 'Ingenieria']

function formatoMoneda(valor) {
  if (valor === null || valor === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(valor)
}

function formatoPorcentaje(valor) {
  if (valor === null || valor === undefined) return ''
  const signo = valor > 0 ? '+' : ''
  return `${signo}${valor.toFixed(1)}%`
}

// Devuelve filas <tr> DENTRO de la misma tabla/columnas que la fila
// general (no una tabla anidada aparte) — así cada valor por categoría cae
// exactamente debajo de su columna general (Costo inicial/Costo real/
// Diferencia), sin depender de que dos tablas distintas midan sus columnas
// igual.
function FilasDetalleCategorias({ obra, categoriasIniciales, categoriasReales, costoRealTotal }) {
  const filas = useMemo(() => {
    const claves = new Set([...categoriasIniciales.keys(), ...categoriasReales.keys()])
    return Array.from(claves)
      .map((categoria) => {
        const costoInicial = categoriasIniciales.has(categoria) ? Number(categoriasIniciales.get(categoria)) : null
        const real = categoriasReales.get(categoria)
        const costoReal = real ? Number(real.costo_real) : null
        const diferencia = costoInicial != null && costoReal != null ? costoReal - costoInicial : null
        return { categoria, costoInicial, costoReal, diferencia }
      })
      .sort((a, b) => {
        const ia = CATEGORIA_ORDEN.indexOf(a.categoria)
        const ib = CATEGORIA_ORDEN.indexOf(b.categoria)
        if (ia === -1 && ib === -1) return a.categoria.localeCompare(b.categoria, 'es')
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      })
  }, [categoriasIniciales, categoriasReales])

  const categorizado = useMemo(
    () => Array.from(categoriasReales.values()).reduce((acc, c) => acc + Number(c.costo_real), 0),
    [categoriasReales],
  )
  const sinCategorizar = costoRealTotal != null ? costoRealTotal - categorizado : null

  if (filas.length === 0) {
    return (
      <tr className="tabla-costes-fila-detalle">
        <td colSpan={6}><p className="dashboard-nota costes-detalle-vacio">Sin desglose por categoría para "{obra}" todavía.</p></td>
      </tr>
    )
  }

  return (
    <>
      {filas.map((f) => (
        <tr key={f.categoria} className="tabla-costes-fila-detalle-categoria">
          <td></td>
          <td className="tabla-costes-categoria">↳ {f.categoria}</td>
          <td></td>
          <td>{formatoMoneda(f.costoInicial)}</td>
          <td>{formatoMoneda(f.costoReal)}</td>
          <td className={f.diferencia > 0 ? 'tabla-costes-diferencia-mala' : f.diferencia < 0 ? 'tabla-costes-diferencia-buena' : ''}>
            {f.diferencia != null ? formatoMoneda(f.diferencia) : '—'}
          </td>
        </tr>
      ))}
      {sinCategorizar != null && sinCategorizar > 0.01 && (
        <tr className="tabla-costes-fila-detalle">
          <td colSpan={6}>
            <p className="dashboard-nota costes-sin-categorizar">
              Sin categorizar (gastos "Varios" del PAF, no entran en ninguna categoría arriba): {formatoMoneda(sinCategorizar)}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

export default function CostesObraPage() {
  const { accessToken } = useAuth()
  const [obras, setObras] = useState([])
  const [costesReales, setCostesReales] = useState([])
  const [sinAsignar, setSinAsignar] = useState([])
  const [categoriasIniciales, setCategoriasIniciales] = useState([])
  const [categoriasReales, setCategoriasReales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloPasadas, setSoloPasadas] = useState(false)
  const [verSinAsignar, setVerSinAsignar] = useState(false)
  const [obraAbierta, setObraAbierta] = useState(null)

  useEffect(() => {
    costesObra(accessToken)
      .then((data) => {
        setObras(data.obras || [])
        setCostesReales(data.costes_reales || [])
        setSinAsignar(data.sin_asignar || [])
        setCategoriasIniciales(data.categorias_iniciales || [])
        setCategoriasReales(data.categorias_reales || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const costoRealPorObra = useMemo(() => new Map(costesReales.map((c) => [c.obra, c])), [costesReales])

  const categoriasInicialesPorObra = useMemo(() => {
    const mapa = new Map()
    for (const c of categoriasIniciales) {
      if (!mapa.has(c.obra)) mapa.set(c.obra, new Map())
      mapa.get(c.obra).set(c.categoria, c.costo_inicial)
    }
    return mapa
  }, [categoriasIniciales])

  const categoriasRealesPorObra = useMemo(() => {
    const mapa = new Map()
    for (const c of categoriasReales) {
      if (!mapa.has(c.obra)) mapa.set(c.obra, new Map())
      mapa.get(c.obra).set(c.categoria, c)
    }
    return mapa
  }, [categoriasReales])

  const filas = useMemo(() => {
    return obras.map((o) => {
      const real = costoRealPorObra.get(o.obra)
      const costoInicial = o.costo_inicial != null ? Number(o.costo_inicial) : null
      const costoReal = real ? Number(real.costo_real) : null
      const diferencia = costoInicial != null && costoReal != null ? costoReal - costoInicial : null
      const porcentaje = costoInicial ? (diferencia / costoInicial) * 100 : null
      return {
        ...o,
        costoInicial,
        costoReal,
        cantidadFilas: real ? real.cantidad_filas : 0,
        diferencia,
        porcentaje,
        pasada: diferencia != null && diferencia > 0,
      }
    })
  }, [obras, costoRealPorObra])

  const filasFiltradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return filas
      .filter((f) => !texto || f.obra?.toLowerCase().includes(texto))
      .filter((f) => !soloPasadas || f.pasada)
      .sort((a, b) => {
        // Las que se pasaron de costo van primero, ordenadas por la peor
        // desviación en € — es lo más urgente que Álvaro necesita ver.
        if (a.pasada && !b.pasada) return -1
        if (!a.pasada && b.pasada) return 1
        if (a.diferencia != null && b.diferencia != null) return b.diferencia - a.diferencia
        if (a.diferencia != null) return -1
        if (b.diferencia != null) return 1
        return (a.obra || '').localeCompare(b.obra || '', 'es')
      })
  }, [filas, busqueda, soloPasadas])

  const totalPasadas = useMemo(() => filas.filter((f) => f.pasada).length, [filas])
  const totales = useMemo(() => {
    const conAmbos = filas.filter((f) => f.costoInicial != null && f.costoReal != null)
    return {
      costoInicial: conAmbos.reduce((acc, f) => acc + f.costoInicial, 0),
      costoReal: conAmbos.reduce((acc, f) => acc + f.costoReal, 0),
      cantidad: conAmbos.length,
    }
  }, [filas])
  const totalSinAsignar = useMemo(() => sinAsignar.reduce((acc, s) => acc + Number(s.total), 0), [sinAsignar])

  function alternarObra(obra) {
    setObraAbierta((actual) => (actual === obra ? null : obra))
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Costes</h1>
          <p>Costo con el que se armó el presupuesto aceptado, comparado contra el gasto real acumulado en PAF — para ver en qué obras ya se pasaron del costo inicial. Hacé click en una obra para ver el desglose por categoría.</p>
        </div>
      </header>

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {!cargando && !error && (
        <>
          <div className="costes-resumen">
            <div className="costes-resumen-tarjeta">
              <span className="costes-resumen-etiqueta">Costo inicial (obras con dato)</span>
              <span className="costes-resumen-valor">{formatoMoneda(totales.costoInicial)}</span>
            </div>
            <div className="costes-resumen-tarjeta">
              <span className="costes-resumen-etiqueta">Costo real (PAF)</span>
              <span className="costes-resumen-valor">{formatoMoneda(totales.costoReal)}</span>
            </div>
            <div className={`costes-resumen-tarjeta ${totales.costoReal > totales.costoInicial ? 'costes-resumen-tarjeta-mala' : 'costes-resumen-tarjeta-buena'}`}>
              <span className="costes-resumen-etiqueta">Diferencia</span>
              <span className="costes-resumen-valor">{formatoMoneda(totales.costoReal - totales.costoInicial)}</span>
            </div>
            <div className="costes-resumen-tarjeta">
              <span className="costes-resumen-etiqueta">Obras comparadas</span>
              <span className="costes-resumen-valor">{totales.cantidad} / {obras.length}</span>
            </div>
          </div>

          <div className="filtro-tabla">
            <div className="filtro-campo">
              <label htmlFor="filtro-obra-costes">Obra</label>
              <input
                id="filtro-obra-costes"
                type="text"
                className="input-filtro"
                placeholder="Filtrar por obra…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            {totalPasadas > 0 && (
              <button
                type="button"
                className={`filtro-prox-descartar ${soloPasadas ? 'filtro-prox-descartar-activo' : ''}`}
                onClick={() => setSoloPasadas((v) => !v)}
              >
                ⚠ {totalPasadas} pasadas de costo
              </button>
            )}
            <span className="filtro-contador">{filasFiltradas.length} de {obras.length}</span>
          </div>

          <div className="tabla-scroll">
            <table className="tabla-costes">
              <thead>
                <tr>
                  <th></th>
                  <th>Obra</th>
                  <th>Cliente</th>
                  <th>Costo inicial</th>
                  <th>Costo real</th>
                  <th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((f) => (
                  <Fragment key={f.obra}>
                    <tr
                      className={`tabla-costes-fila-clicable ${f.pasada ? 'tabla-costes-fila-pasada' : ''} ${obraAbierta === f.obra ? 'tabla-costes-fila-abierta' : ''}`}
                      onClick={() => alternarObra(f.obra)}
                    >
                      <td className="tabla-costes-flecha">{obraAbierta === f.obra ? '▾' : '▸'}</td>
                      <td className="tabla-costes-obra">{f.obra}</td>
                      <td>{f.cliente || 'Sin cliente'}</td>
                      <td>{formatoMoneda(f.costoInicial)}</td>
                      <td>{formatoMoneda(f.costoReal)}</td>
                      <td className={f.diferencia > 0 ? 'tabla-costes-diferencia-mala' : f.diferencia < 0 ? 'tabla-costes-diferencia-buena' : ''}>
                        {f.diferencia != null ? `${formatoMoneda(f.diferencia)} (${formatoPorcentaje(f.porcentaje)})` : '—'}
                      </td>
                    </tr>
                    {obraAbierta === f.obra && (
                      <FilasDetalleCategorias
                        obra={f.obra}
                        categoriasIniciales={categoriasInicialesPorObra.get(f.obra) || new Map()}
                        categoriasReales={categoriasRealesPorObra.get(f.obra) || new Map()}
                        costoRealTotal={f.costoReal}
                      />
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {sinAsignar.length > 0 && (
            <div className="costes-sin-asignar">
              <button type="button" className="notas-obra-ver-archivadas" onClick={() => setVerSinAsignar((v) => !v)}>
                {verSinAsignar ? 'Ocultar' : 'Ver'} gastos del PAF sin emparejar ({sinAsignar.length}, suma {formatoMoneda(totalSinAsignar)})
              </button>
              {verSinAsignar && (
                <>
                  <p className="dashboard-nota">
                    Estos textos de obra del PAF no cruzaron automáticamente contra ninguna obra aceptada — puede ser un nombre escrito distinto, o gasto de una obra que no está (todavía) en Obras Aceptadas.
                  </p>
                  <table className="tabla-costes">
                    <thead>
                      <tr>
                        <th>Texto de obra en el PAF</th>
                        <th>Total</th>
                        <th>Filas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sinAsignar.map((s) => (
                        <tr key={s.obra_texto}>
                          <td>{s.obra_texto}</td>
                          <td>{formatoMoneda(Number(s.total))}</td>
                          <td>{s.cantidad_filas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
