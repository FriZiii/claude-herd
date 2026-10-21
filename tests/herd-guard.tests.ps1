# Runs hooks/herd-guard.ps1 against role/path cases: pwsh -NoProfile -File tests/herd-guard.tests.ps1
param([string]$Hook = (Join-Path $PSScriptRoot '..\hooks\herd-guard.ps1'))
$cases = @(
    @('coordinator', 'F:\Repo\x\src\a.ts', 2),
    @('coordinator', 'F:\Repo\x\GLOSSARY.md', 0),
    @('coordinator', 'docs/adr/0001-x.md', 0),
    @('coordinator', 'F:\Repo\x\docs\agents\verification.md', 0),
    @('coordinator', 'F:\Repo\x.worktrees\_herd\f\brief.md', 0),
    @('coordinator', 'C:\Users\u\AppData\Local\Temp\claude\proj\sess\scratchpad\decide\a.json', 0),
    @('coordinator', 'C:\Users\u\AppData\Local\Temp\claude\proj\sess\src\a.ts', 2),
    @('manager', 'F:\Repo\x.worktrees\f\_feat\.scratch\f\issues\01-a.md', 0),
    @('manager', 'F:\Repo\x.worktrees\f\_feat\src\b.cs', 2),
    @('reviewer', 'F:\Repo\x.worktrees\f\01\GLOSSARY.md', 2),
    @('reviewer', 'F:\Repo\x.worktrees\_herd\f\reviews\01.md', 0),
    @('worker', 'F:\Repo\x\src\a.ts', 0),
    @('', 'F:\Repo\x\src\a.ts', 0)
)
$fail = 0
foreach ($c in $cases) {
    $env:HERD_ROLE = $c[0]
    $json = @{ tool_name = 'Write'; cwd = 'F:\Repo\x'; tool_input = @{ file_path = $c[1] } } | ConvertTo-Json -Compress
    $err = $json | pwsh -NoProfile -File $Hook 2>&1
    $code = $LASTEXITCODE
    $ok = $code -eq $c[2]
    if (-not $ok) { $fail++ }
    '{0} {1,-12} {2,-75} exit {3} (want {4}) {5}' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $c[0], $c[1], $code, $c[2], ($err -join ' ')
}
Remove-Item Env:HERD_ROLE -ErrorAction SilentlyContinue
"failures: $fail"
