const express = require('express');

function gerarRotas(controller, prefixo, {
  listar = true,
  criar = true,
  listarPorId = true,
  editar = true,
  deletar = true
} = {}) {
  const router = express.Router();

  if (listar) {
    router.get(`/${prefixo}`, controller.listar);
  }
  if (criar) {
    router.post(`/${prefixo}`, controller.criar);
  }
  if (listarPorId) {
    router.get(`/${prefixo}/:id`, controller.listarPorId);
  }
  if (editar) {
    router.patch(`/${prefixo}/:id`, controller.editar);
  }
  if (deletar) {
    router.delete(`/${prefixo}/:id`, controller.deletar);
  }

  return router;
}

module.exports = gerarRotas;
