const axios = require('axios');
const dispositivosService = require('./deviceService');
const db = require('../config/database');

const criarNovaPessoaNaCatraca = async (novaPessoa) => {
  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    const userPayload = {
      object: "users",
      values: [{
        registration: String(novaPessoa.id),
        name: novaPessoa.nome
      }]
    };

    try {
      const response = await axios.post(
        `http://${link}/create_objects.fcgi?session=${session}`,
        userPayload,
        { headers: { "Content-Type": "application/json" } }
      );

      resultados.push({ dispositivo: dispositivo.nome, sucesso: true, catracaId: response.data.ids?.[0] });
    } catch (error) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.response?.data || error.message });
    }
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao criar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err; // lança o erro, o controller pode tratar
  }

  return resultados; // tudo ok
};

const editarNomePessoaNaCatraca = async (id, nome) => {
  const query = `SELECT * FROM Pessoa WHERE id = ?`;
  const [pessoa] = await db.query(query, [id]);
  if(!pessoa) return "Pessoa não encontrada";

  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    const userPayload = {
      object: "users",
      values: {
        name: nome
      },
      where: {
        users: {
          // id: id //, // O CORRETO SERÁ PROCURAR PELO ID, POIS SERÁ O MESMO ID NO BANCO LOCAL DO SISTEMA E NO BANCO DA CATRACA
          name: pessoa[0].nome
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

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao editar nome do usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err; // lança o erro, o controller pode tratar
  }

  return resultados; // tudo ok
};

const deletarPessoaDaCatraca = async (id, nome) => {
  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    const userPayload = {
      object: "users",
      where: {
        users: {
          // id: id //, // O CORRETO SERÁ PROCURAR PELO ID, POIS SERÁ O MESMO ID NO BANCO LOCAL DO SISTEMA E NO BANCO DA CATRACA
          name: nome
          // registration: String(id) // TAMBÉM PODERIA SER POR MEIO DESTE REGISTRATION - NA VERDADE, ESTE É O IDEAL DE SE TRABALHAR PARA RELACIONAR COM O BANCO DO SISTEMA
        }
      }
    }

    try {
      const response = await axios.post(
        `http://${link}/destroy_objects.fcgi?session=${session}`,
        userPayload,
        { headers: { "Content-Type": "application/json" } }
      );

      resultados.push({ dispositivo: dispositivo.nome, sucesso: true, catracaId: response.data.ids?.[0] });
    } catch (error) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.response?.data || error.message });
    }
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao deletar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err; // lança o erro, o controller pode tratar
  }

  return resultados; // tudo ok
};

module.exports = {
    criarNovaPessoaNaCatraca,
    editarNomePessoaNaCatraca,
    deletarPessoaDaCatraca
}
