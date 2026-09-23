import { useEffect, useState } from 'react'
import logoGalvi from '../assets/logo_galvi_factura.png'
import carlitoRegularUrl from '../assets/carlito-regular.ttf'
import carlitoBoldUrl from '../assets/carlito-bold.ttf'
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
  movil: 'Móvil: 699 14 23 27',
  telefono: 'Tlf: 91 344 04 62',
  fax: 'Fax: 91 344 08 83',
  email: 'administracion@galvi.es',
  nif: 'N.I.F.: B-84530955',
  cuenta: 'ES35 2100 2530 1813 0054 8475',
  registroMercantil: 'Inscrita en el Registro Mercantil de Madrid, Tomo 22.071, libro 0, folio 59 de la Sección 8, hoja nº M-393689, inscripción 1ª',
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
  // A pedido de Álvaro (2026-09-23): en vez de escribir el importe línea por
  // línea a mano, se puede tildar un grupo de posiciones y aplicarles un
  // % de golpe (sobre el TOTAL de cada línea, mismo criterio que "Uds
  // Mensual" en el MEDYSEG — un % del total, no del pendiente) — el importe
  // sigue siendo editable a mano después para ajustar puntualmente alguna.
  const [seleccionadas, setSeleccionadas] = useState(() => new Set())
  const [porcentaje, setPorcentaje] = useState('')

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
      setSeleccionadas(new Set())
      setPorcentaje('')
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

  function alternarSeleccion(id) {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev)
      if (nuevo.has(id)) nuevo.delete(id)
      else nuevo.add(id)
      return nuevo
    })
  }

  function alternarTodas() {
    setSeleccionadas((prev) => (
      prev.size === lineasConPendiente.length ? new Set() : new Set(lineasConPendiente.map((l) => l.id))
    ))
  }

  function aplicarPorcentaje() {
    const pct = Number(porcentaje)
    if (!pct || seleccionadas.size === 0) return
    setImportes((prev) => {
      const nuevo = { ...prev }
      for (const l of lineasConPendiente) {
        if (!seleccionadas.has(l.id)) continue
        nuevo[l.id] = (Number(l.total) * (pct / 100)).toFixed(2)
      }
      return nuevo
    })
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

      <p className="dashboard-nota">Cuánto facturar de cada línea en esta ronda (importe en €, dejar vacío si no aplica) — tildá varias y aplicales un % de golpe, o escribí el importe línea por línea:</p>

      <div className="facturacion-fila-campos facturacion-aplicar-pct">
        <div className="filtro-campo">
          <label>% a aplicar</label>
          <input
            type="number"
            step="0.01"
            className="input-filtro facturacion-input-pct"
            placeholder="0"
            value={porcentaje}
            onChange={(e) => setPorcentaje(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-secundario"
          onClick={aplicarPorcentaje}
          disabled={!porcentaje || Number(porcentaje) <= 0 || seleccionadas.size === 0}
        >
          Aplicar a {seleccionadas.size} seleccionada{seleccionadas.size === 1 ? '' : 's'}
        </button>
      </div>

      <div className="tabla-scroll">
        <table className="tabla-adicionales facturacion-tabla-lineas">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={seleccionadas.size > 0 && seleccionadas.size === lineasConPendiente.length}
                  onChange={alternarTodas}
                  title="Seleccionar todas"
                />
              </th>
              <th>Ref. ppto</th>
              <th>Concepto</th>
              <th>Pendiente</th>
              <th>A facturar esta ronda</th>
            </tr>
          </thead>
          <tbody>
            {lineasConPendiente.map((l) => (
              <tr key={l.id} className={seleccionadas.has(l.id) ? 'facturacion-fila-seleccionada' : ''}>
                <td>
                  <input type="checkbox" checked={seleccionadas.has(l.id)} onChange={() => alternarSeleccion(l.id)} />
                </td>
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

// Arma el .xlsx de la proforma/factura para una ronda ya creada — a pedido
// de Álvaro (2026-09-23): "dejalo como el que ya tenemos, con el logo, el
// tipo de letra y demás" — esto ya NO es un diseño propio, es una réplica
// celda a celda del formato real que usa Contabilidad (columnas, fuentes,
// anchos, colores de fondo, bordes y el logo), sacada inspeccionando un
// archivo real ya emitido (GALVI FRA 089-2026, obra Azalea) con ExcelJS
// para copiar exactamente qué lleva cada celda. El color de fondo celeste
// (FF21AEB1) es el color de marca que ya usan en cabeceras/agrupadores/
// total final; el logo (logo_galvi_factura.png) se extrajo de ese mismo
// archivo real.
// import() dinámico: ExcelJS pesa bastante (~1MB) y la enorme mayoría de
// las veces que se abre esta pestaña es solo para cargar/revisar líneas,
// no para descargar un documento — así no infla el bundle principal que
// se baja en CADA carga del panel, solo cuando de verdad hace falta.
const MONEY_FMT = '#,##0.00'
const UDS_FMT = '#,##0.00'
const PCT_FMT = '0%'
const TEAL = 'FF21AEB1'
// Color real del texto de datos en el archivo original — se verificó
// abriendo el .xlsx real con Excel (no es un tono "de marca" inventado,
// es gris 50% liso, Font.Color = RGB(128,128,128) / ColorIndex 16).
const TEXTO_MARCA = 'FF808080'
const BORDE_FINO = { style: 'thin', color: { argb: 'FFBFBFBF' } }

function splitDireccionFiscal(direccion) {
  if (!direccion) return ['', '']
  const idx = direccion.lastIndexOf(',')
  if (idx === -1) return [direccion, '']
  return [direccion.slice(0, idx + 1).trim(), direccion.slice(idx + 1).trim()]
}

async function generarDocumentoRonda({ obra, datosCliente, lineas, ronda, rondas }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(ronda.tipo === 'factura' ? 'Factura' : 'Proforma')
  ws.properties.defaultRowHeight = 12
  ws.columns = [
    { width: 1.875 }, { width: 31.125 }, { width: 7.875 }, { width: 5.375 }, { width: 9 },
    { width: 8.5 }, { width: 6.25 }, { width: 8.125 }, { width: 6.875 }, { width: 9.5 }, { width: 1.25 },
  ]

  // Logo real (extraído del archivo de Contabilidad) anclado igual que en
  // el original: fila 1, arrancando en la columna B.
  const logoBuffer = await (await fetch(logoGalvi)).arrayBuffer()
  const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' })
  ws.addImage(logoId, { tl: { col: 1, row: 0 }, ext: { width: 216, height: 113 } })
  ws.getRow(1).height = 87

  const titulo = ronda.tipo === 'factura' ? 'FACTURA' : 'PROFORMA'
  ws.mergeCells('G1:J1')
  const celdaTitulo = ws.getCell('G1')
  celdaTitulo.value = titulo
  celdaTitulo.font = { name: 'Calibri (Cuerpo)', bold: true, size: 20, color: { argb: TEXTO_MARCA } }
  celdaTitulo.alignment = { horizontal: 'center', vertical: 'middle' }

  // Emisor (columna B, filas 2-9) y cliente (columna J, filas 3-5) — misma
  // disposición y alineación que el original (emisor a la izquierda,
  // cliente a la derecha), pero a pedido de Álvaro (2026-09-23) con
  // Calibri (Cuerpo) en vez de Calibri liso y sin ninguna letra negra:
  // todo el bloque de arriba (título, emisor, cliente, fecha/nº/nif,
  // referencia de obra) usa el mismo gris de marca.
  const fuenteEmisor = { name: 'Calibri (Cuerpo)', size: 9, bold: true, color: { argb: TEXTO_MARCA } }
  ;[[2, EMISOR.nombre], [3, EMISOR.direccion], [4, EMISOR.localidad], [5, EMISOR.movil], [6, EMISOR.telefono], [7, EMISOR.fax], [8, EMISOR.email], [9, EMISOR.nif]].forEach(([fila, texto]) => {
    const celda = ws.getCell(`B${fila}`)
    celda.value = texto
    celda.font = fuenteEmisor
    celda.alignment = { horizontal: 'left', vertical: 'middle' }
  })

  const fuenteCliente = { name: 'Calibri (Cuerpo)', size: 11, bold: true, color: { argb: TEXTO_MARCA } }
  const [direccionLinea1, direccionLinea2] = splitDireccionFiscal(datosCliente?.direccion_fiscal)
  ws.getCell('J3').value = datosCliente?.razon_social || 'Cliente sin datos cargados'
  ws.getCell('J4').value = direccionLinea1
  ws.getCell('J5').value = direccionLinea2
  ;['J3', 'J4', 'J5'].forEach((addr) => {
    ws.getCell(addr).font = fuenteCliente
    ws.getCell(addr).alignment = { horizontal: 'right', vertical: 'middle' }
  })

  const fuenteDato = { name: 'Calibri (Cuerpo)', size: 11, bold: true, color: { argb: TEXTO_MARCA } }
  ws.getCell('H9').value = 'FECHA:'
  ws.getCell('H9').font = fuenteDato
  ws.mergeCells('I9:J9')
  ws.getCell('I9').value = formatoFecha(ronda.fecha)
  ws.getCell('I9').font = fuenteDato
  ws.getCell('I9').alignment = { horizontal: 'center' }

  ws.getCell('H10').value = ronda.tipo === 'factura' ? 'Nº FACTURA:' : 'Nº PROFORMA:'
  ws.getCell('H10').font = fuenteDato
  ws.getCell('J10').value = ronda.numero_factura || ''
  ws.getCell('J10').font = fuenteDato

  ws.getCell('H11').value = 'NIF:'
  ws.getCell('H11').font = fuenteDato
  ws.mergeCells('J11:K11')
  ws.getCell('J11').value = datosCliente?.nif || ''
  ws.getCell('J11').font = fuenteDato

  ws.mergeCells('B13:J13')
  ws.getCell('B13').value = `Ref: ${obra}`
  ws.getCell('B13').font = { name: 'Calibri (Cuerpo)', size: 11, bold: true, color: { argb: TEXTO_MARCA } }
  ws.getCell('B13').alignment = { horizontal: 'center', vertical: 'middle' }

  // Fila de agrupación ("Presupuestado" / "Origen" / "Mes") y cabecera de
  // columnas — mismo fondo celeste de marca y mismos tamaños de letra por
  // columna que el archivo real (por eso varían entre 5 y 8pt).
  ws.getRow(14).height = 23.25
  const gruposFila14 = [['C14:E14', 'Presupuestado'], ['F14:H14', 'Origen'], ['I14:J14', 'Mes']]
  gruposFila14.forEach(([rango, texto]) => {
    ws.mergeCells(rango)
    const primeraCol = rango.split(':')[0]
    const celda = ws.getCell(primeraCol)
    celda.value = texto
    celda.font = { name: 'Calibri', bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    const [, colIni, colFin] = rango.match(/^([A-Z]+)\d+:([A-Z]+)\d+$/)
    for (let c = colIni.charCodeAt(0); c <= colFin.charCodeAt(0); c++) {
      const cel = ws.getCell(`${String.fromCharCode(c)}14`)
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cel.border = { bottom: BORDE_FINO, left: c === colIni.charCodeAt(0) ? BORDE_FINO : undefined }
    }
  })

  ws.getRow(15).height = 31.5
  const encabezados = [
    ['B', 'CONCEPTO', 8], ['C', 'IMPORTE UNIT.', 6], ['D', 'UDS.', 6], ['E', ' TOTAL  A FACTURAR', 6],
    ['F', 'FACT. ANTERIOR', 6], ['G', 'UDS FACTURADAS', 5], ['H', 'UDS PENDIENTES', 6],
    ['I', ' UDS MENSUAL', 6], ['J', 'TOTAL FACTURAR MES ACTUAL', 5],
  ]
  encabezados.forEach(([col, texto, size]) => {
    const celda = ws.getCell(`${col}15`)
    celda.value = texto
    celda.font = { name: 'Calibri', bold: true, size, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    celda.border = { top: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO }
  })

  let filaActual = 16
  let baseImponible = 0
  let facturacionOrigen = 0
  const fuenteLinea = { name: 'Calibri', bold: true, size: 9, color: { argb: TEXTO_MARCA } }
  const fuenteConcepto = { name: 'Calibri', bold: true, size: 8, color: { argb: TEXTO_MARCA } }
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
    const valores = {
      B: [l.concepto, fuenteConcepto, undefined, { horizontal: 'left', vertical: 'middle', wrapText: true }, { left: BORDE_FINO, right: BORDE_FINO }],
      C: [precioUnit, fuenteLinea, MONEY_FMT, { horizontal: 'right', vertical: 'middle' }, { right: BORDE_FINO }],
      D: [udsTotal, fuenteLinea, '#,##0', { horizontal: 'right', vertical: 'middle' }, { right: BORDE_FINO }],
      E: [Number(l.total), fuenteLinea, MONEY_FMT, { horizontal: 'right', vertical: 'middle' }, { right: BORDE_FINO }],
      F: [factAnterior, fuenteLinea, MONEY_FMT, { horizontal: 'right', vertical: 'middle' }, { right: BORDE_FINO }],
      G: [udsFacturadas, fuenteLinea, UDS_FMT, { horizontal: 'right', vertical: 'middle' }, { right: BORDE_FINO }],
      H: [udsPendientes, fuenteLinea, UDS_FMT, { horizontal: 'right', vertical: 'middle' }, { left: BORDE_FINO, right: BORDE_FINO }],
      I: [udsMensual, fuenteLinea, '0.00', { horizontal: 'right', vertical: 'middle' }, { right: BORDE_FINO }],
      J: [importeEstaRonda, fuenteLinea, MONEY_FMT, { horizontal: 'right', vertical: 'middle' }, { left: BORDE_FINO, right: BORDE_FINO }],
    }
    for (const [col, [valor, font, numFmt, alignment, border]] of Object.entries(valores)) {
      const celda = fila.getCell(col)
      celda.value = valor
      celda.font = font
      if (numFmt) celda.numFmt = numFmt
      celda.alignment = alignment
      celda.border = border
    }
    filaActual++

    baseImponible += importeEstaRonda
    facturacionOrigen += factAnterior
  }

  filaActual += 1
  const ivaPct = Number(datosCliente?.iva_pct ?? 21)
  // "Operación sujeta a inversión del sujeto pasivo" — en el archivo real
  // (ver GALVI FRA 007-2026, obra sujeta a IVA 0%) va JUSTO arriba del
  // Nº de Cuenta, no al final del documento.
  if (ivaPct === 0) {
    ws.getCell(`B${filaActual}`).value = 'Operación sujeta a inversión del sujeto pasivo Articulo 84.1,2(s)'
    ws.getCell(`B${filaActual}`).font = { name: 'Calibri', bold: true, size: 8, color: { argb: TEXTO_MARCA } }
    ws.getCell(`B${filaActual}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    filaActual += 2
  }

  ws.getCell(`B${filaActual}`).value = `Nº de Cuenta: ${EMISOR.cuenta}`
  ws.getCell(`B${filaActual}`).font = { name: 'Calibri', bold: true, size: 8, color: { argb: TEXTO_MARCA } }
  filaActual += 2

  let amortizacionTotal = 0
  for (const am of ronda.amortizaciones || []) {
    amortizacionTotal += Number(am.monto)
  }
  if (amortizacionTotal > 0) {
    ws.getCell(`B${filaActual}`).value = 'Amortización de anticipo'
    ws.getCell(`B${filaActual}`).font = { name: 'Calibri', italic: true, size: 8, color: { argb: TEXTO_MARCA } }
    const celdaMonto = ws.getCell(`J${filaActual}`)
    celdaMonto.value = -amortizacionTotal
    celdaMonto.numFmt = MONEY_FMT
    celdaMonto.font = { name: 'Calibri', italic: true, size: 9, color: { argb: TEXTO_MARCA } }
    filaActual++
  }

  const baseTrasAnticipo = baseImponible - amortizacionTotal
  const retencionPct = Number(datosCliente?.retencion_pct ?? 0)
  const ivaMonto = baseTrasAnticipo * (ivaPct / 100)
  const retencionMonto = baseTrasAnticipo * (retencionPct / 100)
  const totalFacturar = baseTrasAnticipo + ivaMonto - retencionMonto

  // A pedido de Álvaro (2026-09-23): el bloque de totales del original va
  // recuadrado entero (cada celda B:J con borde fino, como una mini-tabla),
  // no solo la fila del total — y esa última fila (TOTAL A FACTURAR) va
  // coloreada de punta a punta, no solo la celda con el importe.
  const BORDE_CAJA = { top: BORDE_FINO, left: BORDE_FINO, bottom: BORDE_FINO, right: BORDE_FINO }
  function filaTotalCon(etiqueta, valorCol, colLetra, opciones = {}) {
    const fila = ws.getRow(filaActual)
    fila.height = opciones.height || 15.75
    for (let c = 2; c <= 10; c++) {
      const cel = fila.getCell(c)
      cel.border = BORDE_CAJA
      if (opciones.fillFullRow) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
    }
    const relleno = opciones.fillFullRow || opciones.fillValue
    const celdaLabel = ws.getCell(`B${filaActual}`)
    celdaLabel.value = etiqueta
    celdaLabel.font = { name: 'Calibri (Cuerpo)', bold: true, size: 8, color: { argb: opciones.fillFullRow ? 'FFFFFFFF' : TEXTO_MARCA } }
    celdaLabel.alignment = { vertical: 'middle', wrapText: true }
    const celda = ws.getCell(`${colLetra}${filaActual}`)
    celda.value = valorCol
    celda.numFmt = MONEY_FMT
    celda.font = { name: 'Calibri (Cuerpo)', bold: !!opciones.bold, size: opciones.size || 9, color: relleno ? { argb: 'FFFFFFFF' } : { argb: TEXTO_MARCA } }
    if (opciones.fillValue && !opciones.fillFullRow) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
    if (opciones.pct !== undefined) {
      const celdaPct = ws.getCell(`C${filaActual}`)
      celdaPct.value = opciones.pct / 100
      celdaPct.numFmt = PCT_FMT
      celdaPct.font = { name: 'Calibri (Cuerpo)', size: 9, color: { argb: TEXTO_MARCA } }
      celdaPct.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    filaActual++
  }

  filaTotalCon('PREVISIÓN DE FACTURACIÓN SEGÚN PRESUPUESTO', lineas.reduce((acc, l) => acc + Number(l.total), 0), 'E', { height: 21 })
  filaTotalCon('FACTURACIÓN ORIGEN (MESES ANTERIORES)', facturacionOrigen, 'F', { height: 19.5 })
  filaTotalCon('BASE IMPONIBLE (MES ACTUAL)', baseTrasAnticipo, 'J', { bold: true, fillValue: true })
  filaTotalCon('IVA', ivaMonto, 'J', { pct: ivaPct })
  filaTotalCon('RETENCIÓN', -retencionMonto, 'J', { pct: retencionPct })
  filaTotalCon('TOTAL A FACTURAR', totalFacturar, 'J', { bold: true, fillFullRow: true })

  // Franja vertical decorativa del original: el dato del Registro Mercantil
  // de GALVI corriendo rotado 90º por el borde izquierdo de toda la tabla
  // (columna A, de la primera línea hasta la última fila con contenido).
  ws.mergeCells(`A16:A${filaActual - 1}`)
  const celdaRegistro = ws.getCell('A16')
  celdaRegistro.value = EMISOR.registroMercantil
  celdaRegistro.font = { name: 'Calibri', size: 7, color: { argb: TEXTO_MARCA } }
  celdaRegistro.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 }
  celdaRegistro.border = { right: BORDE_FINO }

  ws.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 1, orientation: 'portrait', paperSize: 9, showGridLines: false }

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

function arrayBufferABase64(buffer) {
  let binario = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binario += String.fromCharCode(bytes[i])
  return btoa(binario)
}

// Versión PDF de la misma ronda — a pedido de Álvaro (2026-09-23), para
// tener las dos opciones de descarga en el panel con el mismo aspecto que
// el .xlsx: mismo logo, mismo gris de marca (sin letras negras en ningún
// lado), mismos tamaños por bloque (emisor 9, cliente 11, título 20,
// referencia de obra 11) y la misma tipografía — Carlito, que es la
// fuente libre métricamente compatible con Calibri (la usa LibreOffice
// como reemplazo), embebida acá porque Calibri en sí es una fuente
// propietaria de Microsoft que no se puede redistribuir.
const TEAL_RGB = [0x21, 0xae, 0xb1]
const GRIS_RGB = [0x80, 0x80, 0x80]
const BORDE_RGB = [191, 191, 191]
// Límites de columna en mm (10 bordes = 9 columnas: CONCEPTO, IMPORTE UNIT.,
// UDS., TOTAL A FACTURAR, FACT. ANTERIOR, UDS FACTURADAS, UDS PENDIENTES,
// UDS MENSUAL, TOTAL MES ACTUAL) — las mismas para la tabla de líneas Y
// para el bloque de totales de abajo, así el PDF queda igual de "escalonado"
// que el .xlsx (cada total cae bajo la columna que le corresponde, no todo
// amontonado en una sola columna de "valor").
const COLS_X = [14, 60, 77, 89, 107, 125, 143, 161, 178, 196]

async function registrarCarlito(doc) {
  const [regularBuffer, boldBuffer] = await Promise.all([
    fetch(carlitoRegularUrl).then((r) => r.arrayBuffer()),
    fetch(carlitoBoldUrl).then((r) => r.arrayBuffer()),
  ])
  doc.addFileToVFS('Carlito-Regular.ttf', arrayBufferABase64(regularBuffer))
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal')
  doc.addFileToVFS('Carlito-Bold.ttf', arrayBufferABase64(boldBuffer))
  doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold')
  doc.setFont('Carlito', 'normal')
}

async function generarPdfRonda({ obra, datosCliente, lineas, ronda, rondas }) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  await registrarCarlito(doc)

  const logoBuffer = await (await fetch(logoGalvi)).arrayBuffer()
  const logoBase64 = `data:image/png;base64,${arrayBufferABase64(logoBuffer)}`
  doc.addImage(logoBase64, 'PNG', 14, 10, 36, 18.8)

  const titulo = ronda.tipo === 'factura' ? 'FACTURA' : 'PROFORMA'
  doc.setFont('Carlito', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...GRIS_RGB)
  doc.text(titulo, 196, 22, { align: 'right' })

  doc.setFontSize(9)
  ;[EMISOR.nombre, EMISOR.direccion, EMISOR.localidad, EMISOR.movil, EMISOR.telefono, EMISOR.fax, EMISOR.email, EMISOR.nif].forEach((texto, i) => {
    doc.text(texto, 14, 36 + i * 4)
  })

  // Cliente — misma alineación a la derecha que en el original (y en el
  // .xlsx), con FECHA/Nº/NIF debajo en la misma columna.
  const [direccionLinea1, direccionLinea2] = splitDireccionFiscal(datosCliente?.direccion_fiscal)
  doc.setFontSize(11)
  ;[datosCliente?.razon_social || 'Cliente sin datos cargados', direccionLinea1, direccionLinea2].filter(Boolean).forEach((texto, i) => {
    doc.text(texto, 196, 36 + i * 5, { align: 'right' })
  })

  doc.setFontSize(11)
  doc.text('FECHA:', 150, 56)
  doc.text(formatoFecha(ronda.fecha), 196, 56, { align: 'right' })
  doc.text(ronda.tipo === 'factura' ? 'Nº FACTURA:' : 'Nº PROFORMA:', 150, 61)
  doc.text(ronda.numero_factura || '', 196, 61, { align: 'right' })
  doc.text('NIF:', 150, 66)
  doc.text(datosCliente?.nif || '', 196, 66, { align: 'right' })

  doc.setFontSize(11)
  doc.text(`Ref: ${obra}`, 105, 76, { align: 'center' })

  const filasTabla = []
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
    filasTabla.push([
      l.concepto, euros(precioUnit), String(udsTotal), euros(l.total), euros(factAnterior),
      euros(udsFacturadas), euros(udsPendientes), euros(udsMensual), euros(importeEstaRonda),
    ])
    baseImponible += importeEstaRonda
    facturacionOrigen += factAnterior
  }

  const anchoCol = (i) => COLS_X[i + 1] - COLS_X[i]

  autoTable(doc, {
    startY: 80,
    head: [
      [
        { content: '', styles: { fillColor: [255, 255, 255] } },
        { content: 'Presupuestado', colSpan: 3 },
        { content: 'Origen', colSpan: 3 },
        { content: 'Mes', colSpan: 2 },
      ],
      ['CONCEPTO', 'IMPORTE UNIT.', 'UDS.', 'TOTAL A FACTURAR', 'FACT. ANTERIOR', 'UDS FACTURADAS', 'UDS PENDIENTES', 'UDS MENSUAL', 'TOTAL FACTURAR MES ACTUAL'],
    ],
    body: filasTabla,
    theme: 'grid',
    styles: { font: 'Carlito', fontSize: 6.5, textColor: GRIS_RGB, lineColor: BORDE_RGB, lineWidth: 0.1 },
    headStyles: { font: 'Carlito', fillColor: TEAL_RGB, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 6 },
    columnStyles: Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, { cellWidth: anchoCol(i), halign: i === 0 ? 'left' : 'right' }])),
    didParseCell(data) {
      if (data.row.section === 'head' && data.row.index === 0 && data.column.index > 0) {
        data.cell.styles.fontSize = 8
      }
    },
    margin: { left: 14, right: 14 },
  })

  let y = doc.lastAutoTable.finalY + 6
  const ivaPct = Number(datosCliente?.iva_pct ?? 21)
  doc.setFont('Carlito', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GRIS_RGB)
  if (ivaPct === 0) {
    doc.text('Operación sujeta a inversión del sujeto pasivo Articulo 84.1,2(s)', 14, y)
    y += 6
  }
  doc.text(`Nº de Cuenta: ${EMISOR.cuenta}`, 14, y)
  y += 4

  let amortizacionTotal = 0
  for (const am of ronda.amortizaciones || []) amortizacionTotal += Number(am.monto)
  if (amortizacionTotal > 0) {
    doc.setFont('Carlito', 'normal')
    doc.text('Amortización de anticipo', 14, y + 4)
    doc.text(euros(-amortizacionTotal), 196, y + 4, { align: 'right' })
    y += 8
  }

  const baseTrasAnticipo = baseImponible - amortizacionTotal
  const retencionPct = Number(datosCliente?.retencion_pct ?? 0)
  const ivaMonto = baseTrasAnticipo * (ivaPct / 100)
  const retencionMonto = baseTrasAnticipo * (retencionPct / 100)
  const totalFacturar = baseTrasAnticipo + ivaMonto - retencionMonto
  const totalPresupuesto = lineas.reduce((acc, l) => acc + Number(l.total), 0)

  // Bloque de totales dibujado a mano con la MISMA grilla de 9 columnas que
  // la tabla de líneas (COLS_X) — igual que el .xlsx, donde cada total cae
  // bajo su columna real (PREVISIÓN bajo "TOTAL A FACTURAR", FACTURACIÓN
  // ORIGEN bajo "FACT. ANTERIOR", el resto bajo "TOTAL MES ACTUAL") en vez
  // de una tabla genérica de 2 columnas.
  const filaInicioFooter = y + 4
  function filaFooterPdf(yFila, alto, { etiqueta, colEtiquetaHasta, valor, colValor, pct, fillFullRow, fillValueOnly }) {
    for (let i = 0; i < 9; i++) {
      const x0 = COLS_X[i]
      const ancho = COLS_X[i + 1] - x0
      const rellenar = fillFullRow || (fillValueOnly && i === colValor)
      doc.setDrawColor(...BORDE_RGB)
      doc.setLineWidth(0.1)
      if (rellenar) doc.setFillColor(...TEAL_RGB)
      doc.rect(x0, yFila, ancho, alto, rellenar ? 'FD' : 'S')
    }
    const colorTexto = fillFullRow ? [255, 255, 255] : GRIS_RGB
    doc.setFont('Carlito', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...colorTexto)
    const textoEtiqueta = doc.splitTextToSize(etiqueta, COLS_X[colEtiquetaHasta] - COLS_X[0] - 2)
    doc.text(textoEtiqueta, COLS_X[0] + 1, yFila + alto / 2 - (textoEtiqueta.length - 1) * 1.3, { baseline: 'middle' })
    if (pct !== undefined) {
      doc.setFont('Carlito', 'normal')
      doc.text(`${pct}%`, (COLS_X[1] + COLS_X[2]) / 2, yFila + alto / 2, { align: 'center', baseline: 'middle' })
    }
    const colorValor = fillFullRow || fillValueOnly ? [255, 255, 255] : GRIS_RGB
    doc.setFont('Carlito', fillFullRow ? 'bold' : 'normal')
    doc.setTextColor(...colorValor)
    doc.text(valor, COLS_X[colValor + 1] - 1, yFila + alto / 2, { align: 'right', baseline: 'middle' })
  }

  filaFooterPdf(filaInicioFooter, 7, { etiqueta: 'PREVISIÓN DE FACTURACIÓN SEGÚN PRESUPUESTO', colEtiquetaHasta: 3, valor: euros(totalPresupuesto), colValor: 3 })
  filaFooterPdf(filaInicioFooter + 7, 7, { etiqueta: 'FACTURACIÓN ORIGEN (MESES ANTERIORES)', colEtiquetaHasta: 4, valor: euros(facturacionOrigen), colValor: 4 })
  filaFooterPdf(filaInicioFooter + 14, 6, { etiqueta: 'BASE IMPONIBLE (MES ACTUAL)', colEtiquetaHasta: 8, valor: euros(baseTrasAnticipo), colValor: 8, fillValueOnly: true })
  filaFooterPdf(filaInicioFooter + 20, 6, { etiqueta: 'IVA', colEtiquetaHasta: 8, valor: euros(ivaMonto), colValor: 8, pct: ivaPct })
  filaFooterPdf(filaInicioFooter + 26, 6, { etiqueta: 'RETENCIÓN', colEtiquetaHasta: 8, valor: euros(-retencionMonto), colValor: 8, pct: retencionPct })
  filaFooterPdf(filaInicioFooter + 32, 6, { etiqueta: 'TOTAL A FACTURAR', colEtiquetaHasta: 8, valor: euros(totalFacturar), colValor: 8, fillFullRow: true })

  // Franja vertical del Registro Mercantil de GALVI, igual que en el
  // original — corre rotada por el borde izquierdo de toda la tabla.
  doc.setFont('Carlito', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...GRIS_RGB)
  doc.text(EMISOR.registroMercantil, 12, filaInicioFooter + 38, { angle: 90 })

  const nombreArchivo = `${titulo} - ${obra} - ronda ${ronda.numero}.pdf`
  doc.save(nombreArchivo)
}

function totalRonda(ronda) {
  return (ronda.lineas || []).reduce((acc, l) => acc + Number(l.importe), 0)
}

// Sumatorio de proformas vs. facturas (a pedido de Álvaro, 2026-09-23): con
// varias rondas cargadas no se veía de un vistazo cuánto llevaba proformado
// y cuánto ya facturado de verdad — había que sumar la lista a mano.
function ResumenRondas({ rondas }) {
  const proformas = rondas.filter((r) => r.tipo === 'proforma')
  const facturas = rondas.filter((r) => r.tipo === 'factura')
  const totalProformas = proformas.reduce((acc, r) => acc + totalRonda(r), 0)
  const totalFacturas = facturas.reduce((acc, r) => acc + totalRonda(r), 0)

  return (
    <div className="facturacion-resumen facturacion-resumen-rondas">
      <div className="facturacion-resumen-item">
        <span className="facturacion-resumen-etiqueta">Total proformado ({proformas.length})</span>
        <span className="facturacion-resumen-valor">{euros(totalProformas)} €</span>
      </div>
      <div className="facturacion-resumen-item">
        <span className="facturacion-resumen-etiqueta">Total facturado ({facturas.length})</span>
        <span className="facturacion-resumen-valor facturacion-al-dia">{euros(totalFacturas)} €</span>
      </div>
    </div>
  )
}

function HistorialRondas({ obra, accessToken, rondas, lineas, datosCliente, onCambiadas }) {
  const [error, setError] = useState('')
  const [descargando, setDescargando] = useState(null)

  async function handleDescargarExcel(ronda) {
    setDescargando(`${ronda.id}-xlsx`)
    setError('')
    try {
      await generarDocumentoRonda({ obra, datosCliente, lineas, ronda, rondas })
    } catch (err) {
      setError(err.message)
    } finally {
      setDescargando(null)
    }
  }

  async function handleDescargarPdf(ronda) {
    setDescargando(`${ronda.id}-pdf`)
    setError('')
    try {
      await generarPdfRonda({ obra, datosCliente, lineas, ronda, rondas })
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
      <ResumenRondas rondas={rondas} />
      {error && <div className="auth-error">{error}</div>}
      <ul className="facturacion-lista-rondas">
        {[...rondas].sort((a, b) => b.numero - a.numero).map((r) => {
          const total = totalRonda(r)
          return (
            <li key={r.id} className="facturacion-ronda-item">
              <span className="facturacion-ronda-numero">Ronda {r.numero}</span>
              <span className={`facturacion-ronda-tipo facturacion-ronda-tipo-${r.tipo}`}>{r.tipo === 'factura' ? 'Factura' : 'Proforma'}</span>
              <span>{formatoFecha(r.fecha)}</span>
              <span>{euros(total)} €</span>
              <span className="facturacion-ronda-numero-factura">{r.numero_factura ? `Nº ${r.numero_factura}` : 'Sin número asignado'}</span>
              <button type="button" className="btn-secundario" onClick={() => handleDescargarExcel(r)} disabled={descargando === `${r.id}-xlsx`}>
                {descargando === `${r.id}-xlsx` ? 'Generando…' : '⬇ Excel'}
              </button>
              <button type="button" className="btn-secundario" onClick={() => handleDescargarPdf(r)} disabled={descargando === `${r.id}-pdf`}>
                {descargando === `${r.id}-pdf` ? 'Generando…' : '⬇ PDF'}
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
