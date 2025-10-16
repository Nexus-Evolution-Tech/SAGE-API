async function verificarEAtribuirAtraso(pessoa_id, dataHoraAcesso) {
  const pessoa = await global.db('Pessoa').where({ id: pessoa_id }).first();
  if (!pessoa) return;

  const tipoPessoa = pessoa.tipo;
  const dataAcesso = dataHoraAcesso.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  const diaSemanaMap = {
    0: 'DOMINGO',
    1: 'SEGUNDA',
    2: 'TERÇA',
    3: 'QUARTA',
    4: 'QUINTA',
    5: 'SEXTA',
    6: 'SABADO'
  };
  const diaSemana = diaSemanaMap[dataHoraAcesso.getDay()];

  let horarioPrevisto = null;

  if (tipoPessoa === 'PROFESSOR') {
    const primeiraAula = await global.db('Aula')
      .where({ professor_id: pessoa_id, dia_semana: diaSemana })
      .orderBy('inicio', 'asc')
      .first();

    if (primeiraAula) {
      horarioPrevisto = primeiraAula.inicio;
    }

  } else if (tipoPessoa === 'ALUNO') {
    if (!pessoa.turma_id) return;

    const primeiraAula = await global.db('Aula')
      .where({ turma_id: pessoa.turma_id, dia_semana: diaSemana })
      .orderBy('inicio', 'asc')
      .first();

    if (primeiraAula) {
      horarioPrevisto = primeiraAula.inicio;
    }

  } else {
    const horario = await global.db('Horario')
      .where({ pessoa_id })
      .andWhere('dia_semana', diaSemana)
      .first();

    if (horario) {
      horarioPrevisto = horario.entrada;
    }
  }

  if (!horarioPrevisto) return;

  const horarioChegada = dataHoraAcesso.toTimeString().split(' ')[0]; // 'HH:MM:SS'

  if (horarioChegada > horarioPrevisto) {
    const atrasoExistente = await global.db('Atraso')
      .where({ pessoa_id, data: dataAcesso })
      .first();

    if (!atrasoExistente) {
      await global.db('Atraso').insert({
        pessoa_id,
        data: dataAcesso,
        horario_previsto: horarioPrevisto,
        horario_chegada: horarioChegada
      });
    }
  }
}




module.exports = verificarEAtribuirAtraso;