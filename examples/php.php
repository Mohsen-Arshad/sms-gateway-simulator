<?php
$base = getenv('SIMULATOR_URL') ?: 'http://localhost:3000';
$apiKey = getenv('SIMULATOR_API_KEY');
$headers = "Content-Type: application/json\r\n";
if ($apiKey !== false && $apiKey !== '') {
  $headers .= "Authorization: Bearer " . $apiKey . "\r\n";
}

$payload = json_encode([
  'to' => '+224612345678',
  'body' => 'PHP integration test',
  'sender_id' => 'DEMO',
  'simulation' => ['final_status' => 'delivered'],
], JSON_THROW_ON_ERROR);

$context = stream_context_create(['http' => [
  'method' => 'POST',
  'header' => $headers,
  'content' => $payload,
  'ignore_errors' => false,
]]);
$result = file_get_contents($base . '/api/v1/messages', false, $context);
if ($result === false) {
  throw new RuntimeException('Simulator request failed.');
}
$message = json_decode($result, true, 512, JSON_THROW_ON_ERROR);
print_r($message);
