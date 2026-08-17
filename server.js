import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import http from "node:http";

// Caminho absoluto do FFmpeg no Windows.
// Usamos o caminho completo para não depender do PATH.
const FFMPEG_PATH = "C:\\ffmpeg\\bin\\ffmpeg.exe";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = join(__dirname, "downloads");

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));
app.use("/downloads", express.static(OUTPUT_DIR, {
  fallthrough: false,
  setHeaders(res) {
    res.setHeader("Content-Disposition", "attachment");
  }
}));

const jobs = new Map();
const queue = [];
let running = false;

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
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
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseTime(text) {
  // Converte HH:MM:SS.microsegundos para segundos.
  const match = text.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function enqueue(job) {
  jobs.set(job.id, job);
  queue.push(job.id);
  broadcast({ type: "job", job });
  processQueue();
}

async function processQueue() {
  if (running || queue.length === 0) return;
  running = true;

  const id = queue.shift();
  const job = jobs.get(id);

  if (!job) {
    running = false;
    return processQueue();
  }

  job.status = "downloading";
  broadcast({ type: "job", job });

  const output = join(OUTPUT_DIR, `${job.id}-${safeName(job.title)}.mp4`);
  job.output = `/downloads/${basename(output)}`;

  // Primeiro tentamos apenas remuxar (sem perda de qualidade).
  // Se o codec não for compatível com MP4, fazemos uma segunda tentativa
  // com transcodificação H.264/AAC.
  const args = [
    "-hide_banner",
    "-y",
    "-i", job.url,
    "-c", "copy",
    "-movflags", "+faststart",
    output
  ];

  const ff = spawn(FFMPEG_PATH, args);
  job.pid = ff.pid;

  let stderr = "";

  ff.stderr.on("data", chunk => {
    const text = chunk.toString();
    stderr += text;

    // Mostra progresso aproximado com base no tempo processado.
    const timeMatch = text.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
    if (timeMatch) {
      const current = parseTime(timeMatch[1]);
      if (current != null && job.duration > 0) {
        job.progress = Math.min(99, Math.round((current / job.duration) * 100));
      } else {
        job.progress = Math.min(95, job.progress + 1);
      }
      broadcast({ type: "progress", id: job.id, progress: job.progress });
    }

    const durationMatch = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
    if (durationMatch && !job.duration) {
      job.duration = parseTime(durationMatch[1]) || 0;
      broadcast({ type: "job", job });
    }
  });

  // ff.on("close", code => {
	ff.on("error", (error) => {
    job.pid = null;

    if (code === 0) {
      job.status = "completed";
      job.progress = 100;
      job.finishedAt = Date.now();
      broadcast({ type: "job", job });
      running = false;
      return processQueue();
    }

    // Fallback: transcodificação.
    job.status = "converting";
    job.progress = 0;
    broadcast({ type: "job", job });

    const fallback = spawn(FFMPEG_PATH, [
      "-hide_banner",
      "-y",
      "-i", job.url,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      output
    ]);

    job.pid = fallback.pid;

    fallback.stderr.on("data", chunk => {
      const text = chunk.toString();

      const durationMatch = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
      if (durationMatch && !job.duration) {
        job.duration = parseTime(durationMatch[1]) || 0;
      }

      const timeMatch = text.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
      if (timeMatch) {
        const current = parseTime(timeMatch[1]);
        if (current != null && job.duration > 0) {
          job.progress = Math.min(99, Math.round((current / job.duration) * 100));
          broadcast({ type: "progress", id: job.id, progress: job.progress });
        }
      }
    });

    fallback.on("close", fallbackCode => {
      job.pid = null;

      if (fallbackCode === 0) {
        job.status = "completed";
        job.progress = 100;
        job.finishedAt = Date.now();
        broadcast({ type: "job", job });
      } else {
        job.status = "error";
        job.error = "O FFmpeg não conseguiu baixar/converter este M3U8.";
        broadcast({ type: "job", job });
      }

      running = false;
      processQueue();
    });
  });
}

app.get("/api/jobs", (req, res) => {
  res.json([...jobs.values()].reverse());
});

app.post("/api/jobs", (req, res) => {
  const { url, title } = req.body;

  if (!validUrl(url)) {
    return res.status(400).json({ error: "Informe uma URL HTTP/HTTPS válida." });
  }

  const job = {
    id: crypto.randomUUID(),
    url,
    title: title?.trim() || `Vídeo ${new Date().toLocaleString("pt-BR")}`,
    status: "queued",
    progress: 0,
    duration: 0,
    createdAt: Date.now()
  };

  enqueue(job);
  res.status(201).json(job);
});

app.delete("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.sendStatus(404);

  if (job.pid) {
    try { process.kill(job.pid); } catch {}
  }

  jobs.delete(job.id);
  broadcast({ type: "removed", id: job.id });
  res.sendStatus(204);
});

wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "snapshot", jobs: [...jobs.values()].reverse() }));
});

server.listen(PORT, () => {
  console.log(`M3U8 Player Converter: http://localhost:${PORT}`);
});
