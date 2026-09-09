<?php
declare(strict_types=1);

// Bitácora de obra — a pedido de Álvaro: un diario cronológico de todo lo
// que hace en una obra aceptada puntual (visitas, llamadas, decisiones...),
// con fecha propia (no necesariamente la fecha en que lo escribe — puede
// estar registrando algo de ayer). Distinto de "Notas" (comentarios_obra):
// esa es una lista de pendientes para Alfredo, cada mensaje de Álvaro ES un
// pendiente; la Bitácora es más amplia — la mayoría de las entradas son
// solo registro propio, y Álvaro elige puntualmente cuáles ALSO quiere que
// lleguen a Alfredo como nota (enviar_como_nota), sin tener que escribirlas
// dos veces. Cuando se marca, se inserta además una fila en comentarios_obra
// (mismo mecanismo que ya usa la pestaña "Notas") con el mismo texto.
//
// Solo Álvaro (rol admin) escribe acá — es su bitácora personal de
// actividad. Cualquiera con acceso a la obra (obras.ver_aceptadas, hoy
// Alfredo y admin) puede LEERLA completa, no solo lo que se mandó como
// nota — a diferencia de "Notas", que si es privado entre lo que Alfredo
// necesita ver.
//
// GET ?obra=... : requiere sesión + obras.ver_aceptadas.
// POST {obra, fecha, texto, enviar_como_nota}: requiere sesión + rol admin.
// DELETE ?id=...: requiere sesión + rol admin (borra una entrada propia,
// no toca la nota que ya se haya mandado a comentarios_obra si la hubo —
// son registros independientes una vez creados).

$config = require __DIR__ . '/../../backend/bootstrap.php';

function tieneRolBitacora(array $usuario, string $rol): bool
{
    return in_array($rol, $usuario['roles'] ?? [], true);
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS bitacora_obra (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          fecha TEXT NOT NULL,
          texto TEXT NOT NULL,
          autor_nombre TEXT NOT NULL,
          autor_email TEXT NOT NULL,
          enviado_como_nota INTEGER NOT NULL DEFAULT 0,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    // Comentarios_obra ya existe (creada por obras_aceptadas.php/
    // comentarios_obra.php) — se asegura también acá por el mismo criterio
    // del resto del proyecto: cada endpoint que la usa la deja creada, sin
    // depender de cuál corrió primero.
    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          autor_nombre TEXT NOT NULL,
          autor_email TEXT NOT NULL,
          mensaje TEXT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $obra = trim((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }
        $stmt = $db->prepare('SELECT * FROM bitacora_obra WHERE obra = ? ORDER BY fecha DESC, id DESC');
        $stmt->execute([$obra]);

        Response::json(['entradas' => $stmt->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!tieneRolBitacora($usuario, 'admin')) {
            Response::error('Solo Álvaro puede agregar entradas a la Bitácora', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));
        $fecha = trim((string) ($body['fecha'] ?? ''));
        $texto = trim((string) ($body['texto'] ?? ''));
        if ($obra === '' || $fecha === '' || $texto === '') {
            Response::error('Faltan "obra", "fecha" y/o "texto"', 422);
        }

        $db->prepare('INSERT INTO bitacora_obra (obra, fecha, texto, autor_nombre, autor_email) VALUES (?, ?, ?, ?, ?)')
            ->execute([$obra, $fecha, $texto, $usuario['nombre'], $usuario['email']]);
        $id = (int) $db->lastInsertId();

        $enviarComoNota = ($body['enviar_como_nota'] ?? false) === true;
        if ($enviarComoNota) {
            $db->prepare('INSERT INTO comentarios_obra (obra, autor_nombre, autor_email, mensaje) VALUES (?, ?, ?, ?)')
                ->execute([$obra, $usuario['nombre'], $usuario['email'], $texto]);
            $db->prepare('UPDATE bitacora_obra SET enviado_como_nota = 1 WHERE id = ?')->execute([$id]);
        }

        $stmt = $db->prepare('SELECT * FROM bitacora_obra WHERE id = ?');
        $stmt->execute([$id]);

        Response::json(['entrada' => $stmt->fetch()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        if (!tieneRolBitacora($usuario, 'admin')) {
            Response::error('Solo un administrador puede borrar una entrada de la Bitácora', 403);
        }
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        $db->prepare('DELETE FROM bitacora_obra WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
