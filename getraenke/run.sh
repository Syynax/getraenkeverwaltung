#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e

export PORT=8099
export PUBLIC_DIR=/opt/getraenke/public
# /data ist das persistente Volume des Add-ons – überlebt Update & Neustart.
export DATA_FILE=/data/getraenke.json

# Titel/Log-Level zusätzlich als Env, damit der Server auch ohne options.json
# vernünftige Werte hat. Benutzerliste und Anmeldemodus liest der Server direkt
# aus options.json – verschachtelte Listen überleben den Umweg über die Shell nicht.
export APP_TITEL="$(bashio::config 'titel')"
export APP_UNTERTITEL="$(bashio::config 'untertitel')"
export LOG_LEVEL="$(bashio::config 'log_level')"
export OPTIONS_FILE=/data/options.json

if bashio::supervisor.ping > /dev/null 2>&1; then
    export TZ="$(bashio::info.timezone)"
fi

bashio::log.info "Starte Getränkeverwaltung auf Port ${PORT} …"
bashio::log.info "Datenablage: ${DATA_FILE}"
bashio::log.info "Anmeldung: $(bashio::config 'anmeldung')"

cd /opt/getraenke/server
exec node dist/index.js
