#!/usr/bin/env bash
# Runs Postgres and Redis natively (no Docker) with data under ./.local.
# Usage: pnpm services:native start|stop|status
# Requires Postgres 14+ binaries (initdb, pg_ctl) and redis-server on PATH.
# Without MinIO, set STORAGE_DRIVER=local in .env (files are stored under ./.data/storage).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$ROOT/.local/pg"
REDISDIR="$ROOT/.local/redis"
PGPORT="${PGPORT:-5432}"
REDISPORT="${REDISPORT:-6379}"

find_pg_bin() {
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return; fi
  for d in /Library/PostgreSQL/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/lib/postgresql/*/bin; do
    if [ -x "$d/pg_ctl" ]; then echo "$d"; return; fi
  done
  echo "Postgres binaries not found" >&2; exit 1
}
PGBIN="$(find_pg_bin)"

start() {
  mkdir -p "$ROOT/.local" "$REDISDIR"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    "$PGBIN/initdb" -D "$PGDATA" -U qr --auth=trust >/dev/null
    echo "Initialised Postgres cluster in $PGDATA"
  fi
  if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $ROOT/.local" -l "$ROOT/.local/pg.log" -w start >/dev/null
  fi
  "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U qr -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='qr'" >/dev/null
  "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U qr -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='qr_ordering'" | grep -q 1 \
    || "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U qr qr_ordering
  "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U qr -d postgres -c "ALTER ROLE qr PASSWORD 'qr'" >/dev/null
  echo "Postgres running on 127.0.0.1:$PGPORT (user qr / password qr, db qr_ordering)"
  if command -v redis-server >/dev/null 2>&1; then
    if ! redis-cli -p "$REDISPORT" ping >/dev/null 2>&1; then
      redis-server --port "$REDISPORT" --dir "$REDISDIR" --daemonize yes --save "" --appendonly no >/dev/null
    fi
    echo "Redis running on 127.0.0.1:$REDISPORT"
  else
    echo "redis-server not found: leave REDIS_URL empty to use in-memory fallbacks (single instance only)"
  fi
}

stop() {
  "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 && echo "Postgres stopped" || true
  redis-cli -p "$REDISPORT" shutdown nosave >/dev/null 2>&1 && echo "Redis stopped" || true
}

status() {
  "$PGBIN/pg_ctl" -D "$PGDATA" status || true
  redis-cli -p "$REDISPORT" ping || true
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
