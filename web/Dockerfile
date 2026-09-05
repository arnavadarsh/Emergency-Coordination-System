# Builds all four dashboards and serves them from one nginx image:
#
#   /           user dashboard  (also hosts sign-in and the public /track page)
#   /admin/     admin dashboard
#   /driver/    driver dashboard
#   /hospital/  hospital dashboard
#
# Build context is the PROJECT ROOT, so this file can reach both web/ and
# deploy/:  docker build -f web/Dockerfile .
#
# Vite inlines VITE_* values at BUILD time, so they arrive as build args. A
# rebuild is required to point the bundles at a different backend.

FROM node:20-alpine AS build

ARG VITE_API_URL=http://localhost:3000/api
ARG VITE_SOCKET_URL=http://localhost:3000
ARG VITE_LOGIN_URL=http://localhost:3001
ARG VITE_HOSPITAL_APP_URL=http://localhost:3001/hospital
ARG VITE_DRIVER_APP_URL=http://localhost:3001/driver
ARG VITE_ADMIN_APP_URL=http://localhost:3001/admin

ENV VITE_API_URL=$VITE_API_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_LOGIN_URL=$VITE_LOGIN_URL \
    VITE_HOSPITAL_APP_URL=$VITE_HOSPITAL_APP_URL \
    VITE_DRIVER_APP_URL=$VITE_DRIVER_APP_URL \
    VITE_ADMIN_APP_URL=$VITE_ADMIN_APP_URL

WORKDIR /build

# Each app is installed separately so one app's dependency change does not
# invalidate the others' cached layers.
COPY web/user-dashboard/package*.json ./user-dashboard/
RUN cd user-dashboard && npm ci
COPY web/admin-dashboard/package*.json ./admin-dashboard/
RUN cd admin-dashboard && npm ci
COPY web/driver-dashboard/package*.json ./driver-dashboard/
RUN cd driver-dashboard && npm ci
COPY web/hospital-dashboard/package*.json ./hospital-dashboard/
RUN cd hospital-dashboard && npm ci

COPY web/user-dashboard ./user-dashboard
COPY web/admin-dashboard ./admin-dashboard
COPY web/driver-dashboard ./driver-dashboard
COPY web/hospital-dashboard ./hospital-dashboard

RUN cd user-dashboard     && BASE_PATH=/          npm run build
RUN cd admin-dashboard    && BASE_PATH=/admin/    npm run build
RUN cd driver-dashboard   && BASE_PATH=/driver/   npm run build
RUN cd hospital-dashboard && BASE_PATH=/hospital/ npm run build


FROM nginx:1.27-alpine AS runtime

COPY --from=build /build/user-dashboard/dist     /usr/share/nginx/html
COPY --from=build /build/admin-dashboard/dist    /usr/share/nginx/html/admin
COPY --from=build /build/driver-dashboard/dist   /usr/share/nginx/html/driver
COPY --from=build /build/hospital-dashboard/dist /usr/share/nginx/html/hospital

# The config is rendered at start, not baked in: the listen port and whether to
# proxy the API both depend on where this runs. See the script for why.
COPY deploy/nginx.conf.template deploy/nginx-proxy.partial /etc/nginx/ecs/
COPY deploy/30-render-nginx-conf.sh /docker-entrypoint.d/30-render-nginx-conf.sh
RUN chmod +x /docker-entrypoint.d/30-render-nginx-conf.sh \
 && rm -f /etc/nginx/conf.d/default.conf

# Documentation only — the platform decides the real port via $PORT.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-80}/healthz" || exit 1
