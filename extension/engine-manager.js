'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'WrdUtilities',
  'InterpEngine'
);
const STATE = path.join(ROOT, 'install-state.json');
const PY = path.join(ROOT, 'python', 'python.exe');
const RUN = path.join(ROOT, 'engine', 'run_gmfss.py');
const WORKER = path.join(ROOT, 'engine', 'wrd_gmfss_worker.py');

let workerProcess = null;
let workerReadyPromise = null;
let stdoutBuffer = '';
const pendingJobs = new Map();
const preheatListeners = new Set();

let preheatTimer = null;
let preheatCountdownTimer = null;
let preheatPromise = null;
let preheatState = {
  status: 'idle',
  percent: 0,
  stage: 'Motor aguardando',
  width: 1920,
  height: 1080,
  scale: 1.0,
  precision: 'fp16'
};

function publishPreheatState(patch) {
  preheatState = Object.assign({}, preheatState, patch || {});
  for (const listener of preheatListeners) {
    try { listener(Object.assign({}, preheatState)); } catch (_) {}
  }
}

function onPreheatProgress(listener) {
  if (typeof listener !== 'function') return () => {};
  preheatListeners.add(listener);
  try { listener(Object.assign({}, preheatState)); } catch (_) {}
  return () => preheatListeners.delete(listener);
}

function getPreheatState() {
  return Object.assign({}, preheatState);
}

function state() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return null;
  }
}

function getStatus() {
  const s = state();
  const baseReady = !!(
    s &&
    s.status === 'ready' &&
    fs.existsSync(PY) &&
    fs.existsSync(RUN)
  );
  return {
    ready: baseReady,
    version: s && s.version,
    installRoot: ROOT,
    state: s,
    persistentWorkerInstalled: fs.existsSync(WORKER),
    persistentWorkerRunning: !!(
      workerProcess &&
      workerProcess.exitCode === null &&
      !workerProcess.killed
    )
  };
}

function installEngine({
  manifestUrl,
  installerPath,
  onProgress = () => {},
  force = false
}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      installerPath,
      '-ManifestUrl',
      manifestUrl,
      '-InstallRoot',
      ROOT
    ];
    if (force) args.push('-Force');

    const process = cp.spawn('powershell.exe', args, { windowsHide: true });
    let buffer = '';
    let errors = '';

    process.stdout.setEncoding('utf8');
    process.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('WRD_PROGRESS ')) {
          try {
            onProgress(JSON.parse(line.slice(13)));
          } catch (_) {}
        } else if (line.trim()) {
          onProgress({ stage: 'log', percent: null, message: line.trim() });
        }
      }
    });

    process.stderr.setEncoding('utf8');
    process.stderr.on('data', chunk => {
      errors += chunk;
      onProgress({ stage: 'log', percent: null, message: chunk.trim() });
    });

    process.on('error', reject);
    process.on('close', code => {
      if (code === 0) {
        resolve(getStatus());
      } else {
        reject(new Error(`Instalação falhou (${code}). ${errors}`));
      }
    });
  });
}

function rejectAllPending(error) {
  for (const [, job] of pendingJobs) {
    try {
      job.reject(error);
    } catch (_) {}
  }
  pendingJobs.clear();
}

function routeUnexpectedWorkerText(text, isError = false) {
  const clean = String(text || '').trim();
  if (!clean) return;
  for (const [, job] of pendingJobs) {
    try {
      job.onLog(`${isError ? '[WORKER ERRO] ' : '[WORKER] '}${clean}\n`);
    } catch (_) {}
  }
}

