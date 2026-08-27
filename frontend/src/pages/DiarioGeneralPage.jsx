import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { diarioGeneral } from '../api/client.js'

// Diario General de pedidos de material y gestión — compartida entre
// Alfredo y Álvaro según la entrevista de Fase 1. Los datos vienen de
// backend/drive_sync/sync_diario_general.js, que lee la hoja "Diario
// General" del Excel real y deja fuera a propósito lo administrativo/
// facturación (alcance acordado). Primera versión: solo lectura.
const CATEGORIAS_MATERIAL = ['Proveedor', 'Chapas', 'Vidrios', 'Fabricar', 'Persianas', 'Lacador', 'Medir', 'Acopio']

function formatoFecha(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

function TablaPedidosMaterial({ items }) {
  if (items.length === 0) {
    return <p className="dashboard-nota">Ningún ítem coincide con los filtros aplicados.</p>
  }
  return (
    <div className="tabla-scroll">
      <table className="tabla-ofertas">
        <thead>
          <tr>
            <th>Obra</th>
            <th>Categoría</th>
            <th>Descripción</th>
            <th>Proveedor</th>
            <th>Fecha Pedido</th>
            <th>Fecha Entrega</th>
            <th>Ubicación</th>
            <th>Tarea entrega a obra</th>
            <th>Estatus</th>
            <th>Comentario</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="seguimiento-oferta-proveedor">{it.obra}</td>
              <td>{it.categoria}</td>
              <td>{it.descripcion || '—'}</td>
              <td>{it.proveedor || '—'}</td>
              <td>{formatoFecha(it.fecha_pedido) || '—'}</td>
              <td>{formatoFecha(it.fecha_entrega_proveedor) || '—'}</td>
              <td>{it.ubicacion || '—'}</td>
              <td>{it.tarea_3 || '—'}</td>
              <td>{it.estatus_2 || '—'}</td>
              <td>{it.comentario || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TablaGestion({ items }) {
  if (items.length === 0) {
    return <p className="dashboard-nota">Ninguna tarea coincide con los filtros aplicados.</p>
  }
  return (
    <div className="tabla-scroll">
      <table className="tabla-ofertas">
        <thead>
          <tr>
            <th>Obra</th>
            <th>Descripción</th>
            <th>Objetivo inicio</th>
            <th>Objetivo fin</th>
            <th>Tarea</th>
            <th>Comentario</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="seguimiento-oferta-proveedor">{it.obra}</td>
              <td>{it.descripcion || '—'}</td>
              <td>{formatoFecha(it.fecha_objetivo_inicio) || '—'}</td>
              <td>{formatoFecha(it.fecha_objetivo_fin) || '—'}</td>
              <td>{it.tarea_1 || '—'}</td>
              <td>{it.comentario || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PESTANAS = ['Pedidos de Material', 'Gestión']

export default function DiarioGeneralPage() {
  const { accessToken } = useAuth()
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [pestana, setPestana] = useState('Pedidos de Material')
  const [busquedaObra, setBusquedaObra] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todas')

  useEffect(() => {
    diarioGeneral(accessToken)
      .then((data) => setItems(data.items || []))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [accessToken])

  const itemsDeLaPestana = useMemo(() => {
    if (pestana === 'Gestión') return items.filter((it) => it.categoria === 'Gestión')
    return items.filter((it) => CATEGORIAS_MATERIAL.includes(it.categoria))
  }, [items, pestana])

  const itemsFiltrados = useMemo(() => {
    const texto = busquedaObra.trim().toLowerCase()
    return itemsDeLaPestana
      .filter((it) => !texto || it.obra?.toLowerCase().includes(texto))
      .filter((it) => pestana !== 'Pedidos de Material' || filtroCategoria === 'Todas' || it.categoria === filtroCategoria)
  }, [itemsDeLaPestana, busquedaObra, filtroCategoria, pestana])

  function handleCambioPestana(p) {
    setPestana(p)
    setFiltroCategoria('Todas')
  }

  return (
    <div className="dashboard dashboard-ancho">
      <header className="dashboard-header">
        <div>
          <h1>Diario General</h1>
          <p>Pedidos de material y tareas de gestión por obra — sincronizado desde el Excel de Alfredo</p>
        </div>
      </header>

      <div className="seguimiento-pestanas">
        {PESTANAS.map((p) => (
          <button
            key={p}
            type="button"
            className={`seguimiento-pestana ${p === pestana ? 'seguimiento-pestana-activa' : ''}`}
            onClick={() => handleCambioPestana(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {!cargando && !error && (
        <div className="filtro-tabla">
          <div className="filtro-campo">
            <label htmlFor="filtro-obra">Obra</label>
            <input
              id="filtro-obra"
              type="text"
              className="input-filtro"
              placeholder="Filtrar por obra…"
              value={busquedaObra}
              onChange={(e) => setBusquedaObra(e.target.value)}
            />
          </div>
          {pestana === 'Pedidos de Material' && (
            <div className="filtro-campo">
              <label htmlFor="filtro-categoria">Categoría</label>
              <select
                id="filtro-categoria"
                className="select-inline"
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
              >
                <option value="Todas">Todas</option>
                {CATEGORIAS_MATERIAL.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </div>
          )}
          <span className="filtro-contador">
            {itemsFiltrados.length} de {itemsDeLaPestana.length}
          </span>
        </div>
      )}

      {cargando && <p className="dashboard-nota">Cargando…</p>}
      {error && <div className="auth-error">{error}</div>}

      {!cargando && !error && (
        pestana === 'Pedidos de Material'
          ? <TablaPedidosMaterial items={itemsFiltrados} />
          : <TablaGestion items={itemsFiltrados} />
      )}
    </div>
  )
}
