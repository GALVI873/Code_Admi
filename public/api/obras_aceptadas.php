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
// El Excel de cálculo trae dos columnas en la hoja "Ficha": "PRESUPUESTO"
// (el dato original) y "CONFIRMACIÓN" (vacía siempre — nadie la usa desde
// Excel). Ahora Alfredo confirma/corrige esos 5 campos operativos desde acá
// (PATCH), y backend/drive_sync/escribir_confirmaciones_aceptadas.js
// escribe lo confirmado de vuelta en esa columna del Excel real, usando la
// misma automatización COM que ya usa llenar_ficha_obras.js.
//
// GET: lista todas (requiere sesión + obras.ver_aceptadas).
// PATCH: Alfredo confirma/corrige carpinteria/proveedor/ral/persiana/vidrio
// de una obra puntual (requiere sesión + obras.ver_aceptadas). Marca
// confirmado_en — desde ahí la sincronización con Drive ya no pisa esos 5
// campos con lo que diga el Excel (ver el UPSERT más abajo), la fuente de
// verdad pasa a ser lo que confirmó Alfredo.
// POST: {accion:"listar"} lectura administrativa para el script de
// escritura (protegido por SYNC_TOKEN, sin sesión). Upsert de una obra
// puntual, usado por la sincronización con Drive (mismo token).
// Reconciliación: {accion:"reconciliar", obras:[...]} borra las que ya no
// están en el recorrido (la obra pudo pasar a facturación/cierre y salir
// de la carpeta).

$config = require __DIR__ . '/../../backend/bootstrap.php';

const CAMPOS_CONFIRMABLES = ['carpinteria', 'proveedor', 'ral', 'persiana', 'vidrio'];

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
          confirmado_en TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    $columnas = array_column($db->query('PRAGMA table_info(obras_aceptadas)')->fetchAll(), 'name');
    if (!in_array('confirmado_en', $columnas, true)) {
        $db->exec('ALTER TABLE obras_aceptadas ADD COLUMN confirmado_en TEXT');
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $stmt = $db->query('SELECT * FROM obras_aceptadas ORDER BY obra');
        Response::json(['obras' => $stmt->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }

        $sets = [];
        $valores = [];
        foreach (CAMPOS_CONFIRMABLES as $campo) {
            if (array_key_exists($campo, $body)) {
                $sets[] = "$campo = ?";
                $valor = trim((string) $body[$campo]);
                $valores[] = $valor === '' ? null : $valor;
            }
        }
        if (count($sets) === 0) {
            Response::error('No se envió ningún campo confirmable (' . implode(', ', CAMPOS_CONFIRMABLES) . ')', 422);
        }

        $sets[] = "confirmado_en = datetime('now')";
        $sets[] = "actualizado_en = datetime('now')";
        $valores[] = $id;

        $db->prepare('UPDATE obras_aceptadas SET ' . implode(', ', $sets) . ' WHERE id = ?')
            ->execute($valores);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'listar') {
            $stmt = $db->query('SELECT * FROM obras_aceptadas');
            Response::json(['obras' => $stmt->fetchAll()]);
        }

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

        // Los 5 campos confirmables no se pisan acá una vez que Alfredo los
        // confirmó desde el panel (confirmado_en IS NOT NULL) — a partir de
        // ahí la fuente de verdad es lo que él corrigió, no lo que diga el
        // Excel. El resto (categoria, contacto, cliente, no_ventanas,
        // numero_ppto) sigue actualizándose siempre con lo que traiga Drive.
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
                carpinteria = CASE WHEN obras_aceptadas.confirmado_en IS NULL THEN excluded.carpinteria ELSE obras_aceptadas.carpinteria END,
                proveedor = CASE WHEN obras_aceptadas.confirmado_en IS NULL THEN excluded.proveedor ELSE obras_aceptadas.proveedor END,
                ral = CASE WHEN obras_aceptadas.confirmado_en IS NULL THEN excluded.ral ELSE obras_aceptadas.ral END,
                persiana = CASE WHEN obras_aceptadas.confirmado_en IS NULL THEN excluded.persiana ELSE obras_aceptadas.persiana END,
                vidrio = CASE WHEN obras_aceptadas.confirmado_en IS NULL THEN excluded.vidrio ELSE obras_aceptadas.vidrio END,
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
