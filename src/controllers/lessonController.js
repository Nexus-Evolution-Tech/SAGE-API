const db = require('../config/database');
const logger = require('../config/logger');

// Helper para converter IDs string → number
function parseId(id) {
  if (!id || id === 'null' || id === 'undefined') return null;
  const parsed = parseInt(id);
  return isNaN(parsed) ? null : parsed;
}

const lessonController = {
  // GET /aulas?search=texto - Lista catalogo de aulas (SEM turmaIds)
  async listar(req, res) {
    const { search } = req.query;

    try {
      let query = `SELECT a.id, a.nome, 
                           a.professor_id AS professorId, 
                           a.materia_id AS materiaId,
                           a.sala_padrao_id AS salaPadraoId,
                           a.divisao, 
                           a.observacao,
                           a.created_at AS createdAt, 
                           a.updated_at AS updatedAt
                    FROM Aula a
                    WHERE a.turma_id IS NULL AND a.inicio IS NULL`;
      const params = [];

      if (search) {
        query += ` AND a.nome LIKE ?`;
        params.push(`%${search}%`);
      }

      query += ` ORDER BY a.nome`;

      const [aulas] = await db.query(query, params);

      res.json(aulas || []);
    } catch (error) {
      logger.error(`Erro ao listar aulas: ${error.message}`);
      res.status(500).json({ message: 'Erro ao listar aulas', error: error.message });
    }
  },

  // POST /aulas - Cria nova aula no catalogo (SEM turmaIds)
  async criar(req, res) {
    let { nome, professorId, materiaId, salaPadraoId, divisao, observacao } = req.body;

    // Normalizar divisao: aceitar 'A','B','A/B','INT' e 'DIV A','DIV B','DIV A/B'
    function normalizeDivisao(value) {
      if (!value) return null;
      const v = String(value).toUpperCase().trim();
      if (v === 'A' || v === 'DIV A') return 'DIV A';
      if (v === 'B' || v === 'DIV B') return 'DIV B';
      if (v === 'A/B' || v === 'DIV A/B') return 'DIV A/B';
      if (v === 'INT') return 'INT';
      return v; // mantém valor se já estiver válido
    }
    divisao = normalizeDivisao(divisao);

    // Converter IDs de string para number
    professorId = parseId(professorId);
    materiaId = parseId(materiaId);
    salaPadraoId = parseId(salaPadraoId);

    // Validações
    if (!nome) {
      return res.status(400).json({ message: 'Campo obrigatorio: nome' });
    }

    if (!professorId) {
      return res.status(400).json({ message: 'Campo obrigatorio: professorId' });
    }

    if (!materiaId) {
      return res.status(400).json({ message: 'Campo obrigatorio: materiaId' });
    }

    try {
      // Verificar se professor existe
      const [professor] = await db.query(
        `SELECT id FROM Pessoa WHERE id = ? AND tipo = 'PROFESSOR'`,
        [professorId]
      );
      if (!professor || professor.length === 0) {
        return res.status(400).json({ message: 'Professor não encontrado ou inválido' });
      }

      // Verificar se matéria existe
      const [materia] = await db.query(
        `SELECT id FROM Materia WHERE id = ?`,
        [materiaId]
      );
      if (!materia || materia.length === 0) {
        return res.status(400).json({ message: 'Matéria não encontrada' });
      }

      // Inserir nova aula (SEM turmas - turmas vem via horarios)
      const [result] = await db.query(
        `INSERT INTO Aula (nome, professor_id, materia_id, sala_padrao_id, divisao, observacao) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nome, professorId, materiaId, salaPadraoId, divisao || null, observacao || null]
      );

      const aulaId = result.insertId;

      // Retornar aula criada
      const [aula] = await db.query(
        `SELECT id, nome, 
                professor_id AS professorId, 
                materia_id AS materiaId,
                sala_padrao_id AS salaPadraoId,
                divisao, 
                observacao,
                created_at AS createdAt, 
                updated_at AS updatedAt 
         FROM Aula WHERE id = ?`,
        [aulaId]
      );

      res.status(201).json(aula[0]);
    } catch (error) {
      logger.error(`Erro ao criar aula: ${error.message}`);
      res.status(500).json({ message: 'Erro ao criar aula', error: error.message });
    }
  },

  // PUT /aulas/:id - Atualiza aula do catalogo (SEM turmaIds)
  async editar(req, res) {
    const { id } = req.params;
    let { nome, professorId, materiaId, salaPadraoId, divisao, observacao } = req.body;

    // Normalizar divisao no update também
    function normalizeDivisao(value) {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const v = String(value).toUpperCase().trim();
      if (v === 'A' || v === 'DIV A') return 'DIV A';
      if (v === 'B' || v === 'DIV B') return 'DIV B';
      if (v === 'A/B' || v === 'DIV A/B') return 'DIV A/B';
      if (v === 'INT') return 'INT';
      return v; // mantém valor se já estiver válido
    }
    divisao = normalizeDivisao(divisao);

    // Converter IDs de string para number
    professorId = parseId(professorId);
    materiaId = parseId(materiaId);
    salaPadraoId = parseId(salaPadraoId);

    try {
      const campos = [];
      const valores = [];

      if (nome !== undefined && nome !== null) { 
        campos.push('nome = ?'); 
        valores.push(nome); 
      }

      if (professorId !== undefined && professorId !== null) {
        // Validar professor
        const [prof] = await db.query(
          `SELECT id FROM Pessoa WHERE id = ? AND tipo = 'PROFESSOR'`,
          [professorId]
        );
        if (!prof || prof.length === 0) {
          return res.status(400).json({ message: 'Professor não encontrado ou inválido' });
        }
        campos.push('professor_id = ?');
        valores.push(professorId);
      }

      if (materiaId !== undefined && materiaId !== null) {
        // Validar matéria
        const [mat] = await db.query(
          `SELECT id FROM Materia WHERE id = ?`,
          [materiaId]
        );
        if (!mat || mat.length === 0) {
          return res.status(400).json({ message: 'Matéria não encontrada' });
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
        valores.push(divisao || null); 
      }

      if (observacao !== undefined) { 
        campos.push('observacao = ?'); 
        valores.push(observacao || null); 
      }

      if (campos.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar' });
      }

      valores.push(id);
      await db.query(`UPDATE Aula SET ${campos.join(', ')} WHERE id = ?`, valores);

      res.json({ message: 'Aula atualizada com sucesso' });
    } catch (error) {
      logger.error(`Erro ao atualizar aula: ${error.message}`);
      res.status(500).json({ message: 'Erro ao atualizar aula', error: error.message });
    }
  },

  // DELETE /aulas/:id?mode=detach - Remove aula
  async deletar(req, res) {
    const { id } = req.params;
    const { mode } = req.query;

    try {
      if (mode === 'detach') {
        // 1. Remover aula dos horários (desassociar)
        await db.query('DELETE FROM HorarioAula WHERE aula_id = ?', [id]);
        
        // 2. Deletar a aula do catálogo
        const [result] = await db.query('DELETE FROM Aula WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Aula não encontrada' });
        }
        
        return res.status(200).json({ 
          message: 'Aula removida e desassociada dos horários' 
        });
      }
      
      // Deleção simples (pode falhar se houver FK constraint)
      const [result] = await db.query('DELETE FROM Aula WHERE id = ?', [id]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Aula não encontrada' });
      }
      
      return res.status(200).json({ message: 'Aula removida' });
    } catch (error) {
      logger.error(`Erro ao deletar aula: ${error.message}`);
      res.status(500).json({ 
        message: 'Erro ao deletar aula',
        error: error.message 
      });
    }
  },

  // GET /aulas/horarios/:turma_id/:divisao - Compatibilidade (manter)
  async getHorariosPorTurma(req, res) {
    const { turma_id, divisao } = req.params;
    if (!turma_id || !divisao) {
        return res.status(400).json({ message: 'Parametros turma_id e divisao sao obrigatorios' });
    }
    
    let div = '';
    switch (divisao.toUpperCase()) {
        case 'A':
            div = 'DIV A';
            break;
        case 'B':
            div = 'DIV B';
            break;
        case 'INT':
            div = 'INT';
            break;
        default:
            return res.status(400).json({ message: 'Divisao invalida. Use "A" ou "B".' });
    }

    try {
        let aulas;
        if (div !== 'INT'){
            aulas = await global.db('Aula')
                .select('id', 'nome', 'professor_id', 'turma_id', 'materia_id', 'inicio', 'fim', 'dia_semana', 'divisao')
                .where('turma_id', turma_id)
                .andWhere(function() {
                    this.where('divisao', 'INT').orWhere('divisao', div);
                })
                .get();
        } else if (div === 'INT') {
            aulas = await global.db('Aula')
                .select('id', 'nome', 'professor_id', 'turma_id', 'materia_id', 'inicio', 'fim', 'dia_semana', 'divisao')
                .where('turma_id', turma_id)
                .get();
        }

        if (aulas.length === 0) {
            return res.status(404).json({ message: 'Nenhuma aula encontrada para a turma e divisao especificadas.' });
        }

        res.json(aulas);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar aulas do banco de dados' });
    }
  }
};

module.exports = lessonController;