function handleWorkerMessage(message) {
  const id = message && message.id;
  const job = id ? pendingJobs.get(id) : null;

  if (message.type === 'ready') {
    publishPreheatState({
      status: 'model-ready',
      percent: Math.max(preheatState.percent || 0, 10),
      stage: 'Modelo carregado na GPU'
    });
    return;
  }

  if (message.type === 'preheat-progress') {
    publishPreheatState({
      status: message.status || 'running',
      percent: Number(message.percent || 0),
      stage: message.stage || 'Pré-aquecendo'
    });
  }

  if (!job) {
    if (message.type === 'log' || message.type === 'stderr') {
      routeUnexpectedWorkerText(
        message.message,
        message.type === 'stderr'
      );
    }
    return;
  }

  if (message.type === 'log' || message.type === 'stderr') {
    job.onLog(`${message.message || ''}\n`);
    return;
  }

  if (message.type === 'job-start') {
    job.onLog(
      `[WORKER] ${message.width}x${message.height} | ` +
      `interna ${message.paddedWidth}x${message.paddedHeight} | ` +
      `cache em memória: ${message.alreadyWarmResolution ? 'sim' : 'não'}\n`
    );
    return;
  }

  if (message.type === 'progress') {
    const percent =
      typeof message.percent === 'number'
        ? ` (${message.percent.toFixed(1)}%)`
        : '';
    job.onLog(
      `[PROGRESSO] ${message.current}/${message.total || '?'}${percent} | ` +
      `${Number(message.pairSeconds || 0).toFixed(2)}s no último par\n`
    );
    return;
  }

  if (message.type === 'done') {
    pendingJobs.delete(id);
    job.resolve({ code: 0, persistent: true, result: message.result });
    return;
  }

  if (message.type === 'error') {
    pendingJobs.delete(id);
    const detail = message.traceback ? `\n${message.traceback}` : '';
    job.reject(
      new Error(
        `${message.errorType || 'WorkerError'}: ${message.message || 'Falha'}${detail}`
      )
    );
  }
}

function startPersistentWorker() {
  if (
    workerProcess &&
    workerProcess.exitCode === null &&
    !workerProcess.killed &&
    workerReadyPromise
  ) {
    return workerReadyPromise;
  }

  if (!fs.existsSync(WORKER)) {
    return Promise.reject(
      new Error('Worker persistente ainda não foi instalado.')
    );
  }

  if (!fs.existsSync(PY)) {
    return Promise.reject(new Error('Python do motor não encontrado.'));
  }

  const environment = Object.assign({}, process.env, {
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    MIOPEN_FIND_MODE: 'DYNAMIC_HYBRID',
    MIOPEN_FIND_ENFORCE: 'NONE',
    MIOPEN_COMPILE_PARALLEL_LEVEL: '1',
    WRD_CUDNN_BENCHMARK: '1'
  });

  workerProcess = cp.spawn(PY, ['-u', WORKER], {
    cwd: ROOT,
    windowsHide: true,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  stdoutBuffer = '';

  workerReadyPromise = new Promise((resolve, reject) => {
    let settled = false;
    const startupTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('O worker demorou demais para carregar o GMFSS.'));
        try {
          workerProcess.kill();
        } catch (_) {}
      }
    }, 180000);

    workerProcess.stdout.setEncoding('utf8');
    workerProcess.stdout.on('data', chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch (_) {
          routeUnexpectedWorkerText(line);
          continue;
        }

        if (message.type === 'ready' && !settled) {
          settled = true;
          clearTimeout(startupTimeout);
          resolve(message);
        }
        handleWorkerMessage(message);
      }
    });

    workerProcess.stderr.setEncoding('utf8');
    workerProcess.stderr.on('data', chunk => {
      routeUnexpectedWorkerText(chunk, true);
    });

    workerProcess.on('error', error => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimeout);
        reject(error);
      }
      rejectAllPending(error);
    });

    workerProcess.on('close', code => {
      const error = new Error(
        `Worker persistente encerrou com código ${code}.`
      );
      if (!settled) {
        settled = true;
        clearTimeout(startupTimeout);
        reject(error);
      }
      rejectAllPending(error);
      workerProcess = null;
      workerReadyPromise = null;
      stdoutBuffer = '';
    });
  });

  return workerReadyPromise;
}

function sendWorkerCommand(payload, onLog = () => {}) {
  return startPersistentWorker().then(() => {
    if (!workerProcess || !workerProcess.stdin) {
      throw new Error('Worker persistente não está disponível.');
    }

    const id = payload.id || crypto.randomBytes(16).toString('hex');
    payload.id = id;

    return new Promise((resolve, reject) => {
      pendingJobs.set(id, { resolve, reject, onLog });
      try {
        workerProcess.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        pendingJobs.delete(id);
        reject(error);
      }
    });
  });
}

