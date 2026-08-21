// Minimal HTTP client with HTTP Digest Authentication (RFC 2617, qop="auth").
// Hikvision ISAPI endpoints require digest auth. No external deps — uses Node core.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function parseAuthHeader(header) {
  const out = {};
  // Strip leading "Digest "
  const raw = header.replace(/^Digest\s+/i, '');
  // Split on commas that are not inside quotes
  const parts = raw.match(/(\w+)=("[^"]*"|[^,]*)/g) || [];
  for (const p of parts) {
    const idx = p.indexOf('=');
    const k = p.slice(0, idx).trim();
    let v = p.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function buildDigestHeader({ username, password, method, uri, challenge, nc, cnonce }) {
  const { realm, nonce, qop, opaque, algorithm } = challenge;
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  let response;
  if (qop) {
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }
  let header =
    `Digest username="${username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uri}", response="${response}"`;
  if (opaque) header += `, opaque="${opaque}"`;
  if (algorithm) header += `, algorithm=${algorithm}`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return header;
}

function rawRequest({ hostname, port, protocol, method, path, headers, body, timeout }) {
  return new Promise((resolve, reject) => {
    const lib = protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname,
        port,
        method,
        path,
        headers,
        protocol,
        timeout: timeout || 15000,
        // Hikvision devices often use self-signed certs on https
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Perform a digest-authenticated request.
 * @param {object} opts
 * @param {string} opts.baseUrl  e.g. "http://192.168.1.64" or "https://..:443"
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {string} opts.method   GET/POST/PUT/DELETE
 * @param {string} opts.path     e.g. "/ISAPI/System/deviceInfo"
 * @param {Buffer|string} [opts.body]
 * @param {object} [opts.headers]
 * @param {number} [opts.timeout]
 * @returns {Promise<{status:number, headers:object, body:Buffer, text:string, json:function}>}
 */
export async function digestRequest(opts) {
  const {
    baseUrl,
    username,
    password,
    method = 'GET',
    path,
    body,
    headers = {},
    timeout,
  } = opts;

  const url = new URL(baseUrl);
  const protocol = url.protocol;
  const hostname = url.hostname;
  const port = url.port || (protocol === 'https:' ? 443 : 80);
  const bodyBuf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);

  const baseHeaders = {
    ...headers,
    Host: `${hostname}:${port}`,
    ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
  };

  // 1st request — expect 401 challenge
  const first = await rawRequest({
    hostname,
    port,
    protocol,
    method,
    path,
    headers: baseHeaders,
    body: bodyBuf,
    timeout,
  });

  if (first.status !== 401) {
    return decorate(first);
  }

  const wwwAuth = first.headers['www-authenticate'];
  if (!wwwAuth || !/digest/i.test(wwwAuth)) {
    // Maybe basic auth device
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const retry = await rawRequest({
      hostname,
      port,
      protocol,
      method,
      path,
      headers: { ...baseHeaders, Authorization: `Basic ${basic}` },
      body: bodyBuf,
      timeout,
    });
    return decorate(retry);
  }

  const challenge = parseAuthHeader(wwwAuth);
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const authHeader = buildDigestHeader({
    username,
    password,
    method,
    uri: path,
    challenge,
    nc,
    cnonce,
  });

  const second = await rawRequest({
    hostname,
    port,
    protocol,
    method,
    path,
    headers: { ...baseHeaders, Authorization: authHeader },
    body: bodyBuf,
    timeout,
  });

  return decorate(second);
}

function decorate(res) {
  const text = res.body.toString('utf8');
  return {
    status: res.status,
    headers: res.headers,
    body: res.body,
    text,
    json() {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    ok: res.status >= 200 && res.status < 300,
  };
}
