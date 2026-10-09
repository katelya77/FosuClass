ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /collector
COPY tools/fosu-sync-client/package.json tools/fosu-sync-client/package-lock.json ./tools/fosu-sync-client/
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix tools/fosu-sync-client ci --omit=dev --ignore-scripts && npm --prefix server ci --omit=dev --ignore-scripts
COPY tools/wyz-schedule-collector ./tools/wyz-schedule-collector
COPY tools/fosu-sync-client/*.js ./tools/fosu-sync-client/
COPY server/src ./server/src
COPY server/config ./server/config
COPY shared ./shared
COPY config/terms ./config/terms
COPY miniprogram/utils/courseWeekRules.js ./miniprogram/utils/courseWeekRules.js
CMD ["node", "tools/wyz-schedule-collector/browser-smoke.js"]
