const gerarController = require('./genericControllerFactory');
const { buscarHorariosPorTurma } = require('../services/lessonService');

const tabela = 'Aula';
const campos = ['id', 'nome', 'professor_id', 'turma_id', 'materia_id', 'inicio', 'fim', 'dia_semana', 'divisao', 'created_at', 'updated_at'];

const getHorariosPorTurma = async (req, res) => {
    const { turma_id, divisao } = req.params;
    if (!turma_id || !divisao) {
        return res.status(400).json({ message: 'Parâmetros turma_id e divisao são obrigatórios' });
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
            return res.status(400).json({ message: 'Divisão inválida. Use "A" ou "B".' });
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
                .where('turma_id', turma_id) // quando o aluno for INT não será filtrado por div, apenas por turma, uma turma que não tem divisão a e b só terá aulas INT
                // .andWhere(function() {
                //     this.where('divisao', 'INT');
                // })
                .get();
        }

        if (aulas.length === 0) {
            return res.status(404).json({ message: 'Nenhuma aula encontrada para a turma e divisão especificadas.' });
        }

        res.json(aulas);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar aulas do banco de dados' });
    }
};

const controllerGenerico = gerarController(tabela, campos, 'aula');
module.exports = {
  ...controllerGenerico,
  getHorariosPorTurma,
}