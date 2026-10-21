# PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit): limits file writes of herd roles.
# No HERD_ROLE or HERD_ROLE=worker -> allow. Allowlists: ~/.claude/herd/PROTOCOL.md.
$role = $env:HERD_ROLE
if (-not $role -or $role -eq 'worker') { exit 0 }

$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
$path = $in.tool_input.file_path
if (-not $path) { $path = $in.tool_input.notebook_path }
if (-not $path) { exit 0 }
if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path $in.cwd $path }
$p = [IO.Path]::GetFullPath($path) -replace '\\', '/'

$common = @('\.worktrees/_herd/', '/temp/claude/[^/]+/[^/]+/scratchpad/')
$docs = @('/GLOSSARY[^/]*\.md$', '/docs/adr/', '/docs/agents/', '/\.scratch/')
$allowed = switch ($role) {
    'coordinator' { $common + $docs }
    'manager' { $common + $docs }
    'reviewer' { $common }
    default { $common }
}

foreach ($re in $allowed) { if ($p -match $re) { exit 0 } }

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::Error.WriteLine("herd-guard: role '$role' may not write '$p'. Allowed: $($allowed -join ', '). Code changes are a worker's job - delegate them as your role skill says.")
exit 2
