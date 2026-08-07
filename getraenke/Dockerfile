ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19

# ---------------------------------------------------------------------------
# Build-Stage: Frontend (Vite) und Backend (tsc) kompilieren.
#
# Bewusst das offizielle Node-Image statt des HA-Basisimages: Vite 7 verlangt
# Node >= 20.19, Alpine 3.19 liefert aber nur 20.15. Gebaut wird ohnehin nur
# hier – im fertigen Image landet ausschliesslich das Ergebnis.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /build

# Erst nur die Manifeste kopieren, damit der npm-Layer gecached bleibt.
COPY app/package.json app/package-lock.json* ./app/
COPY server/package.json server/package-lock.json* ./server/
RUN cd app && npm install --no-audit --no-fund \
    && cd ../server && npm install --no-audit --no-fund

COPY app ./app
COPY server ./server

RUN cd app && npm run build \
    && cd ../server && npm run build \
    && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime-Stage: Home-Assistant-Basisimage + Node zum Ausführen.
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs tzdata

WORKDIR /opt/getraenke

COPY --from=builder /build/server/package.json ./server/package.json
COPY --from=builder /build/server/node_modules ./server/node_modules
COPY --from=builder /build/server/dist ./server/dist
COPY --from=builder /build/app/dist ./public

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
