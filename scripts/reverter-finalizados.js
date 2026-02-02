/**
 * Script para reverter alunos finalizados por engano (CONCLUIDO → EM CURSO, turma_id → null).
 *
 * Uso:
 *   node scripts/reverter-finalizados.js
 *     → Faz login, mostra quantos alunos seriam revertidos (não altera nada).
 *
 *   node scripts/reverter-finalizados.js --confirmar
 *     → Aplica a reversão (todos CONCLUIDO viram EM CURSO sem turma).
 *
 * Variáveis de ambiente (opcional):
 *   API_URL      Base da API (ex: http://localhost:3000)
 *   UNIDADE_ID   ID da unidade escolar (ex: 1)
 *   ESCOLA_USUARIO  Login da escola
 *   ESCOLA_SENHA    Senha da escola
 *
 * Se não definir usuário/senha no .env, o script pede no terminal.
 */

const path = require('path');
// Carrega .env da pasta raiz do projeto (SAGE-API), mesmo rodando de outro diretório
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const readline = require('readline');

const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const UNIDADE_ID = process.env.UNIDADE_ID || '1';
const confirmar = process.argv.includes('--confirmar') || process.argv.includes('-y');

function ask(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (res) => { rl.close(); resolve(res?.trim() || ''); }));
}

async function main() {
  let usuario = process.env.ESCOLA_USUARIO;
  let senha = process.env.ESCOLA_SENHA;

  if (!usuario) usuario = await ask('Login da escola (unidade): ');
  if (!senha) senha = await ask('Senha da escola: ');

  if (!usuario || !senha) {
    console.error('É preciso informar usuário e senha da escola (ou ESCOLA_USUARIO e ESCOLA_SENHA no .env).');
    process.exit(1);
  }

  const loginUrl = `${API_URL}/escolas/login/${UNIDADE_ID}`;
  const pathReverter = '/promocao/reverter';
  const pathReverterComApi = '/api/promocao/reverter';

  try {
    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });

    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({ message: loginRes.statusText }));
      console.error('Erro no login:', err.message || loginRes.status);
      process.exit(1);
    }

    const { token } = await loginRes.json();
    if (!token) {
      console.error('Resposta do login não trouxe token.');
      process.exit(1);
    }

    const authHeader = { Authorization: `Bearer ${token}` };
    const query = confirmar ? '?confirmar=sim' : '';
    let reverterUrl = `${API_URL}${pathReverter}${query}`;
    let reverterRes = await fetch(reverterUrl, { method: 'POST', headers: authHeader });

    if (reverterRes.status === 404) {
      reverterUrl = `${API_URL}${pathReverterComApi}${query}`;
      reverterRes = await fetch(reverterUrl, { method: 'POST', headers: authHeader });
    }

    if (!reverterRes.ok) {
      const err = await reverterRes.json().catch(() => ({ message: reverterRes.statusText }));
      console.error('Erro ao reverter:', err.message || reverterRes.status);
      console.error('URL chamada:', reverterUrl);
      if (reverterRes.status === 404) {
        console.error('Dica: confira se a API está rodando e se API_URL no .env está correto (ex: http://localhost:3000, sem /api no final).');
      }
      process.exit(1);
    }

    const resultado = await reverterRes.json();
    console.log(resultado.message);
    if (resultado.totalFinalizados !== undefined) console.log('Total com status CONCLUIDO:', resultado.totalFinalizados);
    if (resultado.revertidos !== undefined) console.log('Revertidos:', resultado.revertidos);
    if (!confirmar && resultado.totalFinalizados > 0) {
      console.log('\nPara aplicar a reversão, rode: node scripts/reverter-finalizados.js --confirmar');
    }
  } catch (err) {
    console.error('Erro:', err.message);
    if (err.cause) console.error(err.cause);
    process.exit(1);
  }
}

main();
