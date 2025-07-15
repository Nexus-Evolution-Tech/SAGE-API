const gerarController = require('./genericControllerFactory');
const { criarAcesso } = require('../services/accessService');

const tabela = 'Acesso';
const campos = ['id', 'pessoa_id', 'dispositivo_id', 'status', 'permitido', 'metodo_auth', 'data_hora', 'updated_at'];

const criar = async (req, res) => {
    const { pessoa_id, dispositivo_id, status, metodo_auth } = req.body;

    if (
        pessoa_id === undefined || 
        dispositivo_id === undefined || 
        status === undefined || 
        metodo_auth === undefined
    ) {
        return res.status(400).json({ message: 'Dados incompletos para criar acesso' });
    }

    try {
        const acesso = await criarAcesso(req.body);
        res.status(201).json(acesso);
    } catch (error) {
        console.error('Erro ao criar acesso:', error);
        res.status(500).json({ message: 'Erro ao efetuar acesso' });
    }
};

const controllerGenerico = gerarController(tabela, campos, 'acesso');

module.exports = {
    ...controllerGenerico,
    criar
};
