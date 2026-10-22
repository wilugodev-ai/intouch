[CmdletBinding()]
param(
    [string]$ProjectId,
    [ValidatePattern('^[a-z]+-[a-z]+[0-9]+$')][string]$Region = 'us-central1',
    [switch]$PrepareOnly,
    [string]$ExistingApiImage,
    [string]$ExistingWebImage,
    [string]$WebOrigin,
    [string]$WhatsAppConfigurationFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$workDirectory = Join-Path $repoRoot '.data\cloud-run'
$repository = 'touchlumo'
$apiService = 'touchlumo-api'
$webService = 'touchlumo-web'

function Invoke-Gcloud {
    param([string[]]$Arguments)
    & $script:gcloudCommand @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Google Cloud command failed: $($Arguments[0..1] -join ' '). Deployment stopped." }
}

function Write-JsonFile {
    param([string]$Name, $Value)
    $file = Join-Path $workDirectory $Name
    [IO.File]::WriteAllText($file, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    return $file
}

function Build-Image {
    param([string]$Target, [string]$Image, [hashtable]$BuildArguments = @{})
    $dockerArguments = @('build', '--file', 'deploy/cloud-run/Dockerfile', '--target', $Target, '--tag', $Image)
    foreach ($name in ($BuildArguments.Keys | Sort-Object)) { $dockerArguments += @('--build-arg', "$name=$($BuildArguments[$name])") }
    $dockerArguments += '.'
    $configuration = @{
        steps = @(@{ name = 'gcr.io/cloud-builders/docker'; args = $dockerArguments })
        images = @($Image)
        serviceAccount = "projects/$ProjectId/serviceAccounts/$script:buildAccount"
        options = @{ logging = 'CLOUD_LOGGING_ONLY' }
        timeout = '1200s'
    }
    $file = Write-JsonFile -Name "build-$Target.json" -Value $configuration
    Invoke-Gcloud -Arguments @('builds', 'submit', '.', "--project=$ProjectId", "--region=$Region", "--config=$file", "--gcs-source-staging-dir=gs://$script:sourceBucket/source", '--quiet')
}

function Deploy-Service {
    param([string]$Service, [string]$Image, [hashtable]$Environment, [hashtable]$SecretBindings = @{})
    # Preserve optional WhatsApp configuration and Secret Manager references.
    # Only the public values managed by this deployer are updated.
    $environmentEntries = foreach ($name in ($Environment.Keys | Sort-Object)) {
        $value = [string]$Environment[$name]
        if ($name -notmatch '^[A-Z][A-Z0-9_]*$' -or $value -match '[,\r\n]') { throw 'Invalid managed environment value.' }
        "$name=$value"
    }
    $environmentArgument = '--update-env-vars=' + ($environmentEntries -join ',')
    $secretArguments = @()
    if ($SecretBindings.Count) {
        $secretEntries = foreach ($name in ($SecretBindings.Keys | Sort-Object)) { "$name=$($SecretBindings[$name])" }
        $secretArguments = @('--update-secrets=' + ($secretEntries -join ','))
    }
    # Allow old/new revisions to overlap only during rollout.
    try {
        Invoke-Gcloud -Arguments (@(
            'run', 'deploy', $Service, "--project=$ProjectId", "--region=$Region", "--image=$Image",
            "--service-account=$script:runtimeAccount", '--allow-unauthenticated', '--ingress=all',
            '--port=8080', '--cpu=1', '--memory=512Mi', '--cpu-throttling',
            '--min=0', '--max=2', '--min-instances=0', '--max-instances=1', '--concurrency=20', '--timeout=60',
            $environmentArgument
        ) + $secretArguments + @('--quiet'))
    } finally {
        $deployed = Invoke-Gcloud -Arguments @('run', 'services', 'list', "--project=$ProjectId", "--region=$Region", "--filter=metadata.name=$Service", '--format=value(metadata.name)')
        if ($deployed) {
            Invoke-Gcloud -Arguments @('run', 'services', 'update', $Service, "--project=$ProjectId", "--region=$Region", '--max=1', '--quiet')
        }
    }
}

function Test-WebOrigin {
    param([string]$Value)
    $parsedOrigin = $null
    return ([Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsedOrigin) -and
        $parsedOrigin.Scheme -eq 'https' -and $parsedOrigin.AbsolutePath -eq '/' -and
        -not $parsedOrigin.Query -and -not $parsedOrigin.Fragment -and -not $parsedOrigin.UserInfo -and
        $Value -eq $parsedOrigin.GetLeftPart([UriPartial]::Authority))
}

$whatsappEnvironment = @{}
$whatsappSecrets = @{}
if ($WhatsAppConfigurationFile) {
    $whatsappConfiguration = Get-Content -LiteralPath $WhatsAppConfigurationFile -Raw | ConvertFrom-Json
    if ($ProjectId -and $whatsappConfiguration.projectId -ne $ProjectId) { throw 'WhatsApp secret references must belong to this deployment project.' }
    $expectedPublic = @('META_APP_ID','META_WHATSAPP_CONFIG_ID','META_GRAPH_API_VERSION','META_PUBLIC_API_ORIGIN')
    $expectedSecrets = @{
        META_APP_SECRET = 'touchlumo-meta-app-secret'
        META_WEBHOOK_VERIFY_TOKEN = 'touchlumo-meta-webhook-verify-token'
        WHATSAPP_TOKEN_ENCRYPTION_KEY = 'touchlumo-whatsapp-encryption-key'
        SUPABASE_WHATSAPP_SECRET_KEY = 'touchlumo-supabase-whatsapp-secret-key'
    }
    if (@($whatsappConfiguration.environment.PSObject.Properties).Count -ne 4 -or @($whatsappConfiguration.secrets.PSObject.Properties).Count -ne 4) { throw 'Expected exactly four public WhatsApp values and four versioned secret references.' }
    foreach ($name in $expectedPublic) {
        $property = $whatsappConfiguration.environment.PSObject.Properties[$name]
        if (-not $property -or $property.Value -isnot [string]) { throw "Missing public WhatsApp value $name" }
        $whatsappEnvironment[$name] = $property.Value
    }
    if ($whatsappEnvironment.META_APP_ID -notmatch '^\d{5,30}$' -or $whatsappEnvironment.META_WHATSAPP_CONFIG_ID -notmatch '^\d{5,30}$' -or $whatsappEnvironment.META_GRAPH_API_VERSION -notmatch '^v\d{2,3}\.\d+$' -or -not (Test-WebOrigin $whatsappEnvironment.META_PUBLIC_API_ORIGIN)) { throw 'Invalid public WhatsApp configuration.' }
    foreach ($name in $expectedSecrets.Keys) {
        $property = $whatsappConfiguration.secrets.PSObject.Properties[$name]
        if (-not $property -or $property.Value -isnot [string] -or $property.Value -notmatch ('^' + [regex]::Escape($expectedSecrets[$name]) + ':[1-9][0-9]*$')) { throw "Expected a pinned version of the approved secret for $name; secret payloads are not accepted." }
        $whatsappSecrets[$name] = $property.Value
    }
}

if ($WebOrigin -and -not (Test-WebOrigin $WebOrigin)) { throw 'WebOrigin must be an HTTPS origin without a path, query, or trailing slash.' }
if ($ProjectId -and $ProjectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'Enter the project ID, not its display name or project number.' }
if (-not $PrepareOnly -and -not $ProjectId) { throw 'Specify -ProjectId with your Google Cloud project ID.' }
if ($ExistingApiImage -and $ExistingApiImage -notmatch ('^' + [regex]::Escape("$Region-docker.pkg.dev/$ProjectId/$repository/api:") + '[a-zA-Z0-9_.-]+$')) {
    throw 'The existing API image must belong to this project, region, and Touchlumo repository.'
}

if ($ExistingWebImage -and $ExistingWebImage -notmatch ('^' + [regex]::Escape("$Region-docker.pkg.dev/$ProjectId/$repository/web:") + '[a-zA-Z0-9_.-]+$')) {
    throw 'The existing web image must belong to this project, region, and Touchlumo repository.'
}

Push-Location $repoRoot
try {
    # Parse locally without executing .env content or reading test/admin credentials.
    $readConfiguration = @'
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const api = parseEnv(fs.readFileSync('apps/api/.env', 'utf8'));
const web = parseEnv(fs.readFileSync('apps/web/.env.local', 'utf8'));
if (api.SUPABASE_URL !== web.NEXT_PUBLIC_SUPABASE_URL || api.SUPABASE_PUBLISHABLE_KEY !== web.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw Error('Web and API Supabase settings must match');
}
process.stdout.write(JSON.stringify({ url: api.SUPABASE_URL, key: api.SUPABASE_PUBLISHABLE_KEY }));
'@
    $configurationJson = $readConfiguration | & node
    if ($LASTEXITCODE -ne 0) { throw 'Could not load matching Supabase settings from the existing local environment files.' }
    $supabase = $configurationJson | ConvertFrom-Json
    if ($supabase.url -notmatch '^https://[a-z0-9-]+\.supabase\.co/?$') { throw 'Expected the existing HTTPS Supabase project URL.' }
    $publishableKey = [string]$supabase.key
    $validKey = $publishableKey -match '^sb_publishable_[A-Za-z0-9_-]+$'
    if (-not $validKey -and $publishableKey -match '^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
        try {
            $encoded = $publishableKey.Split('.')[1].Replace('-', '+').Replace('_', '/')
            $encoded = $encoded.PadRight($encoded.Length + ((4 - $encoded.Length % 4) % 4), '=')
            $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
            $validKey = $claims.role -eq 'anon'
        } catch { $validKey = $false }
    }
    if (-not $validKey) { throw 'Only a Supabase publishable key or legacy anon key can be deployed. Secret/admin keys are rejected.' }

    New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
    $plan = [ordered]@{
        projectId = $ProjectId; region = $Region; services = @($apiService, $webService)
        requestedWebOrigin = $WebOrigin; originPolicy = 'Explicit origin, then existing API origin, then Cloud Run web URL'
        cpuPerService = 1; memoryPerService = '512Mi'; minimumInstancesPerService = 0; maximumInstancesPerService = 1
        attachments = 'Private Cloud Storage customer files; storage and bandwidth pricing applies'; database = 'Existing Supabase project; no migrations'; publicAccess = 'Website and API; CRM routes still require Supabase login'
        whatsapp = if ($WhatsAppConfigurationFile) { 'Explicit public configuration and four pinned Secret Manager references; database migration must be applied separately' } else { 'Preserve existing optional runtime configuration' }
        billing = 'Request-based; builds, image/source storage, logs, bandwidth and overages can cost money'
    }
    $planFile = Write-JsonFile -Name 'deployment-plan.json' -Value $plan
    if ($PrepareOnly) {
        Write-Host "Local configuration validated. Plan: $planFile"
        Write-Host 'No Google Cloud resources were created or changed.'
        return
    }

    $installedGcloud = Get-Command gcloud -ErrorAction SilentlyContinue
    $portableGcloud = Join-Path $repoRoot '.data\google-cloud\google-cloud-sdk\bin\gcloud.cmd'
    if ($installedGcloud) { $script:gcloudCommand = $installedGcloud.Source }
    elseif (Test-Path -LiteralPath $portableGcloud) { $script:gcloudCommand = $portableGcloud }
    else { throw 'Install the Google Cloud CLI and run gcloud auth login before deploying.' }
    $account = Invoke-Gcloud -Arguments @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)')
    if (-not $account) { throw 'Sign in first with gcloud auth login.' }
    $billingJson = Invoke-Gcloud -Arguments @('billing', 'projects', 'describe', $ProjectId, '--format=json')
    if (-not ($billingJson | ConvertFrom-Json).billingEnabled) { throw 'Link billing to this project in Google Cloud Console before deploying.' }

    # Check Google's actual upload list before enabling services or creating resources.
    $uploadFiles = @(Invoke-Gcloud -Arguments @('meta', 'list-files-for-upload'))
    $allowedFiles = '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.dockerignore|\.gcloudignore|deploy/cloud-run/Dockerfile|apps/api/(package\.json|tsconfig\.json|src/.+)|apps/web/(package\.json|tsconfig\.json|next-env\.d\.ts|next\.config\.mjs|app/.+))$'
    foreach ($uploadFile in $uploadFiles) {
        # Trim only a leading ./; hidden allowlist filenames must keep their dot.
        $normal = ([string]$uploadFile).Replace('\', '/') -replace '^\./', ''
        if ($normal -notmatch $allowedFiles -or $normal -match '(^|/)(\.env[^/]*|node_modules|\.git|\.data|backups)(/|$)') {
            throw "Upload allowlist rejected: $normal"
        }
    }
    if (-not $uploadFiles.Count) { throw 'No source files selected for upload.' }
    Write-Host "Upload allowlist checked: $($uploadFiles.Count) source files. Local credentials remain on this computer."

    Invoke-Gcloud -Arguments @('services', 'enable', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com', 'iam.googleapis.com', 'logging.googleapis.com', 'storage.googleapis.com', "--project=$ProjectId", '--quiet')
    $script:buildAccount = "touchlumo-build@$ProjectId.iam.gserviceaccount.com"
    $script:runtimeAccount = "touchlumo-runtime@$ProjectId.iam.gserviceaccount.com"
    foreach ($name in @('touchlumo-build', 'touchlumo-runtime')) {
        $email = "$name@$ProjectId.iam.gserviceaccount.com"
        $existing = Invoke-Gcloud -Arguments @('iam', 'service-accounts', 'list', "--project=$ProjectId", "--filter=email:$email", '--format=value(email)')
        if (-not $existing) { Invoke-Gcloud -Arguments @('iam', 'service-accounts', 'create', $name, "--project=$ProjectId", '--quiet') }
    }
    # Runtime has no project roles; customer-file access is granted at bucket scope below.
    Invoke-Gcloud -Arguments @('projects', 'add-iam-policy-binding', $ProjectId, "--member=serviceAccount:$script:buildAccount", '--role=roles/logging.logWriter', '--condition=None', '--quiet', '--format=none')
    $existingRepository = Invoke-Gcloud -Arguments @('artifacts', 'repositories', 'list', "--project=$ProjectId", "--location=$Region", "--filter=name:/$repository", '--format=value(name)')
    if (-not $existingRepository) { Invoke-Gcloud -Arguments @('artifacts', 'repositories', 'create', $repository, '--repository-format=docker', "--project=$ProjectId", "--location=$Region", '--quiet') }
    Invoke-Gcloud -Arguments @('artifacts', 'repositories', 'add-iam-policy-binding', $repository, "--project=$ProjectId", "--location=$Region", "--member=serviceAccount:$script:buildAccount", '--role=roles/artifactregistry.writer', '--condition=None', '--quiet', '--format=none')
    $script:sourceBucket = "$ProjectId-touchlumo-source"
    $existingBuckets = @(Invoke-Gcloud -Arguments @('storage', 'buckets', 'list', "--project=$ProjectId", '--format=value(name)'))
    if ($existingBuckets -notcontains $script:sourceBucket -and $existingBuckets -notcontains "gs://$script:sourceBucket") {
        Invoke-Gcloud -Arguments @('storage', 'buckets', 'create', "gs://$script:sourceBucket", "--project=$ProjectId", "--location=$Region", '--uniform-bucket-level-access', '--public-access-prevention', '--quiet')
    }
    Invoke-Gcloud -Arguments @('storage', 'buckets', 'add-iam-policy-binding', "gs://$script:sourceBucket", "--member=serviceAccount:$script:buildAccount", '--role=roles/storage.objectViewer', '--quiet', '--format=none')

    $script:attachmentsBucket = "$ProjectId-customer-files"
    if ($existingBuckets -notcontains $script:attachmentsBucket -and $existingBuckets -notcontains "gs://$script:attachmentsBucket") {
        Invoke-Gcloud -Arguments @('storage', 'buckets', 'create', "gs://$script:attachmentsBucket", "--project=$ProjectId", "--location=$Region", '--default-storage-class=STANDARD', '--uniform-bucket-level-access', '--public-access-prevention', '--soft-delete-duration=0', '--quiet')
    }
    Invoke-Gcloud -Arguments @('storage', 'buckets', 'add-iam-policy-binding', "gs://$script:attachmentsBucket", "--member=serviceAccount:$script:runtimeAccount", '--role=roles/storage.objectUser', '--quiet', '--format=none')

    $release = Get-Date -Format 'yyyyMMdd-HHmmss'
    $imageRoot = "$Region-docker.pkg.dev/$ProjectId/$repository"
    $apiImage = if ($ExistingApiImage) { $ExistingApiImage } else { "${imageRoot}/api:$release" }
    $webImage = if ($ExistingWebImage) { $ExistingWebImage } else { "${imageRoot}/web:$release" }
    if ($ExistingApiImage) {
        Invoke-Gcloud -Arguments @('artifacts', 'docker', 'images', 'describe', $apiImage, "--project=$ProjectId", '--format=none')
        Write-Host "Reusing the successfully built API image: $apiImage"
    } else { Build-Image -Target 'api' -Image $apiImage }
    # Preserve the working origin on repeat deployments while the web image builds.
    $existingWebUrl = Invoke-Gcloud -Arguments @('run', 'services', 'list', "--project=$ProjectId", "--region=$Region", "--filter=metadata.name=$webService", '--format=value(status.url)')
    $existingApiJson = Invoke-Gcloud -Arguments @('run', 'services', 'list', "--project=$ProjectId", "--region=$Region", "--filter=metadata.name=$apiService", '--format=json')
    $existingApiServices = @($existingApiJson | ConvertFrom-Json)
    $existingApiOrigin = $null
    if ($existingApiServices.Count) {
        $existingApiContainer = $existingApiServices[0].spec.template.spec.containers[0]
        if ($existingApiContainer.PSObject.Properties['env']) {
            $existingApiOrigin = $existingApiContainer.env | Where-Object name -eq 'WEB_ORIGIN' | Select-Object -First 1 -ExpandProperty value
        }
    }
    $preservedOrigin = if ($existingApiOrigin -and (Test-WebOrigin $existingApiOrigin) -and $existingApiOrigin -ne 'https://not-configured.invalid') { [string]$existingApiOrigin } else { $null }
    $initialWebOrigin = if ($WebOrigin) { $WebOrigin } elseif ($preservedOrigin) { $preservedOrigin } elseif ($existingWebUrl) { ([string]$existingWebUrl).Trim() } else { 'https://not-configured.invalid' }
    $apiEnvironment = @{
        NODE_ENV = 'production'; HOST = '0.0.0.0'; WEB_ORIGIN = $initialWebOrigin; ATTACHMENTS_BUCKET = $script:attachmentsBucket
        SUPABASE_URL = $supabase.url; SUPABASE_PUBLISHABLE_KEY = $publishableKey
    }
    foreach ($name in $whatsappEnvironment.Keys) { $apiEnvironment[$name] = $whatsappEnvironment[$name] }
    Deploy-Service -Service $apiService -Image $apiImage -Environment $apiEnvironment -SecretBindings $whatsappSecrets
    $apiUrl = (Invoke-Gcloud -Arguments @('run', 'services', 'describe', $apiService, "--project=$ProjectId", "--region=$Region", '--format=value(status.url)')).Trim()
    if ($apiUrl -notmatch '^https://[a-z0-9.-]+\.run\.app$') { throw 'Cloud Run did not return a valid API URL.' }
    if ($ExistingWebImage) {
        Invoke-Gcloud -Arguments @('artifacts', 'docker', 'images', 'describe', $webImage, "--project=$ProjectId", '--format=none')
        Write-Host "Reusing the successfully built web image: $webImage"
    } else {
        Build-Image -Target 'web' -Image $webImage -BuildArguments @{
            NEXT_PUBLIC_SUPABASE_URL = $supabase.url; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $publishableKey; NEXT_PUBLIC_API_URL = $apiUrl
        }
    }
    Deploy-Service -Service $webService -Image $webImage -Environment @{ NODE_ENV = 'production'; HOSTNAME = '0.0.0.0' }
    $webUrl = (Invoke-Gcloud -Arguments @('run', 'services', 'describe', $webService, "--project=$ProjectId", "--region=$Region", '--format=value(status.url)')).Trim()
    if ($webUrl -notmatch '^https://[a-z0-9.-]+\.run\.app$') { throw 'Cloud Run did not return a valid web URL.' }
    $publicWebOrigin = if ($WebOrigin) { $WebOrigin } elseif ($preservedOrigin) { $preservedOrigin } else { $webUrl }
    Invoke-Gcloud -Arguments @('run', 'services', 'update', $apiService, "--project=$ProjectId", "--region=$Region", "--update-env-vars=WEB_ORIGIN=$publicWebOrigin", '--quiet')

    $health = Invoke-RestMethod -Uri "$apiUrl/v1/health" -TimeoutSec 90
    if ($health.status -ne 'ok' -or -not $health.databaseConfigured) { throw 'API configuration/health check failed.' }
    $page = Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 90
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'Touchlumo') { throw 'Website smoke check failed.' }
    $resultFile = Write-JsonFile -Name 'deployment-result.json' -Value @{ projectId = $ProjectId; region = $Region; webUrl = $webUrl; webOrigin = $publicWebOrigin; apiUrl = $apiUrl; apiImage = $apiImage; webImage = $webImage; attachmentsBucket = $script:attachmentsBucket; release = $release }
    Write-Host "Website origin: $publicWebOrigin"
    Write-Host "Cloud Run website: $webUrl"
    Write-Host "API: $apiUrl"
    Write-Host "Deployment details: $resultFile"
    Write-Host "Next: add $publicWebOrigin and $publicWebOrigin/** to the existing Supabase Auth redirect allowlist. Keep working localhost entries."
    Write-Host 'Verify sign-in, password recovery, workspace access and generated registration links before sharing publicly.'
} finally {
    Pop-Location
}
