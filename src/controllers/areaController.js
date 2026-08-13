const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const gerarController = require('./genericControllerFactory');
const { invalidate } = require('../cache/helpers');
const logger = require('../config/logger');
const { paths } = require('../config/paths');

const tabela = 'Area';
const campos = ['id', 'nome', 'unidade_id', 'foto'];

const controller = gerarController(tabela, campos, 'área');

async function uploadFoto(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo de foto não enviado' });
  }

  const area_id = req.params.id;
  if (!area_id) {
    return res.status(400).json({ message: 'ID da área é obrigatório' });
  }

  const baseUploads = paths.uploads;
  const pastaDestino = path.join(baseUploads, 'areas');

  if (!fs.existsSync(pastaDestino)) {
    fs.mkdirSync(pastaDestino, { recursive: true });
  }

  try {
    const [rows] = await db.query('SELECT * FROM Area WHERE id = ?', [area_id]);
    if (rows.length === 0) {
      const arquivoTemp = path.join(baseUploads, req.file.filename);
      if (fs.existsSync(arquivoTemp)) fs.unlinkSync(arquivoTemp);
      return res.status(404).json({ message: 'Área não encontrada' });
    }

    const [fotoAtual] = await db.query('SELECT foto FROM Area WHERE id = ?', [area_id]);
    if (fotoAtual.length > 0 && fotoAtual[0].foto) {
      const fotoAntigaCaminho = path.join(baseUploads, fotoAtual[0].foto);
      if (fs.existsSync(fotoAntigaCaminho)) fs.unlinkSync(fotoAntigaCaminho);
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const novoNome = `area_${area_id}${ext}`;
    const antigoCaminho = path.join(baseUploads, req.file.filename);
    const novoCaminho = path.join(pastaDestino, novoNome);

    if (!fs.existsSync(antigoCaminho)) {
      logger.warn(`[Area.uploadFoto] Arquivo temporário não encontrado: ${antigoCaminho}`);
      return res.status(500).json({ message: 'Arquivo de upload não encontrado. Tente novamente.' });
    }

    fs.renameSync(antigoCaminho, novoCaminho);

    const caminhoRelativo = path.join('areas', novoNome).replace(/\\/g, '/');
    await db.query('UPDATE Area SET foto = ? WHERE id = ?', [caminhoRelativo, area_id]);

    await invalidate('Area:*');

    res.status(200).json({
      message: 'Foto da área atualizada com sucesso',
      area_id: Number(area_id),
      foto: caminhoRelativo
    });
  } catch (error) {
    logger.error(`[Area.uploadFoto] ${error.message}`);
    try {
      const arquivoTemp = path.join(baseUploads, req.file.filename);
      if (fs.existsSync(arquivoTemp)) fs.unlinkSync(arquivoTemp);
    } catch (e) { logger.warn('[AREA-FOTO] codigo=ARQUIVO_TEMPORARIO_NAO_REMOVIDO'); }
    res.status(500).json({ message: 'Erro ao salvar a foto da área', error: error.message });
  }
}

controller.uploadFoto = uploadFoto;
module.exports = controller;
