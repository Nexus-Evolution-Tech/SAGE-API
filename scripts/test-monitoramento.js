#!/usr/bin/env node
/**
 * Testa o fluxo da tela de monitoramento:
 * 1) GET diagnostico-acessos/1 (último no banco)
 * 2) POST acessos/sincronizar-todos (força sync)
 * 3) Aguarda 5s
 * 4) GET diagnostico-acessos/1 de novo
 * 5) GET /acessos?page=1&limit=5 (o que a Home chama)
 *
 * Uso: node scripts/test-monitoramento.js
 * Requer: SAGE-API rodando (npm start)
 */
require('dotenv').config();
const http = require('http');

const BASE = process.env.API_URL || process.env.BASE_URL || 'http://localhost:3000';
const baseUrl = BASE.replace(/\/$/, '');

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.get(url.href, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(body || res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function post(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = { hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          resolve({ raw: body, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function main() {
  console.log('Base URL:', baseUrl);
  console.log('');

  try {
    const diag1 = await get('/diagnostico-acessos/1');
    const primeiroBanco = diag1.nosso_banco_amostra?.[0];
    console.log('1) Antes do sync - último no banco:', primeiroBanco ? `${primeiroBanco.pessoa_nome} ${primeiroBanco.data_hora}` : 'nenhum');
    console.log('   Logs na catraca (amostra):', diag1.logs_catraca_amostra?.length ?? 0);
    console.log('');

    console.log('2) Chamando POST /acessos/sincronizar-todos ...');
    const syncRes = await post('/acessos/sincronizar-todos');
    console.log('   Resposta:', JSON.stringify(syncRes, null, 2).slice(0, 500));
    console.log('');

    console.log('3) Aguardando 3s ...');
    await new Promise((r) => setTimeout(r, 3000));

    console.log('4) GET /diagnostico-acessos/1 (pode demorar ~15s se a catraca estiver lenta) ...');
    const diag2 = await get('/diagnostico-acessos/1');
    const primeiroBanco2 = diag2.nosso_banco_amostra?.[0];
    console.log('5) Depois do sync - último no banco:', primeiroBanco2 ? `${primeiroBanco2.pessoa_nome} ${primeiroBanco2.data_hora}` : 'nenhum');
    console.log('');

    console.log('6) GET /acessos?page=1&limit=5 (o que a Home chama; pode precisar de token) ...');
    const acessosRes = await get('/acessos?page=1&limit=5');
    const data = acessosRes.data || acessosRes;
    const arr = Array.isArray(data) ? data : [];
    const primeiroLista = arr[0];
    console.log('   Primeiro da lista:', primeiroLista ? `${primeiroLista.pessoa_nome ?? primeiroLista.pessoa_id} ${primeiroLista.data_hora}` : 'vazio (ou 401 se não estiver logado)');
    if (arr.length > 0) {
      console.log('   Total itens nesta página:', arr.length);
    }
    console.log('');
    if (!primeiroBanco2 && !primeiroLista) {
      console.log('Aviso: nenhum acesso no banco. Verifique se a sync inseriu (veja logs do npm start).');
    } else if (primeiroBanco?.data_hora === primeiroBanco2?.data_hora && primeiroBanco?.id === primeiroBanco2?.id) {
      console.log('Aviso: último acesso não mudou após sync. Pode ser que não haja logs novos na catraca ou que a sync não esteja inserindo (veja logs do npm start).');
    } else {
      console.log('OK: dados atualizados após sync.');
    }
  } catch (err) {
    console.error('Erro:', err.message);
    console.log('Certifique-se de que a SAGE-API está rodando (npm start) em', baseUrl);
    process.exit(1);
  }
}

main();
