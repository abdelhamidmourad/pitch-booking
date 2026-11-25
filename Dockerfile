FROM node:22-slim
WORKDIR /app
COPY backend ./backend
COPY dashboard ./dashboard
COPY web ./web
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/data.db TRUST_PROXY=1
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/server.js"]
