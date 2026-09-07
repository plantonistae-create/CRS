import { DurableObject } from "cloudflare:workers";
import legacyWorker, { CallRoom } from "./index.js";

const FILE_MAX_BYTES = 12 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const SHARD_NAMES = ["crs-exams-0", "crs-exams-1", "crs-exams-2", "crs-exams-3", "crs-exams-4"];
const SHARD_HARD_CAP = 700_000_000;
const TOTAL_HARD_CAP = SHARD_HARD_CAP * SHARD_NAMES.length;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function fileHeaders(mime, fileName, size) {
  const headers = new Headers();
  headers.set("content-type", mime || "application/octet-stream");
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName || "exame")}`);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'self'; sandbox");
  if (Number.isFinite(size)) headers.set("content-length", String(size));
  return headers;
}

function safeName(value) {
  return String(value || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .trim()
    .slice(0, 220) || "arquivo";
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function attachmentKey(shardIndex, fileId) {
  return `sqlite:v1:${shardIndex}:${fileId}`;
}

function parseAttachmentKey(value) {
  const match = String(value || "").match(/^sqlite:v1:(\d+):([A-Za-z0-9_-]{8,100})$/);
  if (!match) return null;
  const shardIndex = Number(match[1]);
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= SHARD_NAMES.length) return null;
  return { shardIndex, fileId: match[2] };
}

export class ExamStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec("PRAGMA foreign_keys = ON");
    sql.exec(`CREATE TABLE IF NOT EXISTS attachment_meta (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS attachment_chunks (
      file_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY(file_id, chunk_index),
      FOREIGN KEY(file_id) REFERENCES attachment_meta(id) ON DELETE CASCADE
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS idx_attachment_chunks_file ON attachment_chunks(file_id, chunk_index)");
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/usage") {
        return json({ bytes: Number(this.ctx.storage.sql.databaseSize || 0) });
      }

      if (request.method === "POST" && url.pathname === "/store") {
        const fileId = request.headers.get("x-crs-file-id") || "";
        if (!validId(fileId)) return json({ error: "Identificador de arquivo inválido." }, 400);
        const mime = request.headers.get("x-crs-file-mime") || "application/octet-stream";
        const fileName = safeName(decodeURIComponent(request.headers.get("x-crs-file-name") || "arquivo"));
        if (!ALLOWED_MIME.has(mime)) return json({ error: "Formato de arquivo não permitido." }, 415);
        const buffer = await request.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (!bytes.byteLength || bytes.byteLength > FILE_MAX_BYTES) return json({ error: "Arquivo deve ter até 12 MB." }, 413);
        const currentSize = Number(this.ctx.storage.sql.databaseSize || 0);
        const estimated = currentSize + Math.ceil(bytes.byteLength * 1.12) + 65_536;
        if (estimated > SHARD_HARD_CAP) return json({ error: "Este bloco de armazenamento atingiu o limite interno de segurança." }, 507);
        const chunkCount = Math.ceil(bytes.byteLength / CHUNK_BYTES);
        try {
          this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec("DELETE FROM attachment_meta WHERE id=?", fileId);
            this.ctx.storage.sql.exec(
              "INSERT INTO attachment_meta (id,file_name,mime,file_size,chunk_count,created_at) VALUES (?,?,?,?,?,?)",
              fileId, fileName, mime, bytes.byteLength, chunkCount, Date.now()
            );
            for (let index = 0; index < chunkCount; index += 1) {
              const start = index * CHUNK_BYTES;
              const end = Math.min(start + CHUNK_BYTES, bytes.byteLength);
              const chunk = bytes.slice(start, end);
              this.ctx.storage.sql.exec(
                "INSERT INTO attachment_chunks (file_id,chunk_index,data) VALUES (?,?,?)",
                fileId, index, chunk.buffer
              );
            }
          });
          await this.ctx.storage.sync();
        } catch (error) {
          if (String(error?.message || error).includes("SQLITE_FULL")) {
            return json({ error: "Armazenamento cheio. Remova anexos antigos antes de enviar novos arquivos." }, 507);
          }
          throw error;
        }
        return json({ ok: true, bytes: Number(this.ctx.storage.sql.databaseSize || 0), fileSize: bytes.byteLength }, 201);
      }

      const fileMatch = url.pathname.match(/^\/file\/([A-Za-z0-9_-]{8,100})$/);
      if (fileMatch && request.method === "GET") {
        const fileId = fileMatch[1];
        const meta = this.ctx.storage.sql.exec("SELECT * FROM attachment_meta WHERE id=?", fileId).toArray()[0];
        if (!meta) return json({ error: "Arquivo não encontrado." }, 404);
        const rows = this.ctx.storage.sql.exec("SELECT data FROM attachment_chunks WHERE file_id=? ORDER BY chunk_index ASC", fileId).toArray();
        if (rows.length !== Number(meta.chunk_count)) return json({ error: "Arquivo incompleto no armazenamento." }, 500);
        const parts = rows.map((row) => row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data).buffer);
        const blob = new Blob(parts, { type: meta.mime });
        return new Response(blob, { headers: fileHeaders(meta.mime, meta.file_name, Number(meta.file_size)) });
      }

      if (fileMatch && request.method === "DELETE") {
        this.ctx.storage.sql.exec("DELETE FROM attachment_meta WHERE id=?", fileMatch[1]);
        await this.ctx.storage.sync();
        return json({ ok: true, bytes: Number(this.ctx.storage.sql.databaseSize || 0) });
      }

      return json({ error: "Rota interna não encontrada." }, 404);
    } catch (error) {
      console.error("exam-store-error", error);
      return json({ error: "Falha no armazenamento do anexo." }, 500);
    }
  }
}

