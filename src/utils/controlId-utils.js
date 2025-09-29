const axios = require('axios');
const converterImagemPorUserId = require('./converterPngBase64');

const obterSessaoAdmin = async (ip, usuario, senha) => {
  try {
    const res = await axios.post(`http://${ip}/login.fcgi`, {
      login: usuario,
      password: senha
    }, {
      headers: { "Content-Type": "application/json" }
    });

    const session = res.data?.session;
    if (!session) throw new Error("Sessão não retornada");

    console.log(`Sessão ADM ${ip}: ${session}`)
    return session;
  } catch (err) {
    console.error("Erro ao obter sessão de admin:", err.response?.data || err.message);
    throw err;
  }
};

/**
 * Retorna o valor do cartão RFID ou QRCODE de um usuário na Control iD
 * 
 * @param {number} userId - ID do usuário
 * @param {string} tipo - 'RFID' ou 'QRCODE'
 * @param {string} session - Sessão autenticada (admin)
 * @param {string} deviceIp - IP da catraca (ex: 192.168.0.100)
 * @returns {Promise<string|null>} - Retorna o value do cartão ou null se não encontrado
 */
const obterCartaoPorTipo = async (userId, tipo, session, deviceIp) => {
  try {
    const response = await axios.post(`http://${deviceIp}/load_objects.fcgi?session=${session}`, {
      object: "cards",
      where: {
        cards: {
          user_id: userId
        }
      }
    }, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    console.log(response.data)

    const cards = response.data.cards;

    if (!cards || cards.length === 0) {
      console.warn(`Nenhum cartão encontrado para o usuário ${userId}.`);
      return null;
    }

    const valoresFiltrados = cards.filter(card => {
      const valorStr = String(card.value);
      if (tipo === "QRCODE") return /^\d{8}$/.test(valorStr);
      if (tipo === "RFID") return /^\d{9,}$/.test(valorStr);
      return false;
    });

    return valoresFiltrados.at(0) || null;
  } catch (err) {
    console.error(`Erro ao buscar cartão do usuário ${userId}:`, err.response?.data || err.message);
    return null;
  }
};

const criarUsuario = async (catracaUserId, novaPessoa, link, session, dispositivo, resultados) => {
  const userPayload = {
    object: "users",
    values: [{
      id: catracaUserId,
      name: novaPessoa.nome,
      registration: '' // NÃO PODE SER NULL JAMAIS
    }]
  };
  console.log(catracaUserId)
  console.log(novaPessoa.nome)

  let userId;
  try {
    const response = await axios.post(
      `http://${link}/create_objects.fcgi?session=${session}`,
      userPayload,
      { headers: { "Content-Type": "application/json" } }
    );
    userId = response.data.ids?.[0] ?? novaPessoa.id; // fallback pro ID local
    resultados.push({ dispositivo: dispositivo.nome, sucesso: true, catracaId: userId });
  } catch (error) {
    resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.response?.data || error.message });
    throw new Error(`Erro ao criar usuário na catraca ${dispositivo.nome}:`, error.response?.data || error.message);
  }
}

const editarUsuario = async (id, nome, link, session, dispositivo, resultados) => {
  const userPayload = {
    object: "users",
    values: {
      name: nome
    },
    where: {
      users: {
        id: id //, // O CORRETO SERÁ PROCURAR PELO ID, POIS SERÁ O MESMO ID NO BANCO LOCAL DO SISTEMA E NO BANCO DA CATRACA
        // name: pessoa[0].nome
        // registration: String(id) // TAMBÉM PODERIA SER POR MEIO DESTE REGISTRATION - NA VERDADE, ESTE É O IDEAL DE SE TRABALHAR PARA RELACIONAR COM O BANCO DO SISTEMA
      }
    }
  }

  try {
    const response = await axios.post(
      `http://${link}/modify_objects.fcgi?session=${session}`,
      userPayload,
      { headers: { "Content-Type": "application/json" } }
    );

    resultados.push({ dispositivo: dispositivo.nome, sucesso: true, catracaId: response.data.ids?.[0] });
  } catch (error) {
    resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.response?.data || error.message });
  }
}

const deletarUsuario = async (id, link, session, dispositivo, resultados) => {
  const userPayload = {
    object: "users",
    where: { users: { id: id } }
  };

  let userSuccess = true;
  try {
    await axios.post(`http://${link}/destroy_objects.fcgi?session=${session}`, userPayload, {
      headers: { "Content-Type": "application/json" }
    });
    resultados.push({ dispositivo: dispositivo.nome, sucesso: true, catracaId: id });
    console.log(`Usuário ${id} deletado com sucesso no dispositivo ${dispositivo.nome}`);
  } catch (err) {
    const detalhesErro = err.response?.data || err.message;
    console.error('Erro ao remover pessoa:', detalhesErro);
    resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: detalhesErro });
    userSuccess = false;
  }
  return userSuccess;
}

