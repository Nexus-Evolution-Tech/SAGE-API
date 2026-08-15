const db = require("../config/database");
const logger = require('../config/logger');
const { ACOES, executarOperacaoAuditada, validarAutor } = require('../services/auditoriaService');

// ==============================
// Normalização de dia da semana
// ==============================
const DIA_DB = {
  'SEGUNDA': 'SEGUNDA',
  'SEGUNDA-FEIRA': 'SEGUNDA',
  'TERCA': 'TERÇA',
  'TERÇA': 'TERÇA',
  'TERÇA-FEIRA': 'TERÇA',
  'QUARTA': 'QUARTA',
  'QUARTA-FEIRA': 'QUARTA',
  'QUINTA': 'QUINTA',
  'QUINTA-FEIRA': 'QUINTA',
  'SEXTA': 'SEXTA',
  'SEXTA-FEIRA': 'SEXTA'
};

function toDbDiaSemana(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  return DIA_DB[v] || null;
}

function toApiDiaSemana(dbValue) {
  if (!dbValue) return null;
  if (dbValue === 'TERÇA') return 'TERCA';
  return dbValue;
}

// ==============================
// Normalização de divisão
// ==============================
const DIVISOES_VALIDAS = ['INT', 'DIV A', 'DIV B'];

function normalizarDivisao(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  // Normalizar "DIVA" -> "DIV A", "DIVB" -> "DIV B"
  const normalized = v.replace(/DIVA$/, 'DIV A').replace(/DIVB$/, 'DIV B');
  return DIVISOES_VALIDAS.includes(normalized) ? normalized : null;
}

// ==============================
// Validações de Conflitos
// ==============================
async function validarConflitoProfessor(professorId, dia, horario, divisao, horarioIdExcluir = null) {
  // IMPORTANTE: Professor não pode dar aula em duas turmas/divisões ao mesmo tempo
  // Checamos conflito SEM considerar a divisão - apenas dia + horário (um professor não é dois)
  if (!professorId) return null;

  const sql = `
    SELECT DISTINCT ha.id, ha.turma_id, ha.divisao, t.nome as turma_nome, a.nome as aula_nome,
           p.nome as professor_nome
    FROM HorarioAula ha
    JOIN Aula a ON ha.aula_id = a.id
    LEFT JOIN Turma t ON ha.turma_id = t.id
    LEFT JOIN Pessoa p ON a.professor_id = p.id
    WHERE a.professor_id = ?
      AND ha.dia_semana = ?
      AND ha.horario = ?
      ${horarioIdExcluir ? 'AND ha.id != ?' : ''}
  `;
  const params = [professorId, dia, horario];
  if (horarioIdExcluir) params.push(horarioIdExcluir);

  const [conflitos] = await db.query(sql, params);
  return conflitos.length > 0 ? conflitos : null;
}

async function validarConflitSala(salaId, dia, horario, divisao, horarioIdExcluir = null) {
  if (!salaId) return false;

  const sql = `
    SELECT id
    FROM HorarioAula
    WHERE sala_id = ?
      AND dia_semana = ?
      AND horario = ?
      AND divisao = ?
      ${horarioIdExcluir ? 'AND id != ?' : ''}
  `;
  const params = [salaId, dia, horario, divisao];
  if (horarioIdExcluir) params.push(horarioIdExcluir);

  const [conflitos] = await db.query(sql, params);
  return conflitos.length > 0;
}

async function validarDuplicadaTurma(turmaId, dia, horario, divisao, horarioIdExcluir = null) {
  const sql = `
    SELECT id
    FROM HorarioAula
    WHERE turma_id = ?
      AND dia_semana = ?
      AND horario = ?
      AND divisao = ?
      ${horarioIdExcluir ? 'AND id != ?' : ''}
  `;
  const params = [turmaId, dia, horario, divisao];
  if (horarioIdExcluir) params.push(horarioIdExcluir);

  const [rows] = await db.query(sql, params);
  return rows.length > 0;
}

