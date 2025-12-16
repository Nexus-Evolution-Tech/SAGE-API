const express = require('express');
const multer = require('multer');
const path = require('path');
const autenticar = require('../middlewares/autenticar');
const { importarPlanilha } = require('../services/importService');
const { exportarDados } = require('../services/exportService');

const router = express.Router();
const upload = multer({ dest: 'src/uploads/' });

// -------------------------------------------------------
//  Baixar planilha modelo
// -------------------------------------------------------
router.get('/dados/planilha-modelo', autenticar, (req, res) => {
  const modeloPath = path.resolve('./models/PlanilhaPessoas-Modelo.xlsx');
  res.download(modeloPath, 'PlanilhaPessoas.xlsx');
});

// -------------------------------------------------------
//  Importar planilha preenchida
// -------------------------------------------------------
router.post('/dados/importar', autenticar, upload.single('planilha'), async (req, res) => {
  try {
    const filePath = req.file?.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Arquivo da planilha não encontrado no upload.' });
    }

    const unidadeIdDefault = req.body.unidade_id ? Number(req.body.unidade_id) : 1;
    const resultado = await importarPlanilha(filePath, unidadeIdDefault);

    res.json({ message: 'Importação concluída.', resultado });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar planilha.' });
  }
});

// -------------------------------------------------------
//  Exportar dados do banco no formato da planilha
// -------------------------------------------------------
router.get('/dados/exportar', autenticar, async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.resolve(`exports/exportacao_${timestamp}.xlsx`);

    await exportarDados(exportPath);

    res.download(exportPath, path.basename(exportPath), (err) => {
      if (err) {
        res.status(500).json({ error: 'Erro ao baixar arquivo.' });
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar dados.' });
  }
});

module.exports = router;
