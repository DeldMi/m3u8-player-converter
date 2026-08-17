const video = document.getElementById("video");
const emptyState = document.getElementById("emptyState");
const urlInput = document.getElementById("url");
const titleInput = document.getElementById("title");
const queueEl = document.getElementById("queue");
const countEl = document.getElementById("count");
const connectionEl = document.getElementById("connection");
const sidebar = document.getElementById("sidebar");
const showSidebar = document.getElementById("showSidebar");

let jobs = new Map();
let currentJob = null;
let hls = null;
let sortMode = "added";
let autoNext = false;
const notifiedJobs = new Set();

function statusLabel(status) {
  return {
    queued: "⏳ Na fila",
    downloading: "📥 Baixando",
    converting: "⚙️ Convertendo",
    paused: "⏸ Pausado",
    cancelled: "🚫 Cancelado",
    completed: "✓ Concluído",
    error: "❌ Erro"
  }[status] || status;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  let list = [...jobs.values()];

  if (sortMode === "alpha") {
    list.sort((a,b) => a.title.localeCompare(b.title, "pt-BR"));
  } else if (sortMode === "alphaDesc") {
    list.sort((a,b) => b.title.localeCompare(a.title, "pt-BR"));
  } else if (sortMode === "status") {
    list.sort((a,b) => a.status.localeCompare(b.status));
  } else {
    list.sort((a,b) => a.createdAt - b.createdAt);
  }

  countEl.textContent = list.length;

  queueEl.innerHTML = list.map(job => {
    const completed = job.status === "completed";
    const error = job.status === "error";
    const processing = ["downloading","converting","paused"].includes(job.status);

    let controls = "";
    if (job.status === "downloading" || job.status === "converting") {
      controls += `<button class="job-action" data-action="pause">⏸ Pausar</button>`;
    }
    if (job.status === "paused") {
      controls += `<button class="job-action" data-action="resume">▶ Continuar</button>`;
    }
    if (processing) {
      controls += `<button class="job-action danger" data-action="cancel">✕ Cancelar</button>`;
    }
    controls += `<button class="job-action danger" data-action="delete">🗑 Excluir</button>`;

    return `
      <article class="job ${currentJob?.id === job.id ? "active" : ""}" data-id="${job.id}">
        <div class="job-top">
          <div class="job-title">${escapeHtml(job.title)}</div>
          <div class="job-status ${completed ? "completed" : ""} ${error ? "error" : ""}">
            ${statusLabel(job.status)}
          </div>
        </div>
        <div class="progress"><div style="width:${job.progress || 0}%"></div></div>
        <div class="job-bottom">
          <small>${job.progress || 0}%${job.size ? ` · ${formatBytes(job.size)}` : ""}</small>
          ${
            completed && job.output
              ? `<a class="download" href="${job.output}" download="${escapeHtml(job.title)}.mp4">⬇ Baixar MP4</a>`
              : error
                ? `<small>${escapeHtml(job.error || "Erro")}</small>`
                : `<small>${job.status === "paused" ? "Pausado" : "Processando..."}</small>`
          }
        </div>
        <div class="job-actions">${controls}</div>
      </article>`;
  }).join("");

  queueEl.querySelectorAll(".job").forEach(el => {
    el.addEventListener("click", event => {
      if (event.target.closest(".download")) return;
      const job = jobs.get(el.dataset.id);
      if (!job) return;

      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action) {
        event.stopPropagation();
        controlJob(job, action);
      } else {
        // Somente esta ação explícita troca o vídeo em reprodução.
        playJob(job);
      }
    });
  });
}

async function controlJob(job, action) {
  if (action === "delete") {
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    jobs.delete(job.id);

    if (currentJob?.id === job.id) {
      currentJob = null;
      video.pause();
      if (hls) { hls.destroy(); hls = null; }
      video.removeAttribute("src");
      video.load();
      emptyState.style.display = "block";
    }
    render();
    return;
  }

  const response = await fetch(`/api/jobs/${job.id}/control`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ action })
  });
  const data = await response.json();

  if (!response.ok) {
    alert(data.error || "Não foi possível controlar o vídeo.");
    return;
  }

  jobs.set(data.id, data);
  render();
}

