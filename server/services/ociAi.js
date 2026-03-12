/**
 * OCI Generative AI service — handles request signing and API calls.
 * Implements OCI HTTP Signature v1 (RSA-SHA256) without needing the OCI SDK.
 */

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

// ── OCI Request Signing ──────────────────────────────────────────────────────

/**
 * Build OCI Authorization header using RSA-SHA256.
 * @param {object} opts
 * @param {string} opts.method  HTTP method (GET/POST)
 * @param {string} opts.url     Full URL
 * @param {object} opts.headers Headers object (will be modified in-place with auth)
 * @param {string} opts.body    Request body string (for POST)
 * @param {string} opts.userId  OCI user OCID
 * @param {string} opts.tenancy OCI tenancy OCID
 * @param {string} opts.fingerprint Key fingerprint
 * @param {string} opts.privateKey  PEM private key string
 */
function signRequest({ method, url, headers, body, userId, tenancy, fingerprint, privateKey }) {
  const parsed   = new URL(url);
  const dateStr  = new Date().toUTCString();
  headers['date'] = dateStr;
  headers['host'] = parsed.host;

  const headersToSign = method.toUpperCase() === 'GET'
    ? ['date', 'host', '(request-target)']
    : ['date', 'host', '(request-target)', 'content-length', 'content-type', 'x-content-sha256'];

  if (method.toUpperCase() !== 'GET' && body) {
    const digest = crypto.createHash('sha256').update(body).digest('base64');
    headers['x-content-sha256'] = digest;
    headers['content-length']   = Buffer.byteLength(body).toString();
  }

  const signingString = headersToSign.map((h) => {
    if (h === '(request-target)') {
      return `(request-target): ${method.toLowerCase()} ${parsed.pathname}${parsed.search}`;
    }
    return `${h}: ${headers[h]}`;
  }).join('\n');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingString);
  const signature = sign.sign(privateKey, 'base64');

  const keyId = `${tenancy}/${userId}/${fingerprint}`;
  headers['Authorization'] = [
    `Signature version="1"`,
    `headers="${headersToSign.join(' ')}"`,
    `keyId="${keyId}"`,
    `algorithm="rsa-sha256"`,
    `signature="${signature}"`,
  ].join(',');
}

/**
 * Make a signed OCI REST API call.
 */
function ociRequest({ method = 'POST', url, body, creds }) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'content-type': 'application/json' };

    signRequest({
      method, url, headers,
      body: bodyStr,
      userId:      creds.user,
      tenancy:     creds.tenancy,
      fingerprint: creds.fingerprint,
      privateKey:  creds.private_key,
    });

    const lib  = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   method.toUpperCase(),
      headers,
    };

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.message || JSON.stringify(json)));
          else resolve(json);
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── OCI GenAI endpoints ──────────────────────────────────────────────────────

function genAiHost(region) {
  return `inference.generativeai.${region}.oci.oraclecloud.com`;
}

/**
 * Test OCI Generative AI connectivity by listing models.
 */
async function testOciConnection(creds) {
  const host = genAiHost(creds.region);
  const url  = `https://${host}/20231130/models?compartmentId=${encodeURIComponent(creds.compartment_id)}&lifecycleState=ACTIVE&limit=5`;
  const headers = {};
  const parsed  = new URL(url);
  headers['host'] = parsed.host;

  signRequest({
    method: 'GET', url, headers,
    body: '',
    userId:      creds.user,
    tenancy:     creds.tenancy,
    fingerprint: creds.fingerprint,
    privateKey:  creds.private_key,
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.message || JSON.stringify(json)));
          else resolve(json);
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Call OCI Cohere Rerank.
 * @param {object} creds  OCI credentials {user, tenancy, fingerprint, private_key, region, compartment_id}
 * @param {string} modelId  OCI model OCID or model name
 * @param {string} query
 * @param {string[]} documents
 * @param {number} topN
 */
async function rerankOci(creds, modelId, query, documents, topN = 10) {
  const host = genAiHost(creds.region);
  const url  = `https://${host}/20231130/actions/rerank`;
  const body = {
    servingMode: {
      modelId,
      servingType: 'ON_DEMAND',
    },
    compartmentId: creds.compartment_id,
    query,
    documents,
    topN,
    isEcho: false,
  };
  return ociRequest({ method: 'POST', url, body, creds });
}

/**
 * Call OCI Cohere Embed.
 * @param {string[]} texts
 * @param {'SEARCH_DOCUMENT'|'SEARCH_QUERY'} inputType
 */
async function embedOci(creds, modelId, texts, inputType = 'SEARCH_DOCUMENT') {
  const host = genAiHost(creds.region);
  const url  = `https://${host}/20231130/actions/embedText`;
  const body = {
    servingMode: {
      modelId,
      servingType: 'ON_DEMAND',
    },
    compartmentId: creds.compartment_id,
    inputs:     texts,
    inputType,
    truncate:   'NONE',
  };
  return ociRequest({ method: 'POST', url, body, creds });
}

module.exports = { testOciConnection, rerankOci, embedOci };
