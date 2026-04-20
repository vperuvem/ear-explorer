# =============================================================================
# install-hooks.ps1 — Wires the EAR Explorer test suite into git pre-commit.
#
# Run once after cloning:
#   powershell -ExecutionPolicy Bypass -File tests\install-hooks.ps1
#
# What it does:
#   1. Installs Jest (npm install in tests/)
#   2. Writes .git/hooks/pre-commit that runs the tests before every commit
#   3. If any test fails the commit is blocked with a clear error message
# =============================================================================

$repoRoot  = Split-Path -Parent $PSScriptRoot
$testsDir  = Join-Path $repoRoot 'tests'
$hooksDir  = Join-Path $repoRoot '.git\hooks'
$hookFile  = Join-Path $hooksDir 'pre-commit'

# ── 1. Verify Node is available ───────────────────────────────────────────────
Write-Host "`nChecking Node.js..." -ForegroundColor Cyan
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0) { Write-Error "node not found — install Node.js 18+"; exit 1 }
Write-Host "  Node $nodeVersion (built-in test runner — no npm install required)" -ForegroundColor Green

# ── 2. Write the pre-commit hook (bash-compatible shell script) ────────────────
if (-not (Test-Path $hooksDir)) { New-Item -ItemType Directory -Path $hooksDir | Out-Null }

# Git on Windows runs hooks via Git Bash — write a POSIX sh script.
$hookContent = @'
#!/bin/sh
# EAR Explorer — pre-commit: run API integration tests before allowing a commit.
# If the server is not running the tests skip gracefully (exit 0) so you are not
# blocked from committing config/doc changes when the server is offline.

REPO_ROOT="$(git rev-parse --show-toplevel)"
TESTS_DIR="$REPO_ROOT/tests"
NODE="$(command -v node 2>/dev/null)"

if [ -z "$NODE" ]; then
  echo "⚠️  node not found — skipping pre-commit tests"
  exit 0
fi

# Quick server liveness check (2-second timeout via node)
SERVER_UP=$("$NODE" -e "
  fetch('http://localhost:9000/api/servers', { signal: AbortSignal.timeout(2000) })
    .then(() => process.stdout.write('yes'))
    .catch(() => process.stdout.write('no'))
" 2>/dev/null)

if [ "$SERVER_UP" != "yes" ]; then
  echo "⚠️  EAR Explorer server not running — skipping pre-commit tests"
  echo "   Start it with: node server.js   (in ear-explorer/)"
  exit 0
fi

echo ""
echo "🧪 Running EAR Explorer integration tests..."
echo ""

cd "$TESTS_DIR" && "$NODE" run-tests.js

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ Tests FAILED — commit blocked."
  echo "   Fix the failures above then try again."
  echo "   To bypass (use sparingly): git commit --no-verify"
  echo ""
  exit 1
fi

echo ""
echo "✅ All tests passed — proceeding with commit."
echo ""
exit 0
'@

# Write with LF line endings (required for Git Bash)
[System.IO.File]::WriteAllText($hookFile, $hookContent.Replace("`r`n", "`n"))

# Mark executable (only matters on Linux/Mac but harmless on Windows)
Write-Host "  Pre-commit hook written to: $hookFile" -ForegroundColor Green

Write-Host ""
Write-Host "✅ Setup complete." -ForegroundColor Green
Write-Host "   Every 'git commit' in ear-explorer will now run the test suite first." -ForegroundColor Cyan
Write-Host "   To run tests manually: cd tests; node run-tests.js" -ForegroundColor Cyan
Write-Host "   To bypass once:        git commit --no-verify" -ForegroundColor DarkGray
Write-Host ""
