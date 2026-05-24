# Custom browser-pool image — adds noVNC live takeover on top of browserless.
#
# Why this exists:
#   The upstream ghcr.io/browserless/chromium image starts Xvfb with
#   `-nolisten tcp -nolisten unix`, so no sidecar can attach a VNC server
#   to its display. ENABLE_LIVE=true on the upstream image is also a no-op
#   in the open-source build — `/live` is a Browserless Cloud feature.
#
#   This image patches Xvfb to expose its Unix socket, adds x11vnc +
#   websockify + noVNC, and a tiny Node auth-proxy that gates `/live`
#   and `/websockify` on the ranch-api JWT.
#
# Build: docker build -t ghcr.io/cleanslice/browser-pool:latest ranch/k8s/browser-pool-image
# Push:  docker push ghcr.io/cleanslice/browser-pool:latest
FROM ghcr.io/browserless/chromium:latest

USER root

# x11vnc to mirror Xvfb :99, websockify + novnc for the browser-side viewer.
# dumb-init already present in the base image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends x11vnc websockify novnc procps \
 && rm -rf /var/lib/apt/lists/*

# Auth-proxy: a single-file Node service that validates ranch-api JWTs,
# serves the noVNC client, and bridges `/websockify` to local x11vnc.
WORKDIR /usr/src/vnc
COPY package.json ./
RUN /usr/src/.nvm/versions/node/v24.15.0/bin/npm install --omit=dev --no-audit --no-fund
COPY auth-proxy.mjs ./

# Override entrypoint so Xvfb listens, x11vnc + websockify + auth-proxy
# start before browserless does.
COPY start.sh /usr/src/app/scripts/start.sh
RUN chmod +x /usr/src/app/scripts/start.sh

# Defaults — overridable in k8s. NOVNC_DIR is where the Debian package
# unpacks; pin the path here so the proxy doesn't probe for it at boot.
ENV AUTH_PROXY_PORT=7900 \
    VNC_RFB_PORT=5900 \
    WEBSOCKIFY_PORT=6080 \
    NOVNC_DIR=/usr/share/novnc

# Restore browserless's WORKDIR — its CMD invokes `./scripts/start.sh`
# relative to /usr/src/app. WORKDIR was moved to /usr/src/vnc earlier in
# this Dockerfile for the auth-proxy install; leaving it there breaks
# container init with "stat ./scripts/start.sh: no such file or directory".
WORKDIR /usr/src/app

EXPOSE 3000 7900

USER blessuser
