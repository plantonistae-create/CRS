import { DurableObject } from "cloudflare:workers";

class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_DEVICE_MAX_ATTEMPTS = 20;
const LOGIN_ADDRESS_MAX_ATTEMPTS = 100;
const COOKIE_NAME = "crs_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PRESCRIPTION_MAX_BYTES = 1_500_000;
const JSON_MAX_BYTES = 1_750_000;
const FILE_MAX_BYTES = 12 * 1024 * 1024;
const encoder = new TextEncoder();

function rejectUnsafeText(value) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127 || (code >= 8234 && code <= 8238) || (code >= 8294 && code <= 8297)) {
      throw new DomainError("O texto contém caracteres não permitidos.");
    }
  }
}
function normalizePatientName(value) {
  if (typeof value !== "string") throw new DomainError("Informe o nome do paciente.");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 120) throw new DomainError("O nome deve ter entre 2 e 120 caracteres.");
  rejectUnsafeText(normalized);
  return normalized;
}
function normalizeRoom(value) {
  if (typeof value !== "string") throw new DomainError("Informe o número do consultório.");
  const normalized = value.trim();
  if (!/^\d{1,4}$/.test(normalized) || Number(normalized) === 0) throw new DomainError("Informe um número de consultório entre 1 e 9999.");
  return normalized;
}
function normalizeOptionalText(value, max, field = "texto") {
  if (value == null) return "";
  if (typeof value !== "string") throw new DomainError(`Formato inválido em ${field}.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new DomainError(`${field} excede o limite permitido.`);
  rejectUnsafeText(normalized);
  return normalized;
}
function normalizeId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new DomainError("Identificador inválido.");
  return value;
}
function normalizeSector(value, required = false) {
  const allowed = new Set(["emergencia", "infantil", "feminina", "masculina"]);
  if (!value && !required) return null;
  if (!allowed.has(value)) throw new DomainError("Setor inválido.");
  return value;
}
function normalizeDestination(value) {
  const allowed = new Set(["salvar", "reavaliacao", "censo", "alta"]);
  if (!allowed.has(value)) throw new DomainError("Destino do paciente inválido.");
  return value;
}
function finalStatusForAction(action) {
  if (action === "absent") return "absent";
  if (action === "finish") return "completed";
  throw new DomainError("Ação inválida.", 404);
}
function ensureActive(call) {
  if (!call) throw new DomainError("Chamada não encontrada.", 404);
  if (call.status !== "calling") throw new DomainError("Esta chamada já foi encerrada.", 409);
  return call;
}
function jsonDo(data, status = 200) {
  return Response.json(data, { status });
}
function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function mapEvent(row) {
  return {
    id: row.id,
    callId: row.call_id,
    type: row.event_type,
    callNumber: row.call_number,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorRole: row.actor_role
  };
}
function mapCall(row, events = []) {
  return {
    id: row.id,
    patientName: row.patient_name,
    room: row.room,
    status: row.status,
    finalStatus: row.final_status,
    callCount: row.call_count,
    createdAt: new Date(row.created_at).toISOString(),
    firstCalledAt: new Date(row.first_called_at).toISOString(),
    lastCalledAt: new Date(row.last_called_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    events
  };
}
function publicCall(call) {
  return {
    id: call.id,
    patientName: call.patientName,
    room: call.room,
    callCount: call.callCount,
    firstCalledAt: call.firstCalledAt,
    lastCalledAt: call.lastCalledAt
  };
}
function mapPatient(row) {
  return {
    id: row.id,
    name: row.patient_name,
    age: row.age || "",
    sex: row.sex || "",
    caseSummary: row.case_summary || "",
    pending: row.pending || "",
    status: row.status,
    sector: row.sector,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    reviewAt: row.review_at ? new Date(row.review_at).toISOString() : null,
    censusAt: row.census_at ? new Date(row.census_at).toISOString() : null,
    dischargeAt: row.discharge_at ? new Date(row.discharge_at).toISOString() : null,
    lastPrescriptionAt: row.last_prescription_at ? new Date(row.last_prescription_at).toISOString() : null,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  };
}
function mapPrescription(row, includeSnapshot = false) {
  const result = {
    id: row.id,
    patientId: row.patient_id,
    createdAt: new Date(row.created_at).toISOString(),
    actorRole: row.actor_role,
    destination: row.destination,
    sector: row.sector,
    previewText: row.preview_text || ""
  };
  if (includeSnapshot) result.snapshot = safeJsonParse(row.snapshot_json, {});
  return result;
}
function mapExam(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    kind: row.kind,
    title: row.title,
    text: row.text_result || "",
    fileName: row.file_name || "",
    mime: row.mime || "",
    size: Number(row.file_size || 0),
    hasFile: !!row.object_key,
    createdAt: new Date(row.created_at).toISOString(),
    actorRole: row.actor_role
  };
}

export class CallRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec("PRAGMA foreign_keys = ON");
    sql.exec(`CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      room TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('calling', 'absent', 'completed')),
      final_status TEXT CHECK (final_status IS NULL OR final_status IN ('absent', 'completed')),
      call_count INTEGER NOT NULL CHECK (call_count >= 1),
      created_at INTEGER NOT NULL,
      first_called_at INTEGER NOT NULL,
      last_called_at INTEGER NOT NULL,
      last_event_id INTEGER NOT NULL DEFAULT 0,
      finished_at INTEGER
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS call_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('called', 'recalled', 'absent', 'completed')),
      call_number INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'doctor')),
      FOREIGN KEY (call_id) REFERENCES calls(id)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS login_limits (
      key_hash TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0
    )`);

    sql.exec(`CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      age TEXT NOT NULL DEFAULT '',
      sex TEXT NOT NULL DEFAULT '',
      case_summary TEXT NOT NULL DEFAULT '',
      pending TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('prescricao','reavaliacao','censo','alta')),
      sector TEXT CHECK (sector IS NULL OR sector IN ('emergencia','infantil','feminina','masculina')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      review_at INTEGER,
      census_at INTEGER,
      discharge_at INTEGER,
      last_prescription_at INTEGER,
      created_by TEXT NOT NULL CHECK (created_by IN ('admin','doctor')),
      updated_by TEXT NOT NULL CHECK (updated_by IN ('admin','doctor'))
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('admin','doctor')),
      destination TEXT NOT NULL CHECK (destination IN ('salvar','reavaliacao','censo','alta')),
      sector TEXT,
      preview_text TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('manual','file')),
      title TEXT NOT NULL,
      text_result TEXT NOT NULL DEFAULT '',
      object_key TEXT,
      file_name TEXT,
      mime TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('admin','doctor')),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS clinical_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      occurred_at INTEGER NOT NULL,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('admin','doctor')),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`);

    const cols = sql.exec("PRAGMA table_info(calls)").toArray();
    if (!cols.some((column) => column.name === "last_event_id")) {
      sql.exec("ALTER TABLE calls ADD COLUMN last_event_id INTEGER NOT NULL DEFAULT 0");
      sql.exec(`UPDATE calls SET last_event_id = COALESCE((SELECT MAX(id) FROM call_events WHERE call_id = calls.id), 0)`);
    }
    sql.exec("CREATE INDEX IF NOT EXISTS idx_calls_status_last_called ON calls(status, last_called_at DESC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_calls_status_last_event ON calls(status, last_event_id DESC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_call_events_call_time ON call_events(call_id, occurred_at ASC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_patients_status_sector ON patients(status, sector, updated_at DESC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_time ON prescriptions(patient_id, created_at DESC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_exams_patient_time ON exams(patient_id, created_at DESC)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_clinical_events_patient_time ON clinical_events(patient_id, occurred_at DESC)");
    sql.exec("PRAGMA optimize");
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/realtime") return this.connectWebSocket(request);
      if (request.method === "POST" && url.pathname === "/login-attempt") return this.recordLoginAttempt(request);
      if (request.method === "POST" && url.pathname === "/login-success") return this.clearLoginAttempts(request);
      if (request.method === "GET" && url.pathname === "/public-state") return jsonDo(this.publicSnapshot());
      if (request.method === "GET" && url.pathname === "/internal-state") return jsonDo(this.internalSnapshot());
      if (request.method === "GET" && url.pathname === "/clinical-state") {
        this.roleFrom(request);
        return jsonDo(this.clinicalSnapshot());
      }
      if (request.method === "POST" && url.pathname === "/calls") return await this.createCall(request);
      const callMatch = url.pathname.match(/^\/calls\/([^/]+)\/(recall|absent|finish)$/);
      if (request.method === "POST" && callMatch) return await this.changeCall(callMatch[1], callMatch[2], request);

      if (request.method === "POST" && url.pathname === "/clinical/prescription") return await this.savePrescription(request);
      if (request.method === "POST" && url.pathname === "/clinical/patients") return await this.createManualPatient(request);
      const patientGet = url.pathname.match(/^\/clinical\/patients\/([^/]+)$/);
      if (request.method === "GET" && patientGet) return this.getPatientDetailsResponse(patientGet[1], request);
      const patientUpdate = url.pathname.match(/^\/clinical\/patients\/([^/]+)\/update$/);
      if (request.method === "POST" && patientUpdate) return await this.updatePatient(patientUpdate[1], request);
      const patientDestination = url.pathname.match(/^\/clinical\/patients\/([^/]+)\/destination$/);
      if (request.method === "POST" && patientDestination) return await this.changePatientDestination(patientDestination[1], request);
      const examManual = url.pathname.match(/^\/clinical\/patients\/([^/]+)\/exams\/manual$/);
      if (request.method === "POST" && examManual) return await this.addManualExam(examManual[1], request);
      const examRecord = url.pathname.match(/^\/clinical\/patients\/([^/]+)\/exams\/record$/);
      if (request.method === "POST" && examRecord) return await this.recordFileExam(examRecord[1], request);
      const examGet = url.pathname.match(/^\/clinical\/exams\/([^/]+)$/);
      if (request.method === "GET" && examGet) return this.getExamMetadata(examGet[1], request);
      const prescGet = url.pathname.match(/^\/clinical\/prescriptions\/([^/]+)$/);
      if (request.method === "GET" && prescGet) return this.getPrescriptionResponse(prescGet[1], request);

      throw new DomainError("Rota não encontrada.", 404);
    } catch (error) {
      if (error instanceof DomainError) return jsonDo({ error: error.message }, error.status);
      console.error("call-room-error", error);
      return jsonDo({ error: "Não foi possível concluir a operação." }, 500);
    }
  }

  roleFrom(request) {
    const role = request.headers.get("x-crs-role");
    if (role !== "admin" && role !== "doctor") throw new DomainError("Acesso não autorizado.", 401);
    return role;
  }
  clientKeyFrom(request) {
    const key = request.headers.get("x-crs-client-key") ?? "";
    if (!/^[a-f0-9]{64}$/.test(key)) throw new DomainError("Identificador de acesso inválido.", 400);
    return key;
  }
  maxAttemptsFrom(request) {
    return request.headers.get("x-crs-max-attempts") === String(LOGIN_ADDRESS_MAX_ATTEMPTS) ? LOGIN_ADDRESS_MAX_ATTEMPTS : LOGIN_DEVICE_MAX_ATTEMPTS;
  }
  recordLoginAttempt(request) {
    const key = this.clientKeyFrom(request);
    const maxAttempts = this.maxAttemptsFrom(request);
    const now = Date.now();
    const current = this.ctx.storage.sql.exec("SELECT * FROM login_limits WHERE key_hash = ?", key).toArray()[0];
    if (current?.blocked_until && current.blocked_until > now) return jsonDo({ allowed: false, retryAfter: Math.ceil((current.blocked_until - now) / 1000) }, 429);
    const windowExpired = !current || now - current.window_started_at >= LOGIN_WINDOW_MS;
    const attempts = windowExpired ? 1 : current.attempts + 1;
    const blockedUntil = attempts > maxAttempts ? now + LOGIN_BLOCK_MS : 0;
    this.ctx.storage.sql.exec(`INSERT INTO login_limits (key_hash, window_started_at, attempts, blocked_until)
      VALUES (?, ?, ?, ?) ON CONFLICT(key_hash) DO UPDATE SET window_started_at=excluded.window_started_at, attempts=excluded.attempts, blocked_until=excluded.blocked_until`,
      key, windowExpired ? now : current.window_started_at, attempts, blockedUntil);
    return blockedUntil ? jsonDo({ allowed: false, retryAfter: Math.ceil(LOGIN_BLOCK_MS / 1000) }, 429) : jsonDo({ allowed: true });
  }
  clearLoginAttempts(request) {
    const key = this.clientKeyFrom(request);
    this.ctx.storage.sql.exec("DELETE FROM login_limits WHERE key_hash = ?", key);
    return jsonDo({ ok: true });
  }

  async createCall(request) {
    const role = this.roleFrom(request);
    if (role !== "doctor") throw new DomainError("Somente o perfil médico pode criar chamadas.", 403);
    const body = await this.readJson(request);
    const patientName = normalizePatientName(body.patientName);
    const room = normalizeRoom(body.room);
    const id = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`INSERT INTO calls (id,patient_name,room,status,final_status,call_count,created_at,first_called_at,last_called_at,last_event_id,finished_at)
        VALUES (?, ?, ?, 'calling', NULL, 1, ?, ?, ?, 0, NULL)`, id, patientName, room, now, now, now);
      const eventId = this.insertCallEvent(id, "called", 1, now, role);
      this.ctx.storage.sql.exec("UPDATE calls SET last_event_id = ? WHERE id = ?", eventId, id);
    });
    await this.ctx.storage.sync();
    await this.broadcastCalls();
    return jsonDo({ call: this.getCall(id) }, 201);
  }
  async changeCall(id, action, request) {
    const role = this.roleFrom(request);
    if (role !== "doctor") throw new DomainError("Somente o perfil médico pode alterar chamadas.", 403);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      const current = ensureActive(this.getDbCall(id));
      if (action === "recall") {
        this.ctx.storage.sql.exec("UPDATE calls SET call_count = call_count + 1, last_called_at = ? WHERE id = ? AND status = 'calling'", now, id);
        const updated = ensureActive(this.getDbCall(id));
        const eventId = this.insertCallEvent(id, "recalled", updated.call_count, now, role);
        this.ctx.storage.sql.exec("UPDATE calls SET last_event_id = ? WHERE id = ?", eventId, id);
        return;
      }
      const finalStatus = finalStatusForAction(action);
      this.ctx.storage.sql.exec("UPDATE calls SET status=?, final_status=?, finished_at=? WHERE id=? AND status='calling'", finalStatus, finalStatus, now, id);
      const eventId = this.insertCallEvent(id, finalStatus, current.call_count, now, role);
      this.ctx.storage.sql.exec("UPDATE calls SET last_event_id = ? WHERE id = ?", eventId, id);
    });
    await this.ctx.storage.sync();
    await this.broadcastCalls();
    return jsonDo({ call: this.getCall(id) });
  }
  insertCallEvent(callId, type, callNumber, occurredAt, role) {
    this.ctx.storage.sql.exec("INSERT INTO call_events (call_id,event_type,call_number,occurred_at,actor_role) VALUES (?,?,?,?,?)", callId, type, callNumber, occurredAt, role);
    return Number(this.ctx.storage.sql.exec("SELECT last_insert_rowid() AS id").one().id);
  }
  getDbCall(id) { return this.ctx.storage.sql.exec("SELECT * FROM calls WHERE id = ?", id).toArray()[0]; }
  getCall(id) {
    const row = this.getDbCall(id);
    if (!row) return null;
    return mapCall(row, this.ctx.storage.sql.exec("SELECT * FROM call_events WHERE call_id=? ORDER BY occurred_at ASC,id ASC", id).toArray().map(mapEvent));
  }
  recentCalls(limit = 100) {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM calls ORDER BY last_event_id DESC, created_at DESC LIMIT ?", limit).toArray();
    if (!rows.length) return [];
    const eventsByCall = new Map();
    for (const event of this.ctx.storage.sql.exec(`SELECT call_events.* FROM call_events
      INNER JOIN (SELECT id FROM calls ORDER BY last_event_id DESC, created_at DESC LIMIT ?) recent_calls ON recent_calls.id=call_events.call_id
      ORDER BY call_events.id ASC`, limit).toArray()) {
      const events = eventsByCall.get(event.call_id) ?? [];
      events.push(mapEvent(event));
      eventsByCall.set(event.call_id, events);
    }
    return rows.map((row) => mapCall(row, eventsByCall.get(row.id) ?? []));
  }
  publicSnapshot() {
    const calls = this.ctx.storage.sql.exec("SELECT * FROM calls WHERE status='calling' ORDER BY last_event_id DESC,last_called_at DESC LIMIT 8").toArray().map((row) => publicCall(mapCall(row)));
    return { current: calls[0] ?? null, recent: calls.slice(1), updatedAt: new Date().toISOString() };
  }
  internalSnapshot() {
    const recent = this.recentCalls();
    const since = Date.now() - 86_400_000;
    const stats = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN final_status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN final_status='absent' THEN 1 ELSE 0 END) AS absent FROM calls WHERE created_at>=?`, since).toArray()[0] ?? {};
    return {
      active: recent.filter((call) => call.status === "calling"),
      recent,
      stats: {
        active: recent.filter((call) => call.status === "calling").length,
        total24h: Number(stats.total ?? 0),
        completed24h: Number(stats.completed ?? 0),
        absent24h: Number(stats.absent ?? 0)
      },
      updatedAt: new Date().toISOString()
    };
  }

  clinicalSnapshot() {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM patients WHERE status IN ('censo','reavaliacao') ORDER BY updated_at DESC").toArray();
    const patients = rows.map(mapPatient);
    const censo = patients.filter((p) => p.status === "censo");
    const reavaliacao = patients.filter((p) => p.status === "reavaliacao");
    const sectors = { emergencia: 0, infantil: 0, feminina: 0, masculina: 0 };
    for (const p of censo) if (p.sector in sectors) sectors[p.sector] += 1;
    return {
      patients,
      counts: { total: patients.length, censo: censo.length, reavaliacao: reavaliacao.length, sectors },
      updatedAt: new Date().toISOString()
    };
  }
  patientRow(id) { return this.ctx.storage.sql.exec("SELECT * FROM patients WHERE id=?", id).toArray()[0]; }
  ensurePatient(id) {
    const row = this.patientRow(id);
    if (!row) throw new DomainError("Paciente não encontrado.", 404);
    return row;
  }
  insertClinicalEvent(patientId, type, payload, role, now = Date.now()) {
    const raw = JSON.stringify(payload ?? {});
    this.ctx.storage.sql.exec("INSERT INTO clinical_events (patient_id,event_type,payload_json,occurred_at,actor_role) VALUES (?,?,?,?,?)", patientId, type, raw.slice(0, 50_000), now, role);
  }
  upsertPatient({ id, name, age, sex, caseSummary, pending, status, sector, role, now }) {
    const current = this.patientRow(id);
    const cleanName = normalizePatientName(name);
    const cleanAge = normalizeOptionalText(age, 20, "idade");
    const cleanSex = normalizeOptionalText(sex, 30, "sexo");
    const cleanCase = normalizeOptionalText(caseSummary, 6000, "resumo do caso");
    const cleanPending = normalizeOptionalText(pending, 4000, "pendências");
    const cleanSector = status === "censo" ? normalizeSector(sector, true) : normalizeSector(sector, false);
    if (!current) {
      this.ctx.storage.sql.exec(`INSERT INTO patients
        (id,patient_name,age,sex,case_summary,pending,status,sector,created_at,updated_at,review_at,census_at,discharge_at,last_prescription_at,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, cleanName, cleanAge, cleanSex, cleanCase, cleanPending, status, cleanSector, now, now,
        status === "reavaliacao" ? now : null, status === "censo" ? now : null, status === "alta" ? now : null,
        null, role, role);
    } else {
      const reviewAt = status === "reavaliacao" ? (current.review_at || now) : current.review_at;
      const censusAt = status === "censo" ? (current.census_at || now) : current.census_at;
      const dischargeAt = status === "alta" ? now : null;
      this.ctx.storage.sql.exec(`UPDATE patients SET patient_name=?,age=?,sex=?,case_summary=?,pending=?,status=?,sector=?,updated_at=?,review_at=?,census_at=?,discharge_at=?,updated_by=? WHERE id=?`,
        cleanName, cleanAge, cleanSex, cleanCase || current.case_summary, cleanPending || current.pending, status, cleanSector,
        now, reviewAt, censusAt, dischargeAt, role, id);
    }
  }
  async savePrescription(request) {
    const role = this.roleFrom(request);
    const body = await this.readJson(request);
    const patientId = normalizeId(body.patientId);
    const destination = normalizeDestination(body.destination || "salvar");
    const sector = destination === "censo" ? normalizeSector(body.sector, true) : null;
    const patient = body.patient || {};
    const snapshotJson = JSON.stringify(body.snapshot || {});
    if (encoder.encode(snapshotJson).byteLength > PRESCRIPTION_MAX_BYTES) throw new DomainError("A prescrição ficou grande demais para ser salva. Remova anexos/rascunhos e tente novamente.", 413);
    const preview = normalizeOptionalText(body.snapshot?.previewText || body.previewText || "", 12000, "prévia da prescrição");
    const now = Date.now();
    const current = this.patientRow(patientId);
    let status = current?.status || "prescricao";
    if (destination === "reavaliacao") status = "reavaliacao";
    else if (destination === "censo") status = "censo";
    else if (destination === "alta") status = "alta";
    const prescId = crypto.randomUUID();
    this.ctx.storage.transactionSync(() => {
      this.upsertPatient({
        id: patientId,
        name: patient.name || current?.patient_name || "Paciente",
        age: patient.age ?? current?.age ?? "",
        sex: patient.sex ?? current?.sex ?? "",
        caseSummary: current?.case_summary || "",
        pending: current?.pending || "",
        status,
        sector: destination === "censo" ? sector : (status === "censo" ? current?.sector : null),
        role,
        now
      });
      this.ctx.storage.sql.exec("INSERT INTO prescriptions (id,patient_id,created_at,actor_role,destination,sector,preview_text,snapshot_json) VALUES (?,?,?,?,?,?,?,?)",
        prescId, patientId, now, role, destination, sector, preview, snapshotJson);
      this.ctx.storage.sql.exec("UPDATE patients SET last_prescription_at=?, updated_at=?, updated_by=? WHERE id=?", now, now, role, patientId);
      this.insertClinicalEvent(patientId, "prescription_saved", { prescriptionId: prescId, destination, sector }, role, now);
    });
    await this.ctx.storage.sync();
    await this.broadcastClinical();
    return jsonDo({ ok: true, patient: mapPatient(this.patientRow(patientId)), prescriptionId: prescId });
  }
  async createManualPatient(request) {
    const role = this.roleFrom(request);
    const body = await this.readJson(request);
    const id = body.id ? normalizeId(body.id) : crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.upsertPatient({
        id,
        name: body.name,
        age: body.age || "",
        sex: body.sex || "",
        caseSummary: body.caseSummary || "",
        pending: body.pending || "",
        status: body.status === "reavaliacao" ? "reavaliacao" : "censo",
        sector: body.status === "reavaliacao" ? null : normalizeSector(body.sector, true),
        role,
        now
      });
      this.insertClinicalEvent(id, "patient_created", { status: body.status === "reavaliacao" ? "reavaliacao" : "censo", sector: body.sector || null }, role, now);
    });
    await this.ctx.storage.sync();
    await this.broadcastClinical();
    return jsonDo({ patient: mapPatient(this.patientRow(id)) }, 201);
  }
  async updatePatient(idRaw, request) {
    const role = this.roleFrom(request);
    const id = normalizeId(idRaw);
    const current = this.ensurePatient(id);
    const body = await this.readJson(request);
    const now = Date.now();
    const caseSummary = normalizeOptionalText(body.caseSummary ?? current.case_summary, 6000, "resumo do caso");
    const pending = normalizeOptionalText(body.pending ?? current.pending, 4000, "pendências");
    const sector = current.status === "censo" ? normalizeSector(body.sector ?? current.sector, true) : current.sector;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE patients SET case_summary=?,pending=?,sector=?,updated_at=?,updated_by=? WHERE id=?", caseSummary, pending, sector, now, role, id);
      this.insertClinicalEvent(id, "patient_updated", { sector }, role, now);
    });
    await this.ctx.storage.sync();
    await this.broadcastClinical();
    return jsonDo({ patient: mapPatient(this.patientRow(id)) });
  }
  async changePatientDestination(idRaw, request) {
    const role = this.roleFrom(request);
    const id = normalizeId(idRaw);
    const current = this.ensurePatient(id);
    const body = await this.readJson(request);
    const destination = normalizeDestination(body.destination);
    const now = Date.now();
    let status = current.status;
    let sector = current.sector;
    if (destination === "reavaliacao") { status = "reavaliacao"; sector = null; }
    else if (destination === "censo") { status = "censo"; sector = normalizeSector(body.sector, true); }
    else if (destination === "alta") { status = "alta"; sector = null; }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`UPDATE patients SET status=?,sector=?,updated_at=?,review_at=?,census_at=?,discharge_at=?,updated_by=? WHERE id=?`,
        status, sector, now,
        status === "reavaliacao" ? (current.review_at || now) : current.review_at,
        status === "censo" ? (current.census_at || now) : current.census_at,
        status === "alta" ? now : null,
        role, id);
      this.insertClinicalEvent(id, "destination_changed", { destination, sector }, role, now);
    });
    await this.ctx.storage.sync();
    await this.broadcastClinical();
    return jsonDo({ patient: mapPatient(this.patientRow(id)) });
  }
  async addManualExam(idRaw, request) {
    const role = this.roleFrom(request);
    const id = normalizeId(idRaw);
    this.ensurePatient(id);
    const body = await this.readJson(request);
    const title = normalizeOptionalText(body.title || "Exame", 160, "título do exame");
    const text = normalizeOptionalText(body.text, 20_000, "resultado do exame");
    if (!text) throw new DomainError("Informe o resultado do exame.");
    const examId = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT INTO exams (id,patient_id,kind,title,text_result,object_key,file_name,mime,file_size,created_at,actor_role) VALUES (?,?, 'manual', ?, ?, NULL, NULL, NULL, 0, ?, ?)", examId, id, title, text, now, role);
      this.ctx.storage.sql.exec("UPDATE patients SET updated_at=?,updated_by=? WHERE id=?", now, role, id);
      this.insertClinicalEvent(id, "exam_added", { examId, kind: "manual", title }, role, now);
    });
    await this.ctx.storage.sync();
    await this.broadcastClinical();
    return jsonDo({ exam: mapExam(this.ctx.storage.sql.exec("SELECT * FROM exams WHERE id=?", examId).one()) }, 201);
  }
  async recordFileExam(idRaw, request) {
    const role = this.roleFrom(request);
    const id = normalizeId(idRaw);
    this.ensurePatient(id);
    const body = await this.readJson(request);
    const examId = normalizeId(body.examId);
    const title = normalizeOptionalText(body.title || body.fileName || "Exame", 160, "título do exame");
    const fileName = normalizeOptionalText(body.fileName || "arquivo", 240, "nome do arquivo");
    const mime = normalizeOptionalText(body.mime || "application/octet-stream", 120, "tipo do arquivo");
    const objectKey = normalizeOptionalText(body.objectKey, 500, "chave do arquivo");
    const size = Number(body.size || 0);
    if (!objectKey || !Number.isFinite(size) || size <= 0 || size > FILE_MAX_BYTES) throw new DomainError("Arquivo inválido.");
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT INTO exams (id,patient_id,kind,title,text_result,object_key,file_name,mime,file_size,created_at,actor_role) VALUES (?,?, 'file', ?, '', ?, ?, ?, ?, ?, ?)", examId, id, title, objectKey, fileName, mime, size, now, role);
      this.ctx.storage.sql.exec("UPDATE patients SET updated_at=?,updated_by=? WHERE id=?", now, role, id);
      this.insertClinicalEvent(id, "exam_added", { examId, kind: "file", title, fileName }, role, now);
    });
    await this.ctx.storage.sync();
    await this.broadcastClinical();
    return jsonDo({ exam: mapExam(this.ctx.storage.sql.exec("SELECT * FROM exams WHERE id=?", examId).one()) }, 201);
  }
  getPatientDetailsResponse(idRaw, request) {
    this.roleFrom(request);
    const id = normalizeId(idRaw);
    const patient = this.ensurePatient(id);
    const prescriptions = this.ctx.storage.sql.exec("SELECT * FROM prescriptions WHERE patient_id=? ORDER BY created_at DESC LIMIT 50", id).toArray();
    const exams = this.ctx.storage.sql.exec("SELECT * FROM exams WHERE patient_id=? ORDER BY created_at DESC LIMIT 100", id).toArray();
    return jsonDo({
      patient: mapPatient(patient),
      prescriptions: prescriptions.map((row) => mapPrescription(row, false)),
      latestPrescription: prescriptions[0] ? mapPrescription(prescriptions[0], true) : null,
      exams: exams.map(mapExam)
    });
  }
  getExamMetadata(idRaw, request) {
    this.roleFrom(request);
    const id = normalizeId(idRaw);
    const row = this.ctx.storage.sql.exec("SELECT * FROM exams WHERE id=?", id).toArray()[0];
    if (!row) throw new DomainError("Exame não encontrado.", 404);
    return jsonDo({ exam: mapExam(row), objectKey: row.object_key });
  }
  getPrescriptionResponse(idRaw, request) {
    this.roleFrom(request);
    const id = normalizeId(idRaw);
    const row = this.ctx.storage.sql.exec("SELECT * FROM prescriptions WHERE id=?", id).toArray()[0];
    if (!row) throw new DomainError("Prescrição não encontrada.", 404);
    return jsonDo({ prescription: mapPrescription(row, true) });
  }
  async readJson(request) {
    try { return await request.json(); } catch { throw new DomainError("Dados inválidos."); }
  }

  connectWebSocket(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new DomainError("Atualização WebSocket esperada.", 426);
    const scope = request.headers.get("x-crs-scope");
    if (!["public", "internal", "clinical"].includes(scope)) throw new DomainError("Escopo inválido.", 400);
    if (scope !== "public") this.roleFrom(request);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [scope]);
    server.serializeAttachment({ scope });
    const data = scope === "public" ? this.publicSnapshot() : scope === "clinical" ? this.clinicalSnapshot() : this.internalSnapshot();
    server.send(JSON.stringify({ type: "snapshot", scope, data }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async broadcastCalls() {
    const publicMessage = JSON.stringify({ type: "snapshot", scope: "public", data: this.publicSnapshot() });
    const internalMessage = JSON.stringify({ type: "snapshot", scope: "internal", data: this.internalSnapshot() });
    for (const socket of this.ctx.getWebSockets("public")) this.safeSend(socket, publicMessage);
    for (const socket of this.ctx.getWebSockets("internal")) this.safeSend(socket, internalMessage);
  }
  async broadcastClinical() {
    const message = JSON.stringify({ type: "snapshot", scope: "clinical", data: this.clinicalSnapshot() });
    for (const socket of this.ctx.getWebSockets("clinical")) this.safeSend(socket, message);
  }
  safeSend(socket, message) {
    try { socket.send(message); } catch { socket.close(1011, "Falha ao atualizar"); }
  }
  webSocketMessage(socket, message) { if (message === "ping") socket.send("pong"); }
  webSocketClose(socket, code, reason) { socket.close(code, reason); }
}

function base64UrlEncode(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function signingKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(payload, secret) {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}
function parseCookie(request) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}
async function createSession(role, secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const encodedPayload = base64UrlEncode(JSON.stringify({ role, exp, nonce: crypto.randomUUID() }));
  return { token: `${encodedPayload}.${await sign(encodedPayload, secret)}`, session: { role, expiresAt: new Date(exp * 1000).toISOString() } };
}
async function readSession(request, secret) {
  const token = parseCookie(request);
  if (!token) return null;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;
  try {
    const key = await signingKey(secret);
    const expected = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(signature.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
    if (!await crypto.subtle.verify("HMAC", key, expected, encoder.encode(encodedPayload))) return null;
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!["admin", "doctor"].includes(payload.role) || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { role: payload.role, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch { return null; }
}
async function passwordsMatch(actual, expected) {
  const [actualHash, expectedHash] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(actual)), crypto.subtle.digest("SHA-256", encoder.encode(expected))]);
  const left = new Uint8Array(actualHash), right = new Uint8Array(expectedHash);
  let different = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) different |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return different === 0;
}
function sessionCookie(token, requestUrl) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${new URL(requestUrl).protocol === "https:" ? "; Secure" : ""}`;
}
function expiredSessionCookie(requestUrl) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${new URL(requestUrl).protocol === "https:" ? "; Secure" : ""}`;
}

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none"
};
function withSecurityHeaders(response) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  if (response.headers.get("content-type")?.match(/text\/html|application\/json/)) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function json(data, status = 200, headers) {
  return withSecurityHeaders(Response.json(data, { status, headers }));
}
function configuredSecret(env) { return env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 ? env.SESSION_SECRET : null; }
function room(env) { return env.CALL_ROOM.getByName("crs-coophavila-principal"); }
async function roomRequest(env, request, path, options = {}) {
  const headers = new Headers(request.headers);
  if (options.role) headers.set("x-crs-role", options.role);
  if (options.scope) headers.set("x-crs-scope", options.scope);
  const target = new URL(path, "https://call-room.internal");
  const init = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return room(env).fetch(new Request(target, init));
}
async function requireSession(request, env) {
  const secret = configuredSecret(env);
  if (!secret) return null;
  const session = await readSession(request, secret);
  return session ? { role: session.role } : null;
}
async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function loginClientKeys(request, secret) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local-client";
  const userAgent = request.headers.get("user-agent") ?? "unknown-client";
  return { address: await sha256Hex(`${secret}:address:${address}`), device: await sha256Hex(`${secret}:device:${address}:${userAgent}`) };
}
async function loginLimitRequest(env, path, key, maxAttempts) {
  const headers = new Headers({ "x-crs-client-key": key, "x-crs-max-attempts": String(maxAttempts) });
  return withSecurityHeaders(await room(env).fetch(new Request(`https://call-room.internal${path}`, { method: "POST", headers })));
}
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
async function login(request, env) {
  const secret = configuredSecret(env);
  if (!secret || !env.ADMIN_PASSWORD || !env.MEDICO_PASSWORD) return json({ error: "O acesso ainda não foi configurado." }, 503);
  const keys = await loginClientKeys(request, secret);
  const deviceLimit = await loginLimitRequest(env, "/login-attempt", keys.device, LOGIN_DEVICE_MAX_ATTEMPTS);
  const addressLimit = deviceLimit.ok ? await loginLimitRequest(env, "/login-attempt", keys.address, LOGIN_ADDRESS_MAX_ATTEMPTS) : deviceLimit;
  const limit = !deviceLimit.ok ? deviceLimit : addressLimit;
  if (limit.status === 429) {
    const body = await limit.json().catch(() => ({}));
    const retryAfter = Math.max(1, Number(body.retryAfter ?? 900));
    return json({ error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." }, 429, { "Retry-After": String(retryAfter) });
  }
  if (!limit.ok) return json({ error: "Não foi possível validar o acesso agora." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Dados de acesso inválidos." }, 400); }
  if (!["admin", "doctor"].includes(body.role) || typeof body.password !== "string") return json({ error: "Dados de acesso inválidos." }, 400);
  const expected = body.role === "admin" ? env.ADMIN_PASSWORD : env.MEDICO_PASSWORD;
  if (!await passwordsMatch(body.password, expected)) return json({ error: "Perfil ou senha incorretos." }, 401);
  await Promise.all([loginLimitRequest(env, "/login-success", keys.device, LOGIN_DEVICE_MAX_ATTEMPTS), loginLimitRequest(env, "/login-success", keys.address, LOGIN_ADDRESS_MAX_ATTEMPTS)]);
  const { token, session } = await createSession(body.role, secret);
  return json({ session }, 200, { "Set-Cookie": sessionCookie(token, request.url), "Cache-Control": "no-store" });
}
function contentLength(request) { return Number(request.headers.get("content-length") ?? 0); }
function isJson(request) { return request.headers.get("content-type")?.toLowerCase().startsWith("application/json"); }
async function fetchRoomJson(env, path, role) {
  const response = await room(env).fetch(new Request(`https://call-room.internal${path}`, { headers: { "x-crs-role": role } }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new DomainError(data.error || "Falha ao consultar dados.", response.status);
  return data;
}
function safeObjectName(name) {
  return String(name || "arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "arquivo";
}
async function handleExamUpload(request, env, session, patientId) {
  if (!env.EXAMS_BUCKET) return json({ error: "Armazenamento de anexos ainda não foi vinculado ao Worker." }, 503);
  if (contentLength(request) > FILE_MAX_BYTES + 1_000_000) return json({ error: "Arquivo acima do limite de 12 MB." }, 413);
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().startsWith("multipart/form-data")) return json({ error: "Envie o exame como formulário multipart." }, 415);
  try { await fetchRoomJson(env, `/clinical/patients/${encodeURIComponent(patientId)}`, session.role); }
  catch (error) { return json({ error: error.message }, error.status || 400); }
  let form;
  try { form = await request.formData(); } catch { return json({ error: "Não foi possível ler o arquivo." }, 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || typeof file.name !== "string") return json({ error: "Selecione um PDF ou imagem." }, 400);
  if (file.size <= 0 || file.size > FILE_MAX_BYTES) return json({ error: "O arquivo deve ter no máximo 12 MB." }, 413);
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) return json({ error: "Formato não permitido. Use PDF, JPG, PNG ou WEBP." }, 415);
  const examId = crypto.randomUUID();
  const objectKey = `patients/${patientId}/${examId}-${safeObjectName(file.name)}`;
  const titleRaw = form.get("title");
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim().slice(0, 160) : file.name.replace(/\.[^.]+$/, "").slice(0, 160);
  try {
    await env.EXAMS_BUCKET.put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }, customMetadata: { patientId, examId } });
    const recordResponse = await room(env).fetch(new Request(`https://call-room.internal/clinical/patients/${encodeURIComponent(patientId)}/exams/record`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-crs-role": session.role },
      body: JSON.stringify({ examId, title, fileName: file.name, mime: file.type, size: file.size, objectKey })
    }));
    const data = await recordResponse.json().catch(() => ({}));
    if (!recordResponse.ok) {
      await env.EXAMS_BUCKET.delete(objectKey).catch(() => {});
      return json({ error: data.error || "Falha ao registrar exame." }, recordResponse.status);
    }
    return json(data, 201);
  } catch (error) {
    console.error("exam-upload-error", error);
    return json({ error: "Não foi possível salvar o arquivo." }, 500);
  }
}
async function handleExamDownload(request, env, session, examId) {
  if (!env.EXAMS_BUCKET) return json({ error: "Armazenamento de anexos ainda não foi vinculado ao Worker." }, 503);
  let meta;
  try { meta = await fetchRoomJson(env, `/clinical/exams/${encodeURIComponent(examId)}`, session.role); }
  catch (error) { return json({ error: error.message }, error.status || 400); }
  if (!meta.objectKey) return json({ error: "Este exame não possui arquivo anexado." }, 404);
  const object = await env.EXAMS_BUCKET.get(meta.objectKey);
  if (!object) return json({ error: "Arquivo não encontrado." }, 404);
  const headers = new Headers();
  headers.set("Content-Type", meta.exam?.mime || object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(meta.exam?.fileName || "exame")}`);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return withSecurityHeaders(new Response(object.body, { headers }));
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "POST" && !sameOrigin(request)) return json({ error: "Origem da solicitação não permitida." }, 403);
  if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, storage: "durable-object-sqlite", realtime: "websocket", attachments: env.EXAMS_BUCKET ? "r2" : "not-bound" });
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (contentLength(request) > 16_384 || !isJson(request)) return json({ error: "Solicitação de login inválida." }, 413);
    return login(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie(request.url) });
  const secret = configuredSecret(env);
  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    if (!secret) return json({ error: "O acesso ainda não foi configurado." }, 503);
    const session = await readSession(request, secret);
    return session ? json({ session }) : json({ error: "Sessão não encontrada." }, 401);
  }
  const session = await requireSession(request, env);
  if (!session) return json({ error: "Sessão expirada." }, 401);

  if (request.method === "GET" && url.pathname === "/api/public/state") return withSecurityHeaders(await roomRequest(env, request, "/public-state"));
  if (request.method === "GET" && url.pathname === "/api/realtime") {
    const requested = url.searchParams.get("scope");
    const scope = requested === "internal" ? "internal" : requested === "clinical" ? "clinical" : "public";
    return roomRequest(env, request, "/realtime", { scope, role: session.role });
  }
  if (request.method === "GET" && url.pathname === "/api/state") return withSecurityHeaders(await roomRequest(env, request, "/internal-state", { role: session.role }));
  if (request.method === "GET" && url.pathname === "/api/clinical/state") return withSecurityHeaders(await roomRequest(env, request, "/clinical-state", { role: session.role }));

  const uploadMatch = url.pathname.match(/^\/api\/clinical\/patients\/([^/]+)\/exams\/file$/);
  if (request.method === "POST" && uploadMatch) return handleExamUpload(request, env, session, uploadMatch[1]);
  const downloadMatch = url.pathname.match(/^\/api\/clinical\/exams\/([^/]+)\/file$/);
  if (request.method === "GET" && downloadMatch) return handleExamDownload(request, env, session, downloadMatch[1]);

  if (request.method === "POST") {
    if (contentLength(request) > JSON_MAX_BYTES) return json({ error: "Solicitação muito grande." }, 413);
    if (!isJson(request)) return json({ error: "Formato da solicitação não permitido." }, 415);
  }

  if (request.method === "POST" && url.pathname === "/api/calls") return withSecurityHeaders(await roomRequest(env, request, "/calls", { role: session.role }));
  const actionMatch = url.pathname.match(/^\/api\/calls\/([^/]+)\/(recall|absent|finish)$/);
  if (request.method === "POST" && actionMatch) return withSecurityHeaders(await roomRequest(env, request, `/calls/${actionMatch[1]}/${actionMatch[2]}`, { role: session.role }));

  if (request.method === "POST" && url.pathname === "/api/clinical/prescription") return withSecurityHeaders(await roomRequest(env, request, "/clinical/prescription", { role: session.role }));
  if (request.method === "POST" && url.pathname === "/api/clinical/patients") return withSecurityHeaders(await roomRequest(env, request, "/clinical/patients", { role: session.role }));
  const patientGet = url.pathname.match(/^\/api\/clinical\/patients\/([^/]+)$/);
  if (request.method === "GET" && patientGet) return withSecurityHeaders(await roomRequest(env, request, `/clinical/patients/${patientGet[1]}`, { role: session.role }));
  const patientUpdate = url.pathname.match(/^\/api\/clinical\/patients\/([^/]+)\/update$/);
  if (request.method === "POST" && patientUpdate) return withSecurityHeaders(await roomRequest(env, request, `/clinical/patients/${patientUpdate[1]}/update`, { role: session.role }));
  const patientDestination = url.pathname.match(/^\/api\/clinical\/patients\/([^/]+)\/destination$/);
  if (request.method === "POST" && patientDestination) return withSecurityHeaders(await roomRequest(env, request, `/clinical/patients/${patientDestination[1]}/destination`, { role: session.role }));
  const manualExam = url.pathname.match(/^\/api\/clinical\/patients\/([^/]+)\/exams\/manual$/);
  if (request.method === "POST" && manualExam) return withSecurityHeaders(await roomRequest(env, request, `/clinical/patients/${manualExam[1]}/exams/manual`, { role: session.role }));
  const prescriptionGet = url.pathname.match(/^\/api\/clinical\/prescriptions\/([^/]+)$/);
  if (request.method === "GET" && prescriptionGet) return withSecurityHeaders(await roomRequest(env, request, `/clinical/prescriptions/${prescriptionGet[1]}`, { role: session.role }));

  return json({ error: "Rota não encontrada." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) return await handleApi(request, env);
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error("worker-error", error);
      if (error instanceof DomainError) return json({ error: error.message }, error.status);
      return json({ error: "Serviço temporariamente indisponível." }, 500);
    }
  }
};
