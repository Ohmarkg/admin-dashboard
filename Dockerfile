# Dev container: bun + JRE (the Firebase emulators require Java) + firebase-tools.
# No secrets baked in — everything runs against the Emulator Suite (REBUILD_CONCEPT §9.1).
FROM oven/bun:1.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends default-jre-headless curl \
    && rm -rf /var/lib/apt/lists/*

# firebase-tools needs Node; oven/bun images don't ship it.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g firebase-tools

WORKDIR /workspace

# The repo is bind-mounted at runtime (docker-compose.yml); dependencies are
# installed on container start so the mount doesn't shadow node_modules.
EXPOSE 3000 4000 8080 9099 9199
