# Installs this repo into the current user's Claude Code config. Idempotent: rerun after pulling or moving the repo.
#   pwsh -NoProfile -File install.ps1
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$claude = Join-Path $HOME '.claude'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# Junctions: ~/.claude/<path> -> repo. An existing real directory is moved to ~/.claude/skills/.trash, not deleted.
function Link([string]$rel, [string]$target) {
    $link = Join-Path $claude $rel
    $item = Get-Item $link -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -and $item.Target -eq $target) { Write-Host "ok      $link"; return }
    if ($item -and $item.LinkType) { [IO.Directory]::Delete($link) }
    elseif ($item) {
        $trash = Join-Path $claude 'skills\.trash'
        New-Item -ItemType Directory -Force $trash | Out-Null
        Move-Item $link (Join-Path $trash "$($item.Name)-$stamp")
        Write-Host "moved   $link -> $trash"
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "linked  $link -> $target"
}

Link 'herd' (Join-Path $repo 'herd')
foreach ($skill in Get-ChildItem (Join-Path $repo 'skills') -Directory) {
    Link "skills\$($skill.Name)" $skill.FullName
}

# CLAUDE.md: the herd section lives between markers and is replaced on every run.
$mdPath = Join-Path $claude 'CLAUDE.md'
$block = "<!-- herd:begin -->`n" + (Get-Content -Raw (Join-Path $repo 'claude-md\herd.md')).Trim() + "`n<!-- herd:end -->"
$md = if (Test-Path $mdPath) { Get-Content -Raw $mdPath } else { '' }
$pattern = '(?s)<!-- herd:begin -->.*<!-- herd:end -->'
$md = if ($md -match $pattern) { $md -replace $pattern, { $block } } else { $md.TrimEnd() + "`n`n$block`n" }
Set-Content -NoNewline -Encoding utf8 $mdPath $md
Write-Host "updated $mdPath"

# settings.json: one PreToolUse entry for herd-guard, pointing at this repo.
$settingsPath = Join-Path $claude 'settings.json'
Copy-Item $settingsPath "$settingsPath.bak-$stamp"
$settings = Get-Content -Raw $settingsPath | ConvertFrom-Json -AsHashtable
if (-not $settings.Contains('hooks')) { $settings['hooks'] = [ordered]@{} }
$guard = 'pwsh -NoProfile -File "' + (Join-Path $repo 'hooks\herd-guard.ps1') + '"'
$pre = @($settings.hooks['PreToolUse'] | Where-Object { $_ -and -not ($_.hooks | Where-Object { $_.command -like '*herd-guard.ps1*' }) })
$pre += [ordered]@{ matcher = 'Edit|Write|MultiEdit|NotebookEdit'; hooks = @([ordered]@{ type = 'command'; command = $guard; timeout = 10 }) }
$settings.hooks['PreToolUse'] = $pre
$settings | ConvertTo-Json -Depth 32 | Set-Content -Encoding utf8 $settingsPath
Write-Host "updated $settingsPath (backup: $settingsPath.bak-$stamp)"

# $PROFILE: dot-source the launchers (coord, mgr).
$profilePath = $PROFILE.CurrentUserCurrentHost
$line = '. "' + (Join-Path $repo 'powershell\herd.ps1') + '"'
$existing = if (Test-Path $profilePath) { @(Get-Content $profilePath) } else { @() }
if ($existing -contains $line) { Write-Host "ok      $profilePath" }
else {
    $stale = $existing | Where-Object { $_ -like '*\powershell\herd.ps1"' }
    if ($stale) { Write-Warning "Remove the stale line from ${profilePath} by hand: $stale" }
    Add-Content -Encoding utf8 $profilePath "`n# Herd launchers (coord, mgr)`n$line"
    Write-Host "updated $profilePath"
}
