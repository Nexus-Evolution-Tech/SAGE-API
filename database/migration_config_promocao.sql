-- Migration: Tabela de configuração para promoção (OPCIONAL)
-- Já incluída em sage.sql e melhorias_sistema.sql - rode apenas se precisar reparar manualmente.
-- Não selecione um schema fixo: o instalador já conecta no DB_NAME escolhido.

CREATE TABLE IF NOT EXISTS ConfigSistema (
  chave VARCHAR(100) PRIMARY KEY,
  valor VARCHAR(500),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Inicializa com 0 = "nunca executou" para que a primeira execução rode ao detectar ano novo
INSERT IGNORE INTO ConfigSistema (chave, valor) 
VALUES ('ultimo_ano_promocao', '0');
