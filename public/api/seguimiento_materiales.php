<?php
declare(strict_types=1);

// Seguimiento de pedidos de material por obra aceptada — leído de la hoja
// "SEG" del Excel "...MEDYSEG.xlsx" que Alfredo (Gestión de Obras) lleva
// por obra dentro de "SEGUIMIENTO DE OBRAS (Aceptadas)" (ver
// backend/drive_sync/sync_obras_aceptadas.js). Tabla separada de
// presupuestos_en_estudio porque es un dominio de datos distinto
// (logística de pedidos, no presupuesto) — el panel las cruza por nombre
// de obra en el frontend.
//
// GET: lista todo el seguimiento (requiere sesión + obras.ver_aceptadas).
// POST: reemplaza completo el seguimiento de una obra puntual, usado por la
// sincronización con Drive (protegido por SYNC_TOKEN, no por sesión de
// usuario). No hay upsert fila por fila porque no hay una clave estable
// entre corridas (una fila puede reordenarse, agregarse o quitarse en la
// tabla dinámica de origen entre una sincronización y la siguiente).

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS seguimiento_materiales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          posicion TEXT,
          material TEXT,
          estado TEXT,
          proveedor TEXT,
          fecha_pedido TEXT,
          numero_orden TEXT,
          fecha_estimada TEXT,
          comentario TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $stmt = $db->query('SELECT * FROM seguimiento_materiales ORDER BY obra, id');
        Response::json(['materiales' => $stmt->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'reemplazar_materiales') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $materiales = $body['materiales'] ?? null;
            if ($obra === '' || !is_array($materiales)) {
                Response::error('Faltan "obra" y/o "materiales" (array)', 422);
            }
            $db->prepare('DELETE FROM seguimiento_materiales WHERE obra = ?')->execute([$obra]);
            $stmt = $db->prepare("
                INSERT INTO seguimiento_materiales (obra, posicion, material, estado, proveedor, fecha_pedido, numero_orden, fecha_estimada, comentario, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ");
            foreach ($materiales as $m) {
                $stmt->execute([
                    $obra,
                    $m['posicion'] ?? null,
                    $m['material'] ?? null,
                    $m['estado'] ?? null,
                    $m['proveedor'] ?? null,
                    $m['fecha_pedido'] ?? null,
                    $m['numero_orden'] ?? null,
                    $m['fecha_estimada'] ?? null,
                    $m['comentario'] ?? null,
                ]);
            }
            Response::json(['ok' => true, 'guardadas' => count($materiales)]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
