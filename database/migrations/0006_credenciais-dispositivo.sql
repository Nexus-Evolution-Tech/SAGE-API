ALTER TABLE Dispositivo
  MODIFY COLUMN usuario VARCHAR(512) NULL COMMENT 'Credencial criptografada em formato autenticado',
  MODIFY COLUMN senha VARCHAR(512) NULL COMMENT 'Credencial criptografada em formato autenticado';
