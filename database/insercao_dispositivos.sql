INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha, numero_serial)
VALUES ("Catraca 01", "IDBlock", "192.168.0.126", "81", "admin", "admin", "0K0410/0011BC");

INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha, numero_serial)
VALUES ("Catraca 02", "IDBlock", "192.168.0.127", "82", "admin", "admin", "0K0410/00177E");

DELETE FROM Dispositivo WHERE id = 1;
SET SQL_SAFE_UPDATES = 0;
DELETE FROM Dispositivo; -- Your original DELETE statement
SET SQL_SAFE_UPDATES = 1; -- **Important:** Re-enable safe mode!

UPDATE Dispositivos
SET nome = 'Catraca 01'
WHERE id = 1;

select * from dispositivo;