function clearPreheatTimers() {
  if (preheatTimer) {
    clearTimeout(preheatTimer);
    preheatTimer = null;
  }
  if (preheatCountdownTimer) {
    clearInterval(preheatCountdownTimer);
    preheatCountdownTimer = null;
  }
}

function cancelAutoPreheat(reason = 'Pré-aquecimento pausado') {
  clearPreheatTimers();

  if (preheatState.status === 'complete' || preheatState.status === 'idle') {
    return Promise.resolve(false);
  }

  publishPreheatState({ status: 'cancelling', stage: reason });

  if (!workerProcess || workerProcess.exitCode !== null) {
    publishPreheatState({ status: 'paused', percent: 0, stage: reason });
    return Promise.resolve(false);
  }

  return sendWorkerCommand({ cmd: 'cancel-preheat' })
    .then(() => true)
    .catch(() => false);
}

function runPreheatNow(options = {}) {
  clearPreheatTimers();

  const width = Number(options.width || 1920);
  const height = Number(options.height || 1080);
  const scale = Number(options.scale || 1.0);
  const precision = options.precision || 'fp16';
  const pauseMs = Number(options.pauseMs || 1200);

  if (preheatState.status === 'complete') {
    return Promise.resolve(getPreheatState());
  }
  if (preheatPromise) return preheatPromise;

  publishPreheatState({
    status: 'starting',
    percent: Math.max(preheatState.percent || 0, 10),
    stage: `Iniciando pré-aquecimento ${width}x${height}`,
    width,
    height,
    scale,
    precision
  });

  preheatPromise = sendWorkerCommand({
    cmd: 'preheat',
    width,
    height,
    scale,
    precision,
    pauseMs
  })
    .then(response => {
      const result = response && response.result;
      if (result && result.cancelled) {
        publishPreheatState({
          status: 'paused',
          percent: 0,
          stage: 'Pré-aquecimento pausado'
        });
      } else {
        publishPreheatState({
          status: 'complete',
          percent: 100,
          stage: `Motor pronto para ${width}x${height}`
        });
      }
      return getPreheatState();
    })
    .catch(error => {
      publishPreheatState({
        status: 'error',
        stage: `Falha no pré-aquecimento: ${error.message}`
      });
      throw error;
    })
    .finally(() => {
      preheatPromise = null;
    });

  return preheatPromise;
}

function startAutoPreheat(options = {}) {
  const delayMs = Math.max(5000, Number(options.delayMs || 30000));
  const width = Number(options.width || 1920);
  const height = Number(options.height || 1080);
  const scale = Number(options.scale || 1.0);
  const precision = options.precision || 'fp16';
  const pauseMs = Number(options.pauseMs || 1200);

  if (['complete', 'running', 'starting', 'countdown'].includes(preheatState.status)) {
    return Promise.resolve(getPreheatState());
  }

  clearPreheatTimers();
  publishPreheatState({
    status: 'loading-model',
    percent: 2,
    stage: 'Carregando modelo na GPU',
    width,
    height,
    scale,
    precision
  });

  return prepareWorker()
    .then(() => {
      let remaining = Math.ceil(delayMs / 1000);
      publishPreheatState({
        status: 'countdown',
        percent: 10,
        stage: `Pré-aquecimento em ${remaining}s`
      });

      preheatCountdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          publishPreheatState({
            status: 'countdown',
            percent: 10,
            stage: `Pré-aquecimento em ${remaining}s`
          });
        }
      }, 1000);

      preheatTimer = setTimeout(() => {
        clearPreheatTimers();
        runPreheatNow({ width, height, scale, precision, pauseMs }).catch(() => {});
      }, delayMs);

      return getPreheatState();
    })
    .catch(error => {
      publishPreheatState({
        status: 'error',
        percent: 0,
        stage: `Não foi possível carregar o motor: ${error.message}`
      });
      throw error;
    });
}

function markWarmFromInterpolation(response) {
  const result = response && response.result;
  if (!result) return;
  if (
    Number(result.width) === Number(preheatState.width) &&
    Number(result.height) === Number(preheatState.height) &&
    Number(result.scale) === Number(preheatState.scale) &&
    String(result.precision) === String(preheatState.precision)
  ) {
    publishPreheatState({
      status: 'complete',
      percent: 100,
      stage: `Motor aquecido pelo processamento ${result.width}x${result.height}`
    });
  }
}


