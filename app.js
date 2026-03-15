const STORAGE_KEY = "relative-noise-room-analyzer";
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20000;
const DISPLAY_POINTS = 320;
const HISTORY_POINTS = 180;
const MAX_SNAPSHOTS = 10;

const octaveBands = [
  { label: "31.5 Hz", center: 31.5, low: 22.3, high: 44.5, note: "Structure-borne rumble" },
  { label: "63 Hz", center: 63, low: 44.5, high: 89.1, note: "Sub and floor transfer" },
  { label: "125 Hz", center: 125, low: 89.1, high: 177, note: "Wall flex / boom" },
  { label: "250 Hz", center: 250, low: 177, high: 354, note: "Low-mid bleed" },
  { label: "500 Hz", center: 500, low: 354, high: 707, note: "Speech body" },
  { label: "1 kHz", center: 1000, low: 707, high: 1414, note: "Speech intelligibility" },
  { label: "2 kHz", center: 2000, low: 1414, high: 2828, note: "Door and seal leaks" },
  { label: "4 kHz", center: 4000, low: 2828, high: 5657, note: "Sharp edge leakage" },
  { label: "8 kHz", center: 8000, low: 5657, high: 11314, note: "Air gaps / hiss" },
  { label: "16 kHz", center: 16000, low: 11314, high: 20000, note: "Fine high-frequency spill" },
];

const focusPresets = {
  balanced(freq) {
    if (freq < 40 || freq > MAX_FREQUENCY) return 0;
    return 1;
  },
  speech(freq) {
    if (freq < 80 || freq > 8000) return 0;
    if (freq < 250) return 0.65;
    if (freq < 4000) return 1.5;
    return 0.85;
  },
  bass(freq) {
    if (freq < 20 || freq > 400) return 0;
    if (freq < 80) return 1.7;
    if (freq < 160) return 1.45;
    return 0.9;
  },
  detail(freq) {
    if (freq < 1000 || freq > MAX_FREQUENCY) return 0;
    if (freq < 4000) return 1;
    return 1.4;
  },
};

const els = {
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  captureReferenceButton: document.getElementById("captureReferenceButton"),
  clearReferenceButton: document.getElementById("clearReferenceButton"),
  captureSnapshotButton: document.getElementById("captureSnapshotButton"),
  togglePeakHoldButton: document.getElementById("togglePeakHoldButton"),
  snapshotLabel: document.getElementById("snapshotLabel"),
  focusPreset: document.getElementById("focusPreset"),
  viewMode: document.getElementById("viewMode"),
  averagingWindow: document.getElementById("averagingWindow"),
  averagingWindowValue: document.getElementById("averagingWindowValue"),
  smoothingControl: document.getElementById("smoothingControl"),
  smoothingValue: document.getElementById("smoothingValue"),
  historyDepth: document.getElementById("historyDepth"),
  historyDepthValue: document.getElementById("historyDepthValue"),
  captureStatus: document.getElementById("captureStatus"),
  sessionState: document.getElementById("sessionState"),
  sessionHint: document.getElementById("sessionHint"),
  broadbandDelta: document.getElementById("broadbandDelta"),
  broadbandNote: document.getElementById("broadbandNote"),
  dominantBand: document.getElementById("dominantBand"),
  dominantBandNote: document.getElementById("dominantBandNote"),
  stabilityValue: document.getElementById("stabilityValue"),
  stabilityNote: document.getElementById("stabilityNote"),
  cursorReadout: document.getElementById("cursorReadout"),
  spectrumCanvas: document.getElementById("spectrumCanvas"),
  spectrogramCanvas: document.getElementById("spectrogramCanvas"),
  bandCards: document.getElementById("bandCards"),
  insightSummary: document.getElementById("insightSummary"),
  insightList: document.getElementById("insightList"),
  snapshotList: document.getElementById("snapshotList"),
};

const state = {
  audioContext: null,
  analyser: null,
  mediaStream: null,
  sourceNode: null,
  animationFrame: 0,
  floatData: null,
  smoothedSpectrum: null,
  peakSpectrum: null,
  sampleRate: 48000,
  fftSize: 8192,
  running: false,
  focusPreset: "speech",
  viewMode: "hybrid",
  averagingWindowMs: 1400,
  smoothing: 0.74,
  historyDepth: 160,
  history: [],
  displayedMetrics: null,
  currentMetrics: null,
  captureJob: null,
  lastHistoryPushAt: 0,
  lastUiPaintAt: 0,
  lastSpectrumHover: null,
  peakHold: false,
  snapshots: [],
  referenceId: null,
  displayFrequencies: [],
  historyFrequencies: [],
  stabilityHistory: [],
  hasSpectrumSeeded: false,
};

loadPersistedState();
wireEvents();
resizeCanvas(els.spectrumCanvas);
resizeCanvas(els.spectrogramCanvas);
renderSnapshotList();
renderBandCards([]);
renderInsights(null);
updateControlReadouts();
syncControlStates();
drawSpectrum(null);
drawSpectrogram();

