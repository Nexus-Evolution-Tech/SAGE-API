function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);

  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();

  // Ajusta se ainda não fez aniversário este ano
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }

  return idade;
}

async function criarAcesso(dados) {
  let { pessoa_id, dispositivo_id, status, permitido, metodo_auth } = dados;

  if (status == 'ENTRADA') permitido = true;
  else {
    const pessoa = await global.db('Pessoa').where('id', pessoa_id).first();
    const idadePessoa = calcularIdade(pessoa.data_nascimento);
    if (pessoa.tipo == 'ALUNO') {
        if (idadePessoa >= 18) permitido = true;
        else {
            let permissaoResponsavel = false; // Aqui você deve implementar a lógica para verificar se o responsável deu permissão
            if (permissaoResponsavel) permitido = true; // Se houver permissão do responsável, a saída é permitida
            else permitido = false; // Se não houver permissão, a saída é negada
        }
    } else permitido = true; // Para outros tipos de pessoa, assume-se que a saída é sempre permitida
  }

  // Cria o registro de acesso
  const acesso = await global.db('Acesso').insert({
    pessoa_id,
    dispositivo_id,
    status,
    permitido,
    metodo_auth,
    data_hora: new Date()
  }).returning('*');

  return { message: "Acesso efetuado com sucesso", acesso: acesso[0] };
}

module.exports = {
  criarAcesso
};