const gerarController = require('./genericControllerFactory');
const crud = require('../utils/generic-db-utils');
const { cacheMutation } = require('../cache/helpers');
const { emitNotification } = require('../services/notificationService');

const tabela = 'SolicitacaoAcesso';
const campos = ['id', 'aluno_id', 'data_hora_solicitacao', 'motivo', 'status', 'data_hora_resposta', 'observacao_resposta'];

const criar = async (req, res) => {
  try {
    const dados = { ...req.body };
    const novoRegistro = await cacheMutation(
      async () => crud.criarRegistro(tabela, dados),
      [`${tabela}:*`]
    );
    emitNotification({
      title: 'Nova solicitação de acesso',
      message: 'Uma nova solicitação de acesso (aluno menor) foi registrada. Verifique em Solicitações.',
      type: 'info',
    });
    res.status(201).json({
      message: 'Solicitação de acesso criada com sucesso',
      data: novoRegistro,
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar solicitação de acesso', error: error.message });
  }
};

const aprovarSolicitacao = async (req, res) => {
  try {
    const id = req.params.id;
    await crud.atualizarRegistro(tabela, id, { status: 'APROVADA', data_hora_resposta: new Date() });
    emitNotification({
      title: 'Solicitação aprovada',
      message: 'Uma solicitação de acesso foi aprovada.',
      type: 'success',
    });
    res.json({ message: `Solicitação de acesso do aluno menor APROVADA com sucesso` });
  } catch (error) {
    res.status(500).json({ message: `Erro ao atualizar solicitação do aluno menor de idade`, error: error.message });
  }
};

const negarSolicitacao = async (req, res) => {
  try {
    const id = req.params.id;
    await crud.atualizarRegistro(tabela, id, { status: 'NEGADA', data_hora_resposta: new Date() });
    emitNotification({
      title: 'Solicitação negada',
      message: 'Uma solicitação de acesso foi negada.',
      type: 'info',
    });
    res.json({ message: `Solicitação de acesso do aluno menor NEGADA com sucesso` });
  } catch (error) {
    res.status(500).json({ message: `Erro ao atualizar solicitação do aluno menor de idade`, error: error.message });
  }
};

const controllerGenerico = gerarController(tabela, campos, 'acesso');

module.exports = {
  ...controllerGenerico,
  criar,
  aprovarSolicitacao,
  negarSolicitacao,
};