const criarCartao = async (id, value, link, session, dispositivo, resultados) => {
  // const value = cartao_rfid ? await gerarCardValue(cartao_rfid) : 0;
  // console.log(`[${dispositivo.nome}] Valor do cartão para ID ${id}:`, value);
  // console.log(cartao_rfid)

  const cardPayload = {
    object: "cards",
    values: [{
      user_id: id,
      value: value // substituir se tiver valor
    }]
  };
  try {
    await axios.post(`http://${link}/create_objects.fcgi?session=${session}`, cardPayload, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    throw new Error(`Não foi possível criar cartão na catraca ${dispositivo.nome}:`, err.message);
  }
}

// const editarCartao = async (id, value, link, session, dispositivo, tipo) => {
//   const cardPayload = {
//     object: "cards",
//     values: [{
//       value: value // substituir se tiver valor
//     }],
//     where: {
//       cards: {
//         user_id: id,
//         value: { eq: obterValorCartaoPorTipo(id, tipo) }
//         // value: { regex: "^[0-9]{8}$" }
//         // value: { like: "________" }
//       }
//     }
//   };
//   try {
//     await axios.post(`http://${link}/modify_objects.fcgi?session=${session}`, cardPayload, { headers: { "Content-Type": "application/json" } });
//   } catch (err) {
//     console.warn(`Não foi possível criar cartão na catraca ${dispositivo.nome}:`, err.message);
//   }
// }

const deletarCartao = async (id, link, session, dispositivo, tipo) => {
  const cartao = await obterCartaoPorTipo(id, tipo, session, link);
  // console.log(cartao.id);
  const cardPayload = {
    object: "cards",
    where: {
      cards: {
        id: cartao.id,
        // value: { regex: "^[0-9]{8}$" }
        // value: { like: "________" }
      }
    }
  };
  try {
      await axios.post(`http://${link}/destroy_objects.fcgi?session=${session}`, cardPayload, {
      headers: { "Content-Type": "application/json" }
      });
  } catch (err) {
      console.warn(`Não foi possível deletar cartão na catraca ${dispositivo.nome}:`, err.message);
  }
}

const criarGrupo = async (id, link, session, dispositivo, resultados) => {
    const groupPayload = {
      object: "user_groups",
      values: [{
        user_id: id,
        group_id: 1 // grupo default - libera todo mundo
      }]
    };
    try {
      await axios.post(`http://${link}/create_objects.fcgi?session=${session}`, groupPayload, { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      throw new Error(`Não foi possível criar grupo na catraca ${dispositivo.nome}:`, err.message);
    }
}

const deletarGrupo = async (id, link, session, dispositivo) => {
    const groupPayload = {
        object: "user_groups",
        where: { user_groups: { user_id: id } }
    };
    try {
        await axios.post(`http://${link}/destroy_objects.fcgi?session=${session}`, groupPayload, {
        headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        console.warn(`Não foi possível deletar grupo na catraca ${dispositivo.nome}:`, err.message);
    }
}

const criarImagemUser = async (id, link, session, dispositivo, resultados) => {
  try {
    const fotoBase64 = await converterImagemPorUserId(id); // AQUI EU TO PASSANDO O ID DA CATRACA, PRECISO CONVERTER PRO ID DO BANCO
    
    const imagePayload = {
      user_images: [{
        user_id: id,
        image: fotoBase64
      }]
    };

    await axios.post(`http://${link}/user_set_image_list.fcgi?session=${session}`, imagePayload, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    // Se não existe arquivo, apenas ignora
    if (err.code !== 'ENOENT') console.warn(`Erro ao enviar imagem na catraca ${dispositivo.nome}:`, err.message);
  }
}

const deletarImagemUser = async (id, link, session, dispositivo, resultados) => {
  const imagePayload = {
    object: "user_images",
    where: { user_images: { user_id: id } }
  };
  try {
    await axios.post(
      `http://${link}/user_destroy_image.fcgi?session=${session}`,
      imagePayload,
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.warn(`Não foi possível deletar imagem na catraca ${dispositivo.nome}:`, err.message);
  }
}

//OBS: MODELO DE CATRACA V2 NÃO PERMITE CRIAÇÃO DE QRCODE, APENAS DE V5 PRA CIMA
// const criarQrCode = async (id, link, session, dispositivo, resultados) => {
//   const qrCodePayload = {
//     object: "qrcodes",
//     values: [{
//       user_id: id,
//       value: value
//     }]
//   };
//   try {
//     await axios.post(
//       `http://${link}/create_objects.fcgi?session=${session}`,
//       qrCodePayload,
//       { headers: { "Content-Type": "application/json" } }
//     );
//   } catch (err) {
//     console.warn(`Não foi possível deletar imagem na catraca ${dispositivo.nome}:`, err.message);
//   }
// }

module.exports = {
  criarUsuario,
  editarUsuario,
  deletarUsuario,
  criarCartao,
  // editarCartao,
  deletarCartao,
  criarGrupo,
  deletarGrupo,
  criarImagemUser,
  deletarImagemUser,
  obterSessaoAdmin,
  obterCartaoPorTipo
  // criarQrCode
}