function wireEvents() {
  els.startButton.addEventListener("click", startAudio);
  els.stopButton.addEventListener("click", stopAudio);
  els.captureReferenceButton.addEventListener("click", () => startCapture("reference", getLabelValue("Reference")));
  els.clearReferenceButton.addEventListener("click", clearReference);
  els.captureSnapshotButton.addEventListener("click", () => startCapture("snapshot", getLabelValue("Snapshot")));
  els.togglePeakHoldButton.addEventListener("click", togglePeakHold);

  els.focusPreset.addEventListener("change", () => {
    state.focusPreset = els.focusPreset.value;
    renderFrame(true);
  });

  els.viewMode.addEventListener("change", () => {
    state.viewMode = els.viewMode.value;
    drawSpectrum(state.displayedMetrics);
  });

  els.averagingWindow.addEventListener("input", updateControlReadouts);
  els.smoothingControl.addEventListener("input", () => {
    state.smoothing = Number(els.smoothingControl.value);
    if (state.analyser) {
      state.analyser.smoothingTimeConstant = state.smoothing;
    }
    updateControlReadouts();
  });
  els.historyDepth.addEventListener("input", () => {
    state.historyDepth = Number(els.historyDepth.value);
    if (state.history.length > state.historyDepth) {
      state.history = state.history.slice(-state.historyDepth);
    }
    updateControlReadouts();
    drawSpectrogram();
  });

  window.addEventListener("resize", () => {
    resizeCanvas(els.spectrumCanvas);
    resizeCanvas(els.spectrogramCanvas);
    drawSpectrum(state.displayedMetrics);
    drawSpectrogram();
  });

  els.spectrumCanvas.addEventListener("mousemove", onSpectrumHover);
  els.spectrumCanvas.addEventListener("mouseleave", () => {
    state.lastSpectrumHover = null;
    els.cursorReadout.textContent = "Hover the spectrum for a frequency readout.";
    drawSpectrum(state.displayedMetrics);
  });
}

async function startAudio() {
  if (state.running) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextCtor();
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = state.fftSize;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = state.smoothing;

    sourceNode.connect(analyser);

    state.audioContext = audioContext;
    state.mediaStream = stream;
    state.sourceNode = sourceNode;
    state.analyser = analyser;
    state.floatData = new Float32Array(analyser.frequencyBinCount);
    state.smoothedSpectrum = new Float32Array(analyser.frequencyBinCount);
    state.peakSpectrum = new Float32Array(analyser.frequencyBinCount);
    state.sampleRate = audioContext.sampleRate;
    state.displayFrequencies = buildLogFrequencies(DISPLAY_POINTS);
    state.historyFrequencies = buildLogFrequencies(HISTORY_POINTS);
    state.running = true;
    state.history = [];
    state.stabilityHistory = [];
    state.hasSpectrumSeeded = false;
    state.lastHistoryPushAt = 0;
    state.lastUiPaintAt = 0;

    updateSessionState("Listening", "Capture a reference at the source side or before treatment.");
    els.captureStatus.textContent = "Microphone live";
    syncControlStates();

    loop();
  } catch (error) {
    const message = error && error.message ? error.message : "Unable to access the microphone.";
    updateSessionState("Input blocked", "Grant microphone access and use localhost if the browser rejects insecure contexts.");
    els.captureStatus.textContent = "Microphone error";
    els.broadbandDelta.textContent = "--";
    els.broadbandNote.textContent = message;
    console.error(error);
  }
}

function stopAudio() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }

  if (state.audioContext) {
    state.audioContext.close();
  }

  state.audioContext = null;
  state.mediaStream = null;
  state.sourceNode = null;
  state.analyser = null;
  state.floatData = null;
  state.smoothedSpectrum = null;
  state.peakSpectrum = null;
  state.running = false;
  state.captureJob = null;
  state.lastSpectrumHover = null;
  state.history = [];
  state.stabilityHistory = [];
  state.hasSpectrumSeeded = false;
  state.currentMetrics = null;
  state.displayedMetrics = null;

  updateSessionState("Idle", "Start the microphone, then capture a reference.");
  els.captureStatus.textContent = "Microphone offline";
  els.cursorReadout.textContent = "Hover the spectrum for a frequency readout.";
  resetTopMetrics();
  renderBandCards([]);
  renderInsights(null);
  syncControlStates();
  drawSpectrum(null);
  drawSpectrogram();
}

function loop(timestamp = performance.now()) {
  if (!state.running || !state.analyser) return;

  state.analyser.getFloatFrequencyData(state.floatData);
  smoothSpectrum();

  const metrics = buildMetrics();
  state.currentMetrics = metrics;

    if (state.captureJob) {
      handleCapture(timestamp);
    }

  if (timestamp - state.lastHistoryPushAt > 90) {
    pushHistoryFrame(metrics);
    state.lastHistoryPushAt = timestamp;
  }

  if (timestamp - state.lastUiPaintAt > 90) {
    renderFrame(false);
    state.lastUiPaintAt = timestamp;
  }

  state.animationFrame = requestAnimationFrame(loop);
}

