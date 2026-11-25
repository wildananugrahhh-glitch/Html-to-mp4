import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

const $ = (id) => document.getElementById(id);
const htmlInput = $("htmlInput");
const previewFrame = $("previewFrame");
const previewWrap = document.querySelector(".preview-frame-wrap");
const renderBtn = $("renderBtn");
const message = $("message");
const progressArea = $("progressArea");
const progressBar = $("progressBar");
const progressLabel = $("progressLabel");
const progressPercent = $("progressPercent");
const downloadArea = $("downloadArea");
const resultVideo = $("resultVideo");
const downloadLink = $("downloadLink");

const sample = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: grid; place-items: center;
    overflow: hidden; color: white; font-family: Arial, sans-serif;
    background: radial-gradient(circle at 20% 20%, #6545b8, transparent 38%),
                linear-gradient(135deg, #101b3c, #080d1d);
  }
  .card { text-align: center; animation: float 2s ease-in-out infinite alternate; }
  .orb {
    width: 90px; height: 90px; border-radius: 50%; margin: 0 auto 22px;
    background: linear-gradient(135deg, #9d8aff, #53e2c1);
    box-shadow: 0 0 55px #8c72ff99;
    animation: spin 5s linear infinite;
  }
  h1 { font-size: clamp(28px, 7vw, 58px); margin: 0 0 10px; }
  p { color: #c9d1ee; letter-spacing: 3px; font-size: 12px; }
  @keyframes float { to { transform: translateY(-18px); } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="card">
    <div class="orb"></div>
    <h1>Hello, Creator!</h1>
    <p>YOUR HTML VIDEO STARTS HERE</p>
  </div>
</body>
</html>`;

let ffmpeg = null;
let ffmpegLoading = null;
let currentVideoUrl = null;
let busy = false;

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = "message" + (type ? " " + type : "");
}
function setProgress(value, label) {
  const n = Math.max(0, Math.min(100, Math.round(value)));
  progressBar.style.width = n + "%";
  progressPercent.textContent = n + "%";
  progressLabel.textContent = label;
}
function getDimensions() {
  const [baseW, baseH] = $("resolution").value.split("x").map(Number);
  const [rw, rh] = $("ratio").value.split(":").map(Number);
  let width, height;
  if (rw >= rh) {
    width = baseW;
    height = Math.round(width * rh / rw);
  } else {
    height = baseH;
    width = Math.round(height * rw / rh);
  }
  // H.264 requires even dimensions.
  return { width: width - width % 2, height: height - height % 2 };
}
function updateResolutionNote() {
  const { width, height } = getDimensions();
  $("resolutionNote").textContent = `Output: ${width} × ${height} px`;
  previewWrap.style.aspectRatio = `${width} / ${height}`;
}
function buildPreview() {
  const code = htmlInput.value.trim();
  if (!code) {
    previewFrame.srcdoc = "";
    $("previewStatus").textContent = "Menunggu kode";
    $("previewStatus").classList.remove("ready");
    return;
  }
  previewFrame.srcdoc = code;
  $("previewStatus").textContent = "Preview diperbarui";
  $("previewStatus").classList.add("ready");
  setMessage("Preview siap. Periksa hasil sebelum render.");
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Gagal membuat frame canvas.")), type);
  });
}
async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async () => {
    setMessage("Mengunduh mesin konversi MP4. Pertama kali bisa memerlukan waktu cukup lama...");
    const instance = new FFmpeg();
    instance.on("log", ({ message: logMessage }) => {
      if (logMessage && /error/i.test(logMessage)) console.warn("FFmpeg:", logMessage);
    });
    const coreBase = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
    await instance.load({
      coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm")
    });
    ffmpeg = instance;
    return instance;
  })();
  try { return await ffmpegLoading; }
  finally { ffmpegLoading = null; }
}

async function renderVideo() {
  if (busy) return;
  const code = htmlInput.value.trim();
  if (!code) {
    setMessage("Masukkan kode HTML terlebih dahulu.", "error");
    return;
  }
  if (!window.html2canvas) {
    setMessage("Library preview tidak berhasil dimuat. Periksa koneksi internet lalu muat ulang halaman.", "error");
    return;
  }
  busy = true;
  renderBtn.disabled = true;
  downloadArea.hidden = true;
  progressArea.hidden = false;
  setProgress(0, "Menyiapkan preview...");
  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = null;
  }

  let recorder = null;
  let stream = null;
  let frameCanvas = null;
  try {
    buildPreview();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1500);
      previewFrame.onload = () => { clearTimeout(timer); resolve(); };
      previewFrame.onerror = () => { clearTimeout(timer); reject(new Error("Preview gagal dimuat.")); };
    });

    const { width, height } = getDimensions();
    const fps = Number($("fps").value);
    const duration = Number($("duration").value);
    const totalFrames = fps * duration;
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = width;
    captureCanvas.height = height;
    const ctx = captureCanvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas tidak didukung browser ini.");

    if (!captureCanvas.captureStream || !window.MediaRecorder) {
      throw new Error("Browser ini belum mendukung perekaman canvas. Coba Chrome versi terbaru.");
    }
    stream = captureCanvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      throw new Error("Perekaman WebM tidak didukung browser ini.");
    }
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.min(12_000_000, width * height * fps * 0.12) });
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(new Error("Perekaman browser gagal."));
    });
    recorder.start(250);

    const frameDelay = 1000 / fps;
    const doc = previewFrame.contentDocument;
    if (!doc || !doc.documentElement) throw new Error("Dokumen preview tidak dapat diakses.");
    for (let i = 0; i < totalFrames; i++) {
      const start = performance.now();
      const rendered = await window.html2canvas(doc.documentElement, {
        backgroundColor: null,
        width: doc.documentElement.scrollWidth || width,
        height: doc.documentElement.scrollHeight || height,
        windowWidth: width,
        windowHeight: height,
        scale: Math.min(width / Math.max(1, doc.documentElement.scrollWidth || width), height / Math.max(1, doc.documentElement.scrollHeight || height)),
        useCORS: true,
        logging: false
      });
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / rendered.width, height / rendered.height);
      const drawW = rendered.width * scale;
      const drawH = rendered.height * scale;
      ctx.drawImage(rendered, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
      rendered.width = 1;
      rendered.height = 1;
      setProgress((i + 1) / totalFrames * 68, `Merekam frame ${i + 1} dari ${totalFrames}...`);
      const remaining = frameDelay - (performance.now() - start);
      if (remaining > 0) await wait(remaining);
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    stream = null;
    const webmBlob = new Blob(chunks, { type: "video/webm" });
    if (!webmBlob.size) throw new Error("Hasil rekaman kosong.");

    setProgress(70, "Memuat konverter MP4...");
    const engine = await loadFFmpeg();
    setProgress(78, "Mengonversi ke MP4...");
    const inputName = "recording.webm";
    const outputName = "html-to-mp4.mp4";
    await engine.writeFile(inputName, new Uint8Array(await webmBlob.arrayBuffer()));
    await engine.exec([
      "-i", inputName,
      "-an",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-preset", "ultrafast",
      "-crf", "23",
      outputName
    ]);
    const data = await engine.readFile(outputName);
    const mp4Blob = new Blob([data.buffer], { type: "video/mp4" });
    if (!mp4Blob.size) throw new Error("Konversi MP4 menghasilkan file kosong.");
    try { await engine.deleteFile(inputName); await engine.deleteFile(outputName); } catch (_) {}

    currentVideoUrl = URL.createObjectURL(mp4Blob);
    resultVideo.src = currentVideoUrl;
    downloadLink.href = currentVideoUrl;
    downloadLink.download = "html-to-mp4.mp4";
    downloadArea.hidden = false;
    setProgress(100, "Selesai!");
    setMessage(`Berhasil! Ukuran video ${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(error?.message || "Terjadi kesalahan saat render.", "error");
    setProgress(0, "Render gagal");
  } finally {
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (_) {}
    }
    if (stream) stream.getTracks().forEach(track => track.stop());
    busy = false;
    renderBtn.disabled = false;
  }
}

$("previewBtn").addEventListener("click", buildPreview);
$("sampleBtn").addEventListener("click", () => {
  htmlInput.value = sample;
  buildPreview();
});
$("clearBtn").addEventListener("click", () => {
  htmlInput.value = "";
  buildPreview();
  setMessage("Editor dibersihkan.");
});
renderBtn.addEventListener("click", renderVideo);
$("resolution").addEventListener("change", updateResolutionNote);
$("ratio").addEventListener("change", updateResolutionNote);
htmlInput.value = sample;
updateResolutionNote();
buildPreview();
