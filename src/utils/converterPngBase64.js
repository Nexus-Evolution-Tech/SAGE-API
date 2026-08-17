const fs = require('fs').promises;
const { obterCaminhoFotoPessoa } = require('./photo-user-utils');

const converterImagemPorUserId = async (id) => {
    const idUser = id; // ISSO É TEMPORÁRIO, SOMENTE PARA REFERENCIAR O ID DO USER NO BANCO DE ACORDO COM UMA REGRA PROVISÓRIA
    const fotoPath = await obterCaminhoFotoPessoa(id);
    if (!fotoPath) {
        const erro = new Error('Foto da pessoa nÃ£o encontrada');
        erro.code = 'ENOENT';
        throw erro;
    }
    const fotoBuffer = await fs.readFile(fotoPath);
    const fotoBase64 = fotoBuffer.toString('base64');
    return fotoBase64;
}

module.exports = converterImagemPorUserId;
