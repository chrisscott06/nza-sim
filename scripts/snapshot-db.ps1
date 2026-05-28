# snapshot-db.ps1 - Brief 72 PA (2026-05-28)
#
# Local SQLite DB snapshot for nza-sim. Triggered by the Windows Scheduled
# Task `nza-sim-db-daily-snapshot` (daily 02:00 local) per the Bible
# addendum landed late 2026-05-28. Manual run is also fine:
#
#     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\snapshot-db.ps1
#
# Behaviour:
#   - Source: <repo>\data\nza_sim.db (+ .db-wal / .db-shm if present)
#   - Destination: C:\Users\ChrisScott\Backups\nza-sim-db\nza_sim_YYYY-MM-DD_HHMM.db
#   - Retention: keep last 14 snapshots; delete older (sorted by Name -
#     the timestamp in the filename gives a lexicographic sort that
#     matches chronological order, no need to parse).
#   - WAL/SHM sidecars are copied alongside if present (preserving the
#     full read-consistent state at snapshot time).
#
# Lineage: this script is a direct response to the 2026-05-28 22:34
# DB-loss incident where a worktree backend sharing the data directory
# via junction caused the live nza_sim.db to be reset to empty schema.
# Without a snapshot, recovery was impossible; with one, the previous
# day's state is always recoverable.

$ErrorActionPreference = 'Stop'

# Resolve repo root relative to the script. Script lives at <repo>\scripts\.
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RepoRoot -or -not (Test-Path $RepoRoot)) {
  # Fallback: assume script is invoked from repo root.
  $RepoRoot = (Get-Location).Path
}

$SourceDir   = Join-Path $RepoRoot 'data'
$SourceDb    = Join-Path $SourceDir 'nza_sim.db'
$SourceWal   = Join-Path $SourceDir 'nza_sim.db-wal'
$SourceShm   = Join-Path $SourceDir 'nza_sim.db-shm'
$BackupRoot  = 'C:\Users\ChrisScott\Backups\nza-sim-db'
$Retention   = 14
$LogFile     = Join-Path $BackupRoot '_snapshot.log'

# Idempotent: create backup dir if it doesn't exist.
if (-not (Test-Path $BackupRoot)) {
  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
}

function Write-Log($msg) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "$ts $msg"
  Add-Content -Path $LogFile -Value $line
  Write-Output $line
}

if (-not (Test-Path $SourceDb)) {
  Write-Log "WARN no source DB at $SourceDb - skipping snapshot"
  exit 0
}

$stamp     = (Get-Date).ToString('yyyy-MM-dd_HHmm')
$destDb    = Join-Path $BackupRoot ("nza_sim_$stamp.db")
$destWal   = Join-Path $BackupRoot ("nza_sim_$stamp.db-wal")
$destShm   = Join-Path $BackupRoot ("nza_sim_$stamp.db-shm")

try {
  Copy-Item -Path $SourceDb -Destination $destDb -Force
  $bytes = (Get-Item $destDb).Length
  Write-Log "OK copied DB → $destDb ($bytes bytes)"
} catch {
  Write-Log "ERROR copying DB: $_"
  exit 1
}

# WAL / SHM are optional - only present when there are uncommitted pages.
if (Test-Path $SourceWal) {
  try {
    Copy-Item -Path $SourceWal -Destination $destWal -Force
    Write-Log "OK copied WAL → $destWal"
  } catch {
    Write-Log "WARN copying WAL: $_ (continuing)"
  }
}
if (Test-Path $SourceShm) {
  try {
    Copy-Item -Path $SourceShm -Destination $destShm -Force
    Write-Log "OK copied SHM → $destShm"
  } catch {
    Write-Log "WARN copying SHM: $_ (continuing)"
  }
}

# Retention: keep last $Retention snapshots (by filename - they sort
# chronologically because of the YYYY-MM-DD_HHMM format). Each "snapshot"
# is a triple (db, db-wal, db-shm) all sharing the same timestamp prefix.
$snapshotPrefixes = Get-ChildItem -Path $BackupRoot -Filter 'nza_sim_*.db' -File `
  | Sort-Object Name -Descending `
  | Select-Object -ExpandProperty BaseName

function Remove-IfExists($p) {
  if (Test-Path $p) {
    try { Remove-Item -Path $p -Force; Write-Log "ROTATE deleted $p" }
    catch { Write-Log ("WARN deleting " + $p + ": " + $_) }
  }
}
if ($snapshotPrefixes.Count -gt $Retention) {
  $toDelete = $snapshotPrefixes | Select-Object -Skip $Retention
  foreach ($prefix in $toDelete) {
    Remove-IfExists (Join-Path $BackupRoot ($prefix + '.db'))
    Remove-IfExists (Join-Path $BackupRoot ($prefix + '.db-wal'))
    Remove-IfExists (Join-Path $BackupRoot ($prefix + '.db-shm'))
  }
}

Write-Log "DONE snapshot run complete"
exit 0
