<?php
declare(strict_types=1);

// Diario General de pedidos de material y gestión — leído de la hoja
// "Diario General" de Z:\DRIVE GALVI\3. PUESTO TÉCNICO\1. Diario General
// Galvi.xlsx (ver backend/drive_sync/sync_diario_general.js). Una fila por
// ítem (material o tarea), no por obra — una obra puede tener varias.
//
// Las hojas "Gestión" y "Estatus Categoria" del mismo Excel NO se
// sincronizan: se confirmó que son vistas/copias de esta misma tabla y no
// siempre están al día entre sí. Diario General es la única fuente de
// verdad; el panel arma las dos vistas (Pedidos de Material / Gestión)
// filtrando por categoría en el frontend, no leyendo esas otras hojas.
// Alcance acotado: solo categorías operativas (Proveedor, Chapas, Vidrios,
// Fabricar, Persianas, Lacador, Medir, Acopio, Gestión) — lo administrativo/
// facturación queda fuera a pedido del usuario.
//
// GET: lista todo (requiere sesión + obras.ver_diario_general — Alfredo y
// admin, ambos lo necesitan según la entrevista de Fase 1).
// POST: {accion:"reemplazar_todo", items:[...]} reemplaza la tabla completa,
// usado por la sincronización con Drive (protegido por SYNC_TOKEN). No hay
// upsert fila por fila porque no hay una clave estable entre corridas: el
// Excel se reordena y las filas se agregan/quitan libremente a mano.

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS diario_general (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT,
          cliente TEXT,
          contacto TEXT,
          cod TEXT,
          obra TEXT NOT NULL,
          fecha_aceptacion TEXT,
          categoria TEXT NOT NULL,
          descripcion TEXT,
          color TEXT,
          material TEXT,
          proveedor TEXT,
          fecha_objetivo_inicio TEXT,
          fecha_objetivo_fin TEXT,
          fecha_pedido TEXT,
          tarea_1 TEXT,
          responsable TEXT,
          estatus_2 TEXT,
          fecha_entrega_proveedor TEXT,
          ubicacion TEXT,
          tarea_3 TEXT,
          comentario TEXT,
          prioridad TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Permiso propio (no reutiliza obras.ver_aceptadas): esta tabla no es
    // solo de Alfredo, la entrevista de Fase 1 confirma que Álvaro también
    // la necesita para transporte/montaje — se otorga a los dos roles.
    $db->exec("INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES ('obras.ver_diario_general', 'Ver el Diario General de pedidos de material y gestión')");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'gestion_obras' AND p.clave = 'obras.ver_diario_general'
    ");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'admin' AND p.clave = 'obras.ver_diario_general'
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_diario_general');

        $items = $db->query('SELECT * FROM diario_general ORDER BY obra, categoria')->fetchAll();
        Response::json(['items' => $items]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'reemplazar_todo') {
            $items = $body['items'] ?? null;
            if (!is_array($items)) {
                Response::error('Falta "items" (array)', 422);
            }
            $db->beginTransaction();
            $db->exec('DELETE FROM diario_general');
            $stmt = $db->prepare("
                INSERT INTO diario_general
                    (tipo, cliente, contacto, cod, obra, fecha_aceptacion, categoria, descripcion, color, material, proveedor, fecha_objetivo_inicio, fecha_objetivo_fin, fecha_pedido, tarea_1, responsable, estatus_2, fecha_entrega_proveedor, ubicacion, tarea_3, comentario, prioridad, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ");
            foreach ($items as $it) {
                $stmt->execute([
                    $it['tipo'] ?? null,
                    $it['cliente'] ?? null,
                    $it['contacto'] ?? null,
                    $it['cod'] ?? null,
                    $it['obra'] ?? '',
                    $it['fecha_aceptacion'] ?? null,
                    $it['categoria'] ?? '',
                    $it['descripcion'] ?? null,
                    $it['color'] ?? null,
                    $it['material'] ?? null,
                    $it['proveedor'] ?? null,
                    $it['fecha_objetivo_inicio'] ?? null,
                    $it['fecha_objetivo_fin'] ?? null,
                    $it['fecha_pedido'] ?? null,
                    $it['tarea_1'] ?? null,
                    $it['responsable'] ?? null,
                    $it['estatus_2'] ?? null,
                    $it['fecha_entrega_proveedor'] ?? null,
                    $it['ubicacion'] ?? null,
                    $it['tarea_3'] ?? null,
                    $it['comentario'] ?? null,
                    $it['prioridad'] ?? null,
                ]);
            }
            $db->commit();
            Response::json(['ok' => true, 'guardados' => count($items)]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
