/**
 * Página de status (Fase 2, E6) — RNF-4 e RNF-12.
 *
 * Quem opera o sistema é a secretaria, não a TI. Este endpoint responde a uma pergunta só:
 * **"está tudo bem, e se não está, preciso fazer alguma coisa?"**
 *
 * Duas decisões deliberadas:
 *
 * 1. **Sem autenticação.** É a tela que a pessoa precisa conseguir abrir justamente quando o
 *    sistema está com problema — inclusive problema de login. Por isso não devolve nenhum dado
 *    pessoal: só contagens, estado de equipamento e versão. Um atacante na LAN da escola descobre
 *    aqui apenas que existe um SAGE, o que ele já sabe por ter alcançado a porta.
 *
 * 2. **Texto pronto, não código de erro.** O backend decide a frase. Se cada tela reescrever a
 *    interpretação do estado, elas divergem — e é assim que se produz "sistema diz que está ok mas
 *    não está".
 */
const express = require('express');
const saudeDispositivos = require('../services/saudeDispositivos');
const db = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();

router.get('/status', async (req, res) => {
  const inicio = Date.now();
  const problemas = [];

  // 1) Banco
  let banco = { ok: false, texto: 'Não foi possível verificar o banco de dados.' };
  try {
    await db.query('SELECT 1');
    banco = { ok: true, texto: 'Banco de dados: funcionando normalmente.' };
  } catch (erro) {
    banco = {
      ok: false,
      texto:
        'Banco de dados: sem resposta. O sistema não consegue gravar nem consultar informações. ' +
        'Se o problema persistir, reinicie o computador e chame o suporte.'
    };
    problemas.push(banco.texto);
    logger.error(`[STATUS] Banco indisponível: ${erro.message}`);
  }

  // 2) Catracas — a razão da falha, e não só "OFFLINE"
  const dispositivos = saudeDispositivos.todos().map((d) => {
    const descricao = saudeDispositivos.descreverParaOperador(d);
    if (descricao.nivel === 'erro' || descricao.nivel === 'atencao') problemas.push(descricao.texto);
    return {
      dispositivo_id: d.dispositivo_id,
      nome: d.nome,
      nivel: descricao.nivel,
      texto: descricao.texto,
      falhasConsecutivas: d.falhasConsecutivas,
      ultimoSucessoEm: d.ultimoSucessoEm,
      ultimaFalhaEm: d.ultimaFalhaEm
    };
  });

  // 3) Acessos aguardando envio para as catracas (fila de sincronização)
  let pendencias = null;
  try {
    const [[linha]] = await db.query('SELECT COUNT(*) AS total FROM sync_pendente');
    pendencias = linha.total;
    if (pendencias > 0) {
      problemas.push(
        `${pendencias} alteração(ões) de cadastro ainda não foram enviadas às catracas. ` +
          'Elas serão enviadas automaticamente assim que a comunicação normalizar.'
      );
    }
  } catch (erro) {
    logger.error(`[STATUS] Não foi possível ler sync_pendente: ${erro.message}`);
  }

  const tudoBem = problemas.length === 0 && banco.ok;

  res.json({
    tudoBem,
    // A frase que a pessoa lê primeiro. Se estiver tudo bem, ela não precisa ler mais nada.
    resumo: tudoBem
      ? 'Tudo funcionando normalmente.'
      : `Há ${problemas.length} ponto(s) que merecem atenção.`,
    problemas,
    banco,
    dispositivos,
    sincronizacaoPendente: pendencias,
    versao: process.env.API_VERSION || null,
    ligadoDesde: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    verificadoEm: new Date().toISOString(),
    tempoDeRespostaMs: Date.now() - inicio
  });
});

module.exports = router;
