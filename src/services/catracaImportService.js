/**
 * Importação da catraca para o SAGE na ordem correta (respeitando FKs).
 * Usado quando o sistema foi recriado e precisa puxar áreas e pessoas da catraca.
 */
const db = require('../config/database');
const deviceService = require('./deviceService');
const logger = require('../config/logger');
const { ORDEM_IMPORT_PARA_SAGE } = require('../config/syncOrder');

/**
 * Busca unidade_id: usa o informado ou a primeira UnidadeEscolar do banco.
 */
async function obterUnidadeId(unidadeIdParam) {
  if (unidadeIdParam != null && Number.isInteger(Number(unidadeIdParam))) {
    const [[u]] = await db.query('SELECT id FROM UnidadeEscolar WHERE id = ?', [Number(unidadeIdParam)]);
    if (u) return u.id;
  }
  const [[u]] = await db.query('SELECT id FROM UnidadeEscolar LIMIT 1');
  return u ? u.id : null;
}

/**
 * Importa áreas e usuários da catraca para o SAGE na ordem correta.
 * 1) Area (catraca areas → SAGE Area)
 * 2) Pessoa (catraca users → SAGE Pessoa, tipo padrão ALUNO)
 * @param {object} dispositivo - Dispositivo do banco (com id, nome, etc.)
 * @param {object} options - { unidade_id?: number, skipAreas?: boolean, skipUsers?: boolean }
 * @returns {Promise<{ areasInseridas: number, areasIgnoradas: number, pessoasInseridas: number, pessoasIgnoradas: number, erros: string[] }>}
 */
async function importarDaCatracaParaSage(dispositivo, options = {}) {
  const unidade_id = await obterUnidadeId(options.unidade_id);
  if (!unidade_id) {
    throw new Error('Nenhuma unidade encontrada. Cadastre uma UnidadeEscolar ou informe unidade_id.');
  }

  const result = { areasInseridas: 0, areasIgnoradas: 0, pessoasInseridas: 0, pessoasIgnoradas: 0, erros: [] };

  // 1) Carregar areas e users da catraca
  let catracaAreas = [];
  let catracaUsers = [];
  try {
    const resAreas = await deviceService.loadObjectsFromCatraca(dispositivo, 'areas', {});
    catracaAreas = resAreas.data || [];
  } catch (e) {
    result.erros.push(`areas: ${e.message}`);
  }
  try {
    const resUsers = await deviceService.loadObjectsFromCatraca(dispositivo, 'users', {});
    catracaUsers = resUsers.data || [];
  } catch (e) {
    result.erros.push(`users: ${e.message}`);
  }

  // 2) Inserir áreas na ordem (Area vem antes de Pessoa)
  if (!options.skipAreas && catracaAreas.length > 0) {
    for (const a of catracaAreas) {
      const nome = (a.name || a.nome || '').toString().trim();
      if (!nome) continue;
      try {
        const [[existe]] = await db.query(
          'SELECT id FROM Area WHERE unidade_id = ? AND nome = ? LIMIT 1',
          [unidade_id, nome]
        );
        if (existe) {
          result.areasIgnoradas++;
          continue;
        }
        await db.query('INSERT INTO Area (nome, unidade_id) VALUES (?, ?)', [nome, unidade_id]);
        result.areasInseridas++;
      } catch (err) {
        result.erros.push(`Area "${nome}": ${err.message}`);
      }
    }
  }

  // 3) Inserir pessoas (users da catraca → Pessoa). Ordem: Pessoa antes de Aluno/Funcionario.
  if (!options.skipUsers && catracaUsers.length > 0) {
    const tipoPadrao = options.tipo_pessoa || 'ALUNO'; // ALUNO, PROFESSOR, etc.
    for (const u of catracaUsers) {
      const nome = (u.name || u.nome || '').toString().trim();
      if (!nome) continue;
      const registration = (u.registration || '').toString().trim();
      // qr_code no SAGE são 8 caracteres; se registration tiver 8, usar como qr_code
      const qr_code = registration.length === 8 ? registration : null;
      try {
        const [[existe]] = await db.query(
          'SELECT id FROM Pessoa WHERE unidade_id = ? AND nome = ? LIMIT 1',
          [unidade_id, nome]
        );
        if (existe) {
          result.pessoasIgnoradas++;
          continue;
        }
        await db.query(
          'INSERT INTO Pessoa (nome, unidade_id, qr_code, tipo, visivel) VALUES (?, ?, ?, ?, 1)',
          [nome, unidade_id, qr_code, tipoPadrao]
        );
        result.pessoasInseridas++;
      } catch (err) {
        result.erros.push(`Pessoa "${nome}": ${err.message}`);
      }
    }
  }

  logger.info(
    `[IMPORT CATRACA] ${dispositivo.nome} → SAGE: areas +${result.areasInseridas} (${result.areasIgnoradas} já existiam), pessoas +${result.pessoasInseridas} (${result.pessoasIgnoradas} já existiam)`
  );
  return result;
}

/**
 * Ordem de importação para uso em UI ou scripts (apenas referência).
 */
function getOrdemImportacaoSage() {
  return [...ORDEM_IMPORT_PARA_SAGE];
}

module.exports = {
  importarDaCatracaParaSage,
  obterUnidadeId,
  getOrdemImportacaoSage
};
