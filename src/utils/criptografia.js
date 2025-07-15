const bcrypt = require('bcrypt');

async function hashSenha(senha) {
  const saltRounds = 10;
  return await bcrypt.hash(senha, saltRounds);
}

async function compararHash(senha, hash){
  return await bcrypt.compare(senha, hash)
}

module.exports = {
  hashSenha,
  compararHash
};