const fs = require('fs').promises;
const path = require('path');

const converterImagemPorUserId = async (id) => {
    const idUser = id; // ISSO É TEMPORÁRIO, SOMENTE PARA REFERENCIAR O ID DO USER NO BANCO DE ACORDO COM UMA REGRA PROVISÓRIA
    const fotoPath = path.join(__dirname, '..', 'uploads', 'pessoas', `pessoa_${idUser}.png`);
    const fotoBuffer = await fs.readFile(fotoPath);
    const fotoBase64 = fotoBuffer.toString('base64');
    return fotoBase64;
}

module.exports = converterImagemPorUserId;