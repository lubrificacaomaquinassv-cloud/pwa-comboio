const STORAGE_KEY   = "comboio-v2-records";
const PENDING_KEY   = "comboio-v2-pending";
const FAILED_KEY    = "comboio-v2-failed";
const ORDER_SEQ_KEY = "comboio-v2-order-seq";

const SB_URL = window.SUPABASE_URL || "https://azhpxhrwhegfysoeqmft.supabase.co";
const SB_KEY = window.SUPABASE_ANON_KEY || "";
const SB_HEADERS = {
  "Content-Type":  "application/json",
  "apikey":        SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Prefer":        "return=minimal"
};

const form             = document.getElementById("com-form");
const connectionStatus = document.getElementById("connection-status");
const dbSyncStatus     = document.getElementById("db-sync-status");
const nextOrderPreview = document.getElementById("next-order-preview");
const recentList       = document.getElementById("recent-list");
const comDateTime      = document.getElementById("comDateTime");

function makeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random()*1e6)}`;
}

function getNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

function toIso(val) {
  if (!val) return new Date().toISOString();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// NOTA: esse numero e so uma pre-visualizacao local pro operador.
// O numero definitivo/oficial agora e gerado pelo proprio banco (trigger no Supabase),
// entao nunca ha risco de dois aparelhos gerarem o mesmo order_number.
function peekOrder() {
  const n = Number(localStorage.getItem(ORDER_SEQ_KEY) || "0") + 1;
  return `COM-${String(n).padStart(5,"0")}`;
}

function nextOrder() {
  const n = Number(localStorage.getItem(ORDER_SEQ_KEY) || "0") + 1;
  localStorage.setItem(ORDER_SEQ_KEY, String(n));
  return `COM-${String(n).padStart(5,"0")}`;
}

function updateOrderPreview() {
  nextOrderPreview.textContent = `Proxima ordem ao salvar: ${peekOrder()}`;
}

function getRecords() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
function saveRecords(r) { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); }
function getPending()   { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; } }
function savePending(q) { localStorage.setItem(PENDING_KEY, JSON.stringify(q)); }
function getFailed()    { try { return JSON.parse(localStorage.getItem(FAILED_KEY) || "[]"); } catch { return []; } }
function saveFailed(f)  { localStorage.setItem(FAILED_KEY, JSON.stringify(f)); }
function escapeHtml(t)  { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

function updateConnectionStatus() {
  connectionStatus.textContent = navigator.onLine ? "Online" : "Offline - dados salvos localmente";
  connectionStatus.className = "connection-status " + (navigator.onLine ? "online" : "offline");
}

function updateSyncStatus() {
  const n = getPending().length;
  const f = getFailed().length;
  if (n === 0 && f === 0) {
    dbSyncStatus.textContent = "Sincronizacao com banco em dia.";
    dbSyncStatus.className = "connection-status online";
  } else if (n > 0 && f === 0) {
    dbSyncStatus.textContent = `${n} lancamento(s) aguardando envio ao banco.`;
    dbSyncStatus.className = "connection-status offline";
  } else if (n === 0 && f > 0) {
    dbSyncStatus.textContent = `Atencao: ${f} lancamento(s) com erro - precisa revisar.`;
    dbSyncStatus.className = "connection-status offline";
  } else {
    dbSyncStatus.textContent = `${n} aguardando envio - ${f} com erro.`;
    dbSyncStatus.className = "connection-status offline";
  }
}

// Retorna { ok:true } em sucesso.
// { ok:false, fatal:true }  -> erro do servidor (4xx): nao adianta repetir, tira da fila.
// { ok:false, fatal:false } -> falha de rede/conexao: mantem na fila pra tentar de novo.
async function syncToSupabase(record) {
  try {
    const r = await fetch(SB_URL + "/rest/v1/comboio_v2", {
      method: "POST",
      headers: SB_HEADERS,
      body: JSON.stringify({
        order_number: record.orderNumber,
        created_at:   record.createdAt,
        vehicle:      record.vehicle      || null,
        operator:     record.operator     || null,
        location:     record.location     || null,
        work_front:   record.workFront    || null,
        fuel_type:    record.fuelType     || null,
        liters:       record.liters       || null,
        hourmeter:    record.hourmeter    || null,
        observation:  record.observation  || null
      })
    });
    if (r.ok || r.status === 201) return { ok: true };
    let body = "";
    try { body = await r.text(); } catch (_) {}
    return { ok: false, fatal: r.status >= 400 && r.status < 500, error: `HTTP ${r.status}: ${body}` };
  } catch (e) {
    console.error("Sync error:", e);
    return { ok: false, fatal: false, error: String(e) };
  }
}

let syncing = false;
async function processQueue() {
  if (!navigator.onLine) { updateSyncStatus(); return; }
  if (syncing) return; // evita duas execucoes simultaneas (timer + evento online)
  syncing = true;
  try {
    let queue = getPending();
    const stuck = [];
    let i = 0;
    while (i < queue.length) {
      const result = await syncToSupabase(queue[i]);
      if (result.ok) {
        queue.splice(i, 1); // sucesso: remove, nao avanca indice
      } else if (result.fatal) {
        console.error("Lancamento rejeitado pelo servidor, isolando:", queue[i]?.orderNumber, result.error);
        stuck.push({ ...queue[i], error: result.error, falhouEm: new Date().toISOString() });
        queue.splice(i, 1); // isola o item ruim, nao trava os proximos
      } else {
        i++; // falha de rede: deixa na fila, tenta o proximo item agora
      }
    }
    savePending(queue);
    if (stuck.length) {
      saveFailed([...getFailed(), ...stuck]);
    }
  } finally {
    syncing = false;
    updateSyncStatus();
  }
}

function enqueue(record) {
  const q = getPending();
  q.push(record);
  savePending(q);
  updateSyncStatus();
  processQueue();
}

function renderRecent() {
  const records = getRecords().slice(-5).reverse();
  recentList.innerHTML = "";
  if (!records.length) {
    recentList.innerHTML = "<li class='recent-item recent-empty'><span class='recent-cell'>Nenhum abastecimento ainda.</span></li>";
    return;
  }
  records.forEach(r => {
    const li = document.createElement("li");
    li.className = "recent-item";
    li.setAttribute("role","row");
    li.innerHTML = `
      <span class="recent-cell">${escapeHtml(r.orderNumber||"-")}</span>
      <span class="recent-cell">${escapeHtml(r.vehicle||"-")}</span>
      <span class="recent-cell">${escapeHtml(String(r.liters||"0"))} L</span>
    `;
    recentList.appendChild(li);
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(form);

  const record = {
    id:          makeId(),
    orderNumber: nextOrder(),
    createdAt:   toIso(String(fd.get("comDateTime") || "")),
    vehicle:     String(fd.get("vehicle")     || "").trim().toUpperCase(),
    operator:    String(fd.get("operator")    || "").trim().toUpperCase(),
    location:    String(fd.get("location")    || "").trim().toUpperCase(),
    workFront:   String(fd.get("workFront")   || "").trim().toUpperCase(),
    fuelType:    String(fd.get("fuelType")    || "").trim(),
    liters:      parseFloat(fd.get("liters")) || null,
    hourmeter:   String(fd.get("hourmeter")   || "").trim() || null,
    observation: String(fd.get("observation") || "").trim() || null
  };

  const records = getRecords();
  records.push(record);
  saveRecords(records);
  enqueue(record);

  form.reset();
  comDateTime.value = getNow();
  updateOrderPreview();
  renderRecent();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js?v=2", { updateViaCache: "none" });
      reg.update();
    } catch(err) { console.error("SW error:", err); }
  });
}

window.addEventListener("online",  updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
window.addEventListener("online",  processQueue);

comDateTime.value = getNow();
updateConnectionStatus();
updateSyncStatus();
updateOrderPreview();
processQueue();
renderRecent();

// tenta sincronizar periodicamente enquanto o app estiver aberto
// (cobre o caso de abrir rapido, salvar e fechar antes do evento "online" disparar)
setInterval(processQueue, 60000);
