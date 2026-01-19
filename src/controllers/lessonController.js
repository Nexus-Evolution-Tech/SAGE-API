const db = require('../config/database');
const logger = require('../config/logger');

// Helper
function parseId(id) {
  if (id === undefined || id === null || id === 'null') return null;
  const parsed = parseInt(id);
  return isNaN(parsed) ? null : parsed;
}

// Normalização de divisão
function normalizeDivisao(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  if (v === 'A' || v === 'DIV A') return 'DIV A';
  if (v === 'B' || v === 'DIV B') return 'DIV B';
  if (v === 'A/B' || v === 'DIV A/B') return 'DIV A/B';
  if (v === 'INT') return 'INT';
  return v;
}

const lessonController = {

  // --------------------------------------------------
  // GET /aulas
  // --------------------------------------------------
  async listar(req, res) {
    const { search } = req.query;

    try {
      let sql = `
        SELECT
          a.id,
          a.nome,
          a.professor_id AS professorId,
          a.materia_id AS materiaId,
          a.sala_padrao_id AS salaPadraoId,
          a.divisao,
          a.observacao,
          a.created_at AS createdAt,
          a.updated_at AS updatedAt
        FROM Aula a
        WHERE 1 = 1
      `;

      const params = [];

      if (search) {
        sql += ' AND a.nome LIKE ?';
        params.push(`%${search}%`);
      }

      sql += ' ORDER BY a.nome';

      const [rows] = await db.query(sql, params);
      res.json(rows || []);
    } catch (error) {
      logger.error(`Erro ao listar aulas: ${error.message}`);
      res.status(500).json({ message: 'Erro ao listar aulas' });
    }
  },

  // --------------------------------------------------
  // POST /aulas
  // --------------------------------------------------
  async criar(req, res) {
    let {
      nome,
      professorId,
      materiaId,
      salaPadraoId,
      divisao = 'INT',
      observacao
    } = req.body;

    professorId = parseId(professorId);
    materiaId = parseId(materiaId);
    salaPadraoId = parseId(salaPadraoId);
    divisao = normalizeDivisao(divisao);

    if (!nome) {
      return res.status(400).json({ message: 'nome é obrigatório' });
    }
    if (!professorId) {
      return res.status(400).json({ message: 'professorId é obrigatório' });
    }
    if (!materiaId) {
      return res.status(400).json({ message: 'materiaId é obrigatório' });
    }

    try {
      // Valida professor
      const [prof] = await db.query(
        `SELECT id FROM Pessoa WHERE id = ? AND tipo = 'PROFESSOR'`,
        [professorId]
      );
      if (prof.length === 0) {
        return res.status(400).json({ message: 'Professor inválido' });
      }

      // Valida matéria
      const [mat] = await db.query(
        `SELECT id FROM Materia WHERE id = ?`,
        [materiaId]
      );
      if (mat.length === 0) {
        return res.status(400).json({ message: 'Matéria inválida' });
      }

      const [result] = await db.query(
        `
        INSERT INTO Aula
          (nome, professor_id, materia_id, sala_padrao_id, divisao, observacao)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          nome,
          professorId,
          materiaId,
          salaPadraoId,
          divisao,
          observacao || null
        ]
      );

      const [aula] = await db.query(
        `
        SELECT
          id,
          nome,
          professor_id AS professorId,
          materia_id AS materiaId,
          sala_padrao_id AS salaPadraoId,
          divisao,
          observacao,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM Aula
        WHERE id = ?
        `,
        [result.insertId]
      );

      res.status(201).json(aula[0]);
    } catch (error) {
      logger.error(`Erro ao criar aula: ${error.message}`);
      res.status(500).json({ message: 'Erro ao criar aula' });
    }
  },

  // --------------------------------------------------
  // PUT /aulas/:id
  // --------------------------------------------------
  async editar(req, res) {
    const { id } = req.params;
    let {
      nome,
      professorId,
      materiaId,
      salaPadraoId,
      divisao,
      observacao
    } = req.body;

    professorId = parseId(professorId);
    materiaId = parseId(materiaId);
    salaPadraoId = parseId(salaPadraoId);
    divisao = normalizeDivisao(divisao);

    try {
      const campos = [];
      const valores = [];

      if (nome !== undefined) {
        campos.push('nome = ?');
        valores.push(nome);
      }

      if (professorId !== null && professorId !== undefined) {
        const [prof] = await db.query(
          `SELECT id FROM Pessoa WHERE id = ? AND tipo = 'PROFESSOR'`,
          [professorId]
        );
        if (prof.length === 0) {
          return res.status(400).json({ message: 'Professor inválido' });
        }
        campos.push('professor_id = ?');
        valores.push(professorId);
      }

      if (materiaId !== null && materiaId !== undefined) {
        const [mat] = await db.query(
          `SELECT id FROM Materia WHERE id = ?`,
          [materiaId]
        );
        if (mat.length === 0) {
          return res.status(400).json({ message: 'Matéria inválida' });
        }
        campos.push('materia_id = ?');
        valores.push(materiaId);
      }

      if (salaPadraoId !== undefined) {
        campos.push('sala_padrao_id = ?');
        valores.push(salaPadraoId);
      }

      if (divisao !== undefined) {
        campos.push('divisao = ?');
        valores.push(divisao);
      }

      if (observacao !== undefined) {
        campos.push('observacao = ?');
        valores.push(observacao);
      }

      if (campos.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar' });
      }

      valores.push(id);

      await db.query(
        `UPDATE Aula SET ${campos.join(', ')} WHERE id = ?`,
        valores
      );

      res.json({ message: 'Aula atualizada com sucesso' });
    } catch (error) {
      logger.error(`Erro ao atualizar aula: ${error.message}`);
      res.status(500).json({ message: 'Erro ao atualizar aula' });
    }
  },

  // --------------------------------------------------
  // DELETE /aulas/:id
  // --------------------------------------------------
  async deletar(req, res) {
    const { id } = req.params;

    try {
      // Remove vínculos primeiro
      await db.query(`DELETE FROM HorarioAula WHERE aula_id = ?`, [id]);

      const [result] = await db.query(`DELETE FROM Aula WHERE id = ?`, [id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Aula não encontrada' });
      }

      res.json({ message: 'Aula removida com sucesso' });
    } catch (error) {
      logger.error(`Erro ao deletar aula: ${error.message}`);
      res.status(500).json({ message: 'Erro ao deletar aula' });
    }
  },

  // --------------------------------------------------
  // GET /aulas/horarios/:turma_id/:divisao  (COMPAT)
  // --------------------------------------------------
  async getHorariosPorTurma(req, res) {
    const { turma_id, divisao } = req.params;
    const turmaId = parseId(turma_id);
    const div = normalizeDivisao(divisao);

    if (!turmaId || !div) {
      return res.status(400).json({ message: 'Parâmetros inválidos' });
    }

    try {
      const [rows] = await db.query(
        `
        SELECT
          a.id AS aulaId,
          a.nome,
          a.divisao,
          h.dia_semana AS diaSemana,
          h.inicio,
          h.fim
        FROM HorarioAula h
        JOIN Aula a ON a.id = h.aula_id
        WHERE h.turma_id = ?
          AND (a.divisao = 'INT' OR a.divisao = ?)
        ORDER BY h.dia_semana, h.inicio
        `,
        [turmaId, div]
      );

      res.json(rows || []);
    } catch (error) {
      logger.error(`Erro ao buscar horários por turma: ${error.message}`);
      res.status(500).json({ message: 'Erro ao buscar horários' });
    }
  }
};

module.exports = lessonController;
