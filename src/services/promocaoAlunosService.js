/**
 * Serviço de Promoção Automática de Alunos
 *
 * Promove alunos de turma quando o ano letivo muda:
 * - "1º A - MTec-PI Desenvolvimento de Sistemas" → "2º A - MTec-PI Desenvolvimento de Sistemas"
 * - Se não existe próxima turma → status CONCLUIDO (ou turma "Finalizado")
 *
 * Critério de elegibilidade (aluno deve ter completado pelo menos 1 ano):
 * - RM: primeiros 4 dígitos = ano de matrícula (ex: 20252930067 → 2025)
 * - Fallback: YEAR(Pessoa.created_at) quando RM ausente
 * - anos_na_escola = ano_atual - ano_matricula >= 1 → elegível para promoção
 */

const db = require('../config/database');
const logger = require('../config/logger');

/**
 * Extrai o número da série e o sufixo do nome da turma.
 * Ex: "1º A - MTec-PI Desenvolvimento de Sistemas" → { numero: 1, sufixo: " A - MTec-PI Desenvolvimento de Sistemas" }
 * @param {string} nomeTurma
 * @returns {{ numero: number, sufixo: string } | null}
 */
function extrairNumeroESufixo(nomeTurma) {
  if (!nomeTurma || typeof nomeTurma !== 'string') return null;
  // Padrão: 1º, 2º, 3º seguido do resto (ex: " A - MTec-PI Desenvolvimento de Sistemas")
  const match = nomeTurma.trim().match(/^(\d+)[º°]\s*(.*)$/i);
  if (!match) return null;
  const numero = parseInt(match[1], 10);
  const sufixo = match[2] ? ` ${match[2].trim()}` : '';
  return { numero, sufixo };
}

/**
 * Gera o nome da próxima turma (incrementa o número da série).
 * Ex: "1º A - MTec-PI DS" → "2º A - MTec-PI DS"
 * @param {string} nomeTurmaAtual
 * @returns {string | null}
 */
function obterNomeProximaTurma(nomeTurmaAtual) {
  const parsed = extrairNumeroESufixo(nomeTurmaAtual);
  if (!parsed) return null;
  const proximoNumero = parsed.numero + 1;
  return `${proximoNumero}º${parsed.sufixo}`;
}

/**
 * Busca turma por nome, curso_id, unidade_id e turno (para garantir match correto).
 * @param {string} nome
 * @param {number} cursoId
 * @param {number} unidadeId
 * @param {string} turno
 */
async function buscarTurmaPorNome(nome, cursoId, unidadeId, turno) {
  const [rows] = await db.query(
    `SELECT id, nome FROM Turma 
     WHERE nome = ? AND curso_id = ? AND unidade_id = ? AND turno = ?
     LIMIT 1`,
    [nome, cursoId, unidadeId, turno]
  );
  return rows[0] || null;
}

/**
 * Extrai ano de matrícula do RM (primeiros 4 dígitos).
 * RM formato: 20252930067 → ano 2025
 */
