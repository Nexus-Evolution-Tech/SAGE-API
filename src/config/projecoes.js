const declaracoes = {
  UnidadeEscolar: {
    leitura: [
      'id', 'nome', 'numero_unidade', 'cnpj', 'login', 'logradouro', 'numero',
      'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato',
      'email', 'logo', 'created_at', 'updated_at'
    ],
    escrita: [
      'nome', 'numero_unidade', 'cnpj', 'login', 'senha', 'logradouro', 'numero',
      'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato',
      'email', 'logo'
    ],
    segredo: [
      'senha', 'recuperacao_chave_hash', 'recuperacao_falhas',
      'recuperacao_bloqueada_ate', 'recuperacao_gerada_em'
    ]
  },
  Dispositivo: {
    leitura: [
      'id', 'nome', 'modelo', 'endereco', 'porta', 'status', 'sync_enabled',
      'last_health_check', 'area_id', 'numero_serial', 'created_at', 'updated_at'
    ],
    escrita: [
      'nome', 'modelo', 'endereco', 'porta', 'usuario', 'senha', 'status',
      'sync_enabled', 'last_health_check', 'area_id', 'numero_serial'
    ],
    segredo: ['usuario', 'senha']
  }
};

function erroDeProjecao(mensagem) {
  const erro = new Error(`PROJECAO_INVALIDA: ${mensagem}`);
  erro.code = 'PROJECAO_INVALIDA';
  return erro;
}

function validarDeclaracoes(projecoes = declaracoes) {
  for (const [tabela, declaracao] of Object.entries(projecoes)) {
    for (const conjunto of ['leitura', 'escrita', 'segredo']) {
      if (!declaracao || !Array.isArray(declaracao[conjunto])) {
        throw erroDeProjecao(`${tabela}.${conjunto} deve ser uma lista`);
      }
      if (new Set(declaracao[conjunto]).size !== declaracao[conjunto].length) {
        throw erroDeProjecao(`${tabela}.${conjunto} possui coluna duplicada`);
      }
    }

    const segredo = new Set(declaracao.segredo);
    const conflito = declaracao.leitura.find((coluna) => segredo.has(coluna));
    if (conflito) throw erroDeProjecao(`${tabela}.${conflito} esta em leitura e segredo`);
  }
  return true;
}

function obterDeclaracao(tabela) {
  const declaracao = declaracoes[tabela];
  if (!declaracao) throw erroDeProjecao(`tabela sem declaracao: ${tabela}`);
  return declaracao;
}

function exigirProjecao(tabela) {
  return obterDeclaracao(tabela);
}

function colunasDeLeitura(tabela) {
  return [...obterDeclaracao(tabela).leitura];
}

function projetarRegistro(tabela, registro, declaracao = obterDeclaracao(tabela)) {
  if (registro === null || registro === undefined) return registro;
  if (Array.isArray(registro)) return registro.map((linha) => projetarRegistro(tabela, linha, declaracao));
  if (typeof registro !== 'object') return registro;

  validarDeclaracoes({ [tabela]: declaracao });
  return Object.fromEntries(declaracao.leitura
    .filter((coluna) => Object.prototype.hasOwnProperty.call(registro, coluna))
    .map((coluna) => [coluna, registro[coluna]]));
}

validarDeclaracoes();

const modulo = { ...declaracoes };
Object.defineProperties(modulo, {
  validarDeclaracoes: { value: validarDeclaracoes },
  obterDeclaracao: { value: obterDeclaracao },
  exigirProjecao: { value: exigirProjecao },
  colunasDeLeitura: { value: colunasDeLeitura },
  projetarRegistro: { value: projetarRegistro }
});

module.exports = modulo;
