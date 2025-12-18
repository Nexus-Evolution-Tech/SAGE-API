const express = require("express");
const router = express.Router();
const horarioAulaController = require("../controllers/horarioAulaController");
const autenticar = require("../middlewares/autenticar");

// Todas as rotas requerem autenticação
router.use("/horarios-aulas", autenticar);

// GET /horarios-aulas - Listar horários (com filtros opcionais)
router.get("/horarios-aulas", horarioAulaController.listar);

// POST /horarios-aulas/validar - Validar conflitos (BEFORE generic POST)
router.post("/horarios-aulas/validar", horarioAulaController.validar);

// POST /horarios-aulas - Criar horário
router.post("/horarios-aulas", horarioAulaController.criar);

// PUT /horarios-aulas/:id - Atualizar horário
router.put("/horarios-aulas/:id", horarioAulaController.editar);

// DELETE /horarios-aulas/:id - Deletar horário
router.delete("/horarios-aulas/:id", horarioAulaController.deletar);

module.exports = router;
