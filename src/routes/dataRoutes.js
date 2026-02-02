const express = require('express');
const multer = require('multer');
const path = require('path');
const autenticar = require('../middlewares/autenticar');
const { importarPlanilha } = require('../services/importService');
const { exportarDados } = require('../services/exportService');
const { emitNotification } = require('../services/notificationService');
const logger = require('../config/logger');

const router = express.Router();
// Configuração robusta de upload para evitar falhas silenciosas
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve('src/uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.xlsx';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_SIZE_MB || '25', 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error(`Formato não suportado: ${ext}. Envie .xlsx/.xls`));
    }
    cb(null, true);
  }
});

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
// Middleware para lidar com erros do multer e evitar ERR_EMPTY_RESPONSE
function handleUploadSingle(req, res, next) {
  upload.single('planilha')(req, res, (err) => {
    if (err) {
      logger.error(`Falha no upload: ${err.message}`);
      return res.status(400).json({ error: 'Falha no upload', detalhe: err.message });
    }
    next();
  });
}

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

    res.json({ message: 'Importação concluída.', resultado });
  } catch (err) {
    logger.error(`Erro ao importar planilha: ${err.message}`);
    res.status(500).json({ error: 'Erro ao importar planilha.', detalhe: err.message, stack: process.env.LOG_LEVEL === 'debug' ? err.stack : undefined });
  }
});

// Rota de teste de upload para diagnosticar multipart (sem processar planilha)
router.post('/dados/importar/ping', autenticar, handleUploadSingle, async (req, res) => {
  res.json({ ok: true, file: req.file?.originalname, size: req.file?.size || 0 });
});

// -------------------------------------------------------
//  Exportar dados do banco no formato da planilha
// -------------------------------------------------------
router.get('/dados/exportar', autenticar, async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.resolve(`exports/exportacao_${timestamp}.xlsx`);

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
