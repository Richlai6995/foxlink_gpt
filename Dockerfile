# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

ENV NODE_ENV=development

WORKDIR /app/client

# Install deps first (layer cache)
COPY client/package*.json ./
RUN npm install

# Build Vite/React app
COPY client ./
# Pre-create dist dir — Vite 6.x prepareOutDir fails with ENOENT if dist doesn't exist
RUN mkdir -p dist && npm run build


# ─── Stage 2: Production Server ───────────────────────────────────────────────
# Use node:20-slim (Debian) — Alpine does NOT support Oracle Instant Client (needs libaio1)
FROM node:20-slim AS runner

# Install Oracle Client dependency + utilities
# node:20-slim = Debian Bookworm (glibc 2.36) → libaio1t64 (not libaio1)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata fontconfig \
    && (apt-get install -y --no-install-recommends libaio1t64 2>/dev/null \
        || apt-get install -y --no-install-recommends libaio1) \
    && rm -rf /var/lib/apt/lists/*

# Timezone
ENV TZ=Asia/Taipei

# Oracle environment variables — 對應 K8s volume mount: pvc-flhqgpt-source subPath:oracle_client
ENV ORACLE_HOME=/opt/oracle/instantclient
ENV LD_LIBRARY_PATH=${ORACLE_HOME}
ENV PATH=${ORACLE_HOME}:${PATH}

# Register Oracle lib path with ldconfig (so oracledb can find libclntsh.so)
RUN mkdir -p /etc/ld.so.conf.d \
    && echo "${ORACLE_HOME}" > /etc/ld.so.conf.d/oracle-instantclient.conf

WORKDIR /app

# Install server deps (production only)
COPY server/package*.json ./
RUN npm install --only=production

# Copy server source
COPY server ./

# Copy built frontend → server/public (served as static)
COPY --from=builder /app/client/dist ./public

# Create runtime directories
RUN mkdir -p uploads data logs backups fonts skill_runners

# CJK fonts for Chinese PDF generation
# Priority: bundled font in server/fonts/ → apt fonts-noto-cjk → wget fallback
RUN if ls fonts/*.ttf fonts/*.otf fonts/*.ttc 2>/dev/null | head -1 | grep -q .; then \
        echo "[Docker] Bundled CJK font found, skipping install"; \
    else \
        apt-get update \
        && apt-get install -y --no-install-recommends fonts-noto-cjk \
        && rm -rf /var/lib/apt/lists/* \
        && echo "[Docker] fonts-noto-cjk installed" \
        || ( wget -qO fonts/NotoSansTC-Regular.otf \
               "https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/TC/NotoSansCJKtc-Regular.otf" \
             && echo "[Docker] Noto CJK font downloaded" \
             || echo "[Docker] WARNING: CJK font setup failed, PDF may show garbled Chinese" ); \
    fi

# Default env
ENV PORT=3007
ENV NODE_ENV=production
ENV DB_PATH=/app/data/system.db
ENV UPLOAD_DIR=/app/uploads

EXPOSE 3007

CMD ["node", "server.js"]
