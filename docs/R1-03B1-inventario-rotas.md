# Inventário R1-03B1

As 14 montagens de `genericRoutesFactory.js` existentes no snapshot são:

1. `areaRoutes.js` — `/areas`
2. `classRoutes.js` — `/turmas`
3. `companyRoutes.js` — `/empresas`
4. `courseRoutes.js` — `/cursos`
5. `deviceRoutes.js` — `/dispositivos`
6. `peopleRoutes.js` — `/pessoas`
7. `presenceRoutes.js` — `/presencas`
8. `roomRoutes.js` — `/sala`
9. `salaRoutes.js` — `/salas`
10. `schoolPhotoRoutes.js` — `/foto_escolas`
11. `schoolRoutes.js` — `/escolas`
12. `subjectRoutes.js` — `/materias`
13. `accessRoutes.js` — `/acessos`
14. `acessSolicitationRoutes.js` — `/solicitacoes-acessos`

O pacote cobre somente os handlers CRUD gerados pelo factory. Listar/obter não
geram evento. Overrides explícitos (por exemplo, criação/edição/remoção de
`Pessoa`, criação de `Acesso`, aprovação/negação e uploads) permanecem fora de
R1-03B1 e não foram alterados.
