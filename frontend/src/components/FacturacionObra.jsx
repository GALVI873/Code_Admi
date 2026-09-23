import { useEffect, useState } from 'react'
import {
  facturacionObra,
  actualizarDatosClienteFacturacion,
  agregarLineaFacturacion,
  eliminarLineaFacturacion,
  agregarAnticipoFacturacion,
  crearRondaFacturacion,
  asignarNumeroFacturaRonda,
  eliminarRondaFacturacion,
} from '../api/client.js'

// Pestaña "Facturación" de una obra aceptada — a pedido de Álvaro,
// 2026-09-23. Hoy esto se lleva a mano en la hoja "Facturación" del
// MEDYSEG.xlsx de cada obra; acá se lleva el mismo registro (líneas,
// rondas de facturación, anticipos) para poder ir generando la proforma o
// la factura directo desde el panel — ver facturacion_obra.php para el
// modelo completo y por qué el anticipo se resuelve distinto que en el
// Excel (ahí es un truco con unidades en -1 y precio negativo; acá es un
// registro aparte con su propio saldo).
//
// El documento que se descarga (generarDocumentoRonda, más abajo) arma un
// .xlsx con las mismas columnas que ya usan (ver EMISOR y las cabeceras de
// la tabla) usando ExcelJS (ya se usa en backend/drive_sync para lo mismo,
// ver enviar_medidas_taller.js) — tiene los datos y el formato de columnas
// correctos, pero no es un clon pixel a pixel del membrete/estilos del
// Excel original (esa librería no lee el archivo real para copiarlo, arma
// uno nuevo). Alcanza para revisar los números y mandarlo, y se puede
// afinar el estilo más adelante si hace falta.

const EMISOR = {
  nombre: 'Gestión de Aluminio y Vidrio, S.L.',
  direccion: 'C/Juan Ramón Jiménez, 2 - Bajo 1',
  localidad: '28036 - Madrid',
  contacto: 'Móvil: 699 14 23 27 · Tlf: 91 344 04 62 · administracion@galvi.es',
  nif: 'N.I.F.: B-84530955',
  cuenta: 'ES35 2100 2530 1813 0054 8475',
}

