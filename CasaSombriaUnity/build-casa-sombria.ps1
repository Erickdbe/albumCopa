$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$project = $PSScriptRoot
$gameAssets = Join-Path $project "Assets\GameAssets"
$grannyAssets = Join-Path $repo "casaSombria\Granny_Game-main\assets"
$enemyAssets = Join-Path $repo "Meshy_AI_Ragged_Wraith_biped\Meshy_AI_Ragged_Wraith_biped"
$unity = Join-Path $repo "Unity2017Local\Editor\Unity.exe"
$log = Join-Path $repo "unity-casa-sombria-build.log"

if (-not (Test-Path -LiteralPath $unity)) {
    throw "Unity 2017.4.40f1 nao encontrada em $unity"
}

foreach ($folder in @("Models", "Textures", "Audio", "Enemy")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $gameAssets $folder) | Out-Null
}

Copy-Item -Path (Join-Path $grannyAssets "models\*") -Destination (Join-Path $gameAssets "Models") -Recurse -Force
Copy-Item -Path (Join-Path $grannyAssets "textures\*") -Destination (Join-Path $gameAssets "Textures") -Recurse -Force
Copy-Item -Path (Join-Path $grannyAssets "audio\*") -Destination (Join-Path $gameAssets "Audio") -Recurse -Force
Copy-Item -Path (Join-Path $enemyAssets "*") -Destination (Join-Path $gameAssets "Enemy") -Recurse -Force

& $unity -batchmode -nographics -quit -projectPath $project -executeMethod CasaSombriaBuilder.BuildWebGL -logFile $log
if ($LASTEXITCODE -ne 0) {
    throw "O build falhou. Consulte $log"
}

Write-Host "Casa Sombria WebGL gerada em casaSombria\Build"