function extrairAnoDoRM(rm) {
  if (!rm || typeof rm !== 'string') return null;
  const match = rm.trim().match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Busca turma "Finalizado" ou "Concluído" na unidade (para alunos que terminaram o curso).
 */
async function buscarTurmaFinalizado(unidadeId) {
  const [rows] = await db.query(
    `SELECT id, nome FROM Turma 
     WHERE unidade_id = ? 
     AND (nome LIKE '%Finalizado%' OR nome LIKE '%Concluído%')
     LIMIT 1`,
    [unidadeId]
  );
  return rows[0] || null;
}

/**
 * Executa a promoção de todos os alunos elegíveis.
 * Só processa alunos com status EM CURSO que têm turma_id.
 * Considera que o ano já virou (rodar em 1º de janeiro ou início do ano letivo).
 *
 * @param {Object} options
 * @param {boolean} options.apenasSimulacao - Se true, não aplica alterações, só retorna o que seria feito
 * @param {number} options.unidadeId - Opcional: filtrar por unidade
 * @returns {Promise<{ promovidos: number, finalizados: number, erros: number, detalhes: Array }>}
 */
async function executarPromocao(options = {}) {
  const { apenasSimulacao = false, unidadeId = null } = options;

  const resultado = {
    promovidos: 0,
    finalizados: 0,
    erros: 0,
    detalhes: [],
    simulacao: apenasSimulacao
  };

  try {
    // Buscar alunos EM CURSO com turma_id (RM e created_at para critério de elegibilidade)
    let query = `
      SELECT a.id as aluno_id, a.turma_id, a.status, a.rm, t.nome as turma_nome, t.curso_id, t.unidade_id, t.turno,
             p.created_at as pessoa_created_at
      FROM Aluno a
      INNER JOIN Turma t ON a.turma_id = t.id
      INNER JOIN Pessoa p ON a.id = p.id
      WHERE a.status = 'EM CURSO' AND a.turma_id IS NOT NULL AND p.visivel = 1
    `;
    const params = [];
    if (unidadeId) {
      query += ' AND t.unidade_id = ?';
      params.push(unidadeId);
    }
    query += ' ORDER BY t.unidade_id, t.curso_id, t.nome, a.id';

    const [alunos] = await db.query(query, params);

    logger.info(`[PROMOÇÃO] ${alunos.length} aluno(s) em curso para processar (simulação: ${apenasSimulacao})`);

    const anoAtual = new Date().getFullYear();

    for (const aluno of alunos) {
      try {
        // Elegibilidade: anos_na_escola >= 1 (completou pelo menos 1 ano)
        const anoMatricula = extrairAnoDoRM(aluno.rm) ?? (aluno.pessoa_created_at ? new Date(aluno.pessoa_created_at).getFullYear() : null);
        if (anoMatricula == null) {
          resultado.detalhes.push({
            aluno_id: aluno.aluno_id,
            turma_atual: aluno.turma_nome,
            acao: 'ignorado',
            motivo: 'Sem RM nem data de criação para determinar ano de matrícula'
          });
          continue;
        }
        const anosNaEscola = anoAtual - anoMatricula;
        if (anosNaEscola < 1) {
          resultado.detalhes.push({
            aluno_id: aluno.aluno_id,
            turma_atual: aluno.turma_nome,
            acao: 'ignorado',
            motivo: `Anos na escola (${anosNaEscola}) < 1 - ainda no primeiro ano`
          });
          continue;
        }

        const nomeProximaTurma = obterNomeProximaTurma(aluno.turma_nome);

        if (!nomeProximaTurma) {
          resultado.detalhes.push({
            aluno_id: aluno.aluno_id,
            turma_atual: aluno.turma_nome,
            acao: 'ignorado',
            motivo: 'Nome da turma não segue o padrão Nº X - Sufixo'
          });
          continue;
        }

        // Buscar se existe a próxima turma
        const proximaTurma = await buscarTurmaPorNome(
          nomeProximaTurma,
          aluno.curso_id,
          aluno.unidade_id,
          aluno.turno
        );

        if (proximaTurma) {
          // Existe próxima turma → promover
          if (!apenasSimulacao) {
            await db.query(
              'UPDATE Aluno SET turma_id = ? WHERE id = ?',
              [proximaTurma.id, aluno.aluno_id]
            );
          }
          resultado.promovidos++;
          resultado.detalhes.push({
            aluno_id: aluno.aluno_id,
            turma_atual: aluno.turma_nome,
            turma_nova: proximaTurma.nome,
            acao: 'promovido'
          });
        } else {
          // Não existe próxima turma → finalizar o aluno
          const turmaFinalizado = await buscarTurmaFinalizado(aluno.unidade_id);

          if (!apenasSimulacao) {
            await db.query(
              'UPDATE Aluno SET status = ?, turma_id = ? WHERE id = ?',
              ['CONCLUIDO', turmaFinalizado ? turmaFinalizado.id : null, aluno.aluno_id]
            );
          }

          resultado.finalizados++;
          resultado.detalhes.push({
            aluno_id: aluno.aluno_id,
            turma_atual: aluno.turma_nome,
            turma_finalizado: turmaFinalizado ? turmaFinalizado.nome : null,
            acao: 'finalizado',
            motivo: turmaFinalizado
              ? 'Curso concluído - movido para turma Finalizado'
              : 'Curso concluído - status CONCLUIDO (sem turma Finalizado cadastrada)'
          });
        }
      } catch (err) {
        resultado.erros++;
        resultado.detalhes.push({
          aluno_id: aluno.aluno_id,
          turma_atual: aluno.turma_nome,
          acao: 'erro',
          motivo: err.message
        });
        logger.error(`[PROMOÇÃO] Erro ao processar aluno ${aluno.aluno_id}: ${err.message}`);
      }
    }

    logger.info(
      `[PROMOÇÃO] Concluído: ${resultado.promovidos} promovidos, ${resultado.finalizados} finalizados, ${resultado.erros} erros`
    );

    return resultado;
  } catch (err) {
    logger.error(`[PROMOÇÃO] Erro geral: ${err.message}`);
    throw err;
  }
}

/**
 * Verifica se a promoção deve rodar (ano mudou desde a última execução).
 * Retorna { deveRodar: boolean, anoAtual, ultimoAno }.
 */
async function verificarSeDeveRodarPromocao() {
  const anoAtual = new Date().getFullYear();
  try {
    const [[row]] = await db.query(
      "SELECT valor FROM ConfigSistema WHERE chave = 'ultimo_ano_promocao' LIMIT 1"
    );
    const ultimoAno = row ? parseInt(row.valor, 10) : null;
    const deveRodar = ultimoAno == null || anoAtual > ultimoAno;
    return { deveRodar, anoAtual, ultimoAno };
  } catch (err) {
    // Tabela pode não existir ainda
    logger.debug(`[PROMOÇÃO] ConfigSistema não encontrada: ${err.message}`);
    return { deveRodar: true, anoAtual, ultimoAno: null };
  }
}

/**
 * Atualiza o último ano em que a promoção foi executada.
 */
async function atualizarUltimoAnoPromocao(ano) {
  try {
    await db.query(
      `INSERT INTO ConfigSistema (chave, valor) VALUES ('ultimo_ano_promocao', ?)
       ON DUPLICATE KEY UPDATE valor = ?, updated_at = NOW()`,
      [String(ano), String(ano)]
    );
  } catch (err) {
    logger.warn(`[PROMOÇÃO] Não foi possível atualizar ConfigSistema: ${err.message}`);
  }
}

/**
 * Executa promoção somente se o ano mudou desde a última execução.
 * Assim, mesmo que o sistema esteja desligado em 1º de janeiro, ao subir
 * em qualquer dia do ano a promoção será executada.
 */
async function executarPromocaoSeAnoMudou(options = {}) {
  const { apenasSimulacao = false } = options;
  const { deveRodar, anoAtual, ultimoAno } = await verificarSeDeveRodarPromocao();

  if (!deveRodar) {
    logger.info(`[PROMOÇÃO] Ano ${anoAtual} já processado (último: ${ultimoAno}). Nada a fazer.`);
    return { executado: false, anoAtual, ultimoAno };
  }

  logger.info(`[PROMOÇÃO] Ano mudou (${ultimoAno || 'nunca'} → ${anoAtual}). Executando promoção...`);
  const resultado = await executarPromocao(options);

  if (!apenasSimulacao) {
    await atualizarUltimoAnoPromocao(anoAtual);
  }

  return { executado: true, anoAtual, ultimoAno, resultado };
}

module.exports = {
  executarPromocao,
  executarPromocaoSeAnoMudou,
  verificarSeDeveRodarPromocao,
  atualizarUltimoAnoPromocao,
  extrairAnoDoRM,
  obterNomeProximaTurma,
  extrairNumeroESufixo,
  buscarTurmaPorNome,
  buscarTurmaFinalizado
};
