#!/usr/bin/env node
/**
 * comfy-generate.mjs — text-to-image via the ComfyUI instance on gpu2.
 *
 * Zero dependencies (node >= 18, built-in fetch). No secrets, no paid API:
 * generation is local on gpu2's RTX 4090s and therefore free.
 *
 * The graph below is built against what THIS install actually exposes
 * (verified through /object_info): the FLUX all-in-one fp8 checkpoints carry
 * their own CLIP-L + T5 + VAE, so CheckpointLoaderSimple is enough — no
 * DualCLIPLoader/VAELoader wiring needed. FLUX needs a 16-channel latent
 * (EmptySD3LatentImage, NOT EmptyLatentImage), cfg = 1.0, and its real
 * prompt-adherence knob is the FluxGuidance node.
 *
 * Usage:
 *   node scripts/comfy-generate.mjs --prompt "a fox" --seed 42 --out fox.png
 *   node scripts/comfy-generate.mjs --prompt "..." --model dev --width 1024 --height 1024
 *
 * Flags:
 *   --prompt   <str>  required
 *   --out      <path> required, local destination (.png)
 *   --seed     <int>  default 0. Same seed + same params => same image.
 *   --width/--height  default 1024. Multiples of 16.
 *   --model    schnell | dev | dev-full | sdxl        default schnell
 *   --steps    <int>  default: 4 (schnell) / 20 (dev) / 25 (sdxl)
 *   --guidance <flt>  default 3.5 (FLUX only, ignored by sdxl)
 *   --host     <url>  default $COMFY_HOST or http://192.168.1.74:8188
 *   --timeout  <sec>  default 1200 (a cold 17 GB checkpoint load is slow)
 *   --keep-remote     do not report the remote path as temporary
 */

import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const MODELS = {
  schnell: { ckpt: 'FLUX1/flux1-schnell-fp8.safetensors', steps: 4, family: 'flux' },
  dev: { ckpt: 'FLUX1/flux1-dev-fp8.safetensors', steps: 20, family: 'flux' },
  'dev-full': { ckpt: 'FLUX1/flux1-dev.safetensors', steps: 20, family: 'flux' },
  sdxl: { ckpt: 'sd_xl_base_1.0.safetensors', steps: 25, family: 'sdxl' },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/** Build the API-format graph. Node ids are strings, links are [nodeId, slot]. */
function buildWorkflow({ model, prompt, negative, seed, steps, width, height, guidance, prefix }) {
  const spec = MODELS[model];
  const g = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: spec.ckpt } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: prefix } },
  };

  if (spec.family === 'flux') {
    // FLUX is a guidance-distilled model: cfg stays at 1.0 and there is no real
    // negative prompt — the conventional negative is a zeroed-out conditioning.
    g['3'] = { class_type: 'FluxGuidance', inputs: { conditioning: ['2', 0], guidance } };
    g['4'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] } };
    g['5'] = { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } };
    g['6'] = {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], seed, steps, cfg: 1.0,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1.0,
        positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0],
      },
    };
  } else {
    g['4'] = { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } };
    g['5'] = { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } };
    g['6'] = {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], seed, steps, cfg: 7.0,
        sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1.0,
        positive: ['2', 0], negative: ['4', 0], latent_image: ['5', 0],
      },
    };
  }
  return g;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = (args.host || process.env.COMFY_HOST || 'http://192.168.1.74:8188').replace(/\/$/, '');

  if (!args.prompt || args.prompt === true) throw new Error('--prompt is required');
  if (!args.out || args.out === true) throw new Error('--out is required');

  const model = String(args.model || 'schnell');
  if (!MODELS[model]) throw new Error(`--model must be one of: ${Object.keys(MODELS).join(', ')}`);

  const seed = Number(args.seed ?? 0);
  const width = Number(args.width ?? 1024);
  const height = Number(args.height ?? 1024);
  const steps = Number(args.steps ?? MODELS[model].steps);
  const guidance = Number(args.guidance ?? 3.5);
  const timeoutMs = Number(args.timeout ?? 1200) * 1000;
  const negative = String(args.negative || 'blurry, low quality, watermark, text');

  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative integer');
  if (width % 16 || height % 16) throw new Error('--width/--height must be multiples of 16');

  const clientId = `aigent-${createHash('sha1').update(String(process.pid) + Date.now()).digest('hex').slice(0, 12)}`;
  const prefix = `aigent/${path.basename(String(args.out)).replace(/\.png$/i, '')}`;
  const workflow = buildWorkflow({ model, prompt: String(args.prompt), negative, seed, steps, width, height, guidance, prefix });

  if (args['dump-workflow']) {
    process.stdout.write(`${JSON.stringify(workflow, null, 2)}\n`);
    return;
  }

  const t0 = Date.now();
  const queued = await fetch(`${host}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!queued.ok) {
    throw new Error(`POST /prompt -> HTTP ${queued.status}: ${(await queued.text()).slice(0, 1200)}`);
  }
  const { prompt_id: promptId, node_errors: nodeErrors } = await queued.json();
  if (nodeErrors && Object.keys(nodeErrors).length) {
    throw new Error(`graph rejected: ${JSON.stringify(nodeErrors).slice(0, 1200)}`);
  }
  process.stderr.write(`queued ${promptId} (${model}, ${steps} steps, ${width}x${height}, seed ${seed})\n`);

  // Poll history. ComfyUI has a websocket channel too, but polling keeps this
  // dependency-free and is plenty for a job measured in tens of seconds.
  let entry = null;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${host}/history/${promptId}`);
    if (!res.ok) continue;
    const hist = await res.json();
    if (hist[promptId]) {
      const status = hist[promptId].status || {};
      if (status.completed || status.status_str === 'success') { entry = hist[promptId]; break; }
      if (status.status_str === 'error') {
        throw new Error(`execution failed: ${JSON.stringify(status.messages || []).slice(0, 1500)}`);
      }
    }
  }
  if (!entry) throw new Error(`timed out after ${timeoutMs / 1000}s waiting on ${promptId}`);

  const images = Object.values(entry.outputs || {}).flatMap((o) => o.images || []);
  if (!images.length) throw new Error('run completed but produced no image');
  const img = images[0];

  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
  const bin = await fetch(`${host}/view?${q}`);
  if (!bin.ok) throw new Error(`GET /view -> HTTP ${bin.status}`);
  const buf = Buffer.from(await bin.arrayBuffer());
  await writeFile(args.out, buf);

  // Server-side wall clock: the delta between ComfyUI's own execution_start and
  // execution_success messages. This excludes our queue wait and the download,
  // so it is the honest per-image cost.
  const msgs = entry.status?.messages || [];
  const at = (name) => msgs.find((m) => m[0] === name)?.[1]?.timestamp;
  const serverMs = at('execution_success') && at('execution_start') ? at('execution_success') - at('execution_start') : null;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    out: path.resolve(String(args.out)),
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    model, ckpt: MODELS[model].ckpt, seed, steps, width, height,
    guidance: MODELS[model].family === 'flux' ? guidance : null,
    remote: `${img.subfolder ? `${img.subfolder}/` : ''}${img.filename}`,
    serverMs, totalMs: Date.now() - t0,
  }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
