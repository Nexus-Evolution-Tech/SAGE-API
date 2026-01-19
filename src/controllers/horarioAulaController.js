const db = require("../config/database");

// -----------------------------
// Normalização de dia da semana
// -----------------------------
const DIA_DB = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

function toDbDiaSemana(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  if (v === 'TERCA') return 'TERÇA';
  if (DIA_DB.includes(v)) return v;
  return null;
}

function toApiDiaSemana(dbValue) {
  if (!dbValue) return null;
  if (dbValue === 'TERÇA') return 'TERCA';
  return dbValue;
}

// -----------------------------
// Normalização de divisão
// -----------------------------
function normalizeDivisao(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  if (v === 'A' || v === 'DIV A') return 'DIV A';
  if (v === 'B' || v === 'DIV B') return 'DIV B';
  if (v === 'A/B' || v === 'DIV A/B') return 'DIV A/B';
  if (v === 'INT') return 'INT';
  return v;
}

// -----------------------------
// Controller
// -----------------------------
const horarioAulaController = {

  // ------------------------------------
  // GET /horarios-aulas
  // ------------------------------------
  async listar(req, res) {
    try {
      const { turmaId, diaSemana, divisao } = req.query;
      const div = normalizeDivisao(divisao);

      let sql = `
        SELECT
          ha.id,
          ha.turma_id,
          ha.aula_id,
          ha.divisao,
          ha.dia_semana,
          ha.inicio,
          ha.fim,
          ha.sala_id,
          ha.created_at,
          ha.updated_at
        FROM HorarioAula ha
        WHERE 1=1
      `;
      const params = [];

      if (turmaId) {
        sql += ' AND ha.turma_id = ?';
        params.push(turmaId);
      }

      if (diaSemana) {
        const diaDb = toDbDiaSemana(diaSemana);
        if (!diaDb) {
          return res.status(400).json({ message: 'Dia da semana inválido' });
        }
        sql += ' AND ha.dia_semana = ?';
        params.push(diaDb);
      }

      if (div) {
        sql += ' AND (ha.divisao = ? OR ha.divisao = "INT")';
        params.push(div);
      }

      sql += `
        ORDER BY
          FIELD(ha.dia_semana, 'DOMINGO','SEGUNDA','TERÇA','QUARTA','QUINTA','SEXTA','SABADO'),
          ha.inicio
      `;

      const [rows] = await db.query(sql, params);

      const response = rows.map(r => ({
        id: r.id,
        turmaId: r.turma_id,
        aulaId: r.aula_id,
        divisao: r.divisao,
        diaSemana: toApiDiaSemana(r.dia_semana),
        inicio: r.inicio,
        fim: r.fim,
        salaId: r.sala_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));

      res.json(response);

    } catch (err) {
      console.error('Erro ao listar horários:', err);
      res.status(500).json({ message: 'Erro ao listar horários' });
    }
  },

  // ------------------------------------
  // POST /horarios-aulas
  // ------------------------------------
  async criar(req, res) {
    try {
      let { turmaId, aulaId, diaSemana, divisao, inicio, fim, salaId } = req.body;

      if (!turmaId || !aulaId || !diaSemana || !inicio || !fim) {
        return res.status(400).json({
          message: 'turmaId, aulaId, diaSemana, inicio e fim são obrigatórios'
        });
      }

      const diaDb = toDbDiaSemana(diaSemana);
      const div = normalizeDivisao(divisao) || 'INT';

      if (!diaDb) {
        return res.status(400).json({ message: 'Dia da semana inválido' });
      }

      // conflito: mesma turma, mesmo dia, sobreposição de horário
      const [conflito] = await db.query(
        `
        SELECT id
        FROM HorarioAula
        WHERE turma_id = ?
          AND dia_semana = ?
          AND divisao = ?
          AND NOT (fim <= ? OR inicio >= ?)
        `,
        [turmaId, diaDb, div, inicio, fim]
      );

      if (conflito.length > 0) {
        return res.status(409).json({
          message: 'Conflito de horário para a turma/divisão'
        });
      }

      const [result] = await db.query(
        `
        INSERT INTO HorarioAula
          (turma_id, aula_id, dia_semana, divisao, inicio, fim, sala_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [turmaId, aulaId, diaDb, div, inicio, fim, salaId || null]
      );

      res.status(201).json({ id: result.insertId });

    } catch (err) {
      console.error('Erro ao criar horário:', err);
      res.status(500).json({ message: 'Erro ao criar horário' });
    }
  },

  // ------------------------------------
  // PUT /horarios-aulas/:id
  // ------------------------------------
  async editar(req, res) {
    try {
      const { id } = req.params;
      let { turmaId, aulaId, diaSemana, divisao, inicio, fim, salaId } = req.body;

      const [existe] = await db.query(
        'SELECT * FROM HorarioAula WHERE id = ?',
        [id]
      );

      if (existe.length === 0) {
        return res.status(404).json({ message: 'Horário não encontrado' });
      }

      const atual = existe[0];

      const novoTurmaId = turmaId ?? atual.turma_id;
      const novoAulaId  = aulaId ?? atual.aula_id;
      const novoInicio  = inicio ?? atual.inicio;
      const novoFim     = fim ?? atual.fim;
      const novoDia     = diaSemana ? toDbDiaSemana(diaSemana) : atual.dia_semana;
      const novoDiv     = normalizeDivisao(divisao) ?? atual.divisao;

      if (!novoDia) {
        return res.status(400).json({ message: 'Dia da semana inválido' });
      }

      const [conflito] = await db.query(
        `
        SELECT id
        FROM HorarioAula
        WHERE turma_id = ?
          AND dia_semana = ?
          AND divisao = ?
          AND id != ?
          AND NOT (fim <= ? OR inicio >= ?)
        `,
        [novoTurmaId, novoDia, novoDiv, id, novoInicio, novoFim]
      );

      if (conflito.length > 0) {
        return res.status(409).json({
          message: 'Conflito de horário para a turma/divisão'
        });
      }

      await db.query(
        `
        UPDATE HorarioAula
        SET
          turma_id = ?,
          aula_id = ?,
          dia_semana = ?,
          divisao = ?,
          inicio = ?,
          fim = ?,
          sala_id = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [
          novoTurmaId,
          novoAulaId,
          novoDia,
          novoDiv,
          novoInicio,
          novoFim,
          salaId ?? atual.sala_id,
          id
        ]
      );

      res.json({ message: 'Horário atualizado com sucesso' });

    } catch (err) {
      console.error('Erro ao editar horário:', err);
      res.status(500).json({ message: 'Erro ao editar horário' });
    }
  },

  // ------------------------------------
  // POST /horarios-aulas/validar
  // ------------------------------------
  async validar(req, res) {
    try {
      let { turmaId, diaSemana, divisao, inicio, fim, horarioIdExcluir } = req.body;

      if (!turmaId || !diaSemana || !inicio || !fim) {
        return res.status(400).json({ message: 'Dados obrigatórios ausentes' });
      }

      const diaDb = toDbDiaSemana(diaSemana);
      const div = normalizeDivisao(divisao) || 'INT';

      if (!diaDb) {
        return res.status(400).json({ message: 'Dia da semana inválido' });
      }

      let sql = `
        SELECT id
        FROM HorarioAula
        WHERE turma_id = ?
          AND dia_semana = ?
          AND divisao = ?
          AND NOT (fim <= ? OR inicio >= ?)
      `;
      const params = [turmaId, diaDb, div, inicio, fim];

      if (horarioIdExcluir) {
        sql += ' AND id != ?';
        params.push(horarioIdExcluir);
      }

      const [rows] = await db.query(sql, params);

      res.json({
        valid: rows.length === 0,
        conflicts: rows
      });

    } catch (err) {
      console.error('Erro ao validar horário:', err);
      res.status(500).json({ message: 'Erro ao validar horário' });
    }
  },

  // ------------------------------------
  // DELETE /horarios-aulas/:id
  // ------------------------------------
  async deletar(req, res) {
    try {
      const { id } = req.params;

      const [existe] = await db.query(
        'SELECT id FROM HorarioAula WHERE id = ?',
        [id]
      );

      if (existe.length === 0) {
        return res.status(404).json({ message: 'Horário não encontrado' });
      }

      await db.query('DELETE FROM HorarioAula WHERE id = ?', [id]);
      res.status(204).send();

    } catch (err) {
      console.error('Erro ao deletar horário:', err);
      res.status(500).json({ message: 'Erro ao deletar horário' });
    }
  }
};

module.exports = horarioAulaController;
