const express = require('express');

function gerarRotas(controller, prefixo) {
  const router = express.Router();

  router.get(`/${prefixo}`, controller.listar);
  router.post(`/${prefixo}`, controller.criar);
  router.get(`/${prefixo}/:id`, controller.listarPorId);
  router.patch(`/${prefixo}/:id`, controller.editar);
  router.delete(`/${prefixo}/:id`, controller.deletar);

  return router;
}

module.exports = gerarRotas;
