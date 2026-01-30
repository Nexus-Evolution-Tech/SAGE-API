#!/usr/bin/env node
/**
 * Chama o endpoint de diagnóstico de acessos (catraca vs banco).
 * Uso: node scripts/diagnostico-acessos.js [dispositivo_id]
 * Ex.: node scripts/diagnostico-acessos.js 1
 *
 * Em desenvolvimento você também pode abrir no navegador:
 * http://localhost:3000/diagnostico-acessos/1
 */
require('dotenv').config();
const https = require('https');
const http = require('http');

const dispositivoId = process.argv[2] || '1';
const baseUrl = process.env.API_URL || process.env.BASE_URL || 'http://localhost:3000';
const url = `${baseUrl.replace(/\/$/, '')}/diagnostico-acessos/${dispositivoId}`;

const client = baseUrl.startsWith('https') ? https : http;

console.log('Chamando:', url);
console.log('');

const req = client.get(url, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log(JSON.stringify(data, null, 2));
      if (data.logs_catraca_amostra && data.logs_catraca_amostra.length > 0) {
        console.log('\n--- Resumo: logs da catraca (amostra) ---');
        data.logs_catraca_amostra.slice(0, 10).forEach((l, i) => {
          console.log(`${i + 1}. user_id=${l.user_id_catraca} → pessoa_id=${l.pessoa_id_calculado} | existe? ${l.pessoa_existe}`);
        });
      }
    } catch (e) {
      console.log(body);
    }
  });
});

req.on('error', (err) => {
  console.error('Erro:', err.message);
  console.log('Certifique-se de que a API está rodando (npm start) e que o dispositivo_id existe.');
});
req.setTimeout(15000, () => {
  req.destroy();
  console.error('Timeout. A catraca pode estar offline.');
});
