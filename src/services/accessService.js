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

  const pessoa = await global.db('Pessoa').where('id', pessoa_id).first();
  const idadePessoa = calcularIdade(pessoa.data_nascimento);

  switch(status) {
    case 'ENTRADA':
      if (pessoa.tipo !== 'ALUNO') {
        permitido = true; // Entrada permitida para não-alunos
        return { message: "Acesso autorizado: Entrada permitida para não-alunos" };
      } else {
        const aluno = await global.db('Aluno').where('id', pessoa_id).first();
        switch (aluno.status) {
          case 'SUSPENSO':
            permitido = false; // Se o aluno foi suspenso, a saída é negada
            return { message: "Acesso negado: Aluno suspenso" };
          case 'TRANSFERIDO':
            permitido = false; // Se o aluno foi transferido, a saída é negada
            return { message: "Acesso negado: Aluno transferido" };
          case 'DESLIGADO':
            permitido = false; // Se o aluno foi desligado, a saída é negada
            return { message: "Acesso negado: Aluno desligado" };
          default:
            permitido = true; // Se o aluno está ativo, a entrada é permitida
            return { message: "Acesso autorizado: Entrada permitida para aluno ativo" };
        }
      }
    case 'SAIDA':
      if (pessoa.tipo !== 'ALUNO') {
        permitido = true; // Saída permitida para todos os tipos de pessoa, exceto aluno
        return { message: "Acesso autorizado: Saída permitida para não-alunos" };
      } else {
        if (idadePessoa >= 18) {
          permitido = true; // Saída permitida para aluno maior de idade
          return { message: "Acesso autorizado: Saída permitida para aluno maior de idade", idade_aluno: `Aluno com ${idadePessoa} anos - MAIOR DE IDADE` };
        } else {
          let permissaoResponsavel = false; // Aqui você deve implementar a lógica para verificar se o responsável deu permissão
          if (permissaoResponsavel){
            permitido = true; // Se houver permissão do responsável, a saída é permitida
            return { message: "Acesso autorizado: Saída permitida com permissão do responsável", idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE` };
          } else {
            console.log("Permissão do responsável não encontrada, negando acesso...");
            permitido = false; // Se não houver permissão, a saída é negada
            return { message: "Acesso negado: Saída sem permissão do responsável", idade_aluno: `Aluno com ${idadePessoa} - MENOR DE IDADE` };
          }
        }
      }
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