function renderFrame(force) {
  if (!state.currentMetrics) return;
  state.displayedMetrics = state.currentMetrics;
  updateTopMetrics(state.currentMetrics);
  renderBandCards(state.currentMetrics.bands);
  renderInsights(state.currentMetrics);
  drawSpectrum(state.currentMetrics);
  drawSpectrogram();
  if (force) {
    renderSnapshotList();
  }
}

function smoothSpectrum() {
  const smoothing = 1 - state.smoothing;
  for (let i = 0; i < state.floatData.length; i += 1) {
    const nextValue = Number.isFinite(state.floatData[i]) ? state.floatData[i] : -110;
    if (!state.hasSpectrumSeeded) {
      state.smoothedSpectrum[i] = nextValue;
      state.peakSpectrum[i] = nextValue;
    } else {
      state.smoothedSpectrum[i] += (nextValue - state.smoothedSpectrum[i]) * smoothing;
      if (state.peakHold) {
        state.peakSpectrum[i] = Math.max(state.peakSpectrum[i] - 0.12, state.smoothedSpectrum[i]);
      } else {
        state.peakSpectrum[i] = state.smoothedSpectrum[i];
      }
    }
  }
  state.hasSpectrumSeeded = true;
}

function buildMetrics() {
  const analysisSpectrum = state.smoothedSpectrum;
  const displaySpectrum = state.peakHold ? state.peakSpectrum : state.smoothedSpectrum;
  const referenceSnapshot = getReferenceSnapshot();
  const referenceSpectrum = referenceSnapshot ? Float32Array.from(referenceSnapshot.spectrum) : null;

  const currentBroadbandDb = computeWeightedBroadband(analysisSpectrum);
  const referenceBroadbandDb = referenceSpectrum ? computeWeightedBroadband(referenceSpectrum) : null;
  const broadbandDeltaDb = referenceBroadbandDb == null ? null : currentBroadbandDb - referenceBroadbandDb;

  const currentShape = state.displayFrequencies.map((freq) => sampleSpectrumAt(displaySpectrum, freq) - currentBroadbandDb);
  const referenceShape = referenceSpectrum
    ? state.displayFrequencies.map((freq) => sampleSpectrumAt(referenceSpectrum, freq) - referenceBroadbandDb)
    : null;
  const deltaShape = referenceSpectrum
    ? state.displayFrequencies.map((freq) => sampleSpectrumAt(displaySpectrum, freq) - sampleSpectrumAt(referenceSpectrum, freq))
    : null;

  const bands = octaveBands.map((band) => {
    const currentBandDb = computeBandDb(analysisSpectrum, band.low, band.high);
    const referenceBandDb = referenceSpectrum ? computeBandDb(referenceSpectrum, band.low, band.high) : null;
    const deltaDb = referenceBandDb == null ? null : currentBandDb - referenceBandDb;
    const relativeShapeDb = currentBandDb - currentBroadbandDb;
    return {
      ...band,
      currentDb: currentBandDb,
      referenceDb: referenceBandDb,
      deltaDb,
      relativeShapeDb,
    };
  });

  const problemBand = pickProblemBand(bands);
  const stabilityDb = computeStability(broadbandDeltaDb, currentBroadbandDb);
  const score = computeIsolationScore(broadbandDeltaDb, bands);

  return {
    spectrum: Float32Array.from(analysisSpectrum),
    displaySpectrum: Float32Array.from(displaySpectrum),
    referenceSpectrum,
    currentBroadbandDb,
    referenceBroadbandDb,
    broadbandDeltaDb,
    currentShape,
    referenceShape,
    deltaShape,
    bands,
    problemBand,
    stabilityDb,
    score,
    referenceSnapshot,
  };
}

function computeWeightedBroadband(spectrum) {
  let weightedPower = 0;
  let totalWeight = 0;
  const weighting = focusPresets[state.focusPreset] || focusPresets.speech;
  const binWidth = state.sampleRate / state.fftSize;

  for (let i = 1; i < spectrum.length; i += 1) {
    const freq = i * binWidth;
    if (freq < MIN_FREQUENCY || freq > MAX_FREQUENCY) continue;
    const weight = weighting(freq);
    if (weight <= 0) continue;
    weightedPower += dbToPower(spectrum[i]) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0 || weightedPower <= 0) return -110;
  return 10 * Math.log10(weightedPower / totalWeight);
}

function computeBandDb(spectrum, low, high) {
  let sum = 0;
  let count = 0;
  const binWidth = state.sampleRate / state.fftSize;

  for (let i = 1; i < spectrum.length; i += 1) {
    const freq = i * binWidth;
    if (freq < low || freq >= high) continue;
    sum += dbToPower(spectrum[i]);
    count += 1;
  }

  if (!count || sum <= 0) return -110;
  return 10 * Math.log10(sum / count);
}

function computeIsolationScore(broadbandDeltaDb, bands) {
  if (broadbandDeltaDb == null) {
    const standout = bands.reduce((max, band) => Math.max(max, band.relativeShapeDb), -Infinity);
    return clamp((standout + 20) * 2.2, 0, 100);
  }

  const attenuation = -broadbandDeltaDb;
  const worstBandDelta = bands.reduce((max, band) => Math.max(max, band.deltaDb ?? -Infinity), -Infinity);
  const worstPenalty = Math.max(0, worstBandDelta + 3) * 2;
  return clamp(attenuation * 4.6 - worstPenalty, 0, 100);
}

