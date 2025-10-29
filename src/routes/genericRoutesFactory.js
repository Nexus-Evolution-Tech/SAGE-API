const express = require('express');
const autenticar = require('../middlewares/autenticar');

function gerarRotas(controller, prefixo, {
  listar = true,
  criar = true,
  listarPorId = true,
  editar = true,
  deletar = true,
  autenticarTodas = true,
  autenticarReqs = { listar: false, criar: false, listarPorId: false, editar: false, deletar: false }
} = {}) {
  const router = express.Router();

  if (autenticarTodas) {
    // 🔒 Todas as rotas protegidas
    if (listar) router.get(`/${prefixo}`, autenticar, controller.listar);
    if (criar) router.post(`/${prefixo}`, autenticar, controller.criar);
    if (listarPorId) router.get(`/${prefixo}/:id`, autenticar, controller.listarPorId);
    if (editar) router.patch(`/${prefixo}/:id`, autenticar, controller.editar);
    if (deletar) router.delete(`/${prefixo}/:id`, autenticar, controller.deletar);
  } else {
    // 🔓 Só autentica o que estiver marcado em autenticarReqs
    if (listar) router.get(`/${prefixo}`, autenticarReqs.listar ? autenticar : [], controller.listar);
    if (criar) router.post(`/${prefixo}`, autenticarReqs.criar ? autenticar : [], controller.criar);
    if (listarPorId) router.get(`/${prefixo}/:id`, autenticarReqs.listarPorId ? autenticar : [], controller.listarPorId);
    if (editar) router.patch(`/${prefixo}/:id`, autenticarReqs.editar ? autenticar : [], controller.editar);
    if (deletar) router.delete(`/${prefixo}/:id`, autenticarReqs.deletar ? autenticar : [], controller.deletar);
  }

  return router;
}

module.exports = gerarRotas;
