const db = require("../config/database");

// Normalização de dias da semana
const DIA_DB = {
  SEGUNDA: 'SEGUNDA',
  TERCA: 'TERÇA',
  QUARTA: 'QUARTA',
  QUINTA: 'QUINTA',
  SEXTA: 'SEXTA'
};

const DIA_API = {
  'SEGUNDA': 'SEGUNDA',
  'TERÇA': 'TERCA',
  'QUARTA': 'QUARTA',
  'QUINTA': 'QUINTA',
  'SEXTA': 'SEXTA'
};

function toDbDiaSemana(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  if (v === 'SEGUNDA') return DIA_DB.SEGUNDA;
  if (v === 'TERCA' || v === 'TERÇA') return DIA_DB.TERCA;
  if (v === 'QUARTA') return DIA_DB.QUARTA;
  if (v === 'QUINTA') return DIA_DB.QUINTA;
  if (v === 'SEXTA') return DIA_DB.SEXTA;
  return null;
}

function toApiDiaSemana(dbValue) {
  if (!dbValue) return null;
  return DIA_API[dbValue] || dbValue;
}

const horarioAulaController = {
  async listar(req, res) {
    try {
      const { turmaId, diaSemana } = req.query;

      let query = "SELECT * FROM HorarioAula WHERE 1=1";
      const params = [];

      if (turmaId) {
        query += " AND turma_id = ?";
        params.push(turmaId);
      }

      if (diaSemana) {
        const diaDb = toDbDiaSemana(diaSemana);
        if (!diaDb) {
          return res.status(400).json({ message: "Dia da semana inválido. Use: SEGUNDA, TERCA, QUARTA, QUINTA ou SEXTA" });
        }
        query += " AND dia_semana = ?";
        params.push(diaDb);
      }

      query += " ORDER BY FIELD(dia_semana, 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA'), horario";

      const [horarios] = await db.query(query, params);

      // Converter para camelCase
      const horariosFormatados = horarios.map((horario) => ({
        id: horario.id,
        turmaId: horario.turma_id,
        aulaId: horario.aula_id,
        diaSemana: toApiDiaSemana(horario.dia_semana),
        horario: horario.horario,
        salaId: horario.sala_id,
        createdAt: horario.created_at,
        updatedAt: horario.updated_at,
      }));

      return res.status(200).json(horariosFormatados);
    } catch (error) {
      console.error("Erro ao listar horários:", error);
      return res.status(500).json({ message: "Erro ao listar horários" });
    }
  },

  async criar(req, res) {
    try {
      let { turmaId, aulaId, diaSemana, horario, salaId } = req.body;

      // Validações
      if (!turmaId || !aulaId || !diaSemana || !horario) {
        return res.status(400).json({
          message: "Turma, aula, dia da semana e horário são obrigatórios",
        });
      }

      // Normalizar horário: se vier como intervalo "07:30-08:20", extrair apenas início
      if (typeof horario === 'string' && horario.includes('-')) {
        horario = horario.split('-')[0].trim();
      }

      // Validar dia da semana
      const diaDb = toDbDiaSemana(diaSemana);
      if (!diaDb) {
        return res.status(400).json({
          message: "Dia da semana inválido. Use: SEGUNDA, TERCA, QUARTA, QUINTA ou SEXTA",
        });
      }

      // Verificar se a turma existe
      const [turmaExiste] = await db.query("SELECT id FROM Turma WHERE id = ?", [turmaId]);
      if (turmaExiste.length === 0) {
        return res.status(404).json({ message: "Turma não encontrada" });
      }

      // Verificar se a aula existe
      const [aulaExiste] = await db.query("SELECT id FROM Aula WHERE id = ?", [aulaId]);
      if (aulaExiste.length === 0) {
        return res.status(404).json({ message: "Aula não encontrada" });
      }

      // Verificar conflito de horário (mesmo dia, mesma turma, mesmo horário)
      const [conflito] = await db.query(
        "SELECT id FROM HorarioAula WHERE turma_id = ? AND dia_semana = ? AND horario = ?",
        [turmaId, diaDb, horario]
      );

      if (conflito.length > 0) {
        return res.status(409).json({
          message: "Já existe um horário para esta turma neste dia e horário",
        });
      }

      // Validar conflitos de professor e sala
      const validacao = await horarioAulaController.validarConflitos(
        turmaId, aulaId, diaDb, horario, salaId || null
      );

      if (!validacao.valid) {
        // Create clean copy of conflicts to avoid serialization issues
        const cleanConflicts = validacao.conflicts.map(c => ({
          type: c.type,
          message: c.message,
          details: c.details ? {...c.details} : undefined
        }));
        return res.status(409).json({
          message: 'Conflito de horário detectado',
          conflicts: cleanConflicts
        });
      }

      // Inserir horário
      const [result] = await db.query(
        "INSERT INTO HorarioAula (turma_id, aula_id, dia_semana, horario, sala_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
        [turmaId, aulaId, diaDb, horario, salaId || null]
      );

      // Buscar o horário criado
      const [horarioCriado] = await db.query("SELECT * FROM HorarioAula WHERE id = ?", [result.insertId]);

      // Retornar em camelCase
      return res.status(201).json({
        id: horarioCriado[0].id,
        turmaId: horarioCriado[0].turma_id,
        aulaId: horarioCriado[0].aula_id,
        diaSemana: toApiDiaSemana(horarioCriado[0].dia_semana),
        horario: horarioCriado[0].horario,
        salaId: horarioCriado[0].sala_id,
        createdAt: horarioCriado[0].created_at,
        updatedAt: horarioCriado[0].updated_at,
      });
    } catch (error) {
      console.error("Erro ao criar horário:", error);
      return res.status(500).json({ message: "Erro ao criar horário" });
    }
  },

  async editar(req, res) {
    try {
      const { id } = req.params;
      let { turmaId, aulaId, diaSemana, horario, salaId } = req.body;

      // Verificar se o horário existe
      const [horarioExiste] = await db.query("SELECT * FROM HorarioAula WHERE id = ?", [id]);
      if (horarioExiste.length === 0) {
        return res.status(404).json({ message: "Horário não encontrado" });
      }

      const horarioAtual = horarioExiste[0];

      // Normalizar horário: se vier como intervalo "07:30-08:20", extrair apenas início
      if (horario && typeof horario === 'string' && horario.includes('-')) {
        horario = horario.split('-')[0].trim();
      }

      // Validar dia da semana (se fornecido)
      if (diaSemana) {
        const diaDb = toDbDiaSemana(diaSemana);
        if (!diaDb) {
          return res.status(400).json({
            message: "Dia da semana inválido. Use: SEGUNDA, TERCA, QUARTA, QUINTA ou SEXTA",
          });
        }
      }

      // Verificar turma (se fornecida)
      if (turmaId) {
        const [turmaExiste] = await db.query("SELECT id FROM Turma WHERE id = ?", [turmaId]);
        if (turmaExiste.length === 0) {
          return res.status(404).json({ message: "Turma não encontrada" });
        }
      }

      // Verificar aula (se fornecida)
      if (aulaId) {
        const [aulaExiste] = await db.query("SELECT id FROM Aula WHERE id = ?", [aulaId]);
        if (aulaExiste.length === 0) {
          return res.status(404).json({ message: "Aula não encontrada" });
        }
      }

      // Verificar conflito (se mudou turma, dia ou horário)
      if (turmaId || diaSemana || horario) {
        const novoTurmaId = turmaId || horarioAtual.turma_id;
        const novoDiaSemana = diaSemana ? toDbDiaSemana(diaSemana) : horarioAtual.dia_semana;
        const novoHorario = horario || horarioAtual.horario;

        const [conflito] = await db.query(
          "SELECT id FROM HorarioAula WHERE turma_id = ? AND dia_semana = ? AND horario = ? AND id != ?",
          [novoTurmaId, novoDiaSemana, novoHorario, id]
        );

        if (conflito.length > 0) {
          return res.status(409).json({
            message: "Já existe um horário para esta turma neste dia e horário",
          });
        }

        // Validar conflitos de professor e sala
        const validacao = await horarioAulaController.validarConflitos(
          novoTurmaId,
          aulaId || horarioAtual.aula_id,
          novoDiaSemana,
          novoHorario,
          salaId !== undefined ? salaId : horarioAtual.sala_id,
          id // Excluir o próprio horário da validação
        );

        if (!validacao.valid) {
          // Create clean copy of conflicts to avoid serialization issues
          const cleanConflicts = validacao.conflicts.map(c => ({
            type: c.type,
            message: c.message,
            details: c.details ? {...c.details} : undefined
          }));
          return res.status(409).json({
            message: 'Conflito de horário detectado',
            conflicts: cleanConflicts
          });
        }
      }

      // Construir query de atualização
      const updates = [];
      const params = [];

      if (turmaId !== undefined) {
        updates.push("turma_id = ?");
        params.push(turmaId);
      }
      if (aulaId !== undefined) {
        updates.push("aula_id = ?");
        params.push(aulaId);
      }
      if (diaSemana !== undefined) {
        updates.push("dia_semana = ?");
        params.push(toDbDiaSemana(diaSemana));
      }
      if (horario !== undefined) {
        updates.push("horario = ?");
        params.push(horario);
      }
      if (salaId !== undefined) {
        updates.push("sala_id = ?");
        params.push(salaId || null);
      }
      updates.push("updated_at = NOW()");
      params.push(id);

      await db.query(
        `UPDATE HorarioAula SET ${updates.join(", ")} WHERE id = ?`,
        params
      );

      return res.status(200).json({ message: "Horário atualizado com sucesso" });
    } catch (error) {
      console.error("Erro ao atualizar horário:", error);
      return res.status(500).json({ message: "Erro ao atualizar horário" });
    }
  },

  // POST /horarios-aulas/validar - Validar conflitos
  async validar(req, res) {
    try {
      let { turmaId, aulaId, diaSemana, horario, salaId, horarioIdExcluir } = req.body;

      if (!turmaId || !aulaId || !diaSemana || !horario) {
        return res.status(400).json({ 
          message: 'Campos obrigatórios: turmaId, aulaId, diaSemana, horario' 
        });
      }

      // Normalizar horário: se vier como intervalo "07:30-08:20", extrair apenas início
      if (typeof horario === 'string' && horario.includes('-')) {
        horario = horario.split('-')[0].trim();
      }

      const diaDb = toDbDiaSemana(diaSemana);
      if (!diaDb) {
        return res.status(400).json({ 
          message: 'Dia da semana inválido. Use: SEGUNDA, TERCA, QUARTA, QUINTA ou SEXTA' 
        });
      }

      const conflicts = [];

      // 1. Buscar professor da aula
      const [aula] = await db.query(
        'SELECT professor_id FROM Aula WHERE id = ?',
        [aulaId]
      );

      if (aula.length === 0) {
        return res.status(404).json({ message: 'Aula não encontrada' });
      }

      const professorId = aula[0].professor_id;

      // 2. Verificar conflito de professor
      let queryProfessor = `
        SELECT 
          h.id,
          h.turma_id,
          t.nome as turma_nome,
          a.nome as aula_nome,
          COALESCE(p.nome, CONCAT('Professor ID ', a.professor_id)) as professor_nome
        FROM HorarioAula h
        JOIN Aula a ON h.aula_id = a.id
        JOIN Turma t ON h.turma_id = t.id
        LEFT JOIN Pessoa p ON a.professor_id = p.id
        WHERE a.professor_id = ?
          AND h.dia_semana = ?
          AND h.horario = ?
          AND h.turma_id != ?`;
      
      const paramsProfessor = [professorId, diaDb, horario, turmaId];
      
      if (horarioIdExcluir) {
        queryProfessor += ' AND h.id != ?';
        paramsProfessor.push(horarioIdExcluir);
      }

      const [conflitoProfessor] = await db.query(queryProfessor, paramsProfessor);

      if (conflitoProfessor.length > 0) {
        const c = conflitoProfessor[0];
        conflicts.push({
          type: 'professor',
          message: `${c.professor_nome} já tem aula neste horário`,
          details: {
            professorId: professorId,
            professorNome: c.professor_nome,
            turmaConflito: c.turma_nome,
            turmaId: c.turma_id,
            aulaConflito: c.aula_nome,
            diaSemana: toApiDiaSemana(diaDb),
            horario: horario
          }
        });
      }

      // 3. Verificar conflito de sala (se fornecida)
      if (salaId) {
        let querySala = `
          SELECT 
            h.id,
            h.turma_id,
            h.sala_id,
            t.nome as turma_nome
          FROM HorarioAula h
          JOIN Turma t ON h.turma_id = t.id
          WHERE h.sala_id = ?
            AND h.dia_semana = ?
            AND h.horario = ?
            AND h.turma_id != ?`;
        
        const paramsSala = [salaId, diaDb, horario, turmaId];
        
        if (horarioIdExcluir) {
          querySala += ' AND h.id != ?';
          paramsSala.push(horarioIdExcluir);
        }

        const [conflitoSala] = await db.query(querySala, paramsSala);

        if (conflitoSala.length > 0) {
          const c = conflitoSala[0];
          conflicts.push({
            type: 'sala',
            message: `Sala ${salaId} já ocupada neste horário`,
            details: {
              salaId: salaId,
              turmaConflito: c.turma_nome,
              turmaId: c.turma_id,
              diaSemana: toApiDiaSemana(diaDb),
              horario: horario
            }
          });
        }
      }

      return res.status(conflicts.length > 0 ? 409 : 200).json({
        valid: conflicts.length === 0,
        conflicts: conflicts
      });
    } catch (error) {
      console.error("Erro ao validar horário:", error);
      return res.status(500).json({ message: "Erro ao validar horário" });
    }
  },

  async deletar(req, res) {
    try {
      const { id } = req.params;

      // Verificar se o horário existe
      const [horarioExiste] = await db.query("SELECT id FROM HorarioAula WHERE id = ?", [id]);
      if (horarioExiste.length === 0) {
        return res.status(404).json({ message: "Horário não encontrado" });
      }

      // Deletar horário
      await db.query("DELETE FROM HorarioAula WHERE id = ?", [id]);

      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao deletar horário:", error);
      return res.status(500).json({ message: "Erro ao deletar horário" });
    }
  },

  // Helper para validar conflitos (usado internamente)
  async validarConflitos(turmaId, aulaId, diaDb, horario, salaId, horarioIdExcluir = null) {
    const conflicts = [];

    try {
      // 1. Buscar professor da aula
      const [aula] = await db.query(
        'SELECT professor_id FROM Aula WHERE id = ?',
        [aulaId]
      );

      if (aula.length === 0) {
        return { valid: false, conflicts: [{ type: 'error', message: 'Aula não encontrada' }] };
      }

      const professorId = aula[0].professor_id;

      // 2. Verificar conflito de professor
      let queryProfessor = `
        SELECT 
          h.id,
          h.turma_id,
          t.nome as turma_nome,
          a.nome as aula_nome,
          COALESCE(p.nome, CONCAT('Professor ID ', a.professor_id)) as professor_nome
        FROM HorarioAula h
        JOIN Aula a ON h.aula_id = a.id
        JOIN Turma t ON h.turma_id = t.id
        LEFT JOIN Pessoa p ON a.professor_id = p.id
        WHERE a.professor_id = ?
          AND h.dia_semana = ?
          AND h.horario = ?
          AND h.turma_id != ?`;
      
      const paramsProfessor = [professorId, diaDb, horario, turmaId];
      
      if (horarioIdExcluir) {
        queryProfessor += ' AND h.id != ?';
        paramsProfessor.push(horarioIdExcluir);
      }

      const [conflitoProfessor] = await db.query(queryProfessor, paramsProfessor);

      if (conflitoProfessor.length > 0) {
        const c = conflitoProfessor[0];
        conflicts.push({
          type: 'professor',
          message: `${c.professor_nome} já tem aula neste horário`,
          details: {
            professorId: professorId,
            professorNome: c.professor_nome,
            turmaConflito: c.turma_nome,
            turmaId: c.turma_id,
            aulaConflito: c.aula_nome,
            diaSemana: toApiDiaSemana(diaDb),
            horario: horario
          }
        });
      }

      // 3. Verificar conflito de sala (se fornecida)
      if (salaId) {
        let querySala = `
          SELECT 
            h.id,
            h.turma_id,
            h.sala_id,
            t.nome as turma_nome
          FROM HorarioAula h
          JOIN Turma t ON h.turma_id = t.id
          WHERE h.sala_id = ?
            AND h.dia_semana = ?
            AND h.horario = ?
            AND h.turma_id != ?`;
        
        const paramsSala = [salaId, diaDb, horario, turmaId];
        
        if (horarioIdExcluir) {
          querySala += ' AND h.id != ?';
          paramsSala.push(horarioIdExcluir);
        }

        const [conflitoSala] = await db.query(querySala, paramsSala);

        if (conflitoSala.length > 0) {
          const c = conflitoSala[0];
          conflicts.push({
            type: 'sala',
            message: `Sala ${salaId} já ocupada neste horário`,
            details: {
              salaId: salaId,
              turmaConflito: c.turma_nome,
              turmaId: c.turma_id,
              diaSemana: toApiDiaSemana(diaDb),
              horario: horario
            }
          });
        }
      }

      return {
        valid: conflicts.length === 0,
        conflicts: conflicts
      };
    } catch (error) {
      console.error("Erro ao validar conflitos:", error);
      return { valid: false, conflicts: [{ type: 'error', message: 'Erro ao validar conflitos' }] };
    }
  }
};

module.exports = horarioAulaController;
