const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { paths } = require('../config/paths');
const logger = require('../config/logger');

if (!fs.existsSync(paths.uploads)) fs.mkdirSync(paths.uploads, { recursive: true });
const maxFileSize = Math.max(1, Number(process.env.UPLOAD_MAX_SIZE_MB || 25)) * 1024 * 1024;
const assinaturasImagem = Object.freeze({
  '.png': Buffer.from('89504e470d0a1a0a', 'hex'),
  '.jpg': Buffer.from('ffd8ff', 'hex'),
  '.jpeg': Buffer.from('ffd8ff', 'hex')
});

function erroTipoArquivo() {
  const erro = new Error('Tipo de arquivo não suportado');
  erro.code = 'SAGE_UNSUPPORTED_FILE_TYPE';
  return erro;
}

function limparTemporario(req) {
  const arquivos = [req._sageUploadTempPath, req.file?.path]
    .filter(Boolean);
  for (const arquivo of arquivos) {
    try {
      if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
    } catch {
      logger.error('[UPLOAD] codigo=ARQUIVO_TEMPORARIO_NAO_REMOVIDO');
    }
  }
  delete req._sageUploadTempPath;
}

function assinaturaValida(file, assinaturas) {
  const ext = path.extname(file.filename).toLowerCase();
  const assinatura = assinaturas[ext];
  if (!assinatura || !fs.existsSync(file.path)) return false;
  const inicio = Buffer.alloc(assinatura.length);
  const fd = fs.openSync(file.path, 'r');
  try {
    return fs.readSync(fd, inicio, 0, assinatura.length, 0) === assinatura.length
      && inicio.equals(assinatura);
  } finally {
    fs.closeSync(fd);
  }
}

function criarUploadSeguro({ storage, fileFilter, assinaturas }) {
  const parser = multer({
    storage,
    limits: { fileSize: maxFileSize, files: 1 },
    fileFilter
  });

  return {
    single(campo) {
      const parsear = parser.single(campo);
      function multerMiddleware(req, res, next) {
        const limparAoTerminar = () => {
          if (!req._sageUploadPreservar) limparTemporario(req);
        };
        res.once('finish', limparAoTerminar);
        res.once('close', limparAoTerminar);
        parsear(req, res, (erro) => {
          if (erro) {
            limparTemporario(req);
            if (erro.code === 'LIMIT_FILE_SIZE' || erro.code === 'LIMIT_FILE_COUNT'
              || erro.code === 'LIMIT_UNEXPECTED_FILE') {
              return res.status(413).json({ error: 'Arquivo excede o limite permitido.' });
            }
            if (erro.code === 'SAGE_UNSUPPORTED_FILE_TYPE') {
              return res.status(415).json({ error: 'Tipo de arquivo não suportado.' });
            }
            return next(erro);
          }
          try {
            if (req.file && !assinaturaValida(req.file, assinaturas)) {
              limparTemporario(req);
              return res.status(415).json({ error: 'Conteúdo do arquivo não corresponde ao tipo declarado.' });
            }
            return next();
          } catch (erroValidacao) {
            limparTemporario(req);
            return next(erroValidacao);
          }
        });
      }
      multerMiddleware.isMulterMiddleware = true;
      return multerMiddleware;
    }
  };
}

const tiposImagem = new Map([
  ['.png', new Set(['image/png'])],
  ['.jpg', new Set(['image/jpeg', 'image/jpg'])],
  ['.jpeg', new Set(['image/jpeg', 'image/jpg'])]
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.uploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nomeTemporario = `temp_${uuidv4()}${ext}`;
    req._sageUploadTempPath = path.join(paths.uploads, nomeTemporario);
    cb(null, nomeTemporario);
  }
});

const uploadFoto = criarUploadSeguro({
  storage,
  assinaturas: assinaturasImagem,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!tiposImagem.has(ext) || !tiposImagem.get(ext).has(file.mimetype)) return cb(erroTipoArquivo());
    return cb(null, true);
  }
});

module.exports = uploadFoto;
module.exports.criarUploadSeguro = criarUploadSeguro;
module.exports.erroTipoArquivo = erroTipoArquivo;
module.exports.assinaturasImagem = assinaturasImagem;
