import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import http from "node:http";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = join(__dirname, "downloads");

// Caminho confirmado no Windows do usuário.
const FFMPEG_PATH = "C:\\ffmpeg\\bin\\ffmpeg.exe";

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

// Permite reproduzir o MP4 pelo navegador e baixá-lo quando concluído.
app.use("/downloads", express.static(OUTPUT_DIR, {
  acceptRanges: true,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache");
  }
}));

const jobs = new Map();
const queue = [];
let running = false;

function broadcast(payload) {
  const message = JSON.stringify(payload);

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function safeName(value) {
  return (value || "video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "video";
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function updateJob(job) {
  jobs.set(job.id, job);
  broadcast({ type: "job", job });
}

function startFfmpeg(args) {
  // O caminho absoluto evita problemas com PATH do Windows.
  return spawn(FFMPEG_PATH, args, {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"]
  });
}

function finishJob(job, output) {
  // Não declaramos "concluído" somente porque o FFmpeg encerrou.
  // Também verificamos se o arquivo realmente existe e possui conteúdo.
  if (!existsSync(output)) {
    return false;
  }

  try {
    const size = statSync(output).size;

    if (size <= 1024) {
      return false;
    }

    job.status = "completed";
    job.progress = 100;
    job.output = `/downloads/${basename(output)}`;
    job.size = size;
    job.pid = null;
    job.finishedAt = Date.now();
    job.error = null;

    updateJob(job);
    return true;
  } catch {
    return false;
  }
}

function processQueue() {
  if (running || queue.length === 0) {
    return;
  }

  running = true;

  const id = queue.shift();
  const job = jobs.get(id);

  if (!job) {
    running = false;
    processQueue();
    return;
  }

  const output = join(
    OUTPUT_DIR,
    `${job.id}-${safeName(job.title)}.mp4`
  );

  job.output = `/downloads/${basename(output)}`;
  job.status = "downloading";
  job.progress = 0;
  updateJob(job);

  // Primeira tentativa: apenas copiar os codecs.
  // É muito mais rápido porque não recodifica o vídeo.
  const remuxArgs = [
    "-hide_banner",
    "-y",
    "-i", job.url,
    "-c", "copy",
    "-movflags", "+faststart",
    "-progress", "pipe:2",
    "-nostats",
    output
  ];

  let ffmpeg;

  try {
    ffmpeg = startFfmpeg(remuxArgs);
    job.pid = ffmpeg.pid;
  } catch (error) {
    job.status = "error";
    job.error = `Não foi possível iniciar o FFmpeg: ${error.message}`;
    job.pid = null;
    updateJob(job);
    running = false;
    processQueue();
    return;
  }

  let buffer = "";

  ffmpeg.stderr.on("data", chunk => {
    buffer += chunk.toString();

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const [key, value] = line.split("=");

      if (key === "out_time_ms" && job.duration > 0) {
        const seconds = Number(value) / 1000000;

        job.progress = Math.min(
          99,
          Math.floor((seconds / job.duration) * 100)
        );

        broadcast({
          type: "progress",
          id: job.id,
          progress: job.progress
        });
      }
    }
  });

  // Impede o erro "Unhandled 'error' event".
  ffmpeg.on("error", error => {
    job.pid = null;
    job.status = "error";
    job.error = `Erro ao iniciar FFmpeg: ${error.message}`;
    updateJob(job);

    running = false;
    processQueue();
  });

  ffmpeg.on("close", code => {
    job.pid = null;

    if (code === 0 && finishJob(job, output)) {
      running = false;
      processQueue();
      return;
    }

    // Caso o remux não seja compatível, fazemos transcodificação.
    job.status = "converting";
    job.progress = 0;
    updateJob(job);

    let converter;

    try {
      converter = startFfmpeg([
        "-hide_banner",
        "-y",
        "-i", job.url,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "160k",
        "-movflags", "+faststart",
        "-progress", "pipe:2",
        "-nostats",
        output
      ]);

      job.pid = converter.pid;
    } catch (error) {
      job.status = "error";
      job.error = `Erro ao iniciar conversão: ${error.message}`;
      job.pid = null;
      updateJob(job);

      running = false;
      processQueue();
      return;
    }

    let convertBuffer = "";

    converter.stderr.on("data", chunk => {
      convertBuffer += chunk.toString();

      const lines = convertBuffer.split(/\r?\n/);
      convertBuffer = lines.pop() || "";

      for (const line of lines) {
        const [key, value] = line.split("=");

        if (key === "out_time_ms" && job.duration > 0) {
          const seconds = Number(value) / 1000000;

          job.progress = Math.min(
            99,
            Math.floor((seconds / job.duration) * 100)
          );

          broadcast({
            type: "progress",
            id: job.id,
            progress: job.progress
          });
        }
      }
    });

    converter.on("error", error => {
      job.pid = null;
      job.status = "error";
      job.error = `Erro durante a conversão: ${error.message}`;
      updateJob(job);

      running = false;
      processQueue();
    });

    converter.on("close", code => {
      job.pid = null;

      if (code === 0 && finishJob(job, output)) {
        running = false;
        processQueue();
        return;
      }

      job.status = "error";
      job.progress = 0;
      job.error = "FFmpeg terminou, mas o MP4 não foi criado corretamente.";
      updateJob(job);

      running = false;
      processQueue();
    });
  });
}

app.get("/api/jobs", (req, res) => {
  res.json([...jobs.values()].reverse());
});

app.get("/api/ffmpeg", (req, res) => {
  res.json({
    path: FFMPEG_PATH,
    exists: existsSync(FFMPEG_PATH)
  });
});

app.post("/api/jobs", (req, res) => {
  const { url, title } = req.body;

  if (!validUrl(url)) {
    return res.status(400).json({
      error: "Informe uma URL HTTP/HTTPS válida."
    });
  }

  if (!existsSync(FFMPEG_PATH)) {
    return res.status(500).json({
      error: `FFmpeg não encontrado em ${FFMPEG_PATH}`
    });
  }

  const job = {
    id: crypto.randomUUID(),
    url,
    title: title?.trim() || `Vídeo ${new Date().toLocaleString("pt-BR")}`,
    status: "queued",
    progress: 0,
    duration: 0,
    output: null,
    size: 0,
    createdAt: Date.now(),
    pid: null,
    error: null
  };

  jobs.set(job.id, job);
  queue.push(job.id);
  broadcast({ type: "job", job });

  processQueue();

  res.status(201).json(job);
});

app.delete("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.sendStatus(404);
  }

  if (job.pid) {
    try {
      process.kill(job.pid);
    } catch {}
  }

  jobs.delete(job.id);
  broadcast({
    type: "removed",
    id: job.id
  });

  res.sendStatus(204);
});

wss.on("connection", ws => {
  ws.send(JSON.stringify({
    type: "snapshot",
    jobs: [...jobs.values()].reverse()
  }));
});

server.listen(PORT, () => {
  console.log(`M3U8 Studio: http://localhost:${PORT}`);
  console.log(`FFmpeg: ${FFMPEG_PATH}`);
});
