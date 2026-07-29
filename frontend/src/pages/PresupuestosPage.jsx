import { useAuth } from '../context/AuthContext.jsx'

const PRESUPUESTOS_MOCK = [
  { id: 1, cliente: 'Constructora López', obra: 'Reforma local Málaga', estado: 'enviado', prioridad: 'Alta' },
  { id: 2, cliente: 'Hnos. Ruiz', obra: 'Fachada aluminio Sevilla', estado: 'borrador', prioridad: 'Media' },
  { id: 3, cliente: 'Promociones Vega', obra: 'Ventanas edificio Vega', estado: 'aceptado', prioridad: 'Alta' },
]

export default function PresupuestosPage() {
  const { usuario } = useAuth()

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Presupuestos</h1>
          <p>Hola, {usuario.nombre}</p>
        </div>
      </header>

      <table className="tabla-presupuestos">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Obra</th>
            <th>Estado</th>
            <th>Prioridad</th>
          </tr>
        </thead>
        <tbody>
          {PRESUPUESTOS_MOCK.map((p) => (
            <tr key={p.id}>
              <td>{p.cliente}</td>
              <td>{p.obra}</td>
              <td><span className={`badge badge-${p.estado}`}>{p.estado}</span></td>
              <td>{p.prioridad}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dashboard-nota">Datos de ejemplo — se conecta a los presupuestos reales cuando ese módulo esté construido.</p>
    </div>
  )
}
