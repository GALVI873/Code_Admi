<?php
declare(strict_types=1);

// Endpoint de configuración inicial: inicializa el esquema SQLite y permite
// crear usuarios, todo por HTTP porque el hosting solo da acceso por FTP
// (sin SSH para correr backend/scripts/crear_usuario.php por línea de comandos).
// Protegido por SETUP_TOKEN — borrar este archivo del servidor (o rotar el
// token) en cuanto termine la configuración inicial.

$config = require __DIR__ . '/../../backend/bootstrap.php';

// Diagnóstico sin token: solo confirma booleanos (nunca valores), para
// depurar sin exponer secretos.
if (($_GET['accion'] ?? '') === 'diagnostico') {
    $envPath = __DIR__ . '/../../backend/.env';
    Response::json([
        'env_existe' => is_file($envPath),
        'env_ruta_buscada' => realpath($envPath) ?: $envPath,
        'jwt_secret_cargado' => getenv('JWT_SECRET') !== false && getenv('JWT_SECRET') !== '',
        'setup_token_cargado' => getenv('SETUP_TOKEN') !== false && getenv('SETUP_TOKEN') !== '',
    ]);
}

$token = $_GET['token'] ?? $_POST['token'] ?? '';
if ($config['setup_token'] === '' || !hash_equals($config['setup_token'], (string) $token)) {
    Response::error('No autorizado', 403);
}

$db = Database::connection($config);
$accion = $_GET['accion'] ?? $_POST['accion'] ?? 'estado';

if ($accion === 'inicializar') {
    $schema = file_get_contents(__DIR__ . '/../../database/schema_auth.sql');
    $db->exec($schema);
    Response::json(['ok' => true, 'mensaje' => 'Esquema inicializado en SQLite']);
}

if ($accion === 'crear_usuario') {
    // Acepta GET además de POST a propósito: es más fácil pegar una URL en el
    // navegador que armar una petición POST sin curl/Postman a mano. Queda
    // protegido igual por el SETUP_TOKEN.
    $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
    $nombre = trim((string) ($body['nombre'] ?? $_REQUEST['nombre'] ?? ''));
    $email = trim((string) ($body['email'] ?? $_REQUEST['email'] ?? ''));
    $password = (string) ($body['password'] ?? $_REQUEST['password'] ?? '');
    $rol = trim((string) ($body['rol'] ?? $_REQUEST['rol'] ?? ''));

    if ($nombre === '' || $email === '' || $password === '' || $rol === '') {
        Response::error('Faltan datos: nombre, email, password y rol son obligatorios', 422);
    }

    $stmt = $db->prepare('SELECT id FROM roles WHERE nombre = ?');
    $stmt->execute([$rol]);
    $rolRow = $stmt->fetch();
    if (!$rolRow) {
        Response::error("El rol '$rol' no existe", 422);
    }

    $db->beginTransaction();
    $db->prepare('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)')
        ->execute([$nombre, $email, password_hash($password, PASSWORD_BCRYPT)]);
    $usuarioId = (int) $db->lastInsertId();
    $db->prepare('INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)')
        ->execute([$usuarioId, $rolRow['id']]);
    $db->commit();

    Response::json(['ok' => true, 'usuario_id' => $usuarioId, 'rol' => $rol]);
}

$stmt = $db->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
Response::json([
    'ok' => true,
    'mensaje' => 'Endpoint de setup activo',
    'tablas_existentes' => $stmt->fetchAll(PDO::FETCH_COLUMN),
]);
