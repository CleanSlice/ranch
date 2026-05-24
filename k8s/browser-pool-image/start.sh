#!/bin/bash
# Custom start.sh for browser-pool with live noVNC takeover.
#
# Differs from upstream browserless start.sh in two ways:
#   1. Xvfb runs WITHOUT -nolisten flags, so x11vnc in this same container
#      can connect via the standard /tmp/.X11-unix/X99 socket.
#   2. We boot four extra processes alongside `node build/index.js`:
#        - x11vnc          mirrors Xvfb :99 to RFB on $VNC_RFB_PORT
#        - websockify      bridges RFB to WS on $WEBSOCKIFY_PORT
#        - auth-proxy.mjs  gates /live + /websockify with the ranch-api JWT
#      Browserless itself is unmodified.
#
# Process death cascade: any of the five backgrounded processes exiting
# terminates the container so k8s reschedules it. We rely on `wait -n`
# rather than supervisord to keep the image small and avoid hiding crashes.
set -e

[ -f /tmp/.X99-lock ] && rm -f /tmp/.X99-lock

if [ -z "$DISPLAY" ]; then
  Xvfb :99 -screen 0 1280x800x24 +extension RANDR >/dev/null 2>&1 &
  xvfb=$!
  export DISPLAY=:99
fi

# x11vnc needs the X server up before it can attach. We give Xvfb a brief
# window to create /tmp/.X11-unix/X99; the loop bails after 5s so a broken
# Xvfb start surfaces as a container crash, not a silent hang.
for _ in 1 2 3 4 5; do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 1
done

x11vnc -display :99 -shared -forever -nopw -bg -rfbport "${VNC_RFB_PORT:-5900}" \
       -quiet -ncache 0 -noxdamage -repeat
websockify --web="${NOVNC_DIR:-/usr/share/novnc}" \
           "${WEBSOCKIFY_PORT:-6080}" "127.0.0.1:${VNC_RFB_PORT:-5900}" \
           >/tmp/websockify.log 2>&1 &
ws=$!

/usr/src/.nvm/versions/node/v24.15.0/bin/node /usr/src/vnc/auth-proxy.mjs &
proxy=$!

dumb-init -- /usr/src/.nvm/versions/node/v24.15.0/bin/node build/index.js "$@" &
node=$!

_forward_term() {
  kill -TERM "$node" "$proxy" "$ws" 2>/dev/null || true
}
trap _forward_term SIGTERM SIGINT

# Exit when any critical child dies — k8s restarts the pod.
set +e
wait -n "$node" "$proxy" "$ws"
rc=$?
kill -TERM "$node" "$proxy" "$ws" 2>/dev/null || true
wait 2>/dev/null
set -e

if [ -n "$xvfb" ]; then
  kill -TERM "$xvfb" 2>/dev/null || true
  wait "$xvfb" 2>/dev/null || true
fi

exit "$rc"