function computeStability(broadbandDeltaDb, currentBroadbandDb) {
  const value = broadbandDeltaDb == null ? currentBroadbandDb : broadbandDeltaDb;
  if (!Number.isFinite(value)) return null;

  state.stabilityHistory.push(value);
  if (state.stabilityHistory.length > 80) {
    state.stabilityHistory.shift();
  }

  if (state.stabilityHistory.length < 8) return null;
  const mean = state.stabilityHistory.reduce((sum, item) => sum + item, 0) / state.stabilityHistory.length;
  const variance = state.stabilityHistory.reduce((sum, item) => sum + (item - mean) ** 2, 0) / state.stabilityHistory.length;
  return Math.sqrt(variance);
}

function pickProblemBand(bands) {
  return bands.reduce((best, band) => {
    const candidate = band.deltaDb == null ? band.relativeShapeDb : band.deltaDb;
    if (!best) return { ...band, score: candidate };
    if (candidate > best.score) return { ...band, score: candidate };
    return best;
  }, null);
}

function updateTopMetrics(metrics) {
  syncControlStates();

  if (!metrics) {
    els.broadbandDelta.textContent = "--";
    return;
  }

  const hasReference = metrics.referenceSnapshot != null;
  const scoreLabel = hasReference ? `${metrics.score.toFixed(0)} / 100` : `${metrics.score.toFixed(0)} contrast`;

  if (hasReference) {
    els.sessionHint.textContent = `Reference: ${metrics.referenceSnapshot.label}. Negative delta is quieter than the reference.`;
    els.broadbandDelta.textContent = formatSigned(metrics.broadbandDeltaDb, " dB");
    els.broadbandNote.textContent = `Weighted ${state.focusPreset} comparison against ${metrics.referenceSnapshot.label}. Relative isolation score ${scoreLabel}.`;
  } else {
    const peakBand = metrics.problemBand ? `${metrics.problemBand.label} ${formatSigned(metrics.problemBand.relativeShapeDb, " dB")}` : "No peak yet";
    els.sessionHint.textContent = "Capture a reference to convert contour peaks into room-isolation deltas.";
    els.broadbandDelta.textContent = `${scoreLabel}`;
    els.broadbandNote.textContent = `Current contour emphasis: ${peakBand}.`;
  }

  if (metrics.problemBand) {
    const label = hasReference && metrics.problemBand.deltaDb != null
      ? `${metrics.problemBand.label} ${formatSigned(metrics.problemBand.deltaDb, " dB")}`
      : `${metrics.problemBand.label} ${formatSigned(metrics.problemBand.relativeShapeDb, " dB")}`;
    els.dominantBand.textContent = label;
    els.dominantBandNote.textContent = metrics.problemBand.note;
  } else {
    els.dominantBand.textContent = "--";
    els.dominantBandNote.textContent = "No band analysis yet.";
  }

  if (metrics.stabilityDb == null) {
    els.stabilityValue.textContent = "--";
    els.stabilityNote.textContent = "Collect a few seconds of steady audio for a stability estimate.";
  } else {
    els.stabilityValue.textContent = `${metrics.stabilityDb.toFixed(1)} dB`;
    els.stabilityNote.textContent = metrics.stabilityDb < 1.5
      ? "Stable enough for repeatable A/B comparisons."
      : "Input is moving around. Use a longer averaging window or steadier source playback.";
  }
}

function resetTopMetrics() {
  els.broadbandDelta.textContent = "--";
  els.broadbandNote.textContent = "Waiting for a reference snapshot.";
  els.dominantBand.textContent = "--";
  els.dominantBandNote.textContent = "No band analysis yet.";
  els.stabilityValue.textContent = "--";
  els.stabilityNote.textContent = "Longer averaging is better for repeatable measurements.";
}

function renderBandCards(bands) {
  if (!bands || !bands.length) {
    els.bandCards.innerHTML = "";
    return;
  }

  const hasReference = bands.some((band) => band.deltaDb != null);
  els.bandCards.innerHTML = bands.map((band) => {
    const value = hasReference ? band.deltaDb : band.relativeShapeDb;
    const positive = value > 0;
    const intensity = clamp(Math.abs(value) / 18, 0.12, 1);
    return `
      <article class="band-card ${positive ? "" : "good"}" style="--intensity:${intensity}">
        <strong>${band.label}</strong>
        <small>${band.note}</small>
        <span class="delta">${formatSigned(value, " dB")}</span>
        <span class="hint">${hasReference ? "vs reference" : "vs current broadband"}</span>
      </article>
    `;
  }).join("");
}

