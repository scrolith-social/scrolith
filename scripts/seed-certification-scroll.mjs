import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { requireLoopbackTestUrl } from './certificationTarget.mjs';
import { readStorageStateTokenFromFile } from './certificationStorageState.mjs';
import { pickCertificationInterestSurveyCandidateIds } from './certificationInterestSurvey.mjs';

const allowedProjects = new Set(['desktop-chrome', 'pixel-7', 'iphone-15', 'mobile-390']);
const project = String(process.env.CERT_BROWSER_PROJECT || '');
if (!allowedProjects.has(project)) throw new Error('invalid_browser_project');

const appUrl = new URL(requireLoopbackTestUrl(process.env.CERT_BASE_URL, 'CERT_BASE_URL'));
const apiUrl = new URL(requireLoopbackTestUrl(process.env.CERT_API_BASE, 'CERT_API_BASE'));
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

const ownerToken = readStorageStateTokenFromFile(ownerStatePath, appUrl.origin);
const viewerToken = readStorageStateTokenFromFile(viewerStatePath, appUrl.origin);
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
      // The Scroll route auto-advances when playback ends. Keep this local
      // fixture alive long enough for the authenticated UI assertions to run.
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 8_000));
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
  const viewerResponse = await fetch(`${apiBase}/auth/me`, {
    headers: { Authorization: `Bearer ${viewerToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  const viewerProfile = await requireJson(viewerResponse, 'viewer_profile');
  const viewerId = String(viewerProfile?.data?.user?.id || viewerProfile?.user?.id || viewerProfile?.data?.id || '').trim();
  if (!viewerId) throw new Error('viewer_profile_invalid');

  const fixtureIds = new Set();
  let selectedFixtureId = '';
  let lastFeedStatus = 0;
  let successfulUploads = 0;
  let successfulCreates = 0;
  // Production shows at most four deterministically ranked Scroll surveys.
  // Create until at least one synthetic fixture is in that eligible set.
  for (let attempt = 0; attempt < 8 && !selectedFixtureId; attempt += 1) {
    const video = await makeSyntheticVideo();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(video.base64, 'base64')], { type: video.mimeType }), `certification-scroll-${attempt + 1}.webm`);

    const uploadResponse = await fetch(`${apiBase}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(30_000)
    });
    const upload = await requireJson(uploadResponse, 'upload');
    const fileId = String(upload?.data?.id || upload?.data?.fileId || '').trim();
    if (upload?.success !== true || !fileId) throw new Error('upload_response_invalid');
    successfulUploads += 1;

    const createResponse = await fetch(`${apiBase}/scroll/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        title: `Certification interest survey fixture ${project} ${attempt + 1}`,
        description: 'Synthetic video fixture used by local authenticated browser certification.',
        visibility: 'public'
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const created = await requireJson(createResponse, 'scroll_create');
    const createdId = String(created?.data?.id || '').trim();
    if (created?.success !== true || !createdId) throw new Error('scroll_response_invalid');
    fixtureIds.add(createdId);
    successfulCreates += 1;

    // Match the default local certification profile's native Scroll page size.
    const feedResponse = await fetch(`${apiBase}/scroll/feed?limit=20`, {
      headers: { Authorization: `Bearer ${viewerToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    });
    lastFeedStatus = feedResponse.status;
    const feed = await requireJson(feedResponse, 'viewer_feed');
    const items = Array.isArray(feed?.data?.items) ? feed.data.items : [];
    if (![...fixtureIds].some((id) => items.some((item) => String(item?.id || '') === id))) {
      throw new Error('viewer_cannot_see_synthetic_scroll');
    }
    selectedFixtureId = pickCertificationInterestSurveyCandidateIds(
      items.map((item) => ({
        id: String(item?.id || '').startsWith('post-video:') ? '' : item?.id,
        authorId: item?.authorId,
        initialSignal: item?.viewer?.feedbackSignal
      })),
      viewerId,
      'scroll',
      4
    ).find((id) => fixtureIds.has(id)) || '';
  }
  if (!selectedFixtureId) throw new Error('synthetic_scroll_not_selected_for_interest_survey');

  console.log(`Synthetic playable Scroll fixture selected for ${project}; uploads=${successfulUploads}, creates=${successfulCreates}, viewerFeed=${lastFeedStatus}.`);
  console.log(`CERTIFICATION_SCROLL_FIXTURE_ID=${selectedFixtureId}`);
}

main().catch((error) => {
  const code = String(error?.message || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  console.error(`Certification Scroll fixture failed: ${code}`);
  process.exitCode = 1;
});
