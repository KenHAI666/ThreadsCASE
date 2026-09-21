function verifyGoogleAccessToken_(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("缺少 Google 登入憑證");
  const response = UrlFetchApp.fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    method: "get",
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("Google 登入已失效，請重新登入");
  const profile = JSON.parse(response.getContentText() || "{}");
  if (!profile.id || !profile.email || !profile.verified_email) throw new Error("無法驗證 Google 帳號");
  return {
    id: String(profile.id),
    email: String(profile.email).trim().toLowerCase(),
    name: String(profile.name || profile.email)
  };
}

function ensureSessionSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty(TR_APP.sessionSecretProperty);
  if (!secret) {
    secret = `${Utilities.getUuid()}${Utilities.getUuid()}${Utilities.getUuid()}`;
    properties.setProperty(TR_APP.sessionSecretProperty, secret);
  }
  return secret;
}

function createSessionToken_(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: now,
    exp: now + TR_APP.sessionSeconds,
    aud: "threads-radar-v2"
  };
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/g, "");
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(encoded, ensureSessionSecret_())).replace(/=+$/g, "");
  return `${encoded}.${signature}`;
}

function verifySessionToken_(sessionToken) {
  const token = String(sessionToken || "").trim();
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("主控台登入憑證格式錯誤");
  const expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], ensureSessionSecret_())).replace(/=+$/g, "");
  if (!constantTimeEqual_(parts[1], expected)) throw new Error("主控台登入憑證無效");
  const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString("UTF-8"));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== "threads-radar-v2" || !payload.sub || !payload.email || Number(payload.exp) <= now) throw new Error("主控台登入已逾時，請重新登入");
  return { id: String(payload.sub), email: String(payload.email).toLowerCase(), name: String(payload.name || payload.email) };
}

function constantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

function authenticateRequest_(input) {
  const value = input && typeof input === "object" ? input : {};
  if (value.sessionToken || value.session_token) return verifySessionToken_(value.sessionToken || value.session_token);
  if (value.googleAccessToken || value.google_access_token) return verifyGoogleAccessToken_(value.googleAccessToken || value.google_access_token);
  throw new Error("請先完成 Google 登入");
}