function renderInsights(metrics) {
  if (!metrics) {
    els.insightSummary.innerHTML = "<p>Capture a reference first so the analyzer can rank problem frequencies against a stable baseline.</p>";
    els.insightList.innerHTML = "";
    return;
  }

  const hasReference = metrics.referenceSnapshot != null;
  const bands = metrics.bands;
  const topBands = [...bands]
    .filter((band) => Number.isFinite(hasReference ? band.deltaDb : band.relativeShapeDb))
    .sort((a, b) => (hasReference ? b.deltaDb - a.deltaDb : b.relativeShapeDb - a.relativeShapeDb))
    .slice(0, 3);

  const lowAvg = averageMetric(bands.filter((band) => band.center <= 125), hasReference);
  const midAvg = averageMetric(bands.filter((band) => band.center > 125 && band.center <= 1000), hasReference);
  const highAvg = averageMetric(bands.filter((band) => band.center > 1000), hasReference);

  const summary = hasReference
    ? buildReferenceSummary(metrics, topBands)
    : buildLiveSummary(topBands);
  const insights = hasReference
    ? buildReferenceInsights(metrics, lowAvg, midAvg, highAvg, topBands)
    : buildLiveInsights(metrics, topBands);

  els.insightSummary.innerHTML = `<p>${summary}</p>`;
  els.insightList.innerHTML = insights.map((item) => `
    <article class="insight-item">
      <strong>${item.title}</strong>
      <p>${item.body}</p>
    </article>
  `).join("");
}

function buildReferenceSummary(metrics, topBands) {
  const attenuation = -metrics.broadbandDeltaDb;
  const topLabel = topBands[0] ? `${topBands[0].label} (${formatSigned(topBands[0].deltaDb, " dB")})` : "none yet";
  if (attenuation >= 18) {
    return `The room is materially quieter than the reference, but ${topLabel} is still the weakest region. That is where extra treatment will buy the next improvement.`;
  }
  if (attenuation >= 8) {
    return `You have partial isolation, with the largest residual leak around ${topLabel}. Keep comparing after each change and target the bands closest to 0 dB first.`;
  }
  return `The live signal is still close to the reference. Start with the weakest zone around ${topLabel}; the current assembly is not yet creating much separation.`;
}

function buildLiveSummary(topBands) {
  const topLabel = topBands[0] ? `${topBands[0].label} (${formatSigned(topBands[0].relativeShapeDb, " dB")})` : "no contour peak yet";
  return `This live contour shows which frequencies dominate the room right now. ${topLabel} stands out most relative to the broadband average. Capture a reference to turn this into an isolation comparison.`;
}

function buildReferenceInsights(metrics, lowAvg, midAvg, highAvg, topBands) {
  const items = [];
  const attenuation = -metrics.broadbandDeltaDb;

  items.push({
    title: "Relative isolation",
    body: attenuation >= 12
      ? `Broadband attenuation is ${attenuation.toFixed(1)} dB for the selected focus preset. That is enough to trust the delta trend, so tune treatment based on the remaining weak bands.`
      : `Broadband attenuation is only ${attenuation.toFixed(1)} dB. The envelope is still leaking a lot of source energy, so expect large gains from basic isolation upgrades before fine tuning.`,
  });

  if (lowAvg > midAvg + 2 && lowAvg > highAvg + 2) {
    items.push({
      title: "Low-frequency weakness",
      body: "The worst residual energy is concentrated below 125 Hz. That usually points to insufficient mass, structural coupling, or low-frequency pressurization. Door seals alone will not solve this zone.",
    });
  } else if (highAvg > lowAvg + 2 && highAvg > midAvg + 1.5) {
    items.push({
      title: "Seal and gap weakness",
      body: "Higher bands are leaking more than the low end. Prioritize perimeter seals, window and door gaskets, electrical penetrations, and HVAC openings before adding more bulk mass.",
    });
  } else {
    items.push({
      title: "Mid-band weakness",
      body: "Speech-range bands are still too close to the reference. Focus on door assemblies, cavity absorption, additional gypsum layers, and any flanking paths that bypass the main wall.",
    });
  }

  if (topBands.length) {
    const labels = topBands.map((band) => `${band.label} ${formatSigned(band.deltaDb, " dB")}`).join(", ");
    items.push({
      title: "Priority bands",
      body: `Work the bands nearest the reference first: ${labels}. Repeat the same signal after each treatment change and watch these values move downward.`,
    });
  }

  if (metrics.stabilityDb != null && metrics.stabilityDb > 2) {
    items.push({
      title: "Measurement stability",
      body: "The live reading is moving enough to blur small differences. Increase the averaging window, keep the source level fixed, and take snapshots only after the trace settles.",
    });
  }

  return items;
}

function buildLiveInsights(metrics, topBands) {
  const items = [
    {
      title: "Reference needed",
      body: "You are currently seeing relative contour peaks, which are useful for finding dominant room noise and resonances. Capture a reference to compare two room states or two positions.",
    },
  ];

  if (topBands.length) {
    items.push({
      title: "Dominant contour",
      body: `The strongest relative hotspots are ${topBands.map((band) => `${band.label} ${formatSigned(band.relativeShapeDb, " dB")}`).join(", ")}. These are the frequencies that deserve targeted listening tests.`,
    });
  }

  if (metrics.stabilityDb != null && metrics.stabilityDb > 2) {
    items.push({
      title: "Steady source warning",
      body: "The contour is moving a lot. For room-isolation work, drive the source with a steady broadband signal instead of relying on incidental noise.",
    });
  }

  return items;
}

