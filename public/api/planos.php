<?php
declare(strict_types=1);

// Planos (plantas) de una obra aceptada, para poder ubicar visualmente cada
// Posición del seguimiento de materiales (ver seguimiento_materiales.php)
// sobre el dibujo real de la planta. El PDF de planos de cada obra vive en
// su carpeta "1.Organización/Planos" dentro de Drive y no tiene texto
// embebido (son escaneos con la numeración de posición escrita a mano) —
// por eso se sube como imagen ya rasterizada (una por página/planta, ver
// backend/drive_sync/sync_planos.js) en vez de intentar leer texto.
//
// Como la numeración de posición está dibujada a mano en un lugar distinto
// en cada plano, no hay forma de calcular sola la coordenada de cada
// posición: se calibra una única vez a mano desde el panel (click sobre el
// plano) y esa calibración se guarda aparte de las imágenes, así que
// sobrevive cuando se vuelve a sincronizar el PDF (mismo plano = mismas
// coordenadas).
//
// GET ?obra=...: devuelve las páginas (imagen en base64) y las posiciones
// ya calibradas de esa obra (requiere sesión + obras.ver_aceptadas).
// PATCH: {obra, posicion_base, pagina, x_pct, y_pct} — calibra (o mueve) la
// marca de una posición sobre el plano (requiere sesión + obras.ver_aceptadas).
// posicion_base es la posición "física" del plano (ej. "2"), sin el sufijo
// ".1"/".2" que puede tener en el Excel cuando una misma posición agrupa
// más de un elemento (dos hojas de una misma ventana, etc.).
// POST {accion:"reemplazar_paginas", obra, paginas:[{pagina, imagen_base64}]}:
// reemplaza las imágenes de una obra (sincronización, protegido por
// SYNC_TOKEN). No toca las posiciones calibradas.

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS obras_planos_paginas (
          obra TEXT NOT NULL,
          pagina INTEGER NOT NULL,
          imagen_base64 TEXT NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, pagina)
        )
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS obras_planos_posiciones (
          obra TEXT NOT NULL,
          posicion_base TEXT NOT NULL,
          pagina INTEGER NOT NULL,
          x_pct REAL NOT NULL,
          y_pct REAL NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, posicion_base)
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $obra = trim((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        $paginas = $db->prepare('SELECT pagina, imagen_base64 FROM obras_planos_paginas WHERE obra = ? ORDER BY pagina');
        $paginas->execute([$obra]);

        $posiciones = $db->prepare('SELECT posicion_base, pagina, x_pct, y_pct FROM obras_planos_posiciones WHERE obra = ?');
        $posiciones->execute([$obra]);

        Response::json([
            'paginas' => $paginas->fetchAll(),
            'posiciones' => $posiciones->fetchAll(),
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));
        $posicionBase = trim((string) ($body['posicion_base'] ?? ''));
        $pagina = $body['pagina'] ?? null;
        $xPct = $body['x_pct'] ?? null;
        $yPct = $body['y_pct'] ?? null;

        if ($obra === '' || $posicionBase === '' || !is_numeric($pagina) || !is_numeric($xPct) || !is_numeric($yPct)) {
            Response::error('Faltan "obra", "posicion_base", "pagina", "x_pct" y/o "y_pct"', 422);
        }

        $db->prepare("
            INSERT INTO obras_planos_posiciones (obra, posicion_base, pagina, x_pct, y_pct, actualizado_en)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra, posicion_base) DO UPDATE SET
                pagina = excluded.pagina, x_pct = excluded.x_pct, y_pct = excluded.y_pct, actualizado_en = excluded.actualizado_en
        ")->execute([$obra, $posicionBase, (int) $pagina, (float) $xPct, (float) $yPct]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));
        $posicionBase = trim((string) ($body['posicion_base'] ?? ''));
        if ($obra === '' || $posicionBase === '') {
            Response::error('Faltan "obra" y/o "posicion_base"', 422);
        }
        $db->prepare('DELETE FROM obras_planos_posiciones WHERE obra = ? AND posicion_base = ?')->execute([$obra, $posicionBase]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'reemplazar_paginas') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $paginas = $body['paginas'] ?? null;
            if ($obra === '' || !is_array($paginas)) {
                Response::error('Faltan "obra" y/o "paginas" (array)', 422);
            }
            $db->prepare('DELETE FROM obras_planos_paginas WHERE obra = ?')->execute([$obra]);
            $stmt = $db->prepare("
                INSERT INTO obras_planos_paginas (obra, pagina, imagen_base64, actualizado_en)
                VALUES (?, ?, ?, datetime('now'))
            ");
            foreach ($paginas as $p) {
                $stmt->execute([$obra, $p['pagina'] ?? null, $p['imagen_base64'] ?? '']);
            }

            Response::json(['ok' => true, 'guardadas' => count($paginas)]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
