/**
 * Armazenamento em memória dos objetos da catraca (users, cards, user_groups,
 * user_images, access_logs, ...) + implementação de `where`, `limit`, `offset` e `order`
 * no formato que a API Control iD aceita.
 */

const OPERADORES = {
  '>': (a, b) => Number(a) > Number(b),
  '>=': (a, b) => Number(a) >= Number(b),
  '<': (a, b) => Number(a) < Number(b),
  '<=': (a, b) => Number(a) <= Number(b),
  '=': (a, b) => String(a) === String(b),
  '==': (a, b) => String(a) === String(b),
  eq: (a, b) => String(a) === String(b),
  '!=': (a, b) => String(a) !== String(b),
  like: (a, b) => new RegExp('^' + String(b).replace(/_/g, '.').replace(/%/g, '.*') + '$').test(String(a)),
  regex: (a, b) => new RegExp(String(b)).test(String(a))
};

/** Compara um item com o filtro de um objeto: { campo: valor } ou { campo: { '>': 10 } }. */
function itemCorresponde(item, filtroCampos) {
  if (!filtroCampos || typeof filtroCampos !== 'object') return true;
  return Object.entries(filtroCampos).every(([campo, condicao]) => {
    const valor = item[campo];
    if (condicao !== null && typeof condicao === 'object' && !Array.isArray(condicao)) {
      return Object.entries(condicao).every(([op, alvo]) => {
        const fn = OPERADORES[op];
        if (!fn) return false;
        return fn(valor, alvo);
      });
    }
    return String(valor) === String(condicao);
  });
}

/**
 * Normaliza o `where` da API para { campo: condicao }.
 * Aceita os dois formatos que a produção envia (ver deviceService.zerarAccessLogsCatraca):
 *  - objeto:  { access_logs: { id: { '>=': 0 } } }
 *  - array:   [ { object: 'access_logs', field: 'id', operator: '>=', value: 0 } ]  (firmware antigo)
 */
function normalizarWhere(where, objectName) {
  if (where == null) return null;
  if (Array.isArray(where)) {
    const campos = {};
    for (const cond of where) {
      if (!cond || (cond.object && cond.object !== objectName)) continue;
      campos[cond.field] = { [cond.operator || '=']: cond.value };
    }
    return Object.keys(campos).length > 0 ? campos : null;
  }
  if (typeof where === 'object') {
    // Formato { objectName: { ... } }; alguns clientes mandam os campos direto.
    if (where[objectName] && typeof where[objectName] === 'object') return where[objectName];
    return where;
  }
  return null;
}

function aplicarOrder(lista, order) {
  if (!Array.isArray(order) || order.length === 0) return lista;
  // Formato Control iD: ['descending', 'id'] / ['ascending', 'id', 'time']
  const direcao = String(order[0]).toLowerCase();
  const campos = order.slice(1);
  if (campos.length === 0) return lista;
  const sinal = direcao.startsWith('desc') ? -1 : 1;
  return [...lista].sort((a, b) => {
    for (const campo of campos) {
      const va = a[campo];
      const vb = b[campo];
      const na = Number(va);
      const nb = Number(vb);
      let cmp;
      if (!Number.isNaN(na) && !Number.isNaN(nb)) cmp = na - nb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp !== 0) return cmp * sinal;
    }
    return 0;
  });
}

class CatracaStore {
  constructor() {
    this.tabelas = {
      users: [],
      cards: [],
      user_groups: [],
      user_images: [],
      groups: [{ id: 1, name: 'Grupo Padrao' }],
      access_logs: []
    };
    this.proximoId = {};
  }

  tabela(nome) {
    if (!this.tabelas[nome]) this.tabelas[nome] = [];
    return this.tabelas[nome];
  }

  gerarId(nome) {
    if (this.proximoId[nome] == null) {
      const atual = this.tabela(nome).reduce((max, i) => Math.max(max, Number(i.id) || 0), 0);
      this.proximoId[nome] = atual + 1;
    }
    return this.proximoId[nome]++;
  }

  registrarId(nome, id) {
    const n = Number(id);
    if (!Number.isNaN(n) && (this.proximoId[nome] == null || n >= this.proximoId[nome])) {
      this.proximoId[nome] = n + 1;
    }
  }

  /** Seleciona com where/limit/offset/order. */
  selecionar(nome, { where, limit, offset, order } = {}) {
    let lista = this.tabela(nome);
    const filtro = normalizarWhere(where, nome);
    if (filtro) lista = lista.filter((item) => itemCorresponde(item, filtro));
    lista = aplicarOrder(lista, order);
    const ini = offset != null && offset >= 0 ? Number(offset) : 0;
    if (limit != null && Number(limit) > 0) return lista.slice(ini, ini + Number(limit));
    return ini > 0 ? lista.slice(ini) : lista;
  }

  inserir(nome, valores) {
    const item = { ...valores };
    if (item.id == null) item.id = this.gerarId(nome);
    else this.registrarId(nome, item.id);
    this.tabela(nome).push(item);
    return item.id;
  }

  existeId(nome, id) {
    return this.tabela(nome).some((i) => String(i.id) === String(id));
  }

  modificar(nome, where, valores) {
    const filtro = normalizarWhere(where, nome);
    let alterados = 0;
    for (const item of this.tabela(nome)) {
      if (filtro && !itemCorresponde(item, filtro)) continue;
      Object.assign(item, valores);
      alterados++;
    }
    return alterados;
  }

  destruir(nome, where) {
    const filtro = normalizarWhere(where, nome);
    const lista = this.tabela(nome);
    const manter = filtro ? lista.filter((i) => !itemCorresponde(i, filtro)) : [];
    const removidos = lista.length - manter.length;
    this.tabelas[nome] = manter;
    return removidos;
  }
}

module.exports = { CatracaStore, itemCorresponde, normalizarWhere, aplicarOrder };
