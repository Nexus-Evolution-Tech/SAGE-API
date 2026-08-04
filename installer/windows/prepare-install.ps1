[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

foreach ($name in @('SAGEAPI', 'SAGEMySQL')) {
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $service -or $service.Status -eq [ServiceProcess.ServiceControllerStatus]::Stopped) {
    continue
  }
  Stop-Service -Name $name -ErrorAction Stop
  $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(60))
  $service.Refresh()
  if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
    throw "Serviço $name não parou antes da atualização"
  }
}
