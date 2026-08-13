const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    // globals: true permite manter os testes em CommonJS (require), padrão do projeto.
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    // Os testes do simulador sobem servidores HTTP em porta efêmera; nada de banco ainda.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Sem paralelismo entre arquivos: evita contenção de porta/CPU em máquina modesta.
    fileParallelism: false,
    reporters: ['default']
  }
});
