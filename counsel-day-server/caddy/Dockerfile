# counsel-day-server/caddy/Dockerfile
#
# Custom Caddy build that includes the Cloudflare DNS provider plugin
# for the ACME DNS-01 challenge. Without this plugin, Caddy can only do
# the HTTP-01 challenge, which fails for hosts behind Cloudflare's proxy
# and is unsuitable for vault.counsel.day (which is DNS-only, not proxied).
#
# Built with:
#   docker build -t caddy-cloudflare:latest .
#
# Build stage uses the xcaddy builder image to produce a custom binary
# with the plugin baked in. Runtime stage is the standard caddy image
# with our binary swapped in.

ARG CADDY_VERSION=2.8.4

FROM caddy:${CADDY_VERSION}-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:${CADDY_VERSION}

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Health-check: the admin endpoint on 2019 is the canonical "is caddy alive" probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:2019/config/ || exit 1