function startCapture(kind, label) {
  if (!state.running || !state.currentMetrics) return;
  state.captureJob = {
    kind,
    label,
    startedAt: performance.now(),
    frames: [],
  };

  els.captureStatus.textContent = `${kind === "reference" ? "Capturing reference" : "Capturing snapshot"}...`;
}

function handleCapture(timestamp) {
  if (!state.captureJob) return;
  state.captureJob.frames.push(Float32Array.from(state.smoothedSpectrum));
  const elapsed = timestamp - state.captureJob.startedAt;

  if (elapsed < state.averagingWindowMs) {
    const seconds = (state.averagingWindowMs / 1000).toFixed(1);
    const percent = Math.min(99, Math.round((elapsed / state.averagingWindowMs) * 100));
    els.captureStatus.textContent = `${state.captureJob.kind === "reference" ? "Capturing reference" : "Capturing snapshot"} ${percent}% of ${seconds}s`;
    return;
  }

  const averaged = averageSpectra(state.captureJob.frames);
  const snapshot = buildSnapshot(state.captureJob.label, averaged);
  upsertSnapshot(snapshot);

  if (state.captureJob.kind === "reference") {
    state.referenceId = snapshot.id;
    els.captureStatus.textContent = `Reference updated: ${snapshot.label}`;
  } else {
    els.captureStatus.textContent = `Snapshot saved: ${snapshot.label}`;
  }

  persistState();
  renderSnapshotList();
  state.captureJob = null;
}

function buildSnapshot(label, spectrum) {
  const broadbandDb = computeWeightedBroadband(spectrum);
  return {
    id: crypto.randomUUID(),
    label,
    createdAt: new Date().toISOString(),
    broadbandDb,
    spectrum: Array.from(spectrum),
  };
}

function upsertSnapshot(snapshot) {
  state.snapshots.unshift(snapshot);
  if (state.snapshots.length > MAX_SNAPSHOTS) {
    state.snapshots = state.snapshots.slice(0, MAX_SNAPSHOTS);
  }
}

function renderSnapshotList() {
  if (!state.snapshots.length) {
    els.snapshotList.innerHTML = '<p class="empty-state">No snapshots saved yet.</p>';
    return;
  }

  els.snapshotList.innerHTML = state.snapshots.map((snapshot) => {
    const active = snapshot.id === state.referenceId;
    return `
      <article class="snapshot-item ${active ? "active" : ""}">
        <div class="snapshot-meta">
          <strong>${escapeHtml(snapshot.label)}</strong>
          <span>${formatDb(snapshot.broadbandDb)} weighted broadband</span>
          <small>${formatDate(snapshot.createdAt)}${active ? " | active reference" : ""}</small>
        </div>
        <div class="snapshot-actions">
          <button type="button" data-action="reference" data-id="${snapshot.id}">Use as reference</button>
          <button type="button" data-action="rename" data-id="${snapshot.id}">Rename</button>
          <button type="button" data-action="delete" data-id="${snapshot.id}">Delete</button>
        </div>
      </article>
    `;
  }).join("");

  els.snapshotList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", onSnapshotAction);
  });
}

function onSnapshotAction(event) {
  const button = event.currentTarget;
  const snapshotId = button.dataset.id;
  const action = button.dataset.action;
  const snapshot = state.snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) return;

  if (action === "reference") {
    state.referenceId = snapshot.id;
    els.captureStatus.textContent = `Reference set to ${snapshot.label}`;
  } else if (action === "rename") {
    const nextLabel = window.prompt("Rename snapshot", snapshot.label);
    if (nextLabel && nextLabel.trim()) {
      snapshot.label = nextLabel.trim().slice(0, 32);
    }
  } else if (action === "delete") {
    state.snapshots = state.snapshots.filter((item) => item.id !== snapshot.id);
    if (state.referenceId === snapshot.id) {
      state.referenceId = null;
    }
  }

  persistState();
  renderSnapshotList();
}

function clearReference() {
  state.referenceId = null;
  persistState();
  els.captureStatus.textContent = "Reference cleared";
  renderSnapshotList();
}

function getReferenceSnapshot() {
  if (!state.referenceId) return null;
  return state.snapshots.find((snapshot) => snapshot.id === state.referenceId) || null;
}

function pushHistoryFrame(metrics) {
  const values = state.historyFrequencies.map((freq) => {
    if (metrics.referenceSnapshot) {
      return sampleSpectrumAt(metrics.spectrum, freq) - sampleSpectrumAt(metrics.referenceSpectrum, freq);
    }
    return sampleSpectrumAt(metrics.spectrum, freq) - metrics.currentBroadbandDb;
  });

  state.history.push(values);
  if (state.history.length > state.historyDepth) {
    state.history = state.history.slice(-state.historyDepth);
  }
}

