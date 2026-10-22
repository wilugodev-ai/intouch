[CmdletBinding()]
param(
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId = 'touchlumo-20261021',
    [ValidatePattern('^[a-z]+-[a-z]+[0-9]+$')][string]$Region = 'us-central1',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$secretResources = @('touchlumo-meta-app-secret','touchlumo-meta-webhook-verify-token','touchlumo-whatsapp-encryption-key','touchlumo-supabase-whatsapp-secret-key')
$runtimeMember = "serviceAccount:touchlumo-runtime@$ProjectId.iam.gserviceaccount.com"
if ($PrepareOnly) {
    Write-Output "Project: $ProjectId; replication location: $Region"
    Write-Output "Secret resources: $($secretResources -join ', ')"
    Write-Output "Recipient: $runtimeMember; role: roles/secretmanager.secretAccessor on each named secret only."
    Write-Output 'Generate values only for webhook verification and encryption; preserve existing enabled versions. Leave app/Supabase values for the user to add privately.'
    Write-Output 'No cloud changes made.'
    return
}
$installed = Get-Command gcloud -ErrorAction SilentlyContinue
$portable = Join-Path $repoRoot '.data\google-cloud\google-cloud-sdk\bin\gcloud.cmd'
$taskGcloud = if ($installed) { $installed.Source } elseif (Test-Path -LiteralPath $portable) { $portable } else { throw 'Google Cloud CLI is unavailable' }
$existingNames = @(& $taskGcloud secrets list "--project=$ProjectId" '--format=value(name)')
if ($LASTEXITCODE -ne 0) { throw 'Could not list secret resources. Enable Secret Manager in the selected project first.' }
$existingNames = @($existingNames | ForEach-Object { ($_ -split '/')[-1] })
foreach ($secretResource in $secretResources) {
    if ($existingNames -notcontains $secretResource) {
        & $taskGcloud secrets create $secretResource "--project=$ProjectId" --replication-policy=user-managed "--locations=$Region" --quiet --format=none
        if ($LASTEXITCODE -ne 0) { throw "Could not create secret resource $secretResource" }
    }
    & $taskGcloud secrets add-iam-policy-binding $secretResource "--project=$ProjectId" "--member=$runtimeMember" --role=roles/secretmanager.secretAccessor --condition=None --quiet --format=none
    if ($LASTEXITCODE -ne 0) { throw "Could not grant runtime access to $secretResource" }
}
$taskCloudToken = & $taskGcloud auth print-access-token
if ($LASTEXITCODE -ne 0 -or -not $taskCloudToken) { throw 'Google Cloud authentication is unavailable' }
$taskCloudHeaders = @{Authorization="Bearer $taskCloudToken"}
try {
    foreach ($generatedSecret in @('touchlumo-meta-webhook-verify-token','touchlumo-whatsapp-encryption-key')) {
        $enabledVersions = @(& $taskGcloud secrets versions list $generatedSecret "--project=$ProjectId" --filter=state:ENABLED --limit=1 '--format=value(name)')
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect secret versions' }
        if ($enabledVersions.Count -eq 0) {
            $randomSecretBytes = New-Object byte[] 32
            $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $randomGenerator.GetBytes($randomSecretBytes) } finally { $randomGenerator.Dispose() }
            $secretPlain = if ($generatedSecret -eq 'touchlumo-whatsapp-encryption-key') { [Convert]::ToBase64String($randomSecretBytes) } else { -join ($randomSecretBytes | ForEach-Object { $_.ToString('x2') }) }
            $secretRequest = @{payload=@{data=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secretPlain))}} | ConvertTo-Json -Depth 4
            $secretUrl = "https://secretmanager.googleapis.com/v1/projects/$ProjectId/secrets/$generatedSecret"
            $createdVersion = Invoke-RestMethod -Uri "${secretUrl}:addVersion" -Headers $taskCloudHeaders -ContentType 'application/json' -Method Post -Body $secretRequest -TimeoutSec 30
            Write-Output "Initialized $generatedSecret; version $($createdVersion.name.Split('/')[-1])."
            [Array]::Clear($randomSecretBytes,0,$randomSecretBytes.Length)
            $secretPlain = $null; $secretRequest = $null
        } else { Write-Output "$generatedSecret already has an enabled version; preserved." }
    }
} catch { throw 'Could not initialize generated WhatsApp secrets. No secret payload was printed.' } finally {
    $taskCloudToken=$null; $taskCloudHeaders=$null; $secretPlain=$null; $secretRequest=$null
}
Write-Output 'App and dedicated Supabase secret resources are ready for private user-provided values. No Cloud Run revision changed.'