const http = require('http');
const { CatracaStore } = require('./store');
const { gerarAccessLogs, PRESETS_FAIXA } = require('./geradorLogs');

/**
 * Simulador HTTP de catraca Control iD IDBlock (firmware antigo).
 *
 * Reproduz de propósito os comportamentos ESTRANHOS do equipamento real (os "quirks").
 * Leia test/fakes/controlid/README.md antes de "consertar" qualquer coisa aqui.
 */

const QUIRKS_PADRAO = {
  /** Q1: modify_objects responde HTTP 400 com corpo VAZIO quando o modify deu certo. */
  modifyRetorna400NoSucesso: true,
  /** Q2: false = catraca sem módulo facial → rejeita user_images. */
  moduloFacial: false,
  /** Q3: latência artificial (ms) só no load_objects de access_logs. */
  latenciaAccessLogsMs: 0,
  /** Q3: ignora `limit`/`offset` em access_logs e devolve TUDO. */
  ignoraLimitEmAccessLogs: false,
  /** Q4: true = respeita where { access_logs: { id: { '>': X } } }; false = ignora em silêncio. */
  honorsWhereFilter: true,
  /** Q6: user_id na catraca = userIdOffset + pessoa.id. */
  userIdOffset: 111000000,
  /** Q7: aceitar `where` de users por `registration` (não só por `id`). */
  aceitaVinculoPorRegistration: true
};

const CONFIG_PADRAO = {
  host: '127.0.0.1',
  /** Tempo de vida da sessão do login.fcgi (ms). */
  sessaoTtlMs: 60 * 60 * 1000,
  seed: 42,
  /** device_id que a catraca informa no push do Monitor. */
  deviceId: 1,
  usuario: 'admin',
  senha: 'admin',
  /** Se true, valida login/senha; catracas antigas costumam aceitar qualquer coisa. */
  validaCredenciais: false
};

const ENDPOINTS_SEM_SESSAO = new Set(['/login.fcgi']);

function jsonBody(res, status, obj) {
  const corpo = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(corpo)
  });
  res.end(corpo);
}

/** Q1: 400 com corpo de comprimento zero — é isto que a produção interpreta como SUCESSO. */
function corpoVazio400(res) {
  res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': 0 });
  res.end();
}

function erro(res, status, mensagem) {
  jsonBody(res, status, { error: { code: status, message: mensagem } });
}