function drawSpectrum(metrics) {
  const canvas = els.spectrumCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "rgba(16, 30, 45, 0.9)");
  bg.addColorStop(1, "rgba(6, 12, 20, 0.96)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height);

  if (!metrics) {
    drawCenterMessage(ctx, width, height, "Start the microphone to draw the spectrum.");
    return;
  }

  if (state.viewMode === "shape" || state.viewMode === "hybrid") {
    drawLine(ctx, metrics.currentShape, width, height, {
      color: "#ff9352",
      min: -28,
      max: 18,
      lineWidth: 3,
    });

    if (metrics.referenceShape) {
      drawLine(ctx, metrics.referenceShape, width, height, {
        color: "#7fe6f0",
        min: -28,
        max: 18,
        lineWidth: 2,
        dash: [10, 8],
      });
    }
  }

  if (metrics.deltaShape && (state.viewMode === "delta" || state.viewMode === "hybrid")) {
    drawDeltaArea(ctx, metrics.deltaShape, width, height, {
      min: -36,
      max: 18,
    });
    drawLine(ctx, metrics.deltaShape, width, height, {
      color: "#ffe7d8",
      min: -36,
      max: 18,
      lineWidth: 2,
    });
  }

  drawFrequencyLabels(ctx, width, height);

  if (state.lastSpectrumHover) {
    drawHoverGuide(ctx, width, height);
  }
}