function playUrl(url, preservePosition = 0, shouldPlay = true) {
  emptyState.style.display = "none";

  if (hls) {
    hls.destroy();
    hls = null;
  }

  // MP4 concluído é reproduzido localmente, evitando travamentos do M3U8.
  if (url.includes("/downloads/") || /\.mp4(?:$|\?)/i.test(url)) {
    video.src = url;
    video.load();

    video.addEventListener("loadedmetadata", function restore() {
      if (preservePosition > 0) {
        video.currentTime = preservePosition;
      }

      if (shouldPlay) {
        video.play().catch(() => {});
      }

      video.removeEventListener("loadedmetadata", restore);
    });

    return;
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
  } else if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 30
    });

    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        console.warn("Erro HLS:", data);
      }
    });
  } else {
    alert("Este navegador não suporta reprodução HLS/M3U8.");
    return;
  }

  video.play().catch(() => {});
}

function playJob(job) {
  currentJob = job;

  if (job.status === "completed" && job.output) {
    playUrl(job.output);
  } else {
    playUrl(job.url);
  }

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
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url, title })
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || "Não foi possível adicionar o vídeo.");
    return;
  }

  jobs.set(data.id, data);

  // Começa pelo M3U8 enquanto o FFmpeg trabalha em segundo plano.
  // Adicionar à fila não interrompe o vídeo que já está sendo assistido.
  if (!currentJob) {
    currentJob = data;
    playUrl(data.url);
  }

  urlInput.value = "";
  titleInput.value = "";

  render();
}

document.getElementById("addBtn").addEventListener("click", addJob);

document.getElementById("playBtn").addEventListener("click", () => {
  const url = urlInput.value.trim();

  if (!url) {
    alert("Cole uma URL M3U8 primeiro.");
    return;
  }

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
  const completed = [...jobs.values()].filter(
    job => job.status === "completed"
  );

  for (const job of completed) {
    await fetch(`/api/jobs/${job.id}`, {
      method: "DELETE"
    });

    jobs.delete(job.id);
  }

  render();
});

document.getElementById("openCurrent").addEventListener("click", () => {
  if (!currentJob) return;

  window.open(
    currentJob.url,
    "_blank",
    "noopener,noreferrer"
  );
});

// A sidebar fica sobreposta ao player, sem mudar sua geometria.
document.getElementById("hideSidebar").addEventListener("click", () => {
  sidebar.classList.add("hidden");
  showSidebar.classList.add("visible");
});

// Botão flutuante sempre permite reabrir o painel.
showSidebar.addEventListener("click", () => {
  sidebar.classList.remove("hidden");
  showSidebar.classList.remove("visible");
});

video.addEventListener("loadeddata", () => {
  emptyState.style.display = "none";
});


document.getElementById("sortMode").addEventListener("change", event => {
  sortMode = event.target.value;
  render();
});

document.getElementById("autoNext").addEventListener("change", event => {
  autoNext = event.target.checked;
});

function showCompletedToast(job) {
  if (notifiedJobs.has(job.id)) return;
  notifiedJobs.add(job.id);

  const box = document.getElementById("notifications");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <button class="toast-close" title="Fechar">×</button>
    <strong>✓ Conversão concluída</strong>
    <span>${escapeHtml(job.title)}</span>
    <div class="toast-timer"></div>
  `;
  box.prepend(toast);

  const timer = setTimeout(() => toast.remove(), 8000);
  toast.querySelector(".toast-close").addEventListener("click", () => {
    clearTimeout(timer);
    toast.remove();
  });
}

function playNextInQueue() {
  let list = [...jobs.values()].filter(j => j.status === "completed" && j.output);
  if (sortMode === "alpha") list.sort((a,b)=>a.title.localeCompare(b.title,"pt-BR"));
  else if (sortMode === "alphaDesc") list.sort((a,b)=>b.title.localeCompare(a.title,"pt-BR"));
  else list.sort((a,b)=>a.createdAt-b.createdAt);

  const i = list.findIndex(j => j.id === currentJob?.id);
  if (i >= 0 && list[i+1]) playJob(list[i+1]);
}

video.addEventListener("ended", () => {
  if (autoNext) playNextInQueue();
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
    const previous = jobs.get(data.job.id);
    jobs.set(data.job.id, data.job);

    // Quando o MP4 termina, troca automaticamente o player para o arquivo local.
    if (
      previous &&
      previous.status !== "completed" &&
      data.job.status === "completed"
    ) {
      showCompletedToast(data.job);

      if (currentJob?.id === data.job.id) {
        const position = video.currentTime || 0;
        const wasPlaying = !video.paused;
        currentJob = data.job;
        playUrl(data.job.output, position, wasPlaying);
      }
    }

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

    if (currentJob?.id === data.id) {
      currentJob = null;
      video.removeAttribute("src");
      video.load();
    }

    render();
  }
});

fetch("/api/jobs")
  .then(response => response.json())
  .then(list => {
    jobs = new Map(list.map(job => [job.id, job]));
    render();
  });