async function readSession(request, env) {
  const url = new URL("/api/auth/session", request.url);
  const response = await legacyWorker.fetch(new Request(url, { method: "GET", headers: request.headers }), env);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session?.role) return { ok: false, response };
  return { ok: true, session: data.session };
}

function mainRoom(env) {
  return env.CALL_ROOM.getByName("crs-coophavila-principal");
}

async function mainRoomJson(env, path, role, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-crs-role", role);
  const response = await mainRoom(env).fetch(new Request(`https://call-room.internal${path}`, { ...init, headers }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Falha ao acessar dados clínicos."), { status: response.status });
  return data;
}

function examShard(env, index) {
  return env.EXAM_STORE.getByName(SHARD_NAMES[index]);
}

async function shardUsage(env, index) {
  const response = await examShard(env, index).fetch(new Request("https://exam-store.internal/usage"));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha ao consultar armazenamento.");
  return Math.max(0, Number(data.bytes || 0));
}

async function allUsage(env) {
  const shardBytes = await Promise.all(SHARD_NAMES.map((_, index) => shardUsage(env, index)));
  const bytes = shardBytes.reduce((sum, value) => sum + value, 0);
  const ratio = TOTAL_HARD_CAP ? bytes / TOTAL_HARD_CAP : 0;
  let level = "ok";
  if (ratio >= 0.95) level = "critical";
  else if (ratio >= 0.85) level = "high";
  else if (ratio >= 0.70) level = "warning";
  return {
    bytes,
    limitBytes: TOTAL_HARD_CAP,
    percent: Math.min(100, Math.round(ratio * 1000) / 10),
    level,
    shardBytes,
    policy: "internal-free-safety-cap"
  };
}

async function chooseShard(env, incomingBytes) {
  const usage = await allUsage(env);
  const projectedTotal = usage.bytes + Math.ceil(incomingBytes * 1.12) + 65_536;
  if (projectedTotal > TOTAL_HARD_CAP) {
    throw Object.assign(new Error("Limite interno de armazenamento atingido. Exclua anexos antigos antes de continuar."), { status: 507 });
  }
  const candidates = usage.shardBytes
    .map((bytes, index) => ({ bytes, index }))
    .filter((item) => item.bytes + Math.ceil(incomingBytes * 1.12) + 65_536 <= SHARD_HARD_CAP)
    .sort((a, b) => a.bytes - b.bytes);
  if (!candidates.length) {
    throw Object.assign(new Error("Os blocos de armazenamento estão próximos do limite. Exclua anexos antigos."), { status: 507 });
  }
  return { index: candidates[0].index, usage };
}

async function handleStorageStatus(request, env) {
  const auth = await readSession(request, env);
  if (!auth.ok) return auth.response;
  try {
    return json(await allUsage(env));
  } catch (error) {
    console.error("storage-status-error", error);
    return json({ error: "Não foi possível consultar o uso do armazenamento." }, 500);
  }
}

async function handleUpload(request, env, patientId) {
  const auth = await readSession(request, env);
  if (!auth.ok) return auth.response;
  if (!validId(patientId)) return json({ error: "Paciente inválido." }, 400);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > FILE_MAX_BYTES + 1_000_000) return json({ error: "Arquivo acima do limite de 12 MB." }, 413);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return json({ error: "Envie PDF ou imagem pelo formulário de anexos." }, 415);

  try {
    await mainRoomJson(env, `/clinical/patients/${encodeURIComponent(patientId)}`, auth.session.role);
  } catch (error) {
    return json({ error: error.message }, error.status || 400);
  }

  let form;
  try { form = await request.formData(); }
  catch { return json({ error: "Não foi possível ler o arquivo." }, 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || typeof file.name !== "string") return json({ error: "Selecione um PDF ou imagem." }, 400);
  if (!file.size || file.size > FILE_MAX_BYTES) return json({ error: "O arquivo deve ter no máximo 12 MB após a compressão." }, 413);
  if (!ALLOWED_MIME.has(file.type)) return json({ error: "Formato não permitido. Use PDF, JPG, PNG ou WEBP." }, 415);

  const examId = crypto.randomUUID();
  const titleRaw = form.get("title");
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim().slice(0, 160) : safeName(file.name).replace(/\.[^.]+$/, "").slice(0, 160);
  let shardIndex;
  let stored = false;
  try {
    const chosen = await chooseShard(env, file.size);
    shardIndex = chosen.index;
    const bytes = await file.arrayBuffer();
    const storeResponse = await examShard(env, shardIndex).fetch(new Request("https://exam-store.internal/store", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-crs-file-id": examId,
        "x-crs-file-mime": file.type,
        "x-crs-file-name": encodeURIComponent(safeName(file.name))
      },
      body: bytes
    }));
    const storeData = await storeResponse.json().catch(() => ({}));
    if (!storeResponse.ok) return json({ error: storeData.error || "Não foi possível armazenar o arquivo." }, storeResponse.status);
    stored = true;

    const objectKey = attachmentKey(shardIndex, examId);
    const record = await mainRoomJson(env, `/clinical/patients/${encodeURIComponent(patientId)}/exams/record`, auth.session.role, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examId, title, fileName: safeName(file.name), mime: file.type, size: file.size, objectKey })
    });
    return json({ ...record, storage: await allUsage(env) }, 201);
  } catch (error) {
    if (stored && Number.isInteger(shardIndex)) {
      await examShard(env, shardIndex).fetch(new Request(`https://exam-store.internal/file/${examId}`, { method: "DELETE" })).catch(() => {});
    }
    console.error("sqlite-exam-upload-error", error);
    return json({ error: error.message || "Não foi possível salvar o arquivo." }, error.status || 500);
  }
}

