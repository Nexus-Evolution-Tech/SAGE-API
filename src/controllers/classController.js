const classService = require('../services/classService');

const getTurmas = async (req, res) => {
    try {
        const turmas = await classService.listarTurmas();
        res.json(turmas);
    } catch (error) {
        console.error('Erro ao listar turmas:', error);
        res.status(500).json({ message: 'Erro ao listar turmas' });
    }
};

const postTurma = async (req, res) => {
    try {
        const novaTurma = await classService.criarTurmaCompleta(req.body);
        res.status(201).json({ message: 'Turma criada com sucesso', pessoa: novaTurma });
    } catch (error) {
        console.error('Erro ao criar turma:', error);
        res.status(500).json({ message: 'Erro ao criar turma' });
    }
};
  
const patchTurma = async (req, res) => {
    try {
        const id = req.params.id;
        await classService.editarTurma(id, req.body);
        res.json({ message: 'Turma atualizada com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar turma:', error);
        res.status(500).json({ message: 'Erro ao atualizar turma' });
    }
};

const deleteTurma = async (req, res) => {
    try {
        const id = req.params.id;
        await classService.deletarTurma(id);
        res.json({ message: 'Turma removida com sucesso' });
    } catch (error) {
        console.error('Erro ao remover turma:', error);
        res.status(500).json({ message: 'Erro ao remover turma' });
    }
};

module.exports = {
    getTurmas,
    postTurma,
    patchTurma,
    deleteTurma
};
