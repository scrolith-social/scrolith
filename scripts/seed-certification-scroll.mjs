import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { parseLoopbackHttpUrl, readStorageStateToken } from '../../geezle-backend/scripts/verify-certification-feed.mjs';

const allowedProjects = new Set(['desktop-chrome', 'pixel-7', 'iphone-15', 'mobile-390']);
const project = String(process.env.CERT_BROWSER_PROJECT || '');
if (!allowedProjects.has(project)) throw new Error('invalid_browser_project');

const appUrl = parseLoopbackHttpUrl(process.env.CERT_BASE_URL);
const apiUrl = parseLoopbackHttpUrl(process.env.CERT_API_BASE);
if (appUrl.search || appUrl.hash || apiUrl.search || apiUrl.hash || !apiUrl.pathname.replace(/\/$/, '').endsWith('/api')) {
  throw new Error('invalid_local_endpoint');
}

const ownerEmail = String(process.env.SCROLITH_E2E_SIGNUP_EMAIL || '').trim().toLowerCase();
const accountPattern = /^scrolith-e2e-\d+-\d+-(?:desktop-chrome|pixel-7|iphone-15|mobile-390)-a@example\.invalid$/;
if (!accountPattern.test(ownerEmail) || !ownerEmail.includes(`-${project}-a@`)) {
  throw new Error('invalid_synthetic_owner');
}

const ownerStatePath = resolve(String(process.env.CERT_STORAGE_STATE || ''));
const viewerStatePath = resolve(String(process.env.SCROLITH_E2E_VIEWER_STORAGE_STATE || ''));
if (!process.env.CERT_STORAGE_STATE || !process.env.SCROLITH_E2E_VIEWER_STORAGE_STATE) {
  throw new Error('missing_synthetic_storage_state');
}

const readToken = (path) => {
  let state;
  try {
    state = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('storage_state_unreadable');
  }
  return readStorageStateToken(state, appUrl.origin);
};

const ownerToken = readToken(ownerStatePath);
const viewerToken = readToken(viewerStatePath);
const apiBase = apiUrl.toString().replace(/\/+$/, '');

async function makeSyntheticVideo() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async () => {
      if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
        throw new Error('video_capture_unavailable');
      }
      const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error('webm_encoder_unavailable');

      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      const stopped = new Promise((resolveStop) => recorder.addEventListener('stop', resolveStop, { once: true }));
      const startedAt = performance.now();
      const draw = () => {
        const frame = Math.floor((performance.now() - startedAt) / 100);
        context.fillStyle = frame % 2 ? '#1d4ed8' : '#047857';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.font = 'bold 14px sans-serif';
        context.fillText('Scrolith test video', 10, 46);
      };
      draw();
      const timer = window.setInterval(draw, 100);
      recorder.start(100);
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1_200));
      window.clearInterval(timer);
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (blob.size < 100) throw new Error('recording_empty');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return { mimeType: recorder.mimeType || mimeType, base64: btoa(binary) };
    });
  } finally {
    await browser.close();
  }
}

async function requireJson(response, step) {
  if (!response.ok) throw new Error(`${step}_http_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${step}_invalid_json`);
  }
}

async function main() {
  const video = await makeSyntheticVideo();
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(video.base64, 'base64')], { type: video.mimeType }), 'certification-scroll.webm');

  const uploadResponse = await fetch(`${apiBase}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, Accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(30_000)
  });
  const upload = await requireJson(uploadResponse, 'upload');
  const fileId = String(upload?.data?.id || upload?.data?.fileId || '').trim();
  if (upload?.success !== true || !fileId) throw new Error('upload_response_invalid');

  const createResponse = await fetch(`${apiBase}/scroll/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId,
      title: `Certification interest survey fixture ${project}`,
      description: 'Synthetic video fixture used by local authenticated browser certification.',
      visibility: 'public'
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const created = await requireJson(createResponse, 'scroll_create');
  const scrollId = String(created?.data?.id || '').trim();
  if (created?.success !== true || !scrollId) throw new Error('scroll_response_invalid');

  const feedResponse = await fetch(`${apiBase}/scroll/feed?limit=60`, {
    headers: { Authorization: `Bearer ${viewerToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  const feed = await requireJson(feedResponse, 'viewer_feed');
  const items = Array.isArray(feed?.data?.items) ? feed.data.items : [];
  if (!items.some((item) => String(item?.id || '') === scrollId)) {
    throw new Error('viewer_cannot_see_synthetic_scroll');
  }

  console.log(`Synthetic playable Scroll fixture ready for ${project}; upload=${uploadResponse.status}, create=${createResponse.status}, viewerFeed=${feedResponse.status}.`);
}

main().catch((error) => {
  const code = String(error?.message || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  console.error(`Certification Scroll fixture failed: ${code}`);
  process.exitCode = 1;
});