// ==============================
// Controller
// ==============================
const horarioAulaController = {

  // ====================================
  // GET /horarios-aulas
  // ====================================
  async listar(req, res) {
    try {
      const { turmaId, diaSemana, divisao } = req.query;

      let sql = `
        SELECT
          ha.id,
          ha.turma_id,
          ha.aula_id,
          ha.divisao,
          ha.dia_semana,
          ha.horario,
          ha.divisao,
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

      if (divisao) {
        const divNorm = normalizarDivisao(divisao);
        if (!divNorm) {
          return res.status(400).json({ message: 'Divisão inválida' });
        }
        sql += ' AND ha.divisao = ?';
        params.push(divNorm);
      }

      sql += `
        ORDER BY
          FIELD(ha.dia_semana, 'SEGUNDA','TERÇA','QUARTA','QUINTA','SEXTA'),
          CAST(ha.horario AS TIME),
          FIELD(ha.divisao, 'INT', 'DIV A', 'DIV B')
      `;

      const [rows] = await db.query(sql, params);

      const response = rows.map(r => {
        return {
          id: r.id,
          turmaId: r.turma_id,
          aulaId: r.aula_id,
          diaSemana: toApiDiaSemana(r.dia_semana),
          horario: r.horario, // Já vem no formato correto "07:30-08:20"
          divisao: r.divisao,
          salaId: r.sala_id,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        };
      });

      res.json(response);

    } catch (err) {
      logger.error('[HORARIO] codigo=HORARIO_LISTAR_FALHOU');
      res.status(500).json({ message: 'Erro ao listar horários' });
    }
  },

  // ====================================
  // POST /horarios-aulas
  // ====================================
  async criar(req, res) {
    try {
      validarAutor(req?.user?.usuario_id);
      const { turmaId, aulaId, diaSemana, horario, divisao, salaId } = req.body;

      // Validações básicas
      if (!turmaId || !aulaId || !diaSemana || !horario) {
        return res.status(400).json({
          message: 'turmaId, aulaId, diaSemana e horario são obrigatórios'
        });
      }

      // Normalizar e validar dia
      const diaDb = toDbDiaSemana(diaSemana);
      const divNorm = normalizarDivisao(divisao);

      if (!diaDb) {
        return res.status(400).json({ message: 'Dia da semana inválido' });
      }

      // Normalizar e validar divisão (obrigatória)
      if (!divNorm) {
        return res.status(400).json({
          message: 'Divisão inválida. Use: INT, DIV A, DIV B'
        });
      }

      // Buscar dados da aula para validação
      const [aulaDados] = await db.query(
        'SELECT professor_id, sala_padrao_id FROM Aula WHERE id = ?',
        [aulaId]
      );

      if (aulaDados.length === 0) {
        return res.status(404).json({ message: 'Aula não encontrada' });
      }

      const { professor_id: professorId } = aulaDados[0];
      const salaFinal = salaId || null; // Pode vir do body ou deixar null

      // Validar duplicata (mesma turma, dia, horário, divisão)
      const ehDuplicada = await validarDuplicadaTurma(turmaId, diaDb, horario, divNorm);
      if (ehDuplicada) {
        return res.status(409).json({
          message: 'Já existe aula neste horário e divisão para esta turma'
        });
      }

      // Validar conflito de professor (não pode dar aula em 2 turmas no mesmo dia/horário)
      const conflitoProfessor = await validarConflitoProfessor(
        professorId,
        diaDb,
        horario,
        divNorm
      );
      if (conflitoProfessor) {
        const conflicts = conflitoProfessor.map(c => ({
          type: 'professor',
          details: {
            professorNome: c.professor_nome || 'Professor',
            aulaConflito: c.aula_nome || 'Aula',
            turmaConflito: c.turma_nome || `Turma ${c.turma_id}`
          }
        }));
        return res.status(409).json({
          message: 'Professor já possui aula neste horário e dia',
          conflicts
        });
      }

      // Validar conflito de sala
      const temConflitSala = await validarConflitSala(
        salaFinal,
        diaDb,
        horario,
        divNorm
      );
      if (temConflitSala) {
        return res.status(409).json({
          message: 'Conflito: sala já está em uso neste horário e divisão'
        });
      }

      // Inserir novo horário
      const result = await executarOperacaoAuditada({
        req, acao: ACOES.REGISTRO_CRIADO, entidade: 'HorarioAula',
        entidadeId: (insertResult) => insertResult?.insertId,
        operacao: async (connection) => {
          const [insertResult] = await connection.query(
        `
        INSERT INTO HorarioAula
          (turma_id, aula_id, dia_semana, horario, divisao, sala_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [turmaId, aulaId, diaDb, horario, divNorm, salaFinal]
          );
          return insertResult;
        }
      });

      if (!result || !result.insertId) {
        logger.error('[HORARIO] codigo=HORARIO_CRIAR_SEM_ID');
        return res.status(500).json({
          message: 'Erro ao inserir horário no banco de dados'
        });
      }

      res.status(201).json({
        id: result.insertId,
        message: 'Horário criado com sucesso'
      });

    } catch (err) {
      logger.error('[HORARIO] codigo=HORARIO_CRIAR_FALHOU');
      res.status(500).json({ message: 'Erro ao criar horário' });
    }
  },

  // ====================================
  // PUT /horarios-aulas/:id
  // ====================================
  async editar(req, res) {
    try {
      validarAutor(req?.user?.usuario_id);
      const { id } = req.params;
      const { turmaId, aulaId, diaSemana, horario, divisao, salaId } = req.body;

      // Buscar horário existente
      const [existe] = await db.query(
        'SELECT * FROM HorarioAula WHERE id = ?',
        [id]
      );

      if (existe.length === 0) {
        return res.status(404).json({ message: 'Horário não encontrado' });
      }

      const atual = existe[0];

      // Determinar novos valores (usa atual se não fornecido)
      const novoTurmaId = turmaId ?? atual.turma_id;
      const novoAulaId = aulaId ?? atual.aula_id;
      const novoHorario = horario ?? atual.horario;
      const novoDiv = divisao ? normalizarDivisao(divisao) : atual.divisao;
      const novoDia = diaSemana ? toDbDiaSemana(diaSemana) : atual.dia_semana;

      if (!novoDia) {
        return res.status(400).json({ message: 'Dia da semana inválido' });
      }

      if (!novoDiv) {
        return res.status(400).json({ message: 'Divisão inválida' });
      }

      // Buscar dados da nova aula se mudou
      const [aulaDados] = await db.query(
        'SELECT professor_id FROM Aula WHERE id = ?',
        [novoAulaId]
      );

      if (aulaDados.length === 0) {
        return res.status(404).json({ message: 'Aula não encontrada' });
      }

      const { professor_id: professorId } = aulaDados[0];
      const novoSalaId = salaId ?? atual.sala_id;

      // Validar duplicata (excluindo este registro)
      const ehDuplicada = await validarDuplicadaTurma(
        novoTurmaId,
        novoDia,
        novoHorario,
        novoDiv,
        id
      );
      if (ehDuplicada) {
        return res.status(409).json({
          message: 'Já existe aula neste horário e divisão para esta turma'
        });
      }

      // Validar conflito de professor (excluindo este registro)
      const conflitoProfessor = await validarConflitoProfessor(
        professorId,
        novoDia,
        novoHorario,
        novoDiv,
        id
      );
      if (conflitoProfessor) {
        const conflicts = conflitoProfessor.map(c => ({
          type: 'professor',
          details: {
            professorNome: c.professor_nome || 'Professor',
            aulaConflito: c.aula_nome || 'Aula',
            turmaConflito: c.turma_nome || `Turma ${c.turma_id}`
          }
        }));
        return res.status(409).json({
          message: 'Professor já possui aula neste horário e dia',
          conflicts
        });
      }

      // Validar conflito de sala (excluindo este registro)
      const temConflitSala = await validarConflitSala(
        novoSalaId,
        novoDia,
        novoHorario,
        novoDiv,
        id
      );
      if (temConflitSala) {
        return res.status(409).json({
          message: 'Conflito: sala já está em uso neste horário e divisão'
        });
      }

      // Atualizar horário
      await executarOperacaoAuditada({
        req, acao: ACOES.REGISTRO_EDITADO, entidade: 'HorarioAula', entidadeId: Number(id),
        operacao: (connection) => connection.query(
        `
        UPDATE HorarioAula
        SET
          turma_id = ?,
          aula_id = ?,
          dia_semana = ?,
          horario = ?,
          divisao = ?,
          sala_id = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [novoTurmaId, novoAulaId, novoDia, novoHorario, novoDiv, novoSalaId, id]
        )
      });

      res.json({ message: 'Horário atualizado com sucesso' });

    } catch (err) {
      logger.error('[HORARIO] codigo=HORARIO_EDITAR_FALHOU');
      res.status(500).json({ message: 'Erro ao editar horário' });
    }
  },

  // ====================================
  // POST /horarios-aulas/validar
  // ====================================
  async validar(req, res) {
    try {
      const { turmaId, diaSemana, horario, divisao, aulaId, horarioIdExcluir } = req.body;

      if (!turmaId || !diaSemana || !horario || !divisao) {
        return res.status(400).json({
          message: 'turmaId, diaSemana, horario e divisao são obrigatórios'
        });
      }

      const diaDb = toDbDiaSemana(diaSemana);
      const divNorm = normalizarDivisao(divisao);

      if (!diaDb) {
        return res.status(400).json({ message: 'Dia da semana inválido' });
      }

      if (!divNorm) {
        return res.status(400).json({ message: 'Divisão inválida' });
      }

      const ehDuplicada = await validarDuplicadaTurma(
        turmaId,
        diaDb,
        horario,
        divNorm,
        horarioIdExcluir
      );
      if (ehDuplicada) {
        return res.status(409).json({
          message: 'Já existe aula neste horário e divisão para esta turma',
          conflicts: [{ type: 'duplicata', message: 'Slot já ocupado para esta turma' }]
        });
      }

      // Validar conflito de professor (quando aulaId informado)
      if (aulaId) {
        const [aulaDados] = await db.query(
          'SELECT professor_id FROM Aula WHERE id = ?',
          [aulaId]
        );
        if (aulaDados.length > 0 && aulaDados[0].professor_id) {
          const conflitoProfessor = await validarConflitoProfessor(
            aulaDados[0].professor_id,
            diaDb,
            horario,
            divNorm,
            horarioIdExcluir
          );
          if (conflitoProfessor) {
            const conflicts = conflitoProfessor.map(c => ({
              type: 'professor',
              details: {
                professorNome: c.professor_nome || 'Professor',
                aulaConflito: c.aula_nome || 'Aula',
                turmaConflito: c.turma_nome || `Turma ${c.turma_id}`
              }
            }));
            return res.status(409).json({
              message: 'Professor já possui aula neste horário e dia',
              conflicts
            });
          }
        }
      }

      res.json({ valid: true });
    } catch (err) {
      logger.error('[HORARIO] codigo=HORARIO_VALIDAR_FALHOU');
      res.status(500).json({ message: 'Erro ao validar horário' });
    }
  },

  // ====================================
  // DELETE /horarios-aulas/:id
  // ====================================
  async deletar(req, res) {
    try {
      validarAutor(req?.user?.usuario_id);
      const { id } = req.params;

      const [existe] = await db.query(
        'SELECT id FROM HorarioAula WHERE id = ?',
        [id]
      );

      if (existe.length === 0) {
        return res.status(404).json({ message: 'Horário não encontrado' });
      }

      await executarOperacaoAuditada({
        req, acao: ACOES.REGISTRO_DELETADO, entidade: 'HorarioAula', entidadeId: Number(id),
        operacao: (connection) => connection.query('DELETE FROM HorarioAula WHERE id = ?', [id])
      });
      res.status(204).send();

    } catch (err) {
      logger.error('[HORARIO] codigo=HORARIO_DELETAR_FALHOU');
      res.status(500).json({ message: 'Erro ao deletar horário' });
    }
  }
};

module.exports = horarioAulaController;
