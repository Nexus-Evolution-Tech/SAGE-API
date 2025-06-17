const courseService = require('../services/courseService');

const getCursos = async (req, res) => {
  try {
    const cursos = await courseService.listarCursos();
    res.json(cursos);
  } catch (error) {
    console.error('Erro ao listar cursos:', error);
    res.status(500).json({ message: 'Erro ao listar cursos' });
  }
};

const postCurso = async (req, res) => {
  try {
    const novoCurso = await courseService.criarCursoCompleto(req.body);
    res.status(201).json({ message: 'Curso criado com sucesso', pessoa: novoCurso });
  } catch (error) {
    console.error('Erro ao criar pessoa:', error);
    res.status(500).json({ message: 'Erro ao criar curso' });
  }
};

const patchCurso = async (req, res) => {
  try {
    const id = req.params.id;
    await courseService.editarCurso(id, req.body);
    res.json({ message: 'Curso atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar curso:', error);
    res.status(500).json({ message: 'Erro ao atualizar curso' });
  }
};

const deleteCurso = async (req, res) => {
  try {
    const id = req.params.id;
    await courseService.deletarCurso(id);
    res.json({ message: 'Curso removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover curso:', error);
    res.status(500).json({ message: 'Erro ao remover curso' });
  }
};

module.exports = {
  getCursos,
  postCurso,
  patchCurso,
  deleteCurso
};
