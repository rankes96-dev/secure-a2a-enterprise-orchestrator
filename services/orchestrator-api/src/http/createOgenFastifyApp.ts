import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { registerPublicMetadataRoutes } from "./routes/registerPublicMetadataRoutes.js";

const defaultMaxBodyBytes = 64 * 1024;

function maxBodyBytes(): number {
  const configured = Number(process.env.MAX_BODY_BYTES ?? defaultMaxBodyBytes);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultMaxBodyBytes;
}

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function safeErrorMessage(error: Error): string {
  if (process.env.NODE_ENV === "production") {
    return "Unexpected server error";
  }

  return error.message || "Unexpected server error";
}

export async function createOgenFastifyApp(): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: maxBodyBytes(),
    genReqId: (request) => {
      const existing = request.headers["x-request-id"];
      return typeof existing === "string" && existing.trim() ? existing : randomUUID();
    }
  });

  await app.register(cors, {
    origin: allowedOrigins(),
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-api-key", "x-internal-service-token", "authorization", "x-ogen-csrf-token"]
  });
  await app.register(cookie);

  app.setErrorHandler((error, request, reply) => {
    const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
    const errorCode = statusCode === 500 ? "internal_server_error" : "request_error";

    void reply.status(statusCode).send({
      error: errorCode,
      message: statusCode === 500 ? safeErrorMessage(error) : error.message,
      requestId: request.id
    });
  });

  await registerPublicMetadataRoutes(app);

  return app;
}
