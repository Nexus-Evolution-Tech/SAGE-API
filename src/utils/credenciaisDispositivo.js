const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AAD = Buffer.from('SAGE:Dispositivo:credencial:v1', 'utf8');
const FORMAT = 'v1';
const CAMPOS_CREDENCIAIS = Object.freeze(['usuario', 'senha']);

function erroConfig(mensagem) {
  const erro = new Error(`CONFIGURACAO_CREDENCIAL_DISPOSITIVO: ${mensagem}`);
  erro.code = 'CONFIGURACAO_CREDENCIAL_DISPOSITIVO';
  return erro;
}

function decodificarBase64Url(valor, nome) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(valor)) {
    throw erroConfig(`${nome} deve ser base64url`);
  }
  const base64 = valor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (valor.length % 4)) % 4);
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length !== KEY_BYTES) throw erroConfig(`${nome} deve conter 32 bytes`);
  return buffer;
}

function chavesConfiguradas() {
  const atual = process.env.SAGE_DEVICE_CREDENTIAL_KEY;
  const anterior = process.env.SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS;
  if (!atual) throw erroConfig('SAGE_DEVICE_CREDENTIAL_KEY ausente');
  const chaves = [{ nome: 'atual', valor: decodificarBase64Url(atual, 'SAGE_DEVICE_CREDENTIAL_KEY') }];
  if (anterior) chaves.push({ nome: 'anterior', valor: decodificarBase64Url(anterior, 'SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS') });
  return chaves;
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isCredencialCriptografada(valor) {
  return typeof valor === 'string' && valor.startsWith(`${FORMAT}:`);
}

function separarEnvelope(valor) {
  const partes = typeof valor === 'string' ? valor.split(':') : [];
  if (partes.length !== 4 || partes[0] !== FORMAT || partes.slice(1).some((parte) => !parte)) {
    const erro = new Error('Envelope de credencial de dispositivo inválido');
    erro.code = 'CREDENCIAL_DISPOSITIVO_INVALIDA';
    throw erro;
  }
  const [_, iv, tag, ciphertext] = partes;
  const decodificar = (parte) => Buffer.from(
    parte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parte.length % 4)) % 4),
    'base64'
  );
  const ivBuffer = decodificar(iv);
  const tagBuffer = decodificar(tag);
  const ciphertextBuffer = decodificar(ciphertext);
  if (ivBuffer.length !== IV_BYTES || tagBuffer.length !== 16 || ciphertextBuffer.length === 0) {
    const erro = new Error('Envelope de credencial de dispositivo inválido');
    erro.code = 'CREDENCIAL_DISPOSITIVO_INVALIDA';
    throw erro;
  }
  return { iv: ivBuffer, tag: tagBuffer, ciphertext: ciphertextBuffer };
}

function criptografarCredencial(valor) {
  if (typeof valor !== 'string') throw new TypeError('Credencial de dispositivo deve ser texto');
  const [chave] = chavesConfiguradas();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, chave.valor, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
  return `${FORMAT}:${base64Url(iv)}:${base64Url(cipher.getAuthTag())}:${base64Url(ciphertext)}`;
}

function descriptografarDetalhes(valor) {
  if (!isCredencialCriptografada(valor)) {
    const erro = new Error('Credencial de dispositivo não está criptografada');
    erro.code = 'CREDENCIAL_DISPOSITIVO_LEGADA';
    throw erro;
  }
  const envelope = separarEnvelope(valor);
  let ultimoErro;
  for (const [indice, chave] of chavesConfiguradas().entries()) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, chave.valor, envelope.iv);
      decipher.setAAD(AAD);
      decipher.setAuthTag(envelope.tag);
      const texto = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString('utf8');
      return { texto, indiceChave: indice };
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  const erro = new Error('Não foi possível autenticar a credencial de dispositivo');
  erro.code = 'CREDENCIAL_DISPOSITIVO_INVALIDA';
  erro.cause = ultimoErro;
  throw erro;
}

function descriptografarCredencial(valor) {
  return descriptografarDetalhes(valor).texto;
}

function protegerDadosDispositivo(dados = {}) {
  const resultado = { ...dados };
  for (const campo of CAMPOS_CREDENCIAIS) {
    if (!(campo in resultado) || resultado[campo] === undefined || resultado[campo] === null) continue;
    if (typeof resultado[campo] !== 'string') throw new TypeError(`${campo} do dispositivo deve ser texto`);
    if (isCredencialCriptografada(resultado[campo])) {
      descriptografarCredencial(resultado[campo]);
    } else {
      resultado[campo] = criptografarCredencial(resultado[campo]);
    }
  }
  return resultado;
}

function prepararDispositivoParaOperacao(dispositivo = {}) {
  const resultado = { ...dispositivo };
  for (const campo of CAMPOS_CREDENCIAIS) {
    if (resultado[campo] === undefined || resultado[campo] === null) continue;
    // Compatibilidade apenas fora de produção para fixtures/desenvolvimento legado.
    // O instalador sempre executa migrarCredenciaisDispositivos antes de iniciar a API.
    resultado[campo] = isCredencialCriptografada(resultado[campo])
      ? descriptografarCredencial(resultado[campo])
      : process.env.NODE_ENV === 'production'
        ? descriptografarCredencial(resultado[campo])
        : resultado[campo];
  }
  return resultado;
}

async function migrarCredenciaisDispositivos(connection) {
  if (!connection || typeof connection.query !== 'function') throw new TypeError('connection é obrigatória');
  const transacionavel = typeof connection.beginTransaction === 'function'
    && typeof connection.commit === 'function'
    && typeof connection.rollback === 'function';
  if (transacionavel) await connection.beginTransaction();
  try {
    const [linhas] = await connection.query('SELECT id, usuario, senha FROM Dispositivo FOR UPDATE');
    const dispositivos = Array.isArray(linhas) ? linhas : [];
    const pendentes = dispositivos.filter((dispositivo) => CAMPOS_CREDENCIAIS.some(
      (campo) => dispositivo[campo] !== undefined && dispositivo[campo] !== null
    ));
    let migrados = 0;
    let rotacionados = 0;
    for (const dispositivo of pendentes) {
      const atualizacoes = {};
      let rotacionou = false;
      for (const campo of CAMPOS_CREDENCIAIS) {
        const valor = dispositivo[campo];
        if (valor === undefined || valor === null) continue;
        if (isCredencialCriptografada(valor)) {
          const detalhes = descriptografarDetalhes(valor);
          if (detalhes.indiceChave > 0) {
            atualizacoes[campo] = criptografarCredencial(detalhes.texto);
            rotacionou = true;
          }
        } else {
          atualizacoes[campo] = criptografarCredencial(String(valor));
        }
      }
      const campos = Object.keys(atualizacoes);
      if (!campos.length) continue;
      await connection.query(
        `UPDATE Dispositivo SET ${campos.map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`,
        [...campos.map((campo) => atualizacoes[campo]), dispositivo.id]
      );
      migrados += 1;
      if (rotacionou) rotacionados += 1;
    }
    if (transacionavel) await connection.commit();
    return { migrados, rotacionados };
  } catch (erro) {
    if (transacionavel) await connection.rollback().catch(() => {});
    throw erro;
  }
}

module.exports = {
  CAMPOS_CREDENCIAIS,
  criptografarCredencial,
  descriptografarCredencial,
  isCredencialCriptografada,
  protegerDadosDispositivo,
  prepararDispositivoParaOperacao,
  migrarCredenciaisDispositivos
};
