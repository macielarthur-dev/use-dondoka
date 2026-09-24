FROM node:22-alpine
WORKDIR /app
COPY server.js index.html style.css logo.png ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
