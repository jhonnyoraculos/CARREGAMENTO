# PWA de Conferência de Carregamento (Volume + Slot via QR)

Next.js + IndexedDB (Dexie) + QR (html5-qrcode). Funciona offline (PWA + service worker) e permite operar por digitação caso a câmera seja bloqueada.

## Rodar em LAN (Windows)
1. Instale dependências (uma vez):  
   `npm install --ignore-scripts`
2. Dev ouvindo em 0.0.0.0 (porta 3000):  
   `npm run dev:lan`
3. No PC, descubra o IP: `ipconfig` (use o IPv4 da sua placa Wi‑Fi/LAN, ex.: 192.168.0.10).
4. No celular (mesma rede Wi‑Fi), abra: `http://SEU_IP:3000` (ou o link mostrado na tela “Abrir no celular”).
5. Se o navegador do celular bloquear a câmera, use os campos “Digitar volume/slot”.

Portas no firewall: libere 3000 (dev) ou 443 (quando usar proxy HTTPS). Em “Firewall do Windows” → “Permitir app pela Parede de Fogo” ou “Regras de Entrada” criando regra para a porta.

## Build e start (produção em LAN)
```
npm run build
npm run start:lan   # escuta 0.0.0.0:3000
```

## HTTPS na LAN (câmera no celular exige HTTPS)
O navegador móvel normalmente exige HTTPS para acessar a câmera. Duas opções:

### Solução A (recomendada): Proxy HTTPS (Caddy)
1. Instale Caddy (binário para Windows).  
2. Gere certificado local (mkcert é o mais prático):  
   - Instale mkcert: https://github.com/FiloSottile/mkcert  
   - `mkcert -install` (gera CA e instala no Windows)  
   - `mkcert 192.168.0.10 localhost` (ajuste para seu IP) → produz `192.168.0.10+2.pem` e `192.168.0.10+2-key.pem`
3. Crie `Caddyfile` (na raiz do projeto ou outra pasta):
   ```
   :443 {
     tls 192.168.0.10+2.pem 192.168.0.10+2-key.pem
     reverse_proxy http://127.0.0.1:3000
   }
   ```
4. Rode Next em HTTP (porta 3000): `npm run dev:lan` ou `npm run start:lan`
5. Inicie Caddy: `caddy run --config Caddyfile`
6. No celular, abra `https://192.168.0.10` (aceite/instale o certificado se necessário).
7. No Android, se pedir confiança no certificado: instale a CA criada pelo mkcert (arquivo `.pem` da CA) em “Certificados de usuário”.

### Solução B: HTTPS direto no Node
1. Gere certificado com mkcert ou OpenSSL (mesmo passo acima). Exemplo OpenSSL:  
   `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout local-key.pem -out local-cert.pem`
2. Crie um servidor custom (ex.: `server-https.js`):
   ```js
   import { createServer } from "https";
   import { readFileSync } from "fs";
   import next from "next";

   const dev = process.env.NODE_ENV !== "production";
   const app = next({ dev, hostname: "0.0.0.0", port: 3000 });
   const handle = app.getRequestHandler();

   app.prepare().then(() => {
     createServer(
       {
         key: readFileSync("local-key.pem"),
         cert: readFileSync("local-cert.pem"),
       },
       (req, res) => handle(req, res)
     ).listen(3000, "0.0.0.0", () => {
       console.log("HTTPS on https://0.0.0.0:3000");
     });
   });
   ```
3. Rode: `node server-https.js`
4. No Android, instale/aceite a CA/certificado igual ao passo da solução A.

## PWA / Offline
- Manifesto: `public/manifest.webmanifest`
- Service Worker: `public/sw.js` (cache básico das rotas estáticas)
- IndexedDB (Dexie) para dados offline
- Instale como app: no Chrome mobile → menu “Adicionar à tela inicial”.

## Funcionalidades do MVP (web)
- Usuário local (lista + criar).
- Viagens (criar/selecionar).
- Slots (cadastrar lista, exibir para gerar QR externo).
- Volumes planejados por viagem.
- Carregamento: escanear volume → escanear slot → salva evento com usuário + timestamp (ou digitar ambos).
- Consulta: escanear/digitar volume → mostra slot atual + histórico.
- Resumo: planejado vs carregado, faltantes, duplicados, não planejados.
- Botão “Abrir no celular” exibe/ajuda a montar o link LAN.
- Modo “digitar códigos” sempre disponível se a câmera falhar/for bloqueada.

## Scripts úteis
- `npm run dev:lan` — desenvolvimento escutando 0.0.0.0:3000.
- `npm run start:lan` — produção escutando 0.0.0.0:3000 (depois de `npm run build`).
- `npm run lint` — lint.

## Observações
- Câmera no celular: só funciona em HTTPS. Sem HTTPS, use “Digitar volume/slot”.
- Rede: PC e celular na mesma rede Wi‑Fi; se houver VPN, confirme o IP correto.
- Firewall: libere porta 3000 (HTTP) ou 443 (proxy HTTPS).
- Ícones: o manifest usa um SVG simples (`/next.svg`); substitua por ícones próprios se quiser uma instalação PWA com ícone personalizado.

## Seed de dados
Na primeira execução são criados: 2 usuários demo, 1 viagem “Viagem Demo”, slots A1..B2, volumes VOL-001..003 e 1 evento carregado (VOL-001 em A1). Isso ajuda a testar offline.
