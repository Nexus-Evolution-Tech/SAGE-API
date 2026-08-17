const express = require('express');
const path = require('path');
const multer = require('multer');
const { criarUploadSeguro, erroTipoArquivo } = require('../middlewares/uploadFoto');
const autenticar = require('../middlewares/autorizacao').exige('ADMINISTRADOR');
const { importarPlanilha } = require('../services/importService');
const { exportarDados } = require('../services/exportService');
const { emitNotification } = require('../services/notificationService');
const logger = require('../config/logger');
const { paths } = require('../config/paths');
const { responderErroInterno } = require('../utils/responderErroInterno');

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, paths.uploads);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.xlsx';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const nome = `${base}_${Date.now()}${ext}`;
    req._sageUploadTempPath = path.join(paths.uploads, nome);
    cb(null, nome);
  }
});

const tiposPlanilha = new Map([
  ['.xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])],
  ['.xls', new Set(['application/vnd.ms-excel'])]
]);
const upload = criarUploadSeguro({
  storage,
  assinaturas: {
    '.xlsx': Buffer.from('504b0304', 'hex'),
    '.xls': Buffer.from('d0cf11e0a1b11ae1', 'hex')
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!tiposPlanilha.has(ext) || !tiposPlanilha.get(ext).has(file.mimetype)) return cb(erroTipoArquivo());
    return cb(null, true);
  }
});

// -------------------------------------------------------
//  Baixar planilha modelo
// -------------------------------------------------------
router.get('/dados/planilha-modelo', autenticar, (req, res) => {
  const modeloPath = path.join(paths.models, 'PlanilhaPessoas-Modelo.xlsx');
  res.download(modeloPath, 'PlanilhaPessoas.xlsx');
});

// -------------------------------------------------------
//  Importar planilha preenchida
// -------------------------------------------------------
const handleUploadSingle = upload.single('planilha');

router.post('/dados/importar', autenticar, handleUploadSingle, async (req, res) => {
  try {
    // Importação pode demorar com arquivos grandes; aumenta timeout só para esta rota
    const routeTimeout = parseInt(process.env.IMPORT_TIMEOUT_MS || '300000', 10); // 5 minutos padrão
    req.setTimeout(routeTimeout);
    res.setTimeout(routeTimeout);

    logger.debug('Início da importação de planilha');
    const filePath = req.file?.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Arquivo da planilha não encontrado no upload.' });
    }

    const unidadeIdDefault = req.body.unidade_id ? Number(req.body.unidade_id) : 1;
    const resultado = await importarPlanilha(filePath, unidadeIdDefault);

    req._sageUploadPreservar = true;
    res.json({ message: 'Importação concluída.', resultado });
  } catch (err) {
    logger.error(`Erro ao importar planilha: ${err.message}`);
    responderErroInterno(res, err, 'Erro ao importar planilha.');
  }
});

// Rota de teste de upload para diagnosticar multipart (sem processar planilha)
router.post('/dados/importar/ping', autenticar, handleUploadSingle, async (req, res) => {
  req._sageUploadPreservar = true;
  res.json({ ok: true, file: req.file?.originalname, size: req.file?.size || 0 });
});

// -------------------------------------------------------
//  Exportar dados do banco no formato da planilha
// -------------------------------------------------------
router.get('/dados/exportar', autenticar, async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.join(paths.exports, `exportacao_${timestamp}.xlsx`);

    await exportarDados(exportPath);

    emitNotification({
      title: 'Exportação pronta',
      message: 'O arquivo de exportação foi gerado e está disponível para download.',
      type: 'success',
    });

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
