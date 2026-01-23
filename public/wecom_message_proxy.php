<?php
// wecom_message_proxy.php
// 用于代表你的业务系统调用企微发送文本消息

header('Content-Type: application/json; charset=utf-8');

// 最前面 header 下面，加这一段
$logLine = date('Y-m-d H:i:s') . ' ' . $_SERVER['REMOTE_ADDR'] . ' ' . ($_SERVER['HTTP_USER_AGENT'] ?? '') . PHP_EOL;
file_put_contents(__DIR__ . '/wecom_message_proxy.log', $logLine, FILE_APPEND);


// ===== 1. 基础配置 =====

$WECOM_CORP_ID = getenv('WECOM_CORP_ID') ?: '';
$WECOM_APP_SECRET = getenv('WECOM_APP_SECRET') ?: '';
$WECOM_AGENT_ID_RAW = getenv('WECOM_AGENT_ID') ?: '';
$WECOM_AGENT_ID = intval($WECOM_AGENT_ID_RAW); // 你的自建应用 AgentId（数字）

// 和 wecom_proxy.php 保持一致或单独生成一串新密钥
$INTERNAL_TOKEN = getenv('WECOM_PROXY_INTERNAL_TOKEN') ?: '';

if ($WECOM_CORP_ID === '' || $WECOM_APP_SECRET === '' || $INTERNAL_TOKEN === '' || $WECOM_AGENT_ID <= 0) {
    http_response_code(500);
    echo json_encode([
        'ok'    => false,
        'error' => 'server_misconfigured',
        'msg'   => 'WECOM_CORP_ID/WECOM_APP_SECRET/WECOM_AGENT_ID/WECOM_PROXY_INTERNAL_TOKEN 未配置',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}


// ===== 2. 校验内部调用 Token =====

$clientToken = isset($_SERVER['HTTP_X_INTERNAL_TOKEN']) ? $_SERVER['HTTP_X_INTERNAL_TOKEN'] : '';

if ($clientToken !== $INTERNAL_TOKEN) {
    http_response_code(401);
    echo json_encode([
        'ok'    => false,
        'error' => 'unauthorized',
        'msg'   => 'invalid internal token',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ===== 3. 解析请求体 =====

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode([
        'ok'    => false,
        'error' => 'invalid_json',
        'msg'   => '请求体不是合法 JSON',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$toUserIds = isset($data['toUserIds']) && is_array($data['toUserIds']) ? $data['toUserIds'] : [];
$content   = isset($data['content']) ? trim((string)$data['content']) : '';

$toUserIds = array_values(array_filter(array_map('trim', $toUserIds)));

if (empty($toUserIds) || $content === '') {
    http_response_code(400);
    echo json_encode([
        'ok'    => false,
        'error' => 'missing_params',
        'msg'   => 'toUserIds 或 content 为空',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ===== 4. 简单的 HTTP GET JSON 封装 =====

function http_get_json($url)
{
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    $resp = curl_exec($ch);

    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return [null, 'curl_error: ' . $err];
    }

    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code < 200 || $code >= 300) {
        return [null, 'http_status_' . $code . ': ' . $resp];
    }

    $data = json_decode($resp, true);
    if (!is_array($data)) {
        return [null, 'invalid_json: ' . $resp];
    }

    return [$data, null];
}

// ===== 5. 获取 access_token =====

$tokenUrl = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid='
    . urlencode($WECOM_CORP_ID)
    . '&corpsecret='
    . urlencode($WECOM_APP_SECRET);

list($tokenData, $tokenErr) = http_get_json($tokenUrl);

if ($tokenErr !== null) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'gettoken_http_error',
        'detail' => $tokenErr,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($tokenData['errcode']) || $tokenData['errcode'] !== 0 || empty($tokenData['access_token'])) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'gettoken_api_error',
        'errcode'=> $tokenData['errcode'] ?? null,
        'errmsg' => $tokenData['errmsg'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$accessToken = $tokenData['access_token'];

// ===== 6. 调用企微发送文本消息 =====

$touser = implode('|', $toUserIds);

$payload = [
    'touser'  => $touser,
    'msgtype' => 'text',
    'agentid' => $WECOM_AGENT_ID,
    'text'    => ['content' => $content],
    'safe'    => 0,
];

$sendUrl = 'https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=' . urlencode($accessToken);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $sendUrl);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 8);

$resp = curl_exec($ch);

if ($resp === false) {
    $err = curl_error($ch);
    curl_close($ch);
    echo json_encode([
        'ok'     => false,
        'error'  => 'send_http_error',
        'detail' => $err,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code < 200 || $code >= 300) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'send_http_status_' . $code,
        'detail' => $resp,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$data = json_decode($resp, true);
if (!is_array($data)) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'send_invalid_json',
        'detail' => $resp,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($data['errcode'] ?? 0) !== 0) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'send_api_error',
        'errcode'=> $data['errcode'] ?? null,
        'errmsg' => $data['errmsg'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'ok' => true,
], JSON_UNESCAPED_UNICODE);