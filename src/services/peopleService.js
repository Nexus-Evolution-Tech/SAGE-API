const {
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  buscarAluno,
  buscarProfessor,
  buscarAdministrador,
  buscarProfAdm,
  buscarTerceirizado,
} = require('../utils/people-db-utils');
const { hashSenha } = require('../utils/criptografia');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');

async function criarPessoaCompleta(dados) {
  const { nome, foto, rg, cpf, telefone, email, data_nascimento, genero, tipo, ...camposExtras } = dados;
  const pessoa = await criarPessoaBase({
    nome,
    foto,
    rg,
    cpf,
    telefone,
    email,
    unidade_id: camposExtras.unidade_id || null,
    qr_code: camposExtras.qr_code || null,
    cartao_rfid: camposExtras.cartao_rfid || null,
    senha_acesso: camposExtras.senha_acesso ? await hashSenha(camposExtras.senha_acesso) : null,
    data_nascimento,
    genero,
    tipo
  });

  const idPessoa = pessoa.id;

  switch (tipo) {
    case 'ALUNO':
      await criarAluno(idPessoa, camposExtras);
      break;
    case 'PROFESSOR':
      await criarProfessor(idPessoa, camposExtras);
      break;
    case 'ADMINISTRADOR':
      await criarAdministrador(idPessoa, camposExtras);
      break;
    case 'TERCEIRIZADO':
      await criarTerceirizado(idPessoa, camposExtras);
      break;
    case 'PROFADM':
      await criarProfAdm(idPessoa, camposExtras);
      break;
    default:
      throw new Error('Tipo de pessoa inválido');
  }

  return { idPessoa, tipoCriado: tipo };
}

async function verificarPessoaPresenteEAtrasada(id) {
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  const diasSemanaEnum = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
  const hoje = new Date();
  const diaSemana = diasSemanaEnum[hoje.getDay()];
  const toleranciaMinutos = 15;

  const pessoa = await global.db('Pessoa')
    .where('id', id)
    .select('id', 'nome', 'tipo')
    .first();

  if (!pessoa) {
    throw new Error(`Pessoa com id ${id} não encontrada`);
  }

  let entradaPrevista = null;
  let atrasado = false;
  let entrada = null;
  let aulasPerdidas = 0;

  const acesso = await global.db('Acesso')
    .where('pessoa_id', id)
    .andWhere('status', 'ENTRADA')
    .andWhere('data_hora', '>=', inicioDia)
    .andWhere('data_hora', '<=', fimDia)
    .orderBy('data_hora', 'asc')
    .first();

  if (acesso) {
    entrada = acesso.data_hora;
  }

  let primeiraAula = null;

  if (pessoa.tipo === 'ALUNO') {
    const aluno = await global.db('Aluno').where('id', pessoa.id).first(['turma_id', 'divisao']);
    if (aluno) {
      const condicoesDivisao = aluno.divisao === 'DIV A' ? ['DIV A', 'DIV A/B'] : ['DIV B', 'DIV A/B'];

      const aulasHoje = await global.db('Aula')
        .where('turma_id', aluno.turma_id)
        .andWhere('dia_semana', diaSemana)
        .whereIn('divisao', condicoesDivisao)
        .orderBy('inicio', 'asc')
        .select('inicio');

      const totalAulas = aulasHoje.length;
      primeiraAula = aulasHoje[0]?.inicio || null;

      if (primeiraAula) {
        const [hora, minuto] = primeiraAula.split(':').map(Number);
        entradaPrevista = new Date();
        entradaPrevista.setHours(hora, minuto, 0, 0);
      }

      if (entrada === null) {
        aulasPerdidas = totalAulas;
      } else {
        const entradaDate = new Date(entrada);
        const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();

        aulasPerdidas = aulasHoje.filter(aula => {
          const [hora, minuto] = aula.inicio.split(':').map(Number);
          const minutosAula = hora * 60 + minuto;
          return minutosAula < minutosEntrada;
        }).length;
      }
    }

  } else if (pessoa.tipo === 'PROFESSOR' || pessoa.tipo === 'PROFADM') {
    const aulasHoje = await global.db('Aula')
      .where({ professor_id: pessoa.id, dia_semana: diaSemana })
      .orderBy('inicio', 'asc')
      .select('inicio');

    const totalAulas = aulasHoje.length;
    primeiraAula = aulasHoje[0]?.inicio || null;

    if (primeiraAula) {
      const [hora, minuto] = primeiraAula.split(':').map(Number);
      entradaPrevista = new Date();
      entradaPrevista.setHours(hora, minuto, 0, 0);
    }

    if (entrada === null) {
      aulasPerdidas = totalAulas;
    } else {
      const entradaDate = new Date(entrada);
      const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();

      aulasPerdidas = aulasHoje.filter(aula => {
        const [hora, minuto] = aula.inicio.split(':').map(Number);
        const minutosAula = hora * 60 + minuto;
        return minutosAula < minutosEntrada;
      }).length;
    }

  } else {
    const funcionario = await global.db(pessoa.tipo)
      .where('id', pessoa.id)
      .first('entrada');

    if (funcionario && funcionario.entrada) {
      const [hora, minuto] = funcionario.entrada.split(':').map(Number);
      entradaPrevista = new Date();
      entradaPrevista.setHours(hora, minuto, 0, 0);
    }
  }

  if (entrada && entradaPrevista) {
    const entradaDate = new Date(entrada);
    const horarioTolerancia = new Date(entradaPrevista.getTime() + toleranciaMinutos * 60 * 1000);
    atrasado = entradaDate > horarioTolerancia;
  }

  return {
    id: pessoa.id,
    nome: pessoa.nome,
    tipo: pessoa.tipo,
    status: entrada ? "PRESENTE" : "AUSENTE",
    hoje: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    dia_semana: diaSemana,
    aulas_perdidas: aulasPerdidas,
    horario_entrada_prevista: entradaPrevista ? entradaPrevista.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
    horario_entrada_real: entrada ? new Date(entrada).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
    atrasado: entrada ? atrasado : null
  };
}

