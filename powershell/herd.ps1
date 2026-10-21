# Herd launchers. Dot-sourced from $PROFILE by install.ps1.

# Start the coordinator in the repo's main checkout (inside herdr).
#   coord          asks whether this repo uses Matt Pocock's skills
#   coord pocock   with mattpocock/skills
#   coord plain    herd only
function coord([ValidateSet('', 'pocock', 'plain')][string]$Mode = '') {
    if ($env:HERDR_ENV -ne '1') { Write-Warning 'coord: run it inside herdr'; return }
    $env:HERD_ROLE = 'coordinator'
    try { claude "/coordinator $Mode".TrimEnd() } finally { Remove-Item Env:HERD_ROLE -ErrorAction SilentlyContinue }
}

# Restart a manager by hand in its feature worktree, e.g. after a crash: mgr <f>
function mgr([Parameter(Mandatory)][string]$Feature) {
    if ($env:HERDR_ENV -ne '1') { Write-Warning 'mgr: run it inside herdr'; return }
    $brief = Join-Path (Get-Location | Split-Path -Parent | Split-Path -Parent) "_herd\$Feature\brief.md"
    if (-not (Test-Path $brief)) { Write-Warning "mgr: $brief not found (run it in <repo>.worktrees\$Feature\_feat)"; return }
    $env:HERD_ROLE = 'manager'
    try { claude --permission-mode auto "/manager $brief" } finally { Remove-Item Env:HERD_ROLE -ErrorAction SilentlyContinue }
}
