<?php
// wecom_proxy.php
// 放在 wecom.iwishweb.com 对应的网站目录下

header('Content-Type: application/json; charset=utf-8');

// ===== 1. 基础配置 =====

// 企业微信 CorpID（建议通过环境变量注入，避免硬编码泄露）
$WECOM_CORP_ID = getenv('WECOM_CORP_ID') ?: '';

// 企业微信自建应用 Secret（建议通过环境变量注入，避免硬编码泄露）
$WECOM_APP_SECRET = getenv('WECOM_APP_SECRET') ?: '';

// 内部调用校验 Token（建议通过环境变量注入，避免硬编码泄露）
$INTERNAL_TOKEN = getenv('WECOM_PROXY_INTERNAL_TOKEN') ?: '';

if ($WECOM_CORP_ID === '' || $WECOM_APP_SECRET === '' || $INTERNAL_TOKEN === '') {
    http_response_code(500);
    echo json_encode([
        'ok'    => false,
        'error' => 'server_misconfigured',
        'msg'   => 'WECOM_CORP_ID/WECOM_APP_SECRET/WECOM_PROXY_INTERNAL_TOKEN 未配置',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}


// ===== 2. 简单安全校验 =====

$clientToken = '';
if (isset($_SERVER['HTTP_X_INTERNAL_TOKEN'])) {
    $clientToken = $_SERVER['HTTP_X_INTERNAL_TOKEN'];
}

if ($clientToken !== $INTERNAL_TOKEN) {
    http_response_code(401);
    echo json_encode([
        'ok'    => false,
        'error' => 'unauthorized',
        'msg'   => 'invalid internal token',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ===== 3. 获取 code 参数 =====

$code = '';
if (isset($_GET['code'])) {
    $code = trim($_GET['code']);
} elseif (isset($_POST['code'])) {
    $code = trim($_POST['code']);
}

if ($code === '') {
    http_response_code(400);
    echo json_encode([
        'ok'    => false,
        'error' => 'missing_code',
        'msg'   => '缺少企微授权 code',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ===== 4. 调企微 gettoken 拿 access_token =====

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

// gettoken
$tokenUrl = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid='
    . urlencode($WECOM_CORP_ID)
    . '&corpsecret='
    . urlencode($WECOM_APP_SECRET);

list($tokenData, $tokenErr) = http_get_json($tokenUrl);

if ($tokenErr !== null) {
    echo json_encode([
        'ok'       => false,
        'error'    => 'gettoken_http_error',
        'detail'   => $tokenErr,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($tokenData['errcode']) || $tokenData['errcode'] !== 0) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'gettoken_api_error',
        'errcode'=> $tokenData['errcode'] ?? null,
        'errmsg' => $tokenData['errmsg'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (empty($tokenData['access_token'])) {
    echo json_encode([
        'ok'    => false,
        'error' => 'gettoken_missing_token',
        'data'  => $tokenData,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$accessToken = $tokenData['access_token'];

// ===== 5. 调企微 getuserinfo 拿 UserId =====

$userUrl = 'https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token='
    . urlencode($accessToken)
    . '&code='
    . urlencode($code);

list($userData, $userErr) = http_get_json($userUrl);

if ($userErr !== null) {
    echo json_encode([
        'ok'       => false,
        'error'    => 'getuserinfo_http_error',
        'detail'   => $userErr,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($userData['errcode']) || $userData['errcode'] !== 0) {
    echo json_encode([
        'ok'     => false,
        'error'  => 'getuserinfo_api_error',
        'errcode'=> $userData['errcode'] ?? null,
        'errmsg' => $userData['errmsg'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (empty($userData['UserId'])) {
    echo json_encode([
        'ok'    => false,
        'error' => 'missing_userid',
        'data'  => $userData,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'ok'     => true,
    'userId' => $userData['UserId'],
], JSON_UNESCAPED_UNICODE);