async function handleDownload(request, env, examId) {
  const auth = await readSession(request, env);
  if (!auth.ok) return auth.response;
  if (!validId(examId)) return json({ error: "Exame inválido." }, 400);
  try {
    const meta = await mainRoomJson(env, `/clinical/exams/${encodeURIComponent(examId)}`, auth.session.role);
    const parsed = parseAttachmentKey(meta.objectKey);
    if (!parsed) return legacyWorker.fetch(request, env);
    const response = await examShard(env, parsed.shardIndex).fetch(new Request(`https://exam-store.internal/file/${parsed.fileId}`));
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return json({ error: data.error || "Arquivo não encontrado." }, response.status);
    }
    const headers = fileHeaders(meta.exam?.mime || response.headers.get("content-type"), meta.exam?.fileName || "exame", Number(meta.exam?.size || 0));
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    return json({ error: error.message || "Não foi possível abrir o arquivo." }, error.status || 500);
  }
}

export { CallRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, storage: "durable-object-sqlite", realtime: "websocket", attachments: "sqlite-do-chunked" });
    }
    if (request.method === "GET" && url.pathname === "/api/clinical/storage") return handleStorageStatus(request, env);
    const uploadMatch = url.pathname.match(/^\/api\/clinical\/patients\/([^/]+)\/exams\/file$/);
    if (request.method === "POST" && uploadMatch) return handleUpload(request, env, uploadMatch[1]);
    const downloadMatch = url.pathname.match(/^\/api\/clinical\/exams\/([^/]+)\/file$/);
    if (request.method === "GET" && downloadMatch) return handleDownload(request, env, downloadMatch[1]);
    return legacyWorker.fetch(request, env);
  }
};
