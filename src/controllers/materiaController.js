const db = require('../config/database');
const logger = require('../config/logger');
const { ACOES, executarOperacaoAuditada, validarAutor } = require('../services/auditoriaService');
const { responderErroInterno } = require('../utils/responderErroInterno');

const materiaController = {
  // GET /materias - Lista todas as matérias
  async listar(req, res) {
    try {
      const [materias] = await db.query(
        `SELECT id, nome, createdAt, updatedAt FROM (
          SELECT id, nome, created_at as createdAt, updated_at as updatedAt FROM Materia
        ) sub ORDER BY nome`
      );

      res.json(materias || []);
    } catch (error) {
      logger.error(`Erro ao listar matérias: ${error.message}`);
      responderErroInterno(res, error, 'Erro ao listar matérias');
    }
  },

  // POST /materias - Cria nova matéria
  async criar(req, res) {
    const { nome } = req.body;

    // Validações
    if (!nome) {
      return res.status(400).json({ message: 'Nome da matéria é obrigatório' });
    }

    if (nome.trim().length < 2) {
      return res.status(400).json({ message: 'Nome da matéria deve ter no mínimo 2 caracteres' });
    }

    try {
      validarAutor(req?.user?.usuario_id);
      // Verificar se já existe (case-insensitive)
      const [existente] = await db.query(
        `SELECT id FROM Materia WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?))`,
        [nome]
      );

      if (existente && existente.length > 0) {
        return res.status(409).json({ message: 'Já existe uma matéria com esse nome' });
      }

      // Inserir nova matéria
      const materia = await executarOperacaoAuditada({
        req, acao: ACOES.REGISTRO_CRIADO, entidade: 'Materia',
        entidadeId: (registro) => registro?.id,
        operacao: async (connection) => {
          const [result] = await connection.query(
            'INSERT INTO Materia (nome) VALUES (?)', [nome.trim()]
          );

      // Retornar matéria criada
      const [rows] = await connection.query(
        `SELECT id, nome, created_at as createdAt, updated_at as updatedAt FROM Materia WHERE id = ?`,
        [result.insertId]
      );
          return rows[0];
        }
      });

      res.status(201).json(materia);
    } catch (error) {
      logger.error(`Erro ao criar matéria: ${error.message}`);
      responderErroInterno(res, error, 'Erro ao criar matéria');
    }
  },

  // DELETE /materias/:id - Remove matéria
  async deletar(req, res) {
    const { id } = req.params;

    try {
      validarAutor(req?.user?.usuario_id);
      // Verificar se há aulas usando esta matéria
      const [aulasUsando] = await db.query(
        'SELECT COUNT(*) as total FROM Aula WHERE materia_id = ?',
        [id]
      );

      if (aulasUsando[0].total > 0) {
        return res.status(409).json({ 
          message: `Não é possível deletar: ${aulasUsando[0].total} aula(s) ainda usa(m) esta matéria` 
        });
      }

      // Deletar matéria
      const [existente] = await db.query('SELECT id FROM Materia WHERE id = ?', [id]);

      if (existente.length === 0) {
        return res.status(404).json({ message: 'Matéria não encontrada' });
      }

      await executarOperacaoAuditada({
        req, acao: ACOES.REGISTRO_DELETADO, entidade: 'Materia', entidadeId: Number(id),
        operacao: (connection) => connection.query('DELETE FROM Materia WHERE id = ?', [id])
      });
      return res.status(204).send();
    } catch (error) {
      logger.error(`Erro ao deletar matéria: ${error.message}`);
      responderErroInterno(res, error, 'Erro ao deletar matéria');
    }
  }
};

module.exports = materiaController;
