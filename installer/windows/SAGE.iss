#ifndef InternalBuild
  #error Este instalador somente pode ser compilado como protótipo interno
#endif
#ifndef SourceRoot
  #error SourceRoot obrigatório
#endif
#ifndef AppVersion
  #error AppVersion obrigatório
#endif
#ifndef InstallerOutput
  #error InstallerOutput obrigatório
#endif

[Setup]
AppId={{F47568D0-DFB1-4D73-A24C-E5D5EC803729}
AppName=SAGE
AppVersion={#AppVersion}
DefaultDirName={autopf}\SAGE
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Uninstallable=yes
OutputDir={#InstallerOutput}
OutputBaseFilename=SAGE-Setup-{#AppVersion}-x64-internal
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\SAGE"; Filename: "http://localhost:3000"

[Code]
var
  CredentialPage: TInputQueryWizardPage;
  NeedsCredential: Boolean;

procedure InitializeWizard;
begin
  NeedsCredential := not FileExists(ExpandConstant('{commonappdata}\SAGE\config\mysql-accounts.ready'));
  CredentialPage := CreateInputQueryPage(wpSelectDir, 'Acesso administrativo inicial',
    'Crie o acesso inicial da unidade', 'A senha não será gravada no instalador nem na linha de comando.');
  CredentialPage.Add('Login inicial', False);
  CredentialPage.Add('Senha inicial', True);
  CredentialPage.Add('Nome da unidade', False);
  CredentialPage.Edits[2].Text := 'Unidade Escolar';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = CredentialPage.ID) and not NeedsCredential;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = CredentialPage.ID) and NeedsCredential then begin
    if Length(Trim(CredentialPage.Values[0])) < 3 then begin MsgBox('Login muito curto.', mbError, MB_OK); Result := False; end
    else if Length(CredentialPage.Values[1]) < 16 then begin MsgBox('A senha deve ter ao menos 16 caracteres.', mbError, MB_OK); Result := False; end
    else if (Pos(#10, CredentialPage.Values[0]) > 0) or (Pos(#13, CredentialPage.Values[0]) > 0) or
      (Pos(#10, CredentialPage.Values[1]) > 0) or (Pos(#13, CredentialPage.Values[1]) > 0) or
      (Pos(#10, CredentialPage.Values[2]) > 0) or (Pos(#13, CredentialPage.Values[2]) > 0) then
      begin MsgBox('Os campos não podem conter quebra de linha.', mbError, MB_OK); Result := False; end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  CredentialFile, Args, Content: String;
begin
  if CurStep <> ssPostInstall then exit;
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\service\initialize-state.ps1') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    RaiseException('Falha ao preparar o estado privado.');
  CredentialFile := '';
  if NeedsCredential then begin
    CredentialFile := ExpandConstant('{commonappdata}\SAGE\config\initial-admin.pending');
    Content := 'LOGIN=' + CredentialPage.Values[0] + #13#10 +
      'PASSWORD=' + CredentialPage.Values[1] + #13#10 +
      'SCHOOL=' + CredentialPage.Values[2] + #13#10;
    if not SaveStringToFile(CredentialFile, Content, False) then RaiseException('Falha ao preparar credencial inicial.');
  end;
  Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\service\complete-install.ps1') + '"';
  if CredentialFile <> '' then Args := Args + ' -CredentialFile "' + CredentialFile + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args,
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    RaiseException('A instalação segura do SAGE falhou. Consulte os logs locais.');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\service\uninstall-services.ps1') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      RaiseException('Os serviços não puderam ser removidos com segurança.');
end;
