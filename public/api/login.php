<?php
declare(strict_types=1);

$config = require __DIR__ . '/../../backend/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$body = json_decode((string) file_get_contents('php://input'), true) ?? [];
$email = trim((string) ($body['email'] ?? ''));
$password = (string) ($body['password'] ?? '');

if ($email === '' || $password === '') {
    Response::error('Email y contraseña son obligatorios', 422);
}

$db = Database::connection($config);
$auth = new AuthService($db, $config);

try {
    $resultado = $auth->login($email, $password, $_SERVER['REMOTE_ADDR'] ?? '');
} catch (RuntimeException $e) {
    Response::error($e->getMessage(), $e->getCode() ?: 401);
}

setcookie('refresh_token', $resultado['refresh_token'], [
    'expires' => time() + $config['jwt']['refresh_ttl'],
    'path' => '/api/',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict',
]);

Response::json([
    'access_token' => $resultado['access_token'],
    'usuario' => $resultado['usuario'],
]);
