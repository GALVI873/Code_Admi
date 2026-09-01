<?php
declare(strict_types=1);

// Hilo de mensajes entre Álvaro y Geraldinne sobre una obra puntual —
// reemplaza el viejo "comentario_geraldinne" de presupuestos_en_estudio.php
// (un solo campo de texto, de un solo sentido: ella escribía, él solo leía).
// Se identifica por el nombre BASE de la obra (sin el sufijo "— Opción A/B"),
// no por el id de presupuestos_en_estudio: una obra con varias opciones
// vivas es, para efectos de esta conversación, un solo proyecto — no tiene
// sentido partir la charla en dos según qué opción esté abierta en cada
// momento. La misma normalización de nombre vive en el frontend
// (ComentariosObra.jsx) y acá, para que ambos lados siempre lleguen a la
// misma clave sin importar qué variante de obra les llegó.
//
// No es chat en tiempo real (no hay websockets en este panel): el hilo se
// arma con GET al abrir el detalle de la obra y se refresca al reabrir o
// recargar, no empuja mensajes nuevos solo.
//
// GET ?obra=... : requiere sesión + (presupuestos.ver_todos o
// presupuestos.ver_seguimiento) — cualquiera de los dos, mismo criterio que
// el resto de presupuestos_en_estudio.php. Devuelve el hilo completo, más
// viejo primero, y de paso marca la conversación como leída por este
// usuario (comentarios_obra_leido) — abrir el hilo ES la señal de lectura,
// no hace falta una acción aparte.
// POST {obra, mensaje}: mismo permiso, agrega un mensaje atribuido al
// usuario de la sesión (nombre/email del JWT, no un campo del body). También
// marca la conversación como leída por quien escribe, para que su propio
// mensaje no le quede marcado como "sin leer" a sí mismo.
//
// comentarios_obra_leido guarda, por obra + usuario, la fecha del último
// vistazo — presupuestos_en_estudio.php la usa para decidir qué tarjetas
// muestran la insignia de "mensajes nuevos".

$config = require __DIR__ . '/../../backend/bootstrap.php';

function nombreBaseObra(string $obra): string
{
    return trim((string) preg_replace('/\s*—\s*Opci[oó]n\s+\w+\s*$/iu', '', $obra));
}

function marcarLeido(PDO $db, string $obra, string $email): void
{
    $db->prepare("
        INSERT INTO comentarios_obra_leido (obra, usuario_email, ultima_lectura)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(obra, usuario_email) DO UPDATE SET ultima_lectura = excluded.ultima_lectura
    ")->execute([$obra, $email]);
}

try {
    $db = Database::connection($config);

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
    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra_leido (
          obra TEXT NOT NULL,
          usuario_email TEXT NOT NULL,
          ultima_lectura TEXT NOT NULL,
          PRIMARY KEY (obra, usuario_email)
        )
    ");

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requiereAlgunPermiso($usuario, ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento']);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $obra = nombreBaseObra((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }
        $stmt = $db->prepare('SELECT * FROM comentarios_obra WHERE obra = ? ORDER BY creado_en ASC, id ASC');
        $stmt->execute([$obra]);
        $comentarios = $stmt->fetchAll();

        marcarLeido($db, $obra, $usuario['email']);

        Response::json(['comentarios' => $comentarios]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = nombreBaseObra((string) ($body['obra'] ?? ''));
        $mensaje = trim((string) ($body['mensaje'] ?? ''));
        if ($obra === '' || $mensaje === '') {
            Response::error('Faltan "obra" y/o "mensaje"', 422);
        }
        $db->prepare('INSERT INTO comentarios_obra (obra, autor_nombre, autor_email, mensaje) VALUES (?, ?, ?, ?)')
            ->execute([$obra, $usuario['nombre'], $usuario['email'], $mensaje]);

        $id = (int) $db->lastInsertId();
        $stmt = $db->prepare('SELECT * FROM comentarios_obra WHERE id = ?');
        $stmt->execute([$id]);

        marcarLeido($db, $obra, $usuario['email']);

        Response::json(['comentario' => $stmt->fetch()]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