function drawSpectrogram() {
  const canvas = els.spectrogramCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(8, 15, 24, 0.95)";
  ctx.fillRect(0, 0, width, height);

  if (!state.history.length) {
    drawCenterMessage(ctx, width, height, "History will appear here once the analyzer is running.");
    return;
  }

  const frameWidth = width / state.history.length;
  const cellHeight = height / HISTORY_POINTS;

  for (let x = 0; x < state.history.length; x += 1) {
    const frame = state.history[x];
    for (let y = 0; y < frame.length; y += 1) {
      ctx.fillStyle = colorForHeat(frame[y]);
      ctx.fillRect(x * frameWidth, height - (y + 1) * cellHeight, Math.ceil(frameWidth + 1), Math.ceil(cellHeight + 1));
    }
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  ctx.fillStyle = "rgba(238, 246, 255, 0.7)";
  ctx.font = `${Math.max(11, Math.round(height * 0.045))}px Aptos, sans-serif`;
  ["20 Hz", "100", "1k", "10k"].forEach((label, index) => {
    const ratio = index / 3;
    ctx.fillText(label, 10 + ratio * (width - 50), height - 12);
  });
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;

  for (let i = 0; i < 6; i += 1) {
    const y = (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  [20, 50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000].forEach((freq) => {
    const x = frequencyToX(freq, width);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  });
}

function drawFrequencyLabels(ctx, width, height) {
  ctx.fillStyle = "rgba(238, 246, 255, 0.62)";
  ctx.font = `${Math.max(11, Math.round(height * 0.038))}px Aptos, sans-serif`;
  [20, 50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000].forEach((freq) => {
    const x = frequencyToX(freq, width);
    ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x + 6, height - 12);
  });
}

function drawLine(ctx, values, width, height, options) {
  if (!values || !values.length) return;
  const { color, min, max, lineWidth, dash } = options;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = mapValue(value, min, max, height);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
}

function drawDeltaArea(ctx, values, width, height, options) {
  const { min, max } = options;
  if (!values || !values.length) return;

  const baselineY = mapValue(0, min, max, height);

  ctx.save();
  for (let i = 0; i < values.length - 1; i += 1) {
    const x1 = (i / (values.length - 1)) * width;
    const x2 = ((i + 1) / (values.length - 1)) * width;
    const y1 = mapValue(values[i], min, max, height);
    const y2 = mapValue(values[i + 1], min, max, height);
    const gradient = ctx.createLinearGradient(0, Math.min(y1, y2, baselineY), 0, Math.max(y1, y2, baselineY));
    if ((values[i] + values[i + 1]) / 2 > 0) {
      gradient.addColorStop(0, "rgba(255, 122, 111, 0.32)");
      gradient.addColorStop(1, "rgba(255, 122, 111, 0.05)");
    } else {
      gradient.addColorStop(0, "rgba(92, 225, 164, 0.28)");
      gradient.addColorStop(1, "rgba(92, 225, 164, 0.05)");
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x1, baselineY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, baselineY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawHoverGuide(ctx, width, height) {
  const x = frequencyToX(state.lastSpectrumHover.frequency, width);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();
}

function drawCenterMessage(ctx, width, height, message) {
  ctx.fillStyle = "rgba(238, 246, 255, 0.72)";
  ctx.font = `${Math.max(14, Math.round(height * 0.05))}px Aptos, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = "left";
}

function onSpectrumHover(event) {
  if (!state.displayedMetrics) return;
  const rect = els.spectrumCanvas.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  const frequency = MIN_FREQUENCY * ((MAX_FREQUENCY / MIN_FREQUENCY) ** clamp(ratio, 0, 1));
  const currentDb = sampleSpectrumAt(state.displayedMetrics.displaySpectrum, frequency);
  const referenceDb = state.displayedMetrics.referenceSpectrum
    ? sampleSpectrumAt(state.displayedMetrics.referenceSpectrum, frequency)
    : null;
  const deltaDb = referenceDb == null ? null : currentDb - referenceDb;
  const shapeDb = currentDb - state.displayedMetrics.currentBroadbandDb;

  state.lastSpectrumHover = { frequency, currentDb, deltaDb, shapeDb };

  els.cursorReadout.textContent = referenceDb == null
    ? `${formatFrequency(frequency)} | contour ${formatSigned(shapeDb, " dB")} | input ${formatDb(currentDb)}`
    : `${formatFrequency(frequency)} | delta ${formatSigned(deltaDb, " dB")} | contour ${formatSigned(shapeDb, " dB")}`;

  drawSpectrum(state.displayedMetrics);
}

function togglePeakHold() {
  state.peakHold = !state.peakHold;
  els.togglePeakHoldButton.dataset.enabled = String(state.peakHold);
  els.togglePeakHoldButton.textContent = state.peakHold ? "Peak hold on" : "Peak hold off";
  if (!state.peakHold && state.smoothedSpectrum && state.peakSpectrum) {
    state.peakSpectrum.set(state.smoothedSpectrum);
  }
}

function syncControlStates() {
  els.startButton.disabled = state.running;
  els.stopButton.disabled = !state.running;
  els.captureReferenceButton.disabled = !state.running;
  els.clearReferenceButton.disabled = !state.referenceId;
  els.captureSnapshotButton.disabled = !state.running;
  els.togglePeakHoldButton.disabled = !state.running;
}

function updateSessionState(title, note) {
  els.sessionState.textContent = title;
  els.sessionHint.textContent = note;
}

function updateControlReadouts() {
  state.averagingWindowMs = Number(els.averagingWindow.value);
  state.historyDepth = Number(els.historyDepth.value);
  state.smoothing = Number(els.smoothingControl.value);
  els.averagingWindowValue.textContent = `${(state.averagingWindowMs / 1000).toFixed(1)} s`;
  els.historyDepthValue.textContent = `${state.historyDepth} frames`;
  els.smoothingValue.textContent = state.smoothing.toFixed(2);
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.snapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
    state.referenceId = parsed.referenceId || null;
  } catch (error) {
    console.warn("Unable to load saved snapshots", error);
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      snapshots: state.snapshots,
      referenceId: state.referenceId,
    }));
  } catch (error) {
    console.warn("Unable to save snapshots", error);
  }
}

function buildLogFrequencies(count) {
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return MIN_FREQUENCY * ((MAX_FREQUENCY / MIN_FREQUENCY) ** ratio);
  });
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * ratio);
  canvas.height = Math.floor(canvas.clientHeight * ratio);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

function frequencyToX(freq, width) {
  const ratio = Math.log10(freq / MIN_FREQUENCY) / Math.log10(MAX_FREQUENCY / MIN_FREQUENCY);
  return clamp(ratio, 0, 1) * width;
}

function sampleSpectrumAt(spectrumLike, frequency) {
  if (!spectrumLike) return -110;
  const spectrum = spectrumLike instanceof Float32Array ? spectrumLike : Float32Array.from(spectrumLike);
  const binWidth = state.sampleRate / state.fftSize;
  const index = clamp(Math.round(frequency / binWidth), 0, spectrum.length - 1);
  return Number.isFinite(spectrum[index]) ? spectrum[index] : -110;
}

function averageSpectra(frames) {
  if (!frames.length) return new Float32Array(state.analyser.frequencyBinCount);
  const size = frames[0].length;
  const result = new Float32Array(size);
  frames.forEach((frame) => {
    for (let i = 0; i < size; i += 1) {
      result[i] += frame[i];
    }
  });
  for (let i = 0; i < size; i += 1) {
    result[i] /= frames.length;
  }
  return result;
}

function dbToPower(db) {
  return 10 ** (db / 10);
}

function mapValue(value, min, max, height) {
  const clamped = clamp((value - min) / (max - min), 0, 1);
  return height - clamped * height;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDb(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)} dB`;
}

function formatSigned(value, suffix = "") {
  if (!Number.isFinite(value)) return `--${suffix}`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function formatFrequency(freq) {
  return freq >= 1000 ? `${(freq / 1000).toFixed(2)} kHz` : `${Math.round(freq)} Hz`;
}

function getLabelValue(fallback) {
  const raw = els.snapshotLabel.value.trim();
  return raw ? raw.slice(0, 32) : fallback;
}

function averageMetric(bands, hasReference) {
  if (!bands.length) return 0;
  const key = hasReference ? "deltaDb" : "relativeShapeDb";
  return bands.reduce((sum, band) => sum + (band[key] || 0), 0) / bands.length;
}

function colorForHeat(value) {
  const clamped = clamp((value + 18) / 30, 0, 1);
  const hue = 210 - clamped * 210;
  const lightness = 22 + clamped * 40;
  return `hsl(${hue} 82% ${lightness}%)`;
}

function formatDate(isoDate) {
  const value = new Date(isoDate);
  return value.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
