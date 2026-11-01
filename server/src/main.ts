import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const cors = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);

const { http } = buildApp({ logger: true, corsOrigin: cors });
http.listen({ port, host }).catch((e) => {
  http.log.error(e);
  process.exit(1);
});
