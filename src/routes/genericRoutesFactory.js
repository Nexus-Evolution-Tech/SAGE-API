const express = require('express');
const { exige } = require('../middlewares/autorizacao');

function gerarRotas(controller, prefixo, {
  listar = true,
  criar = true,
  listarPorId = true,
  editar = true,
  deletar = true,
  autenticarTodas = true,
  autenticarReqs = { listar: false, criar: false, listarPorId: false, editar: false, deletar: false },
  autorizacao = 'SECRETARIA',
  autorizacoes = {}
} = {}) {
  const router = express.Router();
  const middlewareAutorizacao = (operacao) => exige(autorizacoes[operacao] || autorizacao);

  if (autenticarTodas) {
    //  Todas as rotas protegidas
    if (listar) router.get(`/${prefixo}`, middlewareAutorizacao('listar'), controller.listar);
    if (criar) router.post(`/${prefixo}`, middlewareAutorizacao('criar'), controller.criar);
    if (listarPorId) router.get(`/${prefixo}/:id`, middlewareAutorizacao('listarPorId'), controller.listarPorId);
    if (editar) router.patch(`/${prefixo}/:id`, middlewareAutorizacao('editar'), controller.editar);
    if (deletar) router.delete(`/${prefixo}/:id`, middlewareAutorizacao('deletar'), controller.deletar);
  } else {
    // Só autentica o que estiver marcado em autenticarReqs
    if (listar) router.get(`/${prefixo}`, autenticarReqs.listar ? middlewareAutorizacao('listar') : [], controller.listar);
    if (criar) router.post(`/${prefixo}`, autenticarReqs.criar ? middlewareAutorizacao('criar') : [], controller.criar);
    if (listarPorId) router.get(`/${prefixo}/:id`, autenticarReqs.listarPorId ? middlewareAutorizacao('listarPorId') : [], controller.listarPorId);
    if (editar) router.patch(`/${prefixo}/:id`, autenticarReqs.editar ? middlewareAutorizacao('editar') : [], controller.editar);
    if (deletar) router.delete(`/${prefixo}/:id`, autenticarReqs.deletar ? middlewareAutorizacao('deletar') : [], controller.deletar);
  }

  return router;
}

module.exports = gerarRotas;
