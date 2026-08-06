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
Source: "{#SourceRoot}\service\prepare-install.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\SAGE"; Filename: "http://localhost:3000"

[Code]
var
  ServicesPrepared: Boolean;
  InstallCompleted: Boolean;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer;
begin
  Result := '';
  ExtractTemporaryFile('prepare-install.ps1');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\prepare-install.ps1') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then begin
    Result := 'Não foi possível parar os serviços do SAGE com segurança.';
    exit;
  end;
  ServicesPrepared := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then exit;
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\service\initialize-state.ps1') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    RaiseException('Falha ao preparar o estado privado.');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\service\complete-install.ps1') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    RaiseException('A instalação segura do SAGE falhou. Consulte os logs locais.');
  InstallCompleted := True;
end;

procedure DeinitializeSetup;
var ResultCode: Integer;
begin
  if ServicesPrepared and not InstallCompleted and
    FileExists(ExpandConstant('{app}\service\provision-services.ps1')) then
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -File "' +
        ExpandConstant('{app}\service\provision-services.ps1') + '" -StartApi',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
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
