[CmdletBinding()]
param(
  [Parameter()]
  [string]$Region = $env:AWS_REGION,

  [Parameter()]
  [string]$Repository = "prod/hexacode",

  [Parameter()]
  [ValidateSet("identity-service", "problem-service", "submission-service", "worker")]
  [string[]]$Service = @("identity-service", "problem-service", "submission-service", "worker"),

  [Parameter()]
  [string]$TagSuffix,

  [Parameter()]
  [string]$AccountId,

  [switch]$SkipLogin,
  [switch]$SkipPush,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host "==> $Description"
  & $Action
}

$serviceConfig = @{
  "identity-service" = @{
    Dockerfile = "hexacode-backend/services/identity-service/Dockerfile"
    Context = "hexacode-backend"
  }
  "problem-service" = @{
    Dockerfile = "hexacode-backend/services/problem-service/Dockerfile"
    Context = "hexacode-backend"
  }
  "submission-service" = @{
    Dockerfile = "hexacode-backend/services/submission-service/Dockerfile"
    Context = "hexacode-backend"
  }
  "worker" = @{
    Dockerfile = "hexacode-backend/services/worker/Dockerfile"
    Context = "hexacode-backend"
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Region) {
  throw "AWS region is required. Pass -Region or set AWS_REGION."
}

Push-Location $repoRoot
try {
  if (-not $DryRun) {
    Require-Command "aws"
    Require-Command "docker"
  }

  if (-not $TagSuffix) {
    Require-Command "git"
    $TagSuffix = (& git rev-parse --short HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $TagSuffix) {
      throw "Unable to determine git commit SHA. Pass -TagSuffix explicitly."
    }
  }

  if ($DryRun -and -not $AccountId) {
    $AccountId = "123456789012"
  } elseif (-not $AccountId) {
    $AccountId = (& aws sts get-caller-identity --query Account --output text).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $AccountId) {
      throw "Unable to determine AWS account ID."
    }
  }

  $registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"

  if ($DryRun) {
    Write-Host "[dry-run] Repository root: $repoRoot"
    Write-Host "[dry-run] Registry: $registry"
    Write-Host "[dry-run] Repository: $Repository"
    Write-Host "[dry-run] Tag suffix: $TagSuffix"
  } else {
    Invoke-Step "Verify ECR repository '$Repository'" {
      & aws ecr describe-repositories --region $Region --repository-names $Repository | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "ECR repository '$Repository' was not found or is not accessible in region '$Region'."
      }
    }

    if (-not $SkipLogin) {
      Invoke-Step "Login Docker to ECR" {
        $password = & aws ecr get-login-password --region $Region
        if ($LASTEXITCODE -ne 0 -or -not $password) {
          throw "Unable to get ECR login password."
        }
        $password | docker login --username AWS --password-stdin $registry
        if ($LASTEXITCODE -ne 0) {
          throw "Docker login to ECR failed."
        }
      }
    }
  }

  $pushedImages = [System.Collections.Generic.List[string]]::new()

  foreach ($serviceName in $Service) {
    $config = $serviceConfig[$serviceName]
    $localImage = "hexacode-${serviceName}:$TagSuffix"
    $remoteTag = "$serviceName-$TagSuffix"
    $remoteImage = "${registry}/${Repository}:$remoteTag"

    if ($DryRun) {
      Write-Host "[dry-run] docker build -f $($config.Dockerfile) -t $localImage $($config.Context)"
      Write-Host "[dry-run] docker tag $localImage $remoteImage"
      if (-not $SkipPush) {
        Write-Host "[dry-run] docker push $remoteImage"
      }
      continue
    }

    Invoke-Step "Build $serviceName" {
      & docker build -f $config.Dockerfile -t $localImage $config.Context
      if ($LASTEXITCODE -ne 0) {
        throw "Docker build failed for $serviceName."
      }
    }

    Invoke-Step "Tag $serviceName for ECR" {
      & docker tag $localImage $remoteImage
      if ($LASTEXITCODE -ne 0) {
        throw "Docker tag failed for $serviceName."
      }
    }

    if ($SkipPush) {
      Write-Host "Skipped push for $serviceName. Tagged image: $remoteImage"
      continue
    }

    Invoke-Step "Push $serviceName" {
      & docker push $remoteImage
      if ($LASTEXITCODE -ne 0) {
        throw "Docker push failed for $serviceName."
      }
    }

    $pushedImages.Add($remoteImage) | Out-Null
  }

  if ($DryRun) {
    Write-Host "[dry-run] Completed."
    return
  }

  if ($SkipPush) {
    Write-Host "Build and tag completed. Push was skipped."
  } else {
    Write-Host "Pushed images:"
    foreach ($image in $pushedImages) {
      Write-Host " - $image"
    }
  }
}
finally {
  Pop-Location
}