async function verificarTodasPessoasPresentesEAtrasadas() {
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  const diasSemanaEnum = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
  const hoje = new Date();
  const diaSemana = diasSemanaEnum[hoje.getDay()];
  const toleranciaMinutos = 15;

  const pessoas = await global.db('Pessoa').select('id', 'nome', 'tipo');
  const resultados = [];

  for (const pessoa of pessoas) {
    let entrada = null;
    let entradaPrevista = null;
    let atrasado = false;
    let aulasPerdidas = 0;

    // Busca o primeiro acesso do dia para a pessoa
    const acesso = await global.db('Acesso')
      .where('pessoa_id', pessoa.id)
      .andWhere('status', 'ENTRADA')
      .andWhere('data_hora', '>=', inicioDia)
      .andWhere('data_hora', '<=', fimDia)
      .orderBy('data_hora', 'asc')
      .first();

    if (acesso) {
      entrada = acesso.data_hora;
    }

    if (pessoa.tipo === 'ALUNO') {
      const aluno = await global.db('Aluno').where('id', pessoa.id).first(['turma_id', 'divisao']);
      if (aluno) {
        const condicoesDivisao = aluno.divisao === 'DIV A' ? ['DIV A', 'DIV A/B'] : ['DIV B', 'DIV A/B'];

        const aulasHoje = await global.db('Aula')
          .where('turma_id', aluno.turma_id)
          .andWhere('dia_semana', diaSemana)
          .whereIn('divisao', condicoesDivisao)
          .orderBy('inicio', 'asc')
          .select('inicio');

        const totalAulas = aulasHoje.length;
        const primeiraAula = aulasHoje[0] ? aulasHoje[0].inicio : null;

        if (primeiraAula) {
          const [hora, minuto] = primeiraAula.split(':').map(Number);
          entradaPrevista = new Date();
          entradaPrevista.setHours(hora, minuto, 0, 0);
        }

        if (entrada === null) {
          aulasPerdidas = totalAulas; // sem entrada, todas as aulas são perdidas
        } else {
          const entradaDate = new Date(entrada);
          const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();

          aulasPerdidas = aulasHoje.filter(aula => {
            const [hora, minuto] = aula.inicio.split(':').map(Number);
            const minutosAula = hora * 60 + minuto;
            return minutosAula < minutosEntrada; // aula já começou antes da entrada
          }).length;
        }
      }

    } else if (pessoa.tipo === 'PROFESSOR' || pessoa.tipo === 'PROFADM') {
      const aulasHoje = await global.db('Aula')
        .where({ professor_id: pessoa.id, dia_semana: diaSemana })
        .orderBy('inicio', 'asc')
        .select('inicio');

      const totalAulas = aulasHoje.length;
      const primeiraAula = aulasHoje[0] ? aulasHoje[0].inicio : null;

      if (primeiraAula) {
        const [hora, minuto] = primeiraAula.split(':').map(Number);
        entradaPrevista = new Date();
        entradaPrevista.setHours(hora, minuto, 0, 0);
      }

      if (entrada === null) {
        aulasPerdidas = totalAulas; // sem entrada, todas as aulas são perdidas
      } else {
        const entradaDate = new Date(entrada);
        const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();

        aulasPerdidas = aulasHoje.filter(aula => {
          const [hora, minuto] = aula.inicio.split(':').map(Number);
          const minutosAula = hora * 60 + minuto;
          return minutosAula < minutosEntrada; // aula já começou antes da entrada
        }).length;
      }

    } else {
      // Para outros tipos, buscar a entrada prevista na tabela respectiva
      const funcionario = await global.db(pessoa.tipo)
        .where('id', pessoa.id)
        .first('entrada');

      if (funcionario && funcionario.entrada) {
        const [hora, minuto] = funcionario.entrada.split(':').map(Number);
        entradaPrevista = new Date();
        entradaPrevista.setHours(hora, minuto, 0, 0);
      }
    }

    // Calcula atraso somente se a pessoa entrou e tem horário previsto
    if (entrada && entradaPrevista) {
      const entradaDate = new Date(entrada);
      const horarioTolerancia = new Date(entradaPrevista.getTime() + toleranciaMinutos * 60 * 1000);
      atrasado = entradaDate > horarioTolerancia;
    }

    resultados.push({
      id: pessoa.id,
      nome: pessoa.nome,
      tipo: pessoa.tipo,
      status: entrada ? "PRESENTE" : "AUSENTE",
      hoje: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      dia_semana: diaSemana,
      aulas_perdidas: aulasPerdidas || 0,
      horario_entrada_prevista: entradaPrevista ? entradaPrevista.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
      horario_entrada_real: entrada ? new Date(entrada).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
      atrasado: entrada ? atrasado : null
    });
  }

  return resultados;
}

