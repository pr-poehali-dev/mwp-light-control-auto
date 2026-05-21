/**
 * useWebAudio — улучшенный аудио-анализатор для AI Lighting Director
 *
 * Улучшения:
 * - FFT 2048 → в 8× больше частотного разрешения
 * - BPM через медианный peak-detection (устойчив к выбросам)
 * - Структура трека через multi-window энергетический анализ (3 окна)
 * - Spectral flux для детекции резких изменений спектра
 * - Onset detection для силы удара
 * - Shazam-распознавание каждые 30 сек (+ ручной триггер)
 * - Уточнение жанра и BPM из метаданных Shazam
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { shazamApi } from "@/lib/api";
import type { ShazamTrack } from "@/lib/api";

export type TrackStructure = "intro" | "buildup" | "drop" | "breakdown" | "outro" | "unknown";
export type MoodType =
  | "aggressive"
  | "euphoric"
  | "dark"
  | "melancholic"
  | "tense"
  | "relaxed"
  | "hypnotic"
  | "energetic";

export interface TrackFeatures {
  kick_density: number;
  snare_density: number;
  bass_energy: number;
  vocal_presence: number;
  spectral_brightness: number;
  drop_probability: number;
  silence_probability: number;
  spectral_flux: number;     // резкость спектральных изменений (новое)
  onset_strength: number;    // сила текущего удара (новое)
}

export interface ShazamInfo {
  status: "idle" | "loading" | "matched" | "no_match" | "error";
  track: ShazamTrack | null;
  lastAttempt: number;
}

export interface AudioAnalysis {
  bars: number[];
  bpm: number;
  energy: number;
  genre: string;
  mood: MoodType;
  structure: TrackStructure;
  structureProgress: number;
  energyTrend: "rising" | "falling" | "stable";
  trackFeatures: TrackFeatures;
  shazam: ShazamInfo;
  isListening: boolean;
  error: string | null;
}

const FFT_SIZE          = 2048;
const BAR_COUNT         = 32;
const SMOOTHING         = 0.85;
const SHAZAM_INTERVAL   = 30_000;
const SHAZAM_SAMPLE_MS  = 5_000;
const SHAZAM_RATE       = 16_000;
const SHAZAM_FIRST_WAIT = 8_000;

// ─── BPM через медианный peak-detection ──────────────────────────────────────

function detectBPM(energyHistory: number[], fps: number): number {
  if (energyHistory.length < 30) return 0;

  const mean = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
  const threshold = mean * 1.35;
  const minGap = Math.floor(fps * 0.25); // ≥250ms между ударами

  const beats: number[] = [];
  let lastBeat = -minGap;

  for (let i = 1; i < energyHistory.length; i++) {
    if (
      energyHistory[i] > threshold &&
      energyHistory[i - 1] <= threshold &&
      i - lastBeat >= minGap
    ) {
      beats.push(i);
      lastBeat = i;
    }
  }

  if (beats.length < 3) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);

  // Медиана вместо среднего — устойчива к выбросам
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return 0;

  const bpm = Math.round((fps * 60) / median);
  return Math.min(200, Math.max(55, bpm));
}

// ─── Spectral flux ────────────────────────────────────────────────────────────

function spectralFlux(cur: Uint8Array, prev: Uint8Array): number {
  if (prev.length === 0) return 0;
  let flux = 0;
  const len = Math.min(cur.length, prev.length);
  for (let i = 0; i < len; i++) {
    const d = cur[i] - prev[i];
    if (d > 0) flux += d;
  }
  return Math.min(1, flux / (len * 110));
}

// ─── Onset strength ───────────────────────────────────────────────────────────

function onsetStrength(fluxHistory: number[]): number {
  if (fluxHistory.length < 5) return 0;
  const window = fluxHistory.slice(-8);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const cur = fluxHistory[fluxHistory.length - 1];
  return Math.min(1, Math.max(0, (cur - mean * 0.75) * 3.5));
}

// ─── Жанр ─────────────────────────────────────────────────────────────────────

function detectGenre(
  lowE: number, midE: number, highE: number,
  bpm: number, shazamGenre?: string
): string {
  if (shazamGenre && shazamGenre.length > 1) return shazamGenre;
  const total = lowE + midE + highE + 0.001;
  const lr = lowE / total, mr = midE / total, hr = highE / total;
  if (bpm >= 135 && bpm <= 162 && lr > 0.42)              return "Techno";
  if (bpm >= 120 && bpm <= 135 && mr > 0.30 && lr > 0.33) return "House";
  if (bpm >= 110 && bpm <= 125 && mr > 0.35)              return "Deep House";
  if (bpm >= 162 && bpm <= 185 && lr > 0.36)              return "DnB";
  if (bpm >= 137 && bpm <= 148 && hr > 0.26 && mr > 0.30) return "Trance";
  if (bpm >= 140 && bpm <= 165 && hr > 0.28)              return "Hard Dance";
  if (bpm >= 65  && bpm <= 100 && lr > 0.45)              return "Trap";
  if (bpm >= 85  && bpm <= 112 && mr > 0.38 && hr > 0.22) return "Hip-Hop";
  if (bpm >= 110 && bpm <= 145 && hr > 0.33 && mr > 0.33) return "Pop";
  if (bpm >= 100 && bpm <= 145 && mr > 0.38 && hr > 0.24) return "Rock";
  if (bpm < 100  && mr > 0.44)                             return "Jazz";
  if (bpm < 80)                                            return "Ambient";
  return "Electronic";
}

// ─── Настроение ───────────────────────────────────────────────────────────────

function detectMood(
  lowE: number, midE: number, highE: number,
  bpm: number, energy: number,
  trend: "rising" | "falling" | "stable",
  onset: number
): MoodType {
  const total = lowE + midE + highE + 0.001;
  const lr = lowE / total, mr = midE / total, hr = highE / total;
  if (trend === "rising" && energy > 0.27 && energy < 0.78 && onset < 0.42) return "tense";
  if (energy > 0.60 && bpm > 126 && lr > 0.40 && onset > 0.28)             return "aggressive";
  if (energy > 0.50 && hr > 0.27 && bpm > 116 && mr > 0.27)                return "euphoric";
  if (lr > 0.46 && hr < 0.17 && bpm >= 92 && bpm <= 152)                   return "dark";
  if (energy > 0.56 && bpm > 96)                                            return "energetic";
  if (energy < 0.32 && mr > 0.42)                                           return "melancholic";
  if (trend === "stable" && bpm >= 116 && bpm <= 150 && energy > 0.17 && energy < 0.52) return "hypnotic";
  if (energy < 0.27 && bpm < 114)                                           return "relaxed";
  return "energetic";
}

// ─── Структура (multi-window) ─────────────────────────────────────────────────

function detectStructure(
  history: number[],
  trend: "rising" | "falling" | "stable",
  secondsInSeg: number,
  fluxHist: number[]
): { structure: TrackStructure; progress: number } {
  if (history.length < 60) return { structure: "unknown", progress: 0 };

  const n = history.length;
  // 3 окна: ≈0.5 сек, ≈3 сек, ≈10 сек
  const short = history.slice(-10);
  const med   = history.slice(-60);
  const long  = history.slice(0, Math.min(n, 300));

  const aS = short.reduce((a, b) => a + b, 0) / short.length;
  const aM = med.reduce((a, b) => a + b, 0)   / med.length;
  const aL = long.reduce((a, b) => a + b, 0)  / long.length;

  const variance = med.reduce((a, b) => a + (b - aM) ** 2, 0) / med.length;
  const stdDev   = Math.sqrt(variance);

  const avgFlux = fluxHist.length > 0
    ? fluxHist.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, fluxHist.length)
    : 0;

  const progress = Math.min(1, secondsInSeg / 30);

  if (aS > 0.46 && stdDev > 0.065 && trend !== "rising" && avgFlux > 0.04) return { structure: "drop",      progress };
  if (trend === "rising" && aM > aL * 1.10 && aM < 0.80)                   return { structure: "buildup",   progress };
  if (aS < 0.17 && aL > 0.30)                                               return { structure: "breakdown", progress };
  if (aS < 0.23 && aL < 0.20 && trend !== "falling")                        return { structure: "intro",     progress };
  if (trend === "falling" && aM < aL * 0.70 && aM < 0.30)                  return { structure: "outro",     progress };
  return { structure: "drop", progress };
}

// ─── Track features ───────────────────────────────────────────────────────────

function computeTrackFeatures(
  freq: Uint8Array,
  prevFreq: Uint8Array,
  binHz: number,
  energy: number,
  trend: "rising" | "falling" | "stable",
  structure: TrackStructure,
  fluxHist: number[]
): TrackFeatures {
  const len = freq.length;
  const band = (lo: number, hi: number) => {
    const s = Math.floor(lo / binHz), e = Math.floor(hi / binHz);
    let sum = 0;
    for (let i = s; i < Math.min(e, len); i++) sum += freq[i];
    return sum / Math.max(1, (e - s) * 255);
  };

  const kick_raw  = band(50, 120);
  const snare_raw = band(150, 500);
  const bass_raw  = band(20, 300);
  const vocal_raw = band(700, 3500);
  const bright_raw= band(6000, 18000);

  const kick_density        = Math.min(1, kick_raw  * 2.2);
  const snare_density       = Math.min(1, snare_raw * 1.8);
  const bass_energy         = Math.min(1, bass_raw  * 2.0);
  const vocal_presence      = Math.min(1, vocal_raw * 2.3);
  const spectral_brightness = Math.min(1, bright_raw* 2.8);

  const spectral_flux  = spectralFlux(freq, prevFreq);
  const onset_strength = onsetStrength(fluxHist);

  const drop_probability =
    trend === "rising"
      ? Math.min(1, bass_energy * 0.45 + kick_density * 0.35 + energy * 0.20)
      : structure === "buildup"
      ? Math.min(1, bass_energy * 0.65 + energy * 0.35)
      : energy * 0.18;

  const silence_probability = energy < 0.12 ? (0.12 - energy) / 0.12 : 0;

  return {
    kick_density, snare_density, bass_energy, vocal_presence,
    spectral_brightness, drop_probability, silence_probability,
    spectral_flux, onset_strength,
  };
}

// ─── WAV encoder → base64 для Shazam ─────────────────────────────────────────

function pcmToWavBase64(samples: Float32Array, sampleRate: number): string {
  const bps = 16, ch = 1;
  const byteRate = (sampleRate * ch * bps) / 8;
  const blockAlign = (ch * bps) / 8;
  const dataSize = samples.length * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  ws(0, "RIFF"); v.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true);
  v.setUint16(34, bps, true); ws(36, "data"); v.setUint32(40, dataSize, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ─── Хук ─────────────────────────────────────────────────────────────────────

export function useWebAudio() {
  const [analysis, setAnalysis] = useState<AudioAnalysis>({
    bars: Array.from({ length: BAR_COUNT }, () => 0.02),
    bpm: 0, energy: 0, genre: "—", mood: "relaxed",
    structure: "unknown", structureProgress: 0, energyTrend: "stable",
    trackFeatures: {
      kick_density: 0, snare_density: 0, bass_energy: 0,
      vocal_presence: 0, spectral_brightness: 0,
      drop_probability: 0, silence_probability: 1,
      spectral_flux: 0, onset_strength: 0,
    },
    shazam: { status: "idle", track: null, lastAttempt: 0 },
    isListening: false, error: null,
  });

  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const sourceRef    = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const rafRef       = useRef<number>(0);

  const energyHistRef  = useRef<number[]>([]);
  const energyLongRef  = useRef<number[]>([]);
  const trendWinRef    = useRef<number[]>([]);
  const fluxHistRef    = useRef<number[]>([]);
  const prevFreqRef    = useRef<Uint8Array>(new Uint8Array(0));

  const bpmRawRef    = useRef<number>(0);
  const bpmSmthRef   = useRef<number>(0);
  const genreRef     = useRef<string>("—");
  const moodRef      = useRef<MoodType>("relaxed");
  const structRef    = useRef<TrackStructure>("unknown");
  const structProgRef= useRef<number>(0);
  const trendRef     = useRef<"rising" | "falling" | "stable">("stable");
  const featuresRef  = useRef<TrackFeatures>({
    kick_density: 0, snare_density: 0, bass_energy: 0,
    vocal_presence: 0, spectral_brightness: 0,
    drop_probability: 0, silence_probability: 1,
    spectral_flux: 0, onset_strength: 0,
  });
  const segStartRef  = useRef<number>(Date.now());
  const lastStructRef= useRef<TrackStructure>("unknown");
  const shazamRef    = useRef<ShazamInfo>({ status: "idle", track: null, lastAttempt: 0 });
  const shazamBusy   = useRef<boolean>(false);
  const lastShazamTS = useRef<number>(0);

  // FPS estimation
  const fpsHistRef   = useRef<number[]>([]);
  const fpsRef       = useRef<number>(60);
  const lastTsRef    = useRef<number>(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    sourceRef.current   = null;
    streamRef.current   = null;
    setAnalysis(prev => ({ ...prev, isListening: false }));
  }, []);

  // ─── Shazam: запись 5 сек → base64 WAV → API ──────────────────────────────

  const runShazam = useCallback(async (stream: MediaStream) => {
    if (shazamBusy.current) return;
    shazamBusy.current = true;
    lastShazamTS.current = Date.now();

    shazamRef.current = { ...shazamRef.current, status: "loading", lastAttempt: Date.now() };
    setAnalysis(prev => ({ ...prev, shazam: { ...shazamRef.current } }));

    try {
      // Отдельный AudioContext на 16 kHz
      const sCtx = new AudioContext({ sampleRate: SHAZAM_RATE });
      const buffers: Float32Array[] = [];

       
      const scriptNode = sCtx.createScriptProcessor(4096, 1, 1);
      scriptNode.onaudioprocess = (e) => {
        buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      const sSource = sCtx.createMediaStreamSource(stream);
      sSource.connect(scriptNode);
      scriptNode.connect(sCtx.destination);

      await new Promise(r => setTimeout(r, SHAZAM_SAMPLE_MS));

      scriptNode.disconnect();
      sSource.disconnect();
      sCtx.close();

      const total = buffers.reduce((s, b) => s + b.length, 0);
      if (total < 1000) throw new Error("too short");

      const pcm = new Float32Array(total);
      let off = 0;
      for (const b of buffers) { pcm.set(b, off); off += b.length; }

      const wavB64 = pcmToWavBase64(pcm, SHAZAM_RATE);
      const result = await shazamApi.recognize(wavB64);

      if (result.matched && result.track) {
        shazamRef.current = { status: "matched", track: result.track, lastAttempt: Date.now() };
        if (result.track.bpm > 50) {
          bpmRawRef.current  = result.track.bpm;
          bpmSmthRef.current = result.track.bpm;
        }
        if (result.track.genre) genreRef.current = result.track.genre;
      } else {
        shazamRef.current = { status: "no_match", track: shazamRef.current.track, lastAttempt: Date.now() };
      }
    } catch {
      shazamRef.current = { status: "error", track: shazamRef.current.track, lastAttempt: Date.now() };
    } finally {
      shazamBusy.current = false;
      setAnalysis(prev => ({ ...prev, shazam: { ...shazamRef.current } }));
    }
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      const binCount  = analyser.frequencyBinCount; // 1024
      const sampleRate = ctx.sampleRate;
      const binHz     = sampleRate / FFT_SIZE;      // ~21.5 Hz/bin @ 44100

      const freqData  = new Uint8Array(binCount);
      prevFreqRef.current = new Uint8Array(binCount);

      const lowEnd  = Math.floor(250  / binHz);
      const midEnd  = Math.floor(2500 / binHz);
      const highEnd = Math.floor(10000/ binHz);

      let frameCount = 0;

      const tick = (ts: number) => {
        // FPS estimate
        if (lastTsRef.current > 0) {
          const dt = (ts - lastTsRef.current) / 1000;
          if (dt > 0 && dt < 0.25) {
            fpsHistRef.current.push(1 / dt);
            if (fpsHistRef.current.length > 60) fpsHistRef.current.shift();
            fpsRef.current = fpsHistRef.current.reduce((a, b) => a + b, 0) / fpsHistRef.current.length;
          }
        }
        lastTsRef.current = ts;

        analyser.getByteFrequencyData(freqData);

        // Spectral flux
        const flux = spectralFlux(freqData, prevFreqRef.current);
        prevFreqRef.current = new Uint8Array(freqData);
        fluxHistRef.current.push(flux);
        if (fluxHistRef.current.length > 200) fluxHistRef.current.shift();

        // Частотные полосы
        let lSum = 0, mSum = 0, hSum = 0;
        for (let i = 0; i < lowEnd; i++) lSum += freqData[i];
        for (let i = lowEnd; i < midEnd; i++) mSum += freqData[i];
        for (let i = midEnd; i < Math.min(highEnd, binCount); i++) hSum += freqData[i];

        const lowE  = lSum / (lowEnd * 255);
        const midE  = mSum / ((midEnd - lowEnd) * 255);
        const highE = hSum / ((Math.min(highEnd, binCount) - midEnd) * 255);
        const raw   = lowE * 0.50 + midE * 0.35 + highE * 0.15;
        const disp  = Math.min(1, raw * 2.6);

        energyHistRef.current.push(raw);
        if (energyHistRef.current.length > 180) energyHistRef.current.shift();
        energyLongRef.current.push(disp);
        if (energyLongRef.current.length > 600) energyLongRef.current.shift();
        trendWinRef.current.push(disp);
        if (trendWinRef.current.length > 60) trendWinRef.current.shift();

        // Бары
        const binsPerBar = Math.floor(binCount / BAR_COUNT);
        const bars: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let s = 0;
          for (let j = 0; j < binsPerBar; j++) s += freqData[i * binsPerBar + j];
          bars.push(s / binsPerBar / 255);
        }

        frameCount++;

        // Медленные вычисления раз в ~90 кадров
        if (frameCount % 90 === 0) {
          // Тренд
          const tw = trendWinRef.current;
          if (tw.length >= 30) {
            const f = tw.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
            const l = tw.slice(-15).reduce((a, b) => a + b, 0) / 15;
            const d = l - f;
            trendRef.current = d > 0.04 ? "rising" : d < -0.04 ? "falling" : "stable";
          }

          // BPM
          const bpm = detectBPM(energyHistRef.current, fpsRef.current);
          if (bpm > 0) bpmRawRef.current = bpm;
          if (bpmRawRef.current > 0) {
            bpmSmthRef.current = bpmSmthRef.current === 0
              ? bpmRawRef.current
              : Math.round(bpmSmthRef.current * 0.72 + bpmRawRef.current * 0.28);
          }

          // Структура
          const secs = (Date.now() - segStartRef.current) / 1000;
          const { structure, progress } = detectStructure(
            energyLongRef.current, trendRef.current, secs, fluxHistRef.current
          );
          if (structure !== lastStructRef.current) {
            segStartRef.current = Date.now();
            lastStructRef.current = structure;
          }
          structRef.current     = structure;
          structProgRef.current = progress;

          // Настроение
          moodRef.current = detectMood(
            lowE, midE, highE, bpmSmthRef.current, disp,
            trendRef.current, featuresRef.current.onset_strength
          );

          // Жанр (только если Shazam не распознал)
          if (shazamRef.current.status !== "matched") {
            genreRef.current = detectGenre(lowE, midE, highE, bpmSmthRef.current);
          }

          // Track features
          featuresRef.current = computeTrackFeatures(
            freqData, prevFreqRef.current, binHz, disp,
            trendRef.current, structRef.current, fluxHistRef.current
          );
        }

        // Shazam триггер
        const now = Date.now();
        if (
          !shazamBusy.current &&
          disp > 0.05 &&
          now - lastShazamTS.current > SHAZAM_INTERVAL
        ) {
          runShazam(stream);
        }

        setAnalysis({
          bars, bpm: bpmSmthRef.current, energy: disp,
          genre: genreRef.current, mood: moodRef.current,
          structure: structRef.current, structureProgress: structProgRef.current,
          energyTrend: trendRef.current, trackFeatures: featuresRef.current,
          shazam: { ...shazamRef.current },
          isListening: true, error: null,
        });

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
      setAnalysis(prev => ({ ...prev, isListening: true, error: null }));

      // Первый Shazam через 8 сек
      setTimeout(() => { if (streamRef.current) runShazam(stream); }, SHAZAM_FIRST_WAIT);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка доступа к микрофону";
      setAnalysis(prev => ({ ...prev, error: msg, isListening: false }));
    }
  }, [runShazam]);

  useEffect(() => () => stop(), [stop]);

  const triggerShazam = useCallback(() => {
    if (streamRef.current && !shazamBusy.current) runShazam(streamRef.current);
  }, [runShazam]);

  return { analysis, start, stop, triggerShazam };
}
