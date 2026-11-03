# Panel podgladu (read-only) jako serwis w docker-compose. Klucz API i adresy upstreamu przychodza ze srodowiska
# (CERBER_* w docker-compose.yml). Brak zaleznosci npm: tylko wbudowane moduly Node 24.
FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
USER node
EXPOSE 8765
CMD ["node", "server.mjs"]