async function calcularAulasPerdidasPorProfessor(id) {
  // 1. Buscar todos os registros de aula do professor (para cada dia da semana)
  const aulas = await global.db('Aula')
    .where('professor_id', id)
    .select('dia_semana', 'inicio');

  // 2. Buscar todos os acessos (entrada) do professor
  const acessos = await global.db('Acesso')
    .where('pessoa_id', id)
    .andWhere('status', 'ENTRADA')
    .select('data_hora');

  // Agrupar acessos por data (ano-mês-dia)
  const entradasPorData = {};
  acessos.forEach(a => {
    const data = new Date(a.data_hora).toISOString().slice(0, 10);
    if (!entradasPorData[data]) entradasPorData[data] = [];
    entradasPorData[data].push(new Date(a.data_hora));
  });
  Object.values(entradasPorData).forEach(list => list.sort((a, b) => a - b));

  let totalPerdidas = 0;

  // 3. Inferir datas dos últimos 30 dias (ou um período fixo/dinâmico)
  const diasParaCalcular = 30;
  for (let offset = 0; offset < diasParaCalcular; offset++) {
    const dia = new Date();
    dia.setDate(dia.getDate() - offset);
    const diaSemana = ['DOMINGO','SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO'][dia.getDay()];
    const dataStr = dia.toISOString().slice(0, 10);
    const entradasHoje = entradasPorData[dataStr] || [];

    // aulas do dia da semana
    const aulasDoDia = aulas.filter(a => a.dia_semana === diaSemana);
    if (aulasDoDia.length === 0) continue;

    // no acesso: todas perdidas
    if (entradasHoje.length === 0) {
      totalPerdidas += aulasDoDia.length;
    } else {
      const minutosEntrada = entradasHoje[0].getHours() * 60 + entradasHoje[0].getMinutes();
      aulasDoDia.forEach(a => {
        const [hora, min] = a.inicio.split(':').map(Number);
        const minutosAula = hora * 60 + min;
        if (minutosAula < minutosEntrada) totalPerdidas++;
      });
    }
  }

  return { professor_id: id, aulas_perdidas_ultimos_30_dias: totalPerdidas };
}

async function buscarPessoasPorTipo(tipo) {
  const [pessoas] = await db.query('SELECT * FROM Pessoa WHERE tipo = ?', [tipo]);
  
  const resultado = [];

  for (const pessoa of pessoas) {
    let dadosEspecificos = {};

    switch (pessoa.tipo) {
      case 'ALUNO':
        dadosEspecificos = await buscarAluno(pessoa.id);
        break;
      case 'PROFESSOR':
        dadosEspecificos = await buscarProfessor(pessoa.id);
        break;
      case 'ADMINISTRADOR':
        dadosEspecificos = await buscarAdministrador(pessoa.id);
        break;
      case 'PROFADM':
        dadosEspecificos = await buscarProfAdm(pessoa.id);
        break;
      case 'TERCEIRIZADO':
        dadosEspecificos = await buscarTerceirizado(pessoa.id);
        break;
      default:
        // Tipo inválido ou desconhecido, pode logar ou apenas ignorar os extras
        break;
    }

    resultado.push({
      ...pessoa,
      ...dadosEspecificos
    });
  }
  return resultado;
}

