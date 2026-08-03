# Handoff executável — validação Windows do instalador SAGE

Atualizado em 2026-08-03. Este documento é para a sessão do Codex que continuará o trabalho em
uma VM Windows 11 x64. Ele complementa o handoff arquitetural em `../docs/HANDOFF-CODEX.md`.

## Estado exato

- Repositório: `Nexus-Evolution-Tech/SAGE-API`
- Branch: `agent/f8-uninstall`
- Baseline do código do instalador: `94d28d1`
- HEAD remoto atual (inclui este handoff): `7e30435`
- Alvo: Windows 11 x64, Node 24, MySQL 8.4.11, PowerShell 5.1
- O instalador ainda é alfa interno. Não há EXE distribuível, release público, assinatura
  Authenticode ou licença de redistribuição fechada.
- Preserve o arquivo local não rastreado `src/controllers/horarioController 2.js`.
- Não toque em `src/services/accessService.js`; ele pertence ao PR #3.
- Não faça merge em `main`, não apague branches e não afrouxe testes para obter verde.

O checkout do Mac que gerou este handoff tem um packfile Git corrompido
(`pack-b46e...pack is far too short`). Na VM, prefira um clone novo ou uma cópia de trabalho
limpa; não faça rebase baseado nesse `.git` corrompido.

## O que já existe

No branch atual já estão implementados e cobertos por contratos:

- manifesto e montagem do layout Windows (`installer/windows/build-release.ps1`,
  `artifacts.json`);
- estado em `C:\ProgramData\SAGE` com ACL privada e arquivos separados para runtime/manutenção;
- bootstrap MySQL idempotente, sem senha padrão, com conta de manutenção restrita e marcador de
  contas schema v2;
- rejeição explícita do marcador pré-alpha v1, pois não há migração online segura para a conta de
  shutdown;
- `SAGEMySQL` nativo em `LocalService`, `SAGEAPI` sob WinSW, dependência API → MySQL;
- regra de firewall `SAGE-API-LAN`, TCP 3000, somente Domain/Private + `LocalSubnet`, sem MySQL
  na LAN e sem exclusão automática do Defender;
- desinstalação administrativa que valida serviços/regra, faz shutdown do MySQL com cliente
  privado, nunca força `mysqld.exe` e preserva todo `ProgramData`;
- workflow `.github/workflows/windows-native.yml` com layout, bootstrap, ACL, serviços, firewall,
  recovery da API, tentativa de recovery do MySQL, uninstall e preservação de dados.

## Resultado dos testes conhecido

O último resultado local completo registrado foi:

```text
43 arquivos de teste / 218 testes
199 passed, 19 pending/skipped, 0 failed
```

Os 19 casos dependem do MySQL local, que não estava disponível. Portanto o resultado é
**inconclusivo**, não verde. Na VM, rode a suíte inteira com `npx vitest run`; teste pulado não é
teste passando.

O último run Windows nativo `30503250709` falhou no passo de recovery do MySQL:

```text
SCM não reiniciou o MySQL
```

O teste matou o PID que escutava `127.0.0.1:3307` e esperou um novo listener. Não houve novo PID
dentro do gate. Runs anteriores também encontraram `mysqld.exe` órfão durante uninstall. Isso é
um defeito de supervisão/recovery ainda aberto, não um motivo para remover o teste.

## Primeira ação na VM

Se o branch já estiver disponível:

```powershell
git status --short --branch
git rev-parse HEAD
npm ci
npx vitest run test/windows-native-builder-contract.test.js `
  test/windows-initialize-state-contract.test.js `
  test/windows-mysql-bootstrap-contract.test.js `
  test/windows-services-contract.test.js `
  test/windows-firewall-contract.test.js `
  test/windows-uninstall-contract.test.js `
  test/windows-ci-contract.test.js
```

Se não estiver:

```powershell
git clone https://github.com/Nexus-Evolution-Tech/SAGE-API.git
Set-Location .\SAGE-API
git switch --track origin/agent/f8-uninstall
```