function formatoFecha(iso) {
  if (!iso) return ''
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

function euros(n) {
  return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function hoyISO() {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
}

function DatosCliente({ obra, accessToken, datos, onCambiado }) {
  const [error, setError] = useState('')

  async function guardar(campos) {
    setError('')
    try {
      await actualizarDatosClienteFacturacion(accessToken, obra, campos)
      onCambiado(campos)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="facturacion-datos-cliente">
      <div className="facturacion-fila-campos">
        <div className="filtro-campo facturacion-campo-ancho">
          <label>Razón social</label>
          <input type="text" className="input-filtro" defaultValue={datos?.razon_social || ''} onBlur={(e) => guardar({ razon_social: e.target.value })} />
        </div>
      </div>
      <div className="facturacion-fila-campos">
        <div className="filtro-campo facturacion-campo-direccion">
          <label>Dirección fiscal</label>
          <input type="text" className="input-filtro" defaultValue={datos?.direccion_fiscal || ''} onBlur={(e) => guardar({ direccion_fiscal: e.target.value })} />
        </div>
      </div>
      <div className="facturacion-fila-campos">
        <div className="filtro-campo">
          <label>NIF / CIF</label>
          <input type="text" className="input-filtro" defaultValue={datos?.nif || ''} onBlur={(e) => guardar({ nif: e.target.value })} />
        </div>
        <div className="filtro-campo">
          <label>IVA %</label>
          <input type="number" step="0.01" className="input-filtro facturacion-input-pct" defaultValue={datos?.iva_pct ?? 21} onBlur={(e) => guardar({ iva_pct: e.target.value })} />
        </div>
        <div className="filtro-campo">
          <label>Retención %</label>
          <input type="number" step="0.01" className="input-filtro facturacion-input-pct" defaultValue={datos?.retencion_pct ?? 0} onBlur={(e) => guardar({ retencion_pct: e.target.value })} />
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
    </div>
  )
}

function FormAgregarLinea({ obra, accessToken, onAgregada }) {
  const [concepto, setConcepto] = useState('')
  const [presupuestoRef, setPresupuestoRef] = useState('')
  const [uds, setUds] = useState('1')
  const [precioUnit, setPrecioUnit] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!concepto.trim() || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarLineaFacturacion(accessToken, obra, {
        concepto: concepto.trim(),
        presupuesto_ref: presupuestoRef.trim(),
        uds: Number(uds) || 1,
        precio_unit: Number(precioUnit) || 0,
      })
      onAgregada(data.linea)
      setConcepto('')
      setPresupuestoRef('')
      setUds('1')
      setPrecioUnit('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="facturacion-form-linea" onSubmit={handleSubmit}>
      <input type="text" className="input-filtro facturacion-input-ref" placeholder="Ref. ppto (opcional)" value={presupuestoRef} onChange={(e) => setPresupuestoRef(e.target.value)} />
      <input type="text" className="input-filtro facturacion-input-concepto" placeholder="Concepto (posición o fuera de presupuesto, ej. chapas)…" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      <input type="number" step="0.01" className="input-filtro facturacion-input-uds" placeholder="Uds" value={uds} onChange={(e) => setUds(e.target.value)} />
      <input type="number" step="0.01" className="input-filtro facturacion-input-precio" placeholder="Precio unit." value={precioUnit} onChange={(e) => setPrecioUnit(e.target.value)} />
      <button type="submit" className="btn-secundario" disabled={enviando || !concepto.trim()}>+ Agregar línea</button>
      {error && <span className="auth-error">{error}</span>}
    </form>
  )
}

function TablaLineas({ lineas, accessToken, onEliminada }) {
  const [error, setError] = useState('')

  async function handleEliminar(linea) {
    if (!window.confirm(`¿Eliminar "${linea.concepto}"? No se puede deshacer.`)) return
    setError('')
    try {
      await eliminarLineaFacturacion(accessToken, linea.id)
      onEliminada(linea.id)
    } catch (err) {
      setError(err.message)
    }
  }

  if (lineas.length === 0) {
    return <p className="dashboard-nota">Todavía no se cargó ninguna línea.</p>
  }

  const totalPresupuesto = lineas.reduce((acc, l) => acc + Number(l.total), 0)
  const totalFacturado = lineas.reduce((acc, l) => acc + Number(l.facturado), 0)
  const totalPendiente = lineas.reduce((acc, l) => acc + Number(l.pendiente), 0)

  return (
    <div className="tabla-scroll">
      <table className="tabla-adicionales facturacion-tabla-lineas">
        <thead>
          <tr>
            <th>Ref. ppto</th>
            <th>Concepto</th>
            <th>Uds</th>
            <th>Precio unit.</th>
            <th>Total</th>
            <th>Facturado</th>
            <th>Pendiente</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.id}>
              <td>{l.presupuesto_ref || '—'}</td>
              <td>{l.concepto}</td>
              <td>{l.uds}</td>
              <td>{euros(l.precio_unit)}</td>
              <td>{euros(l.total)}</td>
              <td>{euros(l.facturado)}</td>
              <td className={Number(l.pendiente) > 0.01 ? 'facturacion-pendiente' : 'facturacion-al-dia'}>{euros(l.pendiente)}</td>
              <td>
                <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar línea" onClick={() => handleEliminar(l)}>−</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="facturacion-fila-totales">
            <td colSpan={4}>Totales</td>
            <td>{euros(totalPresupuesto)}</td>
            <td>{euros(totalFacturado)}</td>
            <td>{euros(totalPendiente)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      {error && <div className="auth-error">{error}</div>}
    </div>
  )
}

function FormAgregarAnticipo({ obra, accessToken, onAgregado }) {
  const [descripcion, setDescripcion] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!monto || Number(monto) <= 0 || enviando) return
    setEnviando(true)
    setError('')
    try {
      const data = await agregarAnticipoFacturacion(accessToken, obra, { descripcion: descripcion.trim(), monto: Number(monto), fecha })
      onAgregado(data.anticipo)
      setDescripcion('')
      setMonto('')
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="facturacion-form-linea" onSubmit={handleSubmit}>
      <input type="text" className="input-filtro facturacion-input-concepto" placeholder="Descripción (ej. Anticipo material)…" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      <input type="date" className="input-filtro input-fecha-limite" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      <input type="number" step="0.01" className="input-filtro facturacion-input-precio" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
      <button type="submit" className="btn-secundario" disabled={enviando || !monto || Number(monto) <= 0}>+ Agregar anticipo</button>
      {error && <span className="auth-error">{error}</span>}
    </form>
  )
}

function Anticipos({ obra, accessToken, anticipos, onCambiados }) {
  return (
    <div className="facturacion-anticipos">
      {anticipos.length === 0 ? (
        <p className="dashboard-nota">Sin anticipos cargados.</p>
      ) : (
        <ul className="facturacion-lista-anticipos">
          {anticipos.map((a) => (
            <li key={a.id} className="facturacion-anticipo-item">
              <span className="facturacion-anticipo-desc">{a.descripcion || 'Anticipo'}</span>
              <span className="facturacion-anticipo-fecha">{formatoFecha(a.fecha)}</span>
              <span>Monto: {euros(a.monto)} €</span>
              <span>Amortizado: {euros(a.amortizado)} €</span>
              <span className={Number(a.saldo) > 0.01 ? 'facturacion-pendiente' : 'facturacion-al-dia'}>Saldo: {euros(a.saldo)} €</span>
            </li>
          ))}
        </ul>
      )}
      <FormAgregarAnticipo obra={obra} accessToken={accessToken} onAgregado={(a) => onCambiados([...anticipos, a])} />
    </div>
  )
}

// Calcula cuánto se facturó de una línea en rondas ANTERIORES a la
// indicada (por número) — lo usa tanto la vista de "Nueva ronda" (para
// mostrar cuánto queda antes de esta) como la generación del documento.
function facturadoAntesDe(lineaId, numeroRonda, rondas) {
  let total = 0
  for (const r of rondas) {
    if (r.numero >= numeroRonda) continue
    const rl = (r.lineas || []).find((x) => x.linea_id === lineaId)
    if (rl) total += Number(rl.importe)
  }
  return total
}

function NuevaRonda({ obra, accessToken, lineas, anticipos, rondas, onCreada }) {
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState('proforma')
  const [fecha, setFecha] = useState(hoyISO())
  const [importes, setImportes] = useState({})
  const [anticipoId, setAnticipoId] = useState('')
  const [montoAmortizar, setMontoAmortizar] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const lineasConPendiente = lineas.filter((l) => Number(l.pendiente) > 0.01)
  const anticiposConSaldo = anticipos.filter((a) => Number(a.saldo) > 0.01)
  const siguienteNumero = rondas.length > 0 ? Math.max(...rondas.map((r) => r.numero)) + 1 : 1

  async function handleSubmit(e) {
    e.preventDefault()
    const lineasRonda = Object.entries(importes)
      .map(([linea_id, importe]) => ({ linea_id: Number(linea_id), importe: Number(importe) || 0 }))
      .filter((l) => l.importe !== 0)
    if (lineasRonda.length === 0 || enviando) return
    setEnviando(true)
    setError('')
    try {
      const amortizaciones = anticipoId && Number(montoAmortizar) > 0
        ? [{ anticipo_id: Number(anticipoId), monto: Number(montoAmortizar) }]
        : []
      const data = await crearRondaFacturacion(accessToken, obra, { tipo, fecha, lineas: lineasRonda, amortizaciones })
      onCreada({ ...data.ronda, lineas: lineasRonda.map((l) => ({ ...l, ronda_id: data.ronda.id })), amortizaciones: amortizaciones.map((a) => ({ ...a, ronda_id: data.ronda.id })) })
      setImportes({})
      setAnticipoId('')
      setMontoAmortizar('')
      setAbierto(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn-secundario" onClick={() => setAbierto(true)} disabled={lineasConPendiente.length === 0}>
        + Nueva ronda de facturación {lineasConPendiente.length === 0 && '(nada pendiente)'}
      </button>
    )
  }

  return (
    <form className="facturacion-nueva-ronda" onSubmit={handleSubmit}>
      <div className="facturacion-fila-campos">
        <div className="filtro-campo">
          <label>Ronda nº</label>
          <span className="facturacion-numero-ronda">{siguienteNumero}</span>
        </div>
        <div className="filtro-campo">
          <label>Tipo</label>
          <select className="select-inline" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="proforma">Proforma</option>
            <option value="factura">Factura</option>
          </select>
        </div>
        <div className="filtro-campo">
          <label>Fecha</label>
          <input type="date" className="input-filtro input-fecha-limite" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      <p className="dashboard-nota">Cuánto facturar de cada línea en esta ronda (importe en €, dejar vacío si no aplica):</p>
      <div className="tabla-scroll">
        <table className="tabla-adicionales facturacion-tabla-lineas">
          <thead>
            <tr>
              <th>Ref. ppto</th>
              <th>Concepto</th>
              <th>Pendiente</th>
              <th>A facturar esta ronda</th>
            </tr>
          </thead>
          <tbody>
            {lineasConPendiente.map((l) => (
              <tr key={l.id}>
                <td>{l.presupuesto_ref || '—'}</td>
                <td>{l.concepto}</td>
                <td>{euros(l.pendiente)}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="input-filtro facturacion-input-precio"
                    placeholder="0.00"
                    value={importes[l.id] ?? ''}
                    onChange={(e) => setImportes((prev) => ({ ...prev, [l.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {anticiposConSaldo.length > 0 && (
        <div className="facturacion-fila-campos">
          <div className="filtro-campo">
            <label>Amortizar anticipo</label>
            <select className="select-inline" value={anticipoId} onChange={(e) => setAnticipoId(e.target.value)}>
              <option value="">Ninguno</option>
              {anticiposConSaldo.map((a) => (
                <option key={a.id} value={a.id}>{a.descripcion || 'Anticipo'} (saldo {euros(a.saldo)} €)</option>
              ))}
            </select>
          </div>
          {anticipoId && (
            <div className="filtro-campo">
              <label>Monto a amortizar</label>
              <input type="number" step="0.01" className="input-filtro facturacion-input-precio" value={montoAmortizar} onChange={(e) => setMontoAmortizar(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}
      <div className="facturacion-nueva-ronda-acciones">
        <button type="submit" className="btn-secundario" disabled={enviando}>Crear ronda</button>
        <button type="button" className="btn-secundario" onClick={() => setAbierto(false)} disabled={enviando}>Cancelar</button>
      </div>
    </form>
  )
}

// Arma el .xlsx de la proforma/factura para una ronda ya creada — mismas
// columnas que el formato real (ver comentario de cabecera), calculando
// para cada línea cuánto se había facturado ANTES de esta ronda y cuánto
// queda pendiente después. Descarga directo en el navegador (no pasa por
// Drive: no hace falta, es un documento para revisar/mandar al toque).
// import() dinámico: ExcelJS pesa bastante (~1MB) y la enorme mayoría de
// las veces que se abre esta pestaña es solo para cargar/revisar líneas,
// no para descargar un documento — así no infla el bundle principal que
// se baja en CADA carga del panel, solo cuando de verdad hace falta.
const MONEY_FMT = '#,##0.00'
const UDS_FMT = '#,##0.00'
const BORDE_FINO = { style: 'thin', color: { argb: 'FFBFBFBF' } }
const BORDE_TABLA = { top: BORDE_FINO, left: BORDE_FINO, bottom: BORDE_FINO, right: BORDE_FINO }
// Últimas 3 (I,J,K en real; acá G,H,I) llevan fondo celeste clarito en el
// original ("Mes") — se marca igual para que salte a la vista cuál es la
// plata de ESTA ronda entre todas las columnas.
const FILL_MES = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FB' } }

async function generarDocumentoRonda({ obra, datosCliente, lineas, ronda, rondas }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(ronda.tipo === 'factura' ? 'Factura' : 'Proforma')
  ws.columns = [
    { width: 40 }, { width: 13 }, { width: 8 }, { width: 14 },
    { width: 13 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 15 },
  ]

  const titulo = ronda.tipo === 'factura' ? 'FACTURA' : 'PROFORMA'
  ws.mergeCells('F1:I1')
  const celdaTitulo = ws.getCell('F1')
  celdaTitulo.value = titulo
  celdaTitulo.font = { bold: true, size: 18 }
  celdaTitulo.alignment = { horizontal: 'center' }

  // Emisor (izquierda) y cliente (derecha), lado a lado — igual que el
  // formato real en vez de todo apilado en una sola columna.
  const filasEmisor = [EMISOR.nombre, EMISOR.direccion, EMISOR.localidad, EMISOR.contacto, EMISOR.nif]
  filasEmisor.forEach((texto, i) => {
    const celda = ws.getCell(`A${2 + i}`)
    celda.value = texto
    if (i === 0) celda.font = { bold: true }
  })

  ws.mergeCells('F2:I2')
  const celdaClienteNombre = ws.getCell('F2')
  celdaClienteNombre.value = datosCliente?.razon_social || 'Cliente sin datos cargados'
  celdaClienteNombre.font = { bold: true }
  if (datosCliente?.direccion_fiscal) {
    ws.mergeCells('F3:I3')
    ws.getCell('F3').value = datosCliente.direccion_fiscal
  }

  ws.getCell('F5').value = 'FECHA:'
  ws.getCell('F5').font = { bold: true }
  ws.getCell('G5').value = formatoFecha(ronda.fecha)
  ws.getCell('F6').value = ronda.tipo === 'factura' ? 'Nº FACTURA:' : 'Nº PROFORMA:'
  ws.getCell('F6').font = { bold: true }
  ws.getCell('G6').value = ronda.numero_factura || `(ronda ${ronda.numero})`
  if (datosCliente?.nif) {
    ws.getCell('F7').value = 'NIF/CIF:'
    ws.getCell('F7').font = { bold: true }
    ws.getCell('G7').value = datosCliente.nif
  }

  ws.getCell('A9').value = `Ref: ${obra}`
  ws.getCell('A9').font = { bold: true }

  // Fila de agrupación arriba de los encabezados de columna — "Presupuestado"
  // / "Origen" / "Mes", igual que el original (ahí es donde más se nota la
  // diferencia si falta: sin esto la tabla se ve toda al mismo nivel).
  const filaGrupo = 11
  ws.mergeCells(filaGrupo, 2, filaGrupo, 4)
  ws.mergeCells(filaGrupo, 5, filaGrupo, 6)
  ws.mergeCells(filaGrupo, 7, filaGrupo, 9)
  ;[[2, 'Presupuestado'], [5, 'Origen'], [7, 'Mes']].forEach(([col, texto]) => {
    const celda = ws.getRow(filaGrupo).getCell(col)
    celda.value = texto
    celda.font = { bold: true, italic: true }
    celda.alignment = { horizontal: 'center' }
  })

  const encabezados = ['CONCEPTO', 'IMPORTE UNIT.', 'UDS.', 'TOTAL A FACTURAR', 'FACT. ANTERIOR', 'UDS FACTURADAS', 'UDS PENDIENTES', 'UDS MENSUAL', 'TOTAL FACTURAR MES ACTUAL']
  const filaEncabezado = ws.getRow(filaGrupo + 1)
  encabezados.forEach((texto, i) => {
    const celda = filaEncabezado.getCell(i + 1)
    celda.value = texto
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } }
    celda.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', wrapText: true }
    celda.border = BORDE_TABLA
  })
  filaEncabezado.height = 30

  let filaActual = filaGrupo + 2
  let baseImponible = 0
  let facturacionOrigen = 0
  for (const l of lineas) {
    const importeEstaRonda = (ronda.lineas || []).find((rl) => rl.linea_id === l.id)?.importe || 0
    if (importeEstaRonda === 0 && Number(l.total) === 0) continue
    const factAnterior = facturadoAntesDe(l.id, ronda.numero, rondas)
    const udsTotal = Number(l.uds)
    const precioUnit = Number(l.precio_unit)
    const udsFacturadas = precioUnit > 0 ? (factAnterior + importeEstaRonda) / precioUnit : 0
    const udsMensual = precioUnit > 0 ? importeEstaRonda / precioUnit : 0
    const udsPendientes = udsTotal - udsFacturadas

    const fila = ws.getRow(filaActual)
    fila.getCell(1).value = l.concepto
    fila.getCell(2).value = precioUnit
    fila.getCell(3).value = udsTotal
    fila.getCell(4).value = Number(l.total)
    fila.getCell(5).value = factAnterior
    fila.getCell(6).value = udsFacturadas
    fila.getCell(7).value = udsPendientes
    fila.getCell(8).value = udsMensual
    fila.getCell(9).value = importeEstaRonda
    for (let c = 1; c <= 9; c++) {
      const celda = fila.getCell(c)
      celda.border = BORDE_TABLA
      if (c === 2 || c === 4 || c === 5 || c === 9) celda.numFmt = MONEY_FMT
      if (c === 3 || c === 6 || c === 7 || c === 8) celda.numFmt = UDS_FMT
      if (c >= 7) celda.fill = FILL_MES
      if (c >= 2) celda.alignment = { horizontal: 'right' }
    }
    filaActual++

    baseImponible += importeEstaRonda
    facturacionOrigen += factAnterior
  }

  filaActual += 1
  ws.getCell(`A${filaActual}`).value = 'Nº de Cuenta:'
  ws.getCell(`A${filaActual}`).font = { bold: true }
  ws.getCell(`B${filaActual}`).value = EMISOR.cuenta
  filaActual += 2

  let amortizacionTotal = 0
  for (const am of ronda.amortizaciones || []) {
    amortizacionTotal += Number(am.monto)
  }
  if (amortizacionTotal > 0) {
    ws.getCell(`A${filaActual}`).value = 'Amortización de anticipo'
    ws.getCell(`A${filaActual}`).font = { italic: true }
    const celdaMonto = ws.getCell(`I${filaActual}`)
    celdaMonto.value = -amortizacionTotal
    celdaMonto.numFmt = MONEY_FMT
    celdaMonto.font = { italic: true }
    filaActual++
  }

  const baseTrasAnticipo = baseImponible - amortizacionTotal
  const ivaPct = Number(datosCliente?.iva_pct ?? 21)
  const retencionPct = Number(datosCliente?.retencion_pct ?? 0)
  const ivaMonto = baseTrasAnticipo * (ivaPct / 100)
  const retencionMonto = baseTrasAnticipo * (retencionPct / 100)
  const totalFacturar = baseTrasAnticipo + ivaMonto - retencionMonto

  function filaTotalCon(etiqueta, valorCol, colLetra, opciones = {}) {
    ws.getCell(`A${filaActual}`).value = etiqueta
    ws.getCell(`A${filaActual}`).font = { bold: !!opciones.bold }
    const celda = ws.getCell(`${colLetra}${filaActual}`)
    celda.value = valorCol
    celda.numFmt = MONEY_FMT
    celda.font = { bold: !!opciones.bold, size: opciones.size }
    if (opciones.etiqueta2) {
      ws.getCell(`B${filaActual}`).value = opciones.etiqueta2
    }
    filaActual++
  }

  filaTotalCon('PREVISIÓN DE FACTURACIÓN SEGÚN PRESUPUESTO', lineas.reduce((acc, l) => acc + Number(l.total), 0), 'D')
  if (facturacionOrigen > 0) {
    filaTotalCon('FACTURACIÓN ORIGEN (RONDAS ANTERIORES)', facturacionOrigen, 'E')
  }
  filaTotalCon('BASE IMPONIBLE (ESTA RONDA)', baseTrasAnticipo, 'I', { bold: true })
  filaTotalCon('IVA', ivaMonto, 'I', { etiqueta2: `${ivaPct}%` })
  filaTotalCon('RETENCIÓN', -retencionMonto, 'I', { etiqueta2: `${retencionPct}%` })
  filaTotalCon('TOTAL A FACTURAR', totalFacturar, 'I', { bold: true, size: 13 })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const nombreArchivo = `${ronda.tipo === 'factura' ? 'FACTURA' : 'PROFORMA'} - ${obra} - ronda ${ronda.numero}.xlsx`
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function HistorialRondas({ obra, accessToken, rondas, lineas, datosCliente, onCambiadas }) {
  const [error, setError] = useState('')
  const [descargando, setDescargando] = useState(null)

  async function handleDescargar(ronda) {
    setDescargando(ronda.id)
    setError('')
    try {
      await generarDocumentoRonda({ obra, datosCliente, lineas, ronda, rondas })
    } catch (err) {
      setError(err.message)
    } finally {
      setDescargando(null)
    }
  }

  async function handleAsignarNumero(ronda) {
    const numero = window.prompt('Número de factura asignado por Contabilidad (ej. 089-2026):', ronda.numero_factura || '')
    if (numero === null) return
    setError('')
    try {
      await asignarNumeroFacturaRonda(accessToken, ronda.id, numero)
      onCambiadas(rondas.map((r) => (r.id === ronda.id ? { ...r, numero_factura: numero } : r)))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleEliminar(ronda) {
    if (!window.confirm(`¿Eliminar la ronda ${ronda.numero}? No se puede deshacer.`)) return
    setError('')
    try {
      await eliminarRondaFacturacion(accessToken, ronda.id)
      onCambiadas(rondas.filter((r) => r.id !== ronda.id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (rondas.length === 0) {
    return <p className="dashboard-nota">Todavía no se cargó ninguna ronda de facturación.</p>
  }

  return (
    <div className="facturacion-historial">
      {error && <div className="auth-error">{error}</div>}
      <ul className="facturacion-lista-rondas">
        {[...rondas].sort((a, b) => b.numero - a.numero).map((r) => {
          const total = (r.lineas || []).reduce((acc, l) => acc + Number(l.importe), 0)
          return (
            <li key={r.id} className="facturacion-ronda-item">
              <span className="facturacion-ronda-numero">Ronda {r.numero}</span>
              <span className={`facturacion-ronda-tipo facturacion-ronda-tipo-${r.tipo}`}>{r.tipo === 'factura' ? 'Factura' : 'Proforma'}</span>
              <span>{formatoFecha(r.fecha)}</span>
              <span>{euros(total)} €</span>
              <span className="facturacion-ronda-numero-factura">{r.numero_factura ? `Nº ${r.numero_factura}` : 'Sin número asignado'}</span>
              <button type="button" className="btn-secundario" onClick={() => handleDescargar(r)} disabled={descargando === r.id}>
                {descargando === r.id ? 'Generando…' : '⬇ Descargar'}
              </button>
              {r.tipo === 'factura' && (
                <button type="button" className="btn-secundario" onClick={() => handleAsignarNumero(r)}>Nº factura</button>
              )}
              <button type="button" className="boton-icono boton-icono-eliminar" title="Eliminar ronda" onClick={() => handleEliminar(r)}>−</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Resumen general arriba de todo (a pedido de Álvaro, 2026-09-23): antes
// había que bajar hasta la tabla de Líneas y volver a subir para armar una
// ronda, solo para acordarse de cuánto era el total del presupuesto y
// cuánto quedaba pendiente — esto deja esos tres números a la vista todo
// el tiempo, arriba de Datos del cliente/Anticipos.
function ResumenPresupuesto({ lineas }) {
  const totalPresupuesto = lineas.reduce((acc, l) => acc + Number(l.total), 0)
  const totalFacturado = lineas.reduce((acc, l) => acc + Number(l.facturado), 0)
  const totalPendiente = lineas.reduce((acc, l) => acc + Number(l.pendiente), 0)
  const pctFacturado = totalPresupuesto > 0 ? (totalFacturado / totalPresupuesto) * 100 : 0

  return (
    <div className="facturacion-resumen">
      <div className="facturacion-resumen-item">
        <span className="facturacion-resumen-etiqueta">Presupuesto</span>
        <span className="facturacion-resumen-valor">{euros(totalPresupuesto)} €</span>
      </div>
      <div className="facturacion-resumen-item">
        <span className="facturacion-resumen-etiqueta">Facturado</span>
        <span className="facturacion-resumen-valor facturacion-al-dia">{euros(totalFacturado)} €</span>
      </div>
      <div className="facturacion-resumen-item">
        <span className="facturacion-resumen-etiqueta">Pendiente</span>
        <span className="facturacion-resumen-valor facturacion-pendiente">{euros(totalPendiente)} €</span>
      </div>
      <div className="facturacion-resumen-barra">
        <div className="facturacion-resumen-barra-relleno" style={{ width: `${Math.min(100, pctFacturado)}%` }} />
      </div>
      <span className="facturacion-resumen-pct">{pctFacturado.toFixed(1)}% facturado</span>
    </div>
  )
}

export default function FacturacionObra({ obra, accessToken }) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true
    setCargando(true)
    facturacionObra(accessToken, obra)
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

  if (cargando) return <p className="dashboard-nota">Cargando…</p>
  if (error) return <div className="auth-error">{error}</div>
  if (!datos) return null

  return (
    <div className="facturacion-obra">
      <ResumenPresupuesto lineas={datos.lineas} />

      <div className="facturacion-fila-superior">
        <div className="facturacion-columna">
          <h3 className="montaje-subtitulo">Datos del cliente</h3>
          <DatosCliente
            obra={obra}
            accessToken={accessToken}
            datos={datos.datos_cliente}
            onCambiado={(campos) => setDatos((prev) => ({ ...prev, datos_cliente: { ...prev.datos_cliente, ...campos } }))}
          />
        </div>
        <div className="facturacion-columna">
          <h3 className="montaje-subtitulo">Anticipos</h3>
          <Anticipos
            obra={obra}
            accessToken={accessToken}
            anticipos={datos.anticipos || []}
            onCambiados={(anticipos) => setDatos((prev) => ({ ...prev, anticipos }))}
          />
        </div>
      </div>

      <h3 className="montaje-subtitulo">Líneas</h3>
      <TablaLineas
        lineas={datos.lineas}
        accessToken={accessToken}
        onEliminada={(id) => setDatos((prev) => ({ ...prev, lineas: prev.lineas.filter((l) => l.id !== id) }))}
      />
      <FormAgregarLinea obra={obra} accessToken={accessToken} onAgregada={(l) => setDatos((prev) => ({ ...prev, lineas: [...prev.lineas, l] }))} />

      <h3 className="montaje-subtitulo">Rondas de facturación</h3>
      <NuevaRonda
        obra={obra}
        accessToken={accessToken}
        lineas={datos.lineas}
        anticipos={datos.anticipos || []}
        rondas={datos.rondas || []}
        onCreada={(ronda) => {
          setDatos((prev) => {
            const rondas = [...(prev.rondas || []), ronda]
            const lineas = prev.lineas.map((l) => {
              const rl = (ronda.lineas || []).find((x) => x.linea_id === l.id)
              if (!rl) return l
              const facturado = Number(l.facturado) + Number(rl.importe)
              return { ...l, facturado, pendiente: Number(l.total) - facturado }
            })
            const anticipos = (prev.anticipos || []).map((a) => {
              const am = (ronda.amortizaciones || []).find((x) => x.anticipo_id === a.id)
              if (!am) return a
              const amortizado = Number(a.amortizado) + Number(am.monto)
              return { ...a, amortizado, saldo: Number(a.monto) - amortizado }
            })
            return { ...prev, rondas, lineas, anticipos }
          })
        }}
      />
      <HistorialRondas
        obra={obra}
        accessToken={accessToken}
        rondas={datos.rondas || []}
        lineas={datos.lineas}
        datosCliente={datos.datos_cliente}
        onCambiadas={(rondas) => setDatos((prev) => ({ ...prev, rondas }))}
      />
    </div>
  )
}
