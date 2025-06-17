const schoolService = require('../services/schoolService');

const getEscolas = async (req, res) => {
    try {
        const escolas = await schoolService.listarEscolas();
        res.json(escolas);
    } catch (error) {
        console.error('Erro ao listar escolas:', error);
        res.status(500).json({ message: 'Erro ao listar escolas' });
    }
};

const postEscola = async (req, res) => {
    try {
        const novaEscola = await schoolService.criarEscolaCompleta(req.body);
        res.status(201).json({ message: 'Escola criada com sucesso', pessoa: novaEscola });
    } catch (error) {
        console.error('Erro ao criar escola:', error);
        res.status(500).json({ message: 'Erro ao criar escola' });
    }
};
  
const patchEscola = async (req, res) => {
    try {
        const id = req.params.id;
        await schoolService.editarEscola(id, req.body);
        res.json({ message: 'Escola atualizada com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar escola:', error);
        res.status(500).json({ message: 'Erro ao atualizar escola' });
    }
};

const deleteEscola = async (req, res) => {
    try {
        const id = req.params.id;
        await schoolService.deletarEscola(id);
        res.json({ message: 'Escola removida com sucesso' });
    } catch (error) {
        console.error('Erro ao remover escola:', error);
        res.status(500).json({ message: 'Erro ao remover escola' });
    }
};

module.exports = {
    getEscolas,
    postEscola,
    patchEscola,
    deleteEscola
};
