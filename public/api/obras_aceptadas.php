<?php
declare(strict_types=1);

// Lista de obras en "SEGUIMIENTO DE OBRAS (Aceptadas)" para el espacio de
// trabajo de Alfredo (Gestión de Obras) — ver
// backend/drive_sync/sync_obras_aceptadas.js.
//
// Independiente de presupuestos_en_estudio a propósito: se confirmó que esa
// tabla NO sigue a la obra una vez que Geraldinne la mueve fuera de "en
// estudio" (la reconciliación de sync_all.js borra la fila en cuanto deja
// de aparecer en esa carpeta, o directamente nunca se marcó "Aceptado" a
// mano) — no hay ficha operativa confiable ahí para cruzar. Esta tabla es
// su propia fuente de verdad, leída directo del Excel de cálculo que vive
// en la carpeta de la obra ya aceptada.
//
// GET: lista todas (requiere sesión + obras.ver_aceptadas).
// POST: upsert de una obra puntual, usado por la sincronización con Drive
// (protegido por SYNC_TOKEN). Reconciliación: {accion:"reconciliar",
// obras:[...]} borra las que ya no están en el recorrido (la obra pudo
// pasar a facturación/cierre y salir de la carpeta).

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS obras_aceptadas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL UNIQUE,
          categoria TEXT,
          contacto TEXT,
          cliente TEXT,
          no_ventanas INTEGER,
          numero_ppto TEXT,
          carpinteria TEXT,
          proveedor TEXT,
          ral TEXT,
          persiana TEXT,
          vidrio TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $stmt = $db->query('SELECT * FROM obras_aceptadas ORDER BY obra');
        Response::json(['obras' => $stmt->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'reconciliar') {
            $obras = $body['obras'] ?? null;
            if (!is_array($obras)) {
                Response::error('Falta "obras" (array)', 422);
            }
            if (count($obras) === 0) {
                Response::json(['ok' => true, 'eliminadas' => 0]);
            }
            $marcadores = implode(',', array_fill(0, count($obras), '?'));
            $stmt = $db->prepare("DELETE FROM obras_aceptadas WHERE obra NOT IN ($marcadores)");
            $stmt->execute($obras);
            Response::json(['ok' => true, 'eliminadas' => $stmt->rowCount()]);
        }

        $obra = trim((string) ($body['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        $stmt = $db->prepare("
            INSERT INTO obras_aceptadas
                (obra, categoria, contacto, cliente, no_ventanas, numero_ppto, carpinteria, proveedor, ral, persiana, vidrio, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra) DO UPDATE SET
                categoria = excluded.categoria,
                contacto = excluded.contacto,
                cliente = excluded.cliente,
                no_ventanas = excluded.no_ventanas,
                numero_ppto = excluded.numero_ppto,
                carpinteria = excluded.carpinteria,
                proveedor = excluded.proveedor,
                ral = excluded.ral,
                persiana = excluded.persiana,
                vidrio = excluded.vidrio,
                actualizado_en = datetime('now')
        ");
        $stmt->execute([
            $obra,
            $body['categoria'] ?? null,
            $body['contacto'] ?? null,
            $body['cliente'] ?? null,
            $body['no_ventanas'] ?? null,
            $body['numero_ppto'] ?? null,
            $body['carpinteria'] ?? null,
            $body['proveedor'] ?? null,
            $body['ral'] ?? null,
            $body['persiana'] ?? null,
            $body['vidrio'] ?? null,
        ]);

        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
