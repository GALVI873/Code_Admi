<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0'); // los errores van al log del servidor, nunca a la respuesta JSON

$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
        putenv(trim($key) . '=' . trim($value));
    }
}

$config = require __DIR__ . '/config/config.php';

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $config['cors']['allowed_origins'], true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/src/Database.php';
require __DIR__ . '/src/Jwt.php';
require __DIR__ . '/src/Response.php';
require __DIR__ . '/src/AuthService.php';
require __DIR__ . '/src/AuthMiddleware.php';

return $config;