async function createCatracaSimulator(opcoes = {}) {
  const config = { ...CONFIG_PADRAO, ...opcoes };
  const quirks = { ...QUIRKS_PADRAO, ...(opcoes.quirks || {}) };

  const store = new CatracaStore();
  const sessoes = new Map(); // token → { expiraEm, operacoes }
  const requisicoes = []; // histórico: { endpoint, object, corpo, em }
  let monitorConfig = null;
  let contadorSessao = 0;
  let falha = { modo: opcoes.failureMode || null, vezesRestantes: Infinity, ms: 0, aposOperacoes: 1 };
  let operacoesDesdeFalha = 0;
  const eventosPushPerdidos = [];

  function consumirFalha() {
    if (falha.modo == null) return null;
    if (falha.vezesRestantes !== Infinity) {
      falha.vezesRestantes -= 1;
      if (falha.vezesRestantes <= 0) {
        const modo = falha.modo;
        const snapshot = { ...falha };
        falha = { modo: null, vezesRestantes: Infinity, ms: 0, aposOperacoes: 1 };
        return { ...snapshot, modo };
      }
    }
    return falha;
  }

  function criarSessao() {
    const token = `sessao-simulada-${++contadorSessao}-${config.seed}`;
    sessoes.set(token, { expiraEm: Date.now() + config.sessaoTtlMs, operacoes: 0 });
    return token;
  }

  function sessaoValida(token) {
    const s = sessoes.get(token);
    if (!s) return false;
    if (s.expiraEm <= Date.now()) {
      sessoes.delete(token);
      return false;
    }
    return true;
  }

  function expirarTodasAsSessoes() {
    sessoes.clear();
  }

  // ---------------- roteamento dos endpoints ----------------

  function tratarLoadObjects(corpo, res) {
    const nome = corpo.object;
    if (!nome) return erro(res, 400, 'Campo "object" ausente');

    if (nome === 'user_images' && !quirks.moduloFacial) {
      return erro(res, 400, 'user_images não suportado: catraca sem módulo facial');
    }

    if (
      nome === 'users' &&
      !quirks.aceitaVinculoPorRegistration &&
      corpo.where &&
      JSON.stringify(corpo.where).includes('registration')
    ) {
      return erro(res, 400, 'campo registration não indexado neste firmware');
    }

    if (nome === 'access_logs') {
      // Q4: quando honorsWhereFilter = false, o where é DESCARTADO em silêncio.
      const where = quirks.honorsWhereFilter ? corpo.where : undefined;
      // Q3: firmware antigo pode ignorar limit/offset e despejar todos os logs.
      const usarPaginacao = !quirks.ignoraLimitEmAccessLogs;
      const dados = store.selecionar('access_logs', {
        where,
        limit: usarPaginacao ? corpo.limit : undefined,
        offset: usarPaginacao ? corpo.offset : undefined,
        order: corpo.order
      });
      const responder = () => jsonBody(res, 200, { access_logs: dados });
      if (quirks.latenciaAccessLogsMs > 0) return setTimeout(responder, quirks.latenciaAccessLogsMs);
      return responder();
    }

    const dados = store.selecionar(nome, {
      where: corpo.where,
      limit: corpo.limit,
      offset: corpo.offset,
      order: corpo.order
    });
    const projetados = Array.isArray(corpo.columns) && corpo.columns.length > 0
      ? dados.map((item) => Object.fromEntries(corpo.columns.map((c) => [c, item[c]])))
      : dados;
    return jsonBody(res, 200, { [nome]: projetados });
  }

  function tratarCreateObjects(corpo, res) {
    const nome = corpo.object;
    if (!nome) return erro(res, 400, 'Campo "object" ausente');
    if (nome === 'user_images' && !quirks.moduloFacial) {
      return erro(res, 400, 'user_images rejeitado: catraca sem módulo facial (Q2)');
    }
    const valores = Array.isArray(corpo.values) ? corpo.values : [corpo.values].filter(Boolean);
    if (valores.length === 0) return erro(res, 400, 'Campo "values" ausente');

    if (nome === 'users') {
      for (const v of valores) {
        if (v.registration === null || v.registration === undefined) {
          // Comportamento real: registration NULL faz o equipamento recusar o usuário.
          return erro(res, 400, 'registration não pode ser nulo');
        }
        if (v.id != null && store.existeId('users', v.id)) {
          return erro(res, 400, `usuário com id ${v.id} já existe`);
        }
      }
    }

    const ids = valores.map((v) => store.inserir(nome, v));
    return jsonBody(res, 200, { ids });
  }

  function tratarModifyObjects(corpo, res) {
    const nome = corpo.object;
    if (!nome) return erro(res, 400, 'Campo "object" ausente');
    if (
      nome === 'users' &&
      !quirks.aceitaVinculoPorRegistration &&
      corpo.where &&
      JSON.stringify(corpo.where).includes('registration')
    ) {
      return erro(res, 400, 'campo registration não indexado neste firmware');
    }
    const valores = Array.isArray(corpo.values) ? corpo.values[0] : corpo.values;
    if (!valores) return erro(res, 400, 'Campo "values" ausente');

    const alterados = store.modificar(nome, corpo.where, valores);
    if (alterados === 0) {
      // Nada casou com o where: erro DE VERDADE (corpo com `error`).
      return erro(res, 400, 'nenhum objeto corresponde ao filtro');
    }
    // Q1: sucesso → HTTP 400 com corpo vazio.
    if (quirks.modifyRetorna400NoSucesso) return corpoVazio400(res);
    return jsonBody(res, 200, { changes: alterados });
  }

  function tratarDestroyObjects(corpo, res) {
    const nome = corpo.object;
    if (!nome) return erro(res, 400, 'Campo "object" ausente');
    const removidos = store.destruir(nome, corpo.where);
    // Deletar usuário derruba cartões, grupos e imagens (cascade real do equipamento).
    if (nome === 'users') {
      const idsRestantes = new Set(store.tabela('users').map((u) => String(u.id)));
      for (const dependente of ['cards', 'user_groups', 'user_images']) {
        store.tabelas[dependente] = store
          .tabela(dependente)
          .filter((i) => idsRestantes.has(String(i.user_id)));
      }
    }
    return jsonBody(res, 200, { changes: removidos });
  }

  function tratarSetConfiguration(corpo, res) {
    if (corpo.monitor) {
      monitorConfig = { ...corpo.monitor };
    }
    return jsonBody(res, 200, {});
  }

  function tratarUserSetImageList(corpo, res) {
    if (!quirks.moduloFacial) {
      return erro(res, 400, 'user_set_image_list rejeitado: catraca sem módulo facial (Q2)');
    }
    const lista = Array.isArray(corpo.user_images) ? corpo.user_images : [];
    for (const img of lista) store.inserir('user_images', img);
    return jsonBody(res, 200, {});
  }

  // ---------------- servidor HTTP ----------------

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://catraca.local');
      const endpoint = url.pathname;
      const token = url.searchParams.get('session');
      let corpo = {};
      const bruto = Buffer.concat(chunks).toString('utf8');
      if (bruto.length > 0) {
        try {
          corpo = JSON.parse(bruto);
        } catch (e) {
          return erro(res, 400, 'JSON inválido');
        }
      }

      requisicoes.push({ endpoint, object: corpo.object, corpo, em: Date.now() });

      const modoFalha = consumirFalha();
      const modo = modoFalha?.modo || null;

      // Modos que impedem a requisição de ser sequer processada.
      if (modo === 'offline') {
        return req.socket.destroy();
      }
      if (modo === 'timeout') {
        return; // nunca responde: o cliente estoura o timeout dele
      }
      if (modo === 'lentidao' && modoFalha.ms > 0) {
        await new Promise((r) => setTimeout(r, modoFalha.ms));
      }
      if (modo === 'sessaoExpirada' && !ENDPOINTS_SEM_SESSAO.has(endpoint)) {
        // aposOperacoes = N: a N-ésima operação autenticada já encontra a sessão morta.
        operacoesDesdeFalha++;
        if (operacoesDesdeFalha >= (modoFalha.aposOperacoes ?? 1)) {
          expirarTodasAsSessoes();
        }
      }

      if (req.method !== 'POST') return erro(res, 405, 'Somente POST');

      if (!ENDPOINTS_SEM_SESSAO.has(endpoint) && !sessaoValida(token)) {
        return jsonBody(res, 401, { error: 'sessão inválida ou expirada' });
      }
      if (!ENDPOINTS_SEM_SESSAO.has(endpoint)) {
        sessoes.get(token).operacoes++;
      }

      // Coleta a resposta em memória para poder descartá-la (perdeRespostaAposProcessar)
      // ou truncá-la (respostaParcial) DEPOIS de o efeito já ter sido aplicado no store.
      const capturado = { status: 200, corpo: '' };
      const resFake = {
        writeHead(status) {
          capturado.status = status;
          return resFake;
        },
        end(dados) {
          if (dados) capturado.corpo += dados;
        }
      };

      const alvo = modo === 'perdeRespostaAposProcessar' || modo === 'respostaParcial' ? resFake : res;

      switch (endpoint) {
        case '/login.fcgi': {
          if (config.validaCredenciais && (corpo.login !== config.usuario || corpo.password !== config.senha)) {
            erro(alvo, 401, 'credenciais inválidas');
            break;
          }
          jsonBody(alvo, 200, { session: criarSessao() });
          break;
        }
        case '/session_is_valid.fcgi':
          jsonBody(alvo, 200, { session_is_valid: true });
          break;
        case '/load_objects.fcgi':
          tratarLoadObjects(corpo, alvo);
          break;
        case '/create_objects.fcgi':
          tratarCreateObjects(corpo, alvo);
          break;
        case '/create_or_update_objects.fcgi': {
          const valores = Array.isArray(corpo.values) ? corpo.values : [];
          for (const valor of valores) {
            if (valor.id != null && store.existeId(corpo.object, valor.id)) {
              store.modificar(corpo.object, { [corpo.object]: { id: valor.id } }, valor);
            } else store.inserir(corpo.object, valor);
          }
          jsonBody(alvo, 200, { changes: valores.length });
          break;
        }
        case '/modify_objects.fcgi':
          tratarModifyObjects(corpo, alvo);
          break;
        case '/destroy_objects.fcgi':
          tratarDestroyObjects(corpo, alvo);
          break;
        case '/set_configuration.fcgi':
          tratarSetConfiguration(corpo, alvo);
          break;
        case '/user_set_image_list.fcgi':
          tratarUserSetImageList(corpo, alvo);
          break;
        case '/user_destroy_image.fcgi':
          store.destruir('user_images', corpo.where);
          jsonBody(alvo, 200, {});
          break;
        default:
          erro(alvo, 404, `endpoint ${endpoint} não implementado no simulador`);
      }

      if (modo === 'perdeRespostaAposProcessar') {
        // Efeito JÁ aplicado no store; a resposta nunca chega ao cliente.
        return req.socket.destroy();
      }
      if (modo === 'respostaParcial') {
        // Declara o Content-Length completo e envia só metade do JSON: o cliente
        // recebe um JSON truncado / conexão cortada no meio.
        const completo = capturado.corpo || '{}';
        const metade = completo.slice(0, Math.max(1, Math.floor(completo.length / 2)));
        res.writeHead(capturado.status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(completo)
        });
        res.write(metade);
        return req.socket.destroy();
      }
    });
  });

  await new Promise((resolve) => server.listen(0, config.host, resolve));
  const porta = server.address().port;

  const sim = {
    /** Formato aceito por deviceService.linkCatraca → `endereco:porta`. */
    url: `${config.host}:${porta}`,
    host: config.host,
    porta,
    /** Objeto no formato da tabela Dispositivo, pronto para passar ao deviceService. */
    dispositivo: {
      id: 1,
      nome: 'Catraca Simulada',
      endereco: config.host,
      porta,
      usuario: config.usuario,
      senha: config.senha,
      sync_enabled: 1,
      control_id_device_id: config.deviceId
    },
    quirks,
    store,
    requisicoes,

    setQuirk(nome, valor) {
      quirks[nome] = valor;
      return sim;
    },

    /**
     * @param {string|null} modo - offline | timeout | sessaoExpirada | respostaParcial |
     *   perdeRespostaAposProcessar | lentidao | perdeEventoPush | null
     * @param {object} [opcoes] - { vezes, ms, aposOperacoes }
     */
    setFailureMode(modo, opcoes = {}) {
      falha = {
        modo,
        vezesRestantes: opcoes.vezes != null ? opcoes.vezes : Infinity,
        ms: opcoes.ms ?? 0,
        aposOperacoes: opcoes.aposOperacoes ?? 1
      };
      operacoesDesdeFalha = 0;
      return sim;
    },

    get failureMode() {
      return falha.modo;
    },

    /**
     * Popula access_logs de forma determinística (Q3 + Q5).
     * @param {number} quantidade
     * @param {object} [opcoes] - { idInicial, seed, userIdOffset, pessoaIds, offsetsExtras }
     */
    seedAccessLogs(quantidade = 48057, opcoes = {}) {
      const logs = gerarAccessLogs({
        quantidade,
        idInicial: opcoes.idInicial ?? PRESETS_FAIXA.instanciaA.idInicial,
        seed: opcoes.seed ?? config.seed,
        userIdOffset: opcoes.userIdOffset ?? quirks.userIdOffset,
        deviceId: config.deviceId,
        ...opcoes
      });
      store.tabelas.access_logs = logs;
      store.proximoId.access_logs = null;
      return logs;
    },

    /**
     * Cria usuários no formato do SAGE (Q6): user_id = offset + pessoa.id.
     * Passe dois offsets para simular a base suja com usuários órfãos.
     */
    seedUsuarios(pessoaIds = [1, 2, 3], offsets = [quirks.userIdOffset]) {
      const criados = [];
      for (const offset of offsets) {
        for (const pessoaId of pessoaIds) {
          const id = offset + pessoaId;
          store.inserir('users', { id, name: `Pessoa Teste ${pessoaId}`, registration: '' });
          store.inserir('user_groups', { user_id: id, group_id: 1 });
          criados.push(id);
        }
      }
      return criados;
    },

    /** Configuração do Monitor recebida via set_configuration.fcgi (ou null). */
    get monitorConfig() {
      return monitorConfig;
    },

    eventosPushPerdidos,

    /**
     * Emite um evento push (POST) para a URL de callback configurada pelo Monitor.
     * Respeita o modo de falha `perdeEventoPush`.
     * @param {object|object[]} values - access_log(s) inserido(s)
     */
    async emitirEventoPush(values) {
      const lista = Array.isArray(values) ? values : [values];
      const payload = {
        device_id: config.deviceId,
        object_changes: lista.map((v) => ({ object: 'access_logs', type: 'inserted', values: v }))
      };
      if (falha.modo === 'perdeEventoPush') {
        eventosPushPerdidos.push(payload);
        return { enviado: false, motivo: 'perdeEventoPush' };
      }
      if (!monitorConfig) {
        return { enviado: false, motivo: 'monitor não configurado' };
      }
      const caminho = monitorConfig.path.startsWith('/') ? monitorConfig.path : `/${monitorConfig.path}`;
      const corpo = JSON.stringify(payload);
      return new Promise((resolve) => {
        const req = http.request(
          {
            host: monitorConfig.hostname,
            port: Number(monitorConfig.port),
            path: caminho,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) }
          },
          (resp) => {
            const partes = [];
            resp.on('data', (c) => partes.push(c));
            resp.on('end', () =>
              resolve({ enviado: true, status: resp.statusCode, corpo: Buffer.concat(partes).toString('utf8') })
            );
          }
        );
        req.on('error', (err) => resolve({ enviado: false, motivo: err.message }));
        req.end(corpo);
      });
    },

    /** Quantas vezes um endpoint foi CHAMADO (conta inclusive requisições cuja resposta foi perdida). */
    contarRequisicoes(endpoint) {
      return requisicoes.filter((r) => r.endpoint === endpoint).length;
    },

    sessoesAtivas() {
      return [...sessoes.keys()];
    },

    async stop() {
      sessoes.clear();
      // Encerra conexões pendentes primeiro: os modos de falha (timeout) deixam
      // requisições sem resposta e server.close() sozinho nunca resolveria.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  };

  return sim;
}

module.exports = { createCatracaSimulator, QUIRKS_PADRAO, PRESETS_FAIXA, gerarAccessLogs };
