[CmdletBinding()]
param(
    [string]$PsqlPath = "",
    [string]$ServerHost = "127.0.0.1",
    [int]$Port = 5432,
    [string]$AdminUser = "postgres",
    [string]$AppUser = "nocdesk",
    [string]$Database = "nocdesk",
    [string]$AppPassword = "nocdesk_local_only"
)

$ErrorActionPreference = "Stop"

foreach ($identifier in @($AdminUser, $AppUser, $Database)) {
    if ($identifier -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw "Invalid PostgreSQL identifier '$identifier'. Use letters, numbers, and underscores only."
    }
}

if ($AppPassword -notmatch '^[A-Za-z0-9._~-]+$') {
    throw "AppPassword must be URL-safe because it is also used in DATABASE_URL."
}

if ([string]::IsNullOrWhiteSpace($PsqlPath)) {
    $command = Get-Command psql -ErrorAction SilentlyContinue
    if ($command) {
        $PsqlPath = $command.Source
    }
    else {
        $postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
        $candidate = Get-ChildItem -Path (Join-Path $postgresRoot "*\bin\psql.exe") -ErrorAction SilentlyContinue |
            Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
            Select-Object -First 1

        if ($candidate) {
            $PsqlPath = $candidate.FullName
        }
    }
}

if ([string]::IsNullOrWhiteSpace($PsqlPath) -or -not (Test-Path -LiteralPath $PsqlPath)) {
    throw "psql.exe was not found. Install PostgreSQL Command Line Tools or pass -PsqlPath with the full path to psql.exe."
}

$secureAdminPassword = Read-Host "PostgreSQL administrator password for '$AdminUser'" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdminPassword)
$adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
$previousPgPassword = $env:PGPASSWORD
$tempSqlPath = [System.IO.Path]::GetTempFileName()
$dollar = '$'

function ConvertTo-SqlLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

try {
    $appUserSql = ConvertTo-SqlLiteral $AppUser
    $databaseSql = ConvertTo-SqlLiteral $Database
    $appPasswordSql = ConvertTo-SqlLiteral $AppPassword

    $sql = @"
DO $($dollar)$($dollar)
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $appUserSql) THEN
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $appUserSql, $appPasswordSql);
    ELSE
        EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', $appUserSql, $appPasswordSql);
    END IF;
END
$($dollar)$($dollar);

SELECT format('CREATE DATABASE %I OWNER %I', $databaseSql, $appUserSql)
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = $databaseSql)
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', $databaseSql, $appUserSql)
\gexec
"@

    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($tempSqlPath, $sql, $utf8NoBom)

    $env:PGPASSWORD = $adminPassword
    & $PsqlPath -X -w -v ON_ERROR_STOP=1 -h $ServerHost -p $Port -U $AdminUser -d postgres -f $tempSqlPath
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL setup failed. Confirm that the PostgreSQL service is running and the administrator credentials are correct."
    }

    $env:PGPASSWORD = $AppPassword
    & $PsqlPath -X -w -v ON_ERROR_STOP=1 -h $ServerHost -p $Port -U $AppUser -d $Database -c "SELECT current_database() AS database, current_user AS role;"
    if ($LASTEXITCODE -ne 0) {
        throw "The application role could not connect. Check the local PostgreSQL configuration."
    }

    Write-Host ""
    Write-Host "Local PostgreSQL is ready." -ForegroundColor Green
    Write-Host "Database: $Database | Role: $AppUser | Host: $ServerHost | Port: $Port"
}
finally {
    if ($null -eq $previousPgPassword) {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:PGPASSWORD = $previousPgPassword
    }

    if (Test-Path -LiteralPath $tempSqlPath) {
        Remove-Item -LiteralPath $tempSqlPath -Force -ErrorAction SilentlyContinue
    }

    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}
