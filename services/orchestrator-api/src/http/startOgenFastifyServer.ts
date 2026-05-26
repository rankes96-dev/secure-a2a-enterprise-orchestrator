import { createOgenFastifyApp } from "./createOgenFastifyApp.js";

export async function startOgenFastifyServer(port: number, host = process.env.HOST ?? "127.0.0.1"): Promise<void> {
  const app = await createOgenFastifyApp();
  await app.listen({ port, host });
  console.log(`Listening with Fastify on http://${host}:${port}`);
}
