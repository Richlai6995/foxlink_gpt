# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app/client

# Install deps first (layer cache)
COPY client/package*.json ./
RUN npm install

# Build Vite/React app
COPY client ./
# Pre-create dist dir — Vite 6.x prepareOutDir fails with ENOENT if dist doesn't exist
RUN mkdir -p dist && npx vite build


# ─── Stage 2: Production Server ───────────────────────────────────────────────
# Use node:20-slim (Debian) — Alpine does NOT support Oracle Instant Client (needs libaio1)
FROM node:20-slim AS runner

# Install Oracle Client dependency + utilities
# node:20-slim = Debian Bookworm (glibc 2.36) → libaio1t64 (not libaio1)
# LibreOffice impress = .ppt → .pptx conversion (for legacy Office support)
#   headless-only 子集：core + impress；不裝 writer/calc（.doc 走 word-extractor pure JS、
#   .xls 靠 xlsx lib 已能讀）。整體增加約 ~250MB。
# python3 + pip:給 PDF → DOCX skill 用(pdf2docx + PyMuPDF)。約 +400MB。
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata fontconfig \
    && (apt-get install -y --no-install-recommends libaio1t64 2>/dev/null \
        || apt-get install -y --no-install-recommends libaio1) \
    && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-core \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Python venv for PDF workers
# 用 venv 不踩 Debian Bookworm 的 PEP 668(EXTERNALLY-MANAGED)限制,
# 且把 pip 套件鎖在 /opt/pdf-venv 不污染 system python。
ENV PDF_VENV=/opt/pdf-venv
ENV PDF_PYTHON=${PDF_VENV}/bin/python3
RUN python3 -m venv ${PDF_VENV} \
    && ${PDF_PYTHON} -m pip install --no-cache-dir --upgrade pip

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

# Install Python deps for pdf workers
# 先單獨 COPY requirements.txt 拿 layer cache;requirements 不變就不會重跑 pip install。
COPY server/python_workers/requirements.txt /tmp/pdf_workers_requirements.txt
RUN ${PDF_PYTHON} -m pip install --no-cache-dir -r /tmp/pdf_workers_requirements.txt \
    && rm /tmp/pdf_workers_requirements.txt

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

# Build-time version(同 image 所有 pod 共用,避免 K8s 多 pod 環境下 /api/version
# 因 HOSTNAME 不同各回不一樣,造成 client 一直彈「新版本」toast)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Build-time date — scheduler 啟動時用來擋老 image 偷跑排程(>30 天 refuse)
# 配 [scheduledTaskService.js initScheduler] 的 startup gate
# 2026-06-01 ghost container 事故根因:2 個月前的 docker-compose 還在打 prod DB
ARG BUILD_DATE=1970-01-01
ENV BUILD_DATE=${BUILD_DATE}

EXPOSE 3007

CMD ["node", "server.js"]
