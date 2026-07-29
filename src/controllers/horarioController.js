const horarioController = {
  descontinuado(req, res) {
    return res
      .set('Deprecation', 'true')
      .status(410)
      .json({
        message: 'O contrato /horarios foi descontinuado',
        replacement: '/horarios-aulas'
      });
  }
};

module.exports = horarioController;
