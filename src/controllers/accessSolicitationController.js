const gerarController = require('./genericControllerFactory');
const crud = require('../utils/generic-db-utils');
const { cacheMutation } = require('../cache/helpers');
const { emitNotification } = require('../services/notificationService');
const { ACOES, executarOperacaoAuditada } = require('../services/auditoriaService');
const { responderErroInterno } = require('../utils/responderErroInterno');

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
      ignorados: novoRegistro.ignorados || [],
    });
  } catch (error) {
    if (error.code === 'ESCRITA_CHAVE_NAO_DECLARADA' || error.code === 'ESCRITA_NENHUM_CAMPO_APLICAVEL') {
      return res.status(400).json({ message: error.message, chaves: error.chaves || [], ignorados: error.ignorados || [] });
    }
    responderErroInterno(res, error, 'Erro ao criar solicitação de acesso');
  }
};

const aprovarSolicitacao = async (req, res) => {
  try {
    const id = req.params.id;
    await executarOperacaoAuditada({
      req, acao: ACOES.REGISTRO_EDITADO, entidade: tabela, entidadeId: Number(id),
      operacao: (connection) => crud.atualizarRegistro(
        tabela, id, { status: 'APROVADA', data_hora_resposta: new Date() }, connection
      )
    });
    emitNotification({
      title: 'Solicitação aprovada',
      message: 'Uma solicitação de acesso foi aprovada.',
      type: 'success',
    });
    res.json({ message: `Solicitação de acesso do aluno menor APROVADA com sucesso` });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao atualizar solicitação do aluno menor de idade');
  }
};

const negarSolicitacao = async (req, res) => {
  try {
    const id = req.params.id;
    await executarOperacaoAuditada({
      req, acao: ACOES.REGISTRO_EDITADO, entidade: tabela, entidadeId: Number(id),
      operacao: (connection) => crud.atualizarRegistro(
        tabela, id, { status: 'NEGADA', data_hora_resposta: new Date() }, connection
      )
    });
    emitNotification({
      title: 'Solicitação negada',
      message: 'Uma solicitação de acesso foi negada.',
      type: 'info',
    });
    res.json({ message: `Solicitação de acesso do aluno menor NEGADA com sucesso` });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao atualizar solicitação do aluno menor de idade');
  }
};

const controllerGenerico = gerarController(tabela, campos, 'acesso');

module.exports = {
  ...controllerGenerico,
  criar,
  aprovarSolicitacao,
  negarSolicitacao,
};
