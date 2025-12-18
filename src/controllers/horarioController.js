const db = require('../config/database');
const logger = require('../config/logger');

const horarioController = {
  // GET /horarios - Lista todos os horarios (slots da grade)
  async listar(req, res) {
    try {
      const [horarios] = await db.query(`
        SELECT 
          id,
          turma_id AS turmaId,
          dia_semana,
          inicio,
          fim,
          id AS aulaId,
          nome,
          divisao
        FROM Aula
        ORDER BY turma_id, FIELD(dia_semana, 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO'), inicio
      `);

      res.json(horarios || []);
    } catch (error) {
      logger.error(`Erro ao listar horarios: ${error.message}`);
      res.status(500).json({ message: 'Erro ao listar horarios', error: error.message });
    }
  },

  // POST /horarios - Cria novo horario
  async criar(req, res) {
    const { turmaId, dia_semana, inicio, fim, aulaId } = req.body;

    if (!turmaId || !dia_semana || !inicio || !fim) {
      return res.status(400).json({ message: 'Campos obrigatorios: turmaId, dia_semana, inicio, fim' });
    }

    try {
      // Se aulaId fornecido, buscar dados da aula
      let nome = null;
      let professor_id = null;
      let materia_id = null;
      let divisao = null;

      if (aulaId) {
        const [aula] = await db.query('SELECT nome, professor_id, materia_id, divisao FROM Aula WHERE id = ?', [aulaId]);
        if (aula.length > 0) {
          nome = aula[0].nome;
          professor_id = aula[0].professor_id;
          materia_id = aula[0].materia_id;
          divisao = aula[0].divisao;
        }
      }

      const [result] = await db.query(
        `INSERT INTO Aula (nome, professor_id, materia_id, turma_id, inicio, fim, dia_semana, divisao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nome, professor_id, materia_id, turmaId, inicio, fim, dia_semana, divisao]
      );

      const [horario] = await db.query(
        `SELECT id, turma_id AS turmaId, dia_semana, inicio, fim, id AS aulaId, nome, divisao FROM Aula WHERE id = ?`,
        [result.insertId]
      );

      res.status(201).json({ message: 'Horario criado com sucesso', data: horario[0] });
    } catch (error) {
      logger.error(`Erro ao criar horario: ${error.message}`);
      res.status(500).json({ message: 'Erro ao criar horario', error: error.message });
    }
  },

  // PUT /horarios/:id - Atualiza horario existente
  async editar(req, res) {
    const { id } = req.params;
    const { turmaId, dia_semana, inicio, fim, aulaId, nome, divisao } = req.body;

    try {
      const campos = [];
      const valores = [];

      if (turmaId !== undefined) { campos.push('turma_id = ?'); valores.push(turmaId); }
      if (dia_semana !== undefined) { campos.push('dia_semana = ?'); valores.push(dia_semana); }
      if (inicio !== undefined) { campos.push('inicio = ?'); valores.push(inicio); }
      if (fim !== undefined) { campos.push('fim = ?'); valores.push(fim); }
      if (nome !== undefined) { campos.push('nome = ?'); valores.push(nome); }
      if (divisao !== undefined) { campos.push('divisao = ?'); valores.push(divisao); }

      if (campos.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar' });
      }

      valores.push(id);

      await db.query(`UPDATE Aula SET ${campos.join(', ')} WHERE id = ?`, valores);

      res.json({ message: 'Horario atualizado com sucesso' });
    } catch (error) {
      logger.error(`Erro ao atualizar horario: ${error.message}`);
      res.status(500).json({ message: 'Erro ao atualizar horario', error: error.message });
    }
  },

  // DELETE /horarios/:id - Remove horario
  async deletar(req, res) {
    const { id } = req.params;

    try {
      await db.query('DELETE FROM Aula WHERE id = ?', [id]);
      res.json({ message: 'Horario removido com sucesso' });
    } catch (error) {
      logger.error(`Erro ao deletar horario: ${error.message}`);
      res.status(500).json({ message: 'Erro ao deletar horario', error: error.message });
    }
  },

  // POST /horarios/validar - Valida conflitos de horario
  async validar(req, res) {
    const { turmaId, dia_semana, inicio, fim, aulaId } = req.body;

    if (!turmaId || !dia_semana || !inicio || !fim) {
      return res.status(400).json({ message: 'Campos obrigatorios: turmaId, dia_semana, inicio, fim' });
    }

    try {
      // Verificar conflito de horario na mesma turma
      const [conflitoTurma] = await db.query(
        `SELECT id FROM Aula 
         WHERE turma_id = ? 
           AND dia_semana = ? 
           AND ((inicio < ? AND fim > ?) OR (inicio >= ? AND inicio < ?))`,
        [turmaId, dia_semana, fim, inicio, inicio, fim]
      );

      if (conflitoTurma.length > 0) {
        return res.status(400).json({ 
          message: 'Conflito de horario: ja existe uma aula neste horario para esta turma' 
        });
      }

      // Se aulaId fornecida, verificar conflito de professor
      if (aulaId) {
        const [aula] = await db.query('SELECT professor_id FROM Aula WHERE id = ?', [aulaId]);

        if (aula.length > 0 && aula[0].professor_id) {
          const [conflitoProf] = await db.query(
            `SELECT id FROM Aula
             WHERE professor_id = ?
               AND dia_semana = ?
               AND ((inicio < ? AND fim > ?) OR (inicio >= ? AND inicio < ?))`,
            [aula[0].professor_id, dia_semana, fim, inicio, inicio, fim]
          );

          if (conflitoProf.length > 0) {
            return res.status(400).json({ 
              message: 'Conflito de professor: o professor ja tem aula neste horario' 
            });
          }
        }
      }

      res.json({ message: 'Horario valido, sem conflitos' });
    } catch (error) {
      logger.error(`Erro ao validar horario: ${error.message}`);
      res.status(500).json({ message: 'Erro ao validar horario', error: error.message });
    }
  }
};

module.exports = horarioController;