function isNonFallbackWorkerError(error) {
  const text = String((error && error.message) || error || '');
  return (
    text.includes('OutputFileLockedError') ||
    text.includes('arquivo de saída está aberto') ||
    text.includes('arquivo de sa') && text.includes('aberto') ||
    text.includes('PermissionError') ||
    text.includes('WinError 32') ||
    text.includes('ValueError') ||
    text.includes('FileNotFoundError')
  );
}

function interpolateLegacy({
  input,
  output,
  factor = 2,
  scale = 1.0,
  precision = 'fp16',
  onLog = () => {}
}) {
  if (!getStatus().ready) {
    return Promise.reject(new Error('Motor não instalado.'));
  }

  const args = [
    RUN,
    path.resolve(input),
    '--factor',
    String(factor),
    '--scale',
    String(scale),
    '--precision',
    precision
  ];
  if (output) args.push('--output', path.resolve(output));

  return new Promise((resolve, reject) => {
    const process = cp.spawn(PY, args, {
      cwd: ROOT,
      windowsHide: true,
      env: Object.assign({}, process.env, {
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      })
    });
    let errors = '';

    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');

    process.stdout.on('data', chunk => onLog(chunk.toString()));
    process.stderr.on('data', chunk => {
      errors += chunk;
      onLog(chunk.toString());
    });
    process.on('error', reject);
    process.on('close', code => {
      if (code === 0) resolve({ code, persistent: false });
      else reject(new Error(`Interpolação falhou (${code}). ${errors}`));
    });
  });
}

function interpolate({
  input,
  output,
  factor = 2,
  scale = 1.0,
  precision = 'fp16',
  onLog = () => {}
}) {
  if (!getStatus().ready) {
    return Promise.reject(new Error('Motor não instalado.'));
  }

  if (!fs.existsSync(WORKER)) {
    onLog('[WORKER] Patch ausente; usando motor original.\n');
    return interpolateLegacy({
      input,
      output,
      factor,
      scale,
      precision,
      onLog
    });
  }

  return cancelAutoPreheat('Interpolação iniciada')
    .catch(() => false)
    .then(() =>
      sendWorkerCommand(
        {
          cmd: 'interpolate',
          input: path.resolve(input),
          output: output ? path.resolve(output) : undefined,
          factor,
          scale,
          precision
        },
        onLog
      )
    )
    .then(response => {
      markWarmFromInterpolation(response);
      return response;
    })
    .catch(error => {
      if (isNonFallbackWorkerError(error)) {
        onLog(`[WORKER] ${error.message}\n`);
        throw error;
      }

      onLog(
        `[WORKER] Processo persistente falhou; usando o motor original. ${error.message}\n`
      );
      return interpolateLegacy({
        input,
        output,
        factor,
        scale,
        precision,
        onLog
      });
    });
}

function prepareWorker(onLog = () => {}) {
  if (!getStatus().ready || !fs.existsSync(WORKER)) {
    return Promise.resolve(null);
  }
  return startPersistentWorker().then(info => {
    onLog(
      `[WORKER] GMFSS mantido na GPU | ${info.gpu} | PID ${info.pid}\n`
    );
    return info;
  });
}

function shutdownWorker() {
  clearPreheatTimers();
  if (!workerProcess || workerProcess.exitCode !== null) {
    return Promise.resolve();
  }
  return sendWorkerCommand({ cmd: 'shutdown' }).catch(() => {
    try {
      workerProcess.kill();
    } catch (_) {}
  });
}

try {
  process.once('exit', () => {
    try {
      if (workerProcess && workerProcess.exitCode === null) {
        workerProcess.kill();
      }
    } catch (_) {}
  });
} catch (_) {}

// preheat-ui.js starts model loading and auto warm-up.

module.exports = {
  INSTALL_ROOT: ROOT,
  getStatus,
  installEngine,
  interpolate,
  prepareWorker,
  startAutoPreheat,
  runPreheatNow,
  cancelAutoPreheat,
  onPreheatProgress,
  getPreheatState,
  shutdownWorker
};
