const gerarController = require('./genericControllerFactory');
const crud = require('../utils/generic-db-utils');

const tabela = 'SolicitacaoAcesso';
const campos = ['id', 'aluno_id', 'data_hora_solicitacao', 'motivo', 'status', 'data_hora_resposta', 'observacao_resposta'];

const aprovarSolicitacao = async (req, res) => {
    try {
        const id = req.params.id;
        await crud.atualizarRegistro(tabela, id, { status: 'APROVADA' });
        res.json({ message: `Solicitação de acesso do aluno menor APROVADA com sucesso` });
    } catch (error) {
        res.status(500).json({ message: `Erro ao atualizar solicitação do aluno menor de idade`, error: error.message });
    }
};

const negarSolicitacao = async (req, res) => {
    try {
        const id = req.params.id;
        await crud.atualizarRegistro(tabela, id, { status: 'NEGADA' });
        res.json({ message: `Solicitação de acesso do aluno menor NEGADA com sucesso` });
    } catch (error) {
    res.status(500).json({ message: `Erro ao atualizar solicitação do aluno menor de idade`, error: error.message });
    }
};

const controllerGenerico = gerarController(tabela, campos, 'acesso');

module.exports = {
    ...controllerGenerico,
    aprovarSolicitacao,
    negarSolicitacao
};
