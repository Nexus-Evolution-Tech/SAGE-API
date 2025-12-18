/*
 End-to-end test for Aulas and Horarios API
 Steps:
 1) Create Aula A (turma1, professor P)
 2) Update Aula A
 3) Create Aula B (turma2, same professor P)
 4) Create schedule for Aula A at SEGUNDA 07:30 (interval format)
 5) Try create schedule for Aula B at same slot -> expect 409 with conflict details
 6) Delete Aula A and Aula B (cascade deletes schedules)
*/

require('dotenv').config();
const axios = require('axios');
const { gerarToken } = require('../src/utils/jwt');

async function run() {
  const baseURL = process.env.BASE_URL || 'http://localhost:3000';
  const token = gerarToken({ id: 1, role: 'ADMIN', name: 'E2E-Tester' });
  const api = axios.create({ baseURL, headers: { Authorization: `Bearer ${token}` } });

  const print = (...args) => console.log('[E2E]', ...args);

  let turma1, turma2, professorId, materiaId;
  let aulaA, aulaB;

  try {
    print('Fetching base data (professor, materia, turmas)...');
    const [profRes, matRes, turmasRes] = await Promise.all([
      api.get('/pessoas/tipo/PROFESSOR'),
      api.get('/materias'),
      api.get('/turmas')
    ]);

    const professores = profRes.data?.data || profRes.data || [];
    const materias = matRes.data?.data || matRes.data || [];
    const turmas = turmasRes.data?.data || turmasRes.data || [];
    if (!professores.length) throw new Error('Nenhum professor encontrado');
    if (!materias.length) throw new Error('Nenhuma matéria encontrada');
    if (turmas.length < 2) throw new Error('Menos de duas turmas disponíveis');

    professorId = professores[0].id;
    materiaId = materias[0].id;
    turma1 = turmas[0].id;
    turma2 = turmas.find(t => t.id !== turma1)?.id;
    if (!professorId || !turma1 || !turma2) throw new Error('IDs base inválidos');

    print('Using professorId=', professorId, 'materiaId=', materiaId, 'turma1=', turma1, 'turma2=', turma2);

    // 1) Create Aula A
    print('1) Creating Aula A');
    const aulaARes = await api.post('/aulas', {
      nome: 'E2E Aula A',
      professorId: professorId,
      materiaId: materiaId,
      salaPadraoId: null,
      divisao: 'INT',
      observacao: 'catalog aula'
    });
    aulaA = aulaARes.data; // lessonController retorna a aula criada direta
    if (!aulaA?.id) throw new Error('Falha ao criar Aula A');
    print('Aula A id=', aulaA.id);

    // 2) Update Aula A
    print('2) Updating Aula A (nome)');
    await api.put(`/aulas/${aulaA.id}`, { nome: 'E2E Aula A (Atualizada)' });
    print('Aula A updated');

    // 3) Create Aula B (same professor, other turma)
    print('3) Creating Aula B');
    const aulaBRes = await api.post('/aulas', {
      nome: 'E2E Aula B',
      professorId: professorId,
      materiaId: materiaId,
      salaPadraoId: null,
      divisao: 'INT',
      observacao: 'catalog aula'
    });
    aulaB = aulaBRes.data;
    if (!aulaB?.id) throw new Error('Falha ao criar Aula B');
    print('Aula B id=', aulaB.id);

    // 4) Create schedule for Aula A
    print('4) Creating Horario (Aula A, turma1) on free slot (SEGUNDA)');
    const slots = ['13:00-13:50','14:00-14:50','15:00-15:50','16:00-16:50','17:00-17:50','18:00-18:50'];
    let chosenSlot = null;
    for (const slot of slots) {
      try {
        const hARes = await api.post('/horarios-aulas', {
          turmaId: turma1,
          aulaId: aulaA.id,
          diaSemana: 'SEGUNDA',
          horario: slot
        });
        chosenSlot = slot;
        print('Horario A created at', slot, '->', JSON.stringify(hARes.data));
        break;
      } catch (err) {
        if (err.response && err.response.status === 409) {
          print('Slot', slot, 'unavailable, trying next...');
          continue;
        }
        throw err;
      }
    }
    if (!chosenSlot) throw new Error('Não encontrou nenhum slot livre para turma1');

    // 5) Try to create conflicting schedule for Aula B in turma2 same slot
    print(`5) Creating Horario (Aula B, turma2) on same slot ${chosenSlot} (expect conflict)`);
    try {
      await api.post('/horarios-aulas', {
        turmaId: turma2,
        aulaId: aulaB.id,
        diaSemana: 'SEGUNDA',
        horario: chosenSlot
      });
      throw new Error('Esperava conflito 409, mas requisição foi 200');
    } catch (err) {
      if (err.response && err.response.status === 409) {
        print('✅ Conflito detectado conforme esperado. Payload:');
        console.log(JSON.stringify(err.response.data, null, 2));
      } else {
        throw err;
      }
    }

    print('✓ E2E completed successfully');
  } catch (err) {
    console.error('[E2E] ERROR:', err.message);
    if (err.response) {
      console.error('[E2E] Response:', err.response.status, err.response.data);
    }
    process.exitCode = 1;
  } finally {
    // 6) Cleanup: delete aulas (cascade deletes schedules)
    try {
      if (aulaA?.id) await api.delete(`/aulas/${aulaA.id}`);
      if (aulaB?.id) await api.delete(`/aulas/${aulaB.id}`);
      print('Cleanup done');
    } catch (e) {
      print('Cleanup error:', e.message);
    }
  }
}

run();
