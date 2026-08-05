const fs = require('fs');
const http = require('http');
const path = require('path');
const YAML = require('yaml');

const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:3000');
const maxLatencyMs = Number(process.env.SAGE_AUDIT_MAX_LATENCY_MS || 2000);
const swagger = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'docs', 'swagger.yml'), 'utf8'));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

function call(method, requestPath) {
  return new Promise((resolve) => {
    const started = Date.now();
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const payload = hasBody ? Buffer.from('{}') : null;
    const request = http.request({
      hostname: baseUrl.hostname,
      port: baseUrl.port || 80,
      path: requestPath,
      method,
      timeout: 10000,
      headers: {
        Origin: 'http://localhost:3000',
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
      }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({
        status: response.statusCode,
        latencyMs: Date.now() - started,
        allowOrigin: response.headers['access-control-allow-origin'] || null
      }));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => resolve({ error: error.message, latencyMs: Date.now() - started }));
    if (payload) request.write(payload);
    request.end();
  });
}

async function main() {
  const operations = [];
  for (const [template, definition] of Object.entries(swagger.paths || {})) {
    const requestPath = template.replace(/\{[^}]+\}/g, '1');
    for (const method of Object.keys(definition)) {
      if (methods.has(method)) operations.push({ method: method.toUpperCase(), requestPath });
    }
  }

  const results = [];
  for (const operation of operations) {
    const preflight = await call('OPTIONS', operation.requestPath);
    const response = await call(operation.method, operation.requestPath);
    const failed = Boolean(
      preflight.error || preflight.status !== 204 || preflight.allowOrigin !== 'http://localhost:3000' ||
      response.error || response.status >= 500 || response.latencyMs > maxLatencyMs
    );
    results.push({ ...operation, preflight, response, failed });
  }

  const failures = results.filter((item) => item.failed);
  const latencies = results.map((item) => item.response.latencyMs).sort((a, b) => a - b);
  const summary = {
    baseUrl: baseUrl.origin,
    operations: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    maxLatencyMs: latencies.at(-1) || 0,
    p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] || 0,
    failures
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