async function uploadFotoPessoa(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo de foto não enviado' });
  }

  const pessoa_id = req.params.id;
  
  if (!pessoa_id) {
    return res.status(400).json({ message: 'ID da pessoa é obrigatório' });
  }

  // Caminho /pessoas
  const baseUploads = path.resolve(__dirname, '..', 'uploads');
  const pastaDestino = path.join(baseUploads, 'pessoas');

  if (!fs.existsSync(pastaDestino)) {
    fs.mkdirSync(pastaDestino, { recursive: true });
  }

  try {
    // Verificar se a pessoa existe
    const [rows] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [pessoa_id]);
    console.log('Pessoa encontrada:', rows[0]);

    if (rows.length === 0) {
      const arquivoTemp = path.resolve(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
      return res.status(404).json({ message: 'Pessoa não encontrada' });
    }

    // Verificar se pessoa já tem foto e remover foto antiga
    const [fotoAtual] = await db.query('SELECT foto FROM Pessoa WHERE id = ?', [pessoa_id]);
    
    if (fotoAtual.length > 0 && fotoAtual[0].foto) {
      const fotoAntigaCaminho = path.join(baseUploads, fotoAtual[0].foto);
      if (fs.existsSync(fotoAntigaCaminho)) {
        fs.unlinkSync(fotoAntigaCaminho);
      }
    }

    // Gerar nome único para a foto
    const novoNome = `pessoa_${pessoa_id}.jpg`;
    const antigoCaminho = path.resolve(__dirname, '..', 'uploads', req.file.filename);
    const novoCaminho = path.join(pastaDestino, novoNome);

    // Mover arquivo para pasta correta
    fs.renameSync(antigoCaminho, novoCaminho);

    // Atualizar caminho da foto na tabela Pessoa
    const caminhoRelativo = path.join(novoNome).replace(/\\/g, '/');
    await db.query('UPDATE Pessoa SET foto = ? WHERE id = ?', [caminhoRelativo, pessoa_id]);

    res.status(200).json({ 
      message: 'Foto atualizada com sucesso',
      pessoa_id: pessoa_id,
      foto: caminhoRelativo 
    });

  } catch (error) {
    console.error('Erro ao fazer upload da foto:', error);
    
    // Tentar remover arquivo temporário em caso de erro
    try {
      const arquivoTemp = path.resolve(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
    } catch (cleanupError) {
      console.error('Erro ao limpar arquivo temporário:', cleanupError);
    }
    
    res.status(500).json({ message: 'Erro ao salvar a foto da pessoa' });
  }
}

async function removerFotoPessoa(req, res) {
  const { pessoa_id } = req.params;

  try {
    // Buscar foto atual da pessoa
    const [pessoa] = await db.query('SELECT foto FROM Pessoa WHERE id = ?', [pessoa_id]);
    
    if (pessoa.length === 0) {
      return res.status(404).json({ message: 'Pessoa não encontrada' });
    }

    if (!pessoa[0].foto) {
      return res.status(400).json({ message: 'Pessoa não possui foto para remover' });
    }

    // Remover arquivo físico
    const baseUploads = path.resolve(__dirname, '..', 'uploads');
    const caminhoFoto = path.join(baseUploads, pessoa[0].foto);
    
    if (fs.existsSync(caminhoFoto)) {
      fs.unlinkSync(caminhoFoto);
    }

    // Atualizar banco removendo referência da foto
    await db.query('UPDATE Pessoa SET foto = NULL WHERE id = ?', [pessoa_id]);

    res.status(200).json({ 
      message: 'Foto removida com sucesso',
      pessoa_id: pessoa_id 
    });

  } catch (error) {
    console.error('Erro ao remover foto:', error);
    res.status(500).json({ message: 'Erro ao remover a foto da pessoa' });
  }
}

module.exports = {
  criarPessoaCompleta,
  verificarPessoaPresenteEAtrasada,
  verificarTodasPessoasPresentesEAtrasadas,
  buscarPessoasPorTipo,
  uploadFotoPessoa,
  removerFotoPessoa,
  calcularAulasPerdidasPorProfessor
};
