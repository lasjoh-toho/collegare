import { buildApp } from './app.js';
import { configFromEnv, createServices } from './services.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const cors = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);

const services = await createServices(configFromEnv());
const { http } = await buildApp({ logger: true, corsOrigin: cors, services, spike: process.env.SPIKE === '1',
  clientDir: process.env.CLIENT_DIR ?? '../client/out',
  officeDir: process.env.OFFICE_DIR ?? '../web/out',
});

// abgelaufene Sitzungen, Codes und LTI-Zustände stündlich aufräumen
setInterval(() => void services.sessions.cleanup().catch((e) => http.log.warn(e)), 3_600_000).unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void http.close().then(() => process.exit(0));
  });
}

http.listen({ port, host }).catch((e) => {
  http.log.error(e);
  process.exit(1);
});