Abra PowerShell **como Administrador** para os passos de serviço. Antes de alterar código, capture
o modelo real de processos:

```powershell
Get-CimInstance Win32_Service -Filter "Name='SAGEMySQL'" |
  Select-Object Name,State,ProcessId,StartName,PathName
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like 'C:\Program Files\SAGE\*' } |
  Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine
Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
sc.exe qfailure SAGEMySQL
```

Não publique senhas ou conteúdo de `*.env`/`*.cnf` no log. Os comandos acima não precisam delas.

## Investigação que precisa ser concluída

A documentação oficial do MySQL confirma que, no Windows, `mysqld` usa um processo monitor e
outro processo servidor, e que `RESTART` depende desse monitor:
<https://dev.mysql.com/doc/refman/8.4/en/restart.html>.

A documentação do WinSW confirma que ele pode supervisionar um executável e usar
`<stopexecutable>`/`<stoparguments>` para shutdown gracioso:
<https://github.com/winsw/winsw/blob/v3/docs/xml-config-file.md>.

Determine na VM, com evidência de PID/parentesco, se o serviço nativo está supervisionando o
processo que possui o listener. Depois escolha e documente uma solução:

1. manter o serviço nativo, se for possível provar recovery após kill do engine e shutdown limpo;
2. ou supervisionar `mysqld` com WinSW/um wrapper equivalente, usando `mysqladmin` e o arquivo
   de credencial de shutdown protegido para parada normal.

Não troque `Stop-Process` por `Stop-Service` no teste: isso provaria apenas parada administrativa,
não recuperação de uma falha real. Não force-kill `mysqld.exe` no uninstall; se o shutdown limpo
falhar, o uninstaller deve falhar alto e preservar o estado.

Qualquer mudança no modelo de serviço precisa atualizar provisionamento, uninstaller, XML/config,
contratos Windows e `.github/workflows/windows-native.yml`. Mantenha cada PR em torno de 300
linhas ou menos; primeiro faça o teste reproduzir o comportamento, depois a correção.

## Gate antes de seguir para Inno

Só avance para `.iss`/EXE quando todos estes fatos estiverem provados no Windows:

- suíte completa sem falha; dependências MySQL não podem ser mascaradas como skip;
- instalação/layout offline em Windows x64;
- API e MySQL sob contas/ACL esperadas;
- API recupera após kill e MySQL recupera após kill do engine/listener;
- reboot mantém serviços e readiness;
- uninstall repetido remove código/serviços/firewall e preserva `ProgramData`;
- regra de firewall estrangeira não é removida;
- nenhum segredo aparece em linha de comando, logs ou artefato.

Ainda faltam depois desse gate: Inno Setup, update lado a lado, migration/readiness/rollback,
prova completa na VM limpa, assinatura Authenticode, licença de redistribuição do MySQL e landing
page. A landing page só deve apontar para artefato assinado, com manifesto e checksum.

## Documentação alinhada neste branch

- README agora aponta para documentos existentes e descreve o CI Windows como parcial.
- Spec F8 registra o estado real e o recovery MySQL aberto.
- ROADMAP, arquitetura e F2b não recomendam mais exclusão automática do Defender.
- O handoff arquitetural em `../docs/HANDOFF-CODEX.md` é histórico fora deste checkout; ele ainda
  contém a contagem antiga de testes e caminhos legados. Não o trate como estado atual.

### Onde isto pode dar errado

- A VM pode não reproduzir exatamente o runner `windows-2025`; registre versão do Windows e do
  MySQL em cada evidência.
- Trocar o serviço nativo por WinSW pode aumentar o escopo e alterar semântica de parada; preserve
  o cliente de shutdown restrito e valide ACL/parentesco antes de aceitar a mudança.
- Mesmo com todos os testes Windows, isso não prova desempenho no HD mecânico da escola nem o
  comportamento da IDBlock antiga. Esses são gates posteriores de hardware real.
