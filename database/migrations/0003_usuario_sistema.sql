CREATE TABLE IF NOT EXISTS Usuario (
  id INT AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(100) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  nome_exibicao VARCHAR(100) NOT NULL,
  papel ENUM('ADMINISTRADOR', 'SECRETARIA') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  pessoa_id INT NULL,
  precisa_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE,
  falhas_login INT NOT NULL DEFAULT 0,
  bloqueado_ate DATETIME NULL,
  ultimo_acesso DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuario_pessoa FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO Usuario
  (login, senha_hash, nome_exibicao, papel, ativo, precisa_trocar_senha)
SELECT u.login, u.senha, LEFT(COALESCE(NULLIF(u.nome, ''), u.login), 100),
       'ADMINISTRADOR', TRUE, TRUE
 FROM UnidadeEscolar u
 WHERE u.login IS NOT NULL
   AND u.senha IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM Usuario novo
      WHERE novo.login COLLATE utf8mb4_unicode_ci = u.login COLLATE utf8mb4_unicode_ci
   );
