const video = document.getElementById("video");
const emptyState = document.getElementById("emptyState");
const urlInput = document.getElementById("url");
const titleInput = document.getElementById("title");
const queueEl = document.getElementById("queue");
const countEl = document.getElementById("count");
const connectionEl = document.getElementById("connection");

let jobs = new Map();
let currentJob = null;
let hls = null;

function statusLabel(status) {
  return {
    queued: "Na fila",
    downloading: "Baixando",
    converting: "Convertendo",
    completed: "Concluído",
    error: "Erro"
  }[status] || status;
}

function render() {
  const list = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  countEl.textContent = list.length;

  queueEl.innerHTML = list.map(job => `
    <article class="job ${currentJob?.id === job.id ? "active" : ""}" data-id="${job.id}">
      <div class="job-top">
        <div class="job-title">${escapeHtml(job.title)}</div>
        <div class="job-status ${job.status === "completed" ? "completed" : ""}">
          ${statusLabel(job.status)}
        </div>
      </div>
      <div class="progress"><div style="width:${job.progress || 0}%"></div></div>
      <div class="job-bottom">
        <small>${job.progress || 0}%</small>
        ${job.status === "completed"
          ? `<a class="download" href="${job.output}" download>⬇ Baixar MP4</a>`
          : `<small>${job.status === "error" ? "Verifique a URL" : "Processando..."}</small>`}
      </div>
    </article>
  `).join("");

  queueEl.querySelectorAll(".job").forEach(el => {
    el.addEventListener("click", event => {
      if (event.target.closest("a")) return;
      const job = jobs.get(el.dataset.id);
      if (job) playJob(job);
    });
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function playUrl(url) {
  emptyState.style.display = "none";

  // HLS.js é usado em navegadores que não possuem suporte HLS nativo.
  if (hls) {
    hls.destroy();
    hls = null;
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
  } else if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    alert("Este navegador não suporta reprodução HLS/M3U8.");
    return;
  }

  video.play().catch(() => {});
}

function playJob(job) {
  currentJob = job;
  playUrl(job.url);
  render();
}

async function addJob() {
  const url = urlInput.value.trim();
  const title = titleInput.value.trim();

  if (!url) {
    alert("Cole uma URL M3U8 primeiro.");
    return;
  }

  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title })
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || "Não foi possível adicionar o vídeo.");
    return;
  }

  jobs.set(data.id, data);
  currentJob = data;
  playUrl(data.url);

  // Limpa apenas os campos para permitir colar rapidamente vários links.
  urlInput.value = "";
  titleInput.value = "";

  render();
}

document.getElementById("addBtn").addEventListener("click", addJob);

document.getElementById("playBtn").addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) return alert("Cole uma URL M3U8 primeiro.");
  playUrl(url);
});

document.getElementById("pasteBtn").addEventListener("click", async () => {
  try {
    urlInput.value = await navigator.clipboard.readText();
  } catch {
    alert("O navegador não permitiu acesso à área de transferência.");
  }
});

document.getElementById("clearCompleted").addEventListener("click", async () => {
  const completed = [...jobs.values()].filter(j => j.status === "completed");
  for (const job of completed) {
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    jobs.delete(job.id);
  }
  render();
});

document.getElementById("openCurrent").addEventListener("click", () => {
  if (!currentJob) return;
  window.open(currentJob.url, "_blank", "noopener");
});

document.getElementById("toggleSidebar").addEventListener("click", () => {
  document.body.classList.toggle("sidebar-hidden");
});

video.addEventListener("loadeddata", () => {
  emptyState.style.display = "none";
});

const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${location.host}`);

ws.addEventListener("open", () => {
  connectionEl.textContent = "● conectado";
});

ws.addEventListener("close", () => {
  connectionEl.textContent = "● desconectado";
  connectionEl.style.color = "#ef4444";
});

ws.addEventListener("message", event => {
  const data = JSON.parse(event.data);

  if (data.type === "snapshot") {
    jobs = new Map(data.jobs.map(job => [job.id, job]));
    render();
    return;
  }

  if (data.type === "job") {
    jobs.set(data.job.id, data.job);
    render();
    return;
  }

  if (data.type === "progress") {
    const job = jobs.get(data.id);
    if (job) {
      job.progress = data.progress;
      render();
    }
    return;
  }

  if (data.type === "removed") {
    jobs.delete(data.id);
    render();
  }
});

// Carrega a fila inicial caso o WebSocket demore para conectar.
fetch("/api/jobs")
  .then(r => r.json())
  .then(list => {
    jobs = new Map(list.map(job => [job.id, job]));
    render();
  });
