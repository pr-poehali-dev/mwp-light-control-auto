import { useState, useEffect, useRef, useCallback } from "react";

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
  kick_density: number;        // 0-1: насколько часто и сильно бьёт бас-бочка
  snare_density: number;       // 0-1: плотность снэра / перкуссии
  bass_energy: number;         // 0-1: энергия суббаса и баса
  vocal_presence: number;      // 0-1: наличие вокального диапазона (средние частоты 800-3000 Hz)
  spectral_brightness: number; // 0-1: яркость спектра (доля верхних частот)
  drop_probability: number;    // 0-1: вероятность скорого дропа (нарастание + высокий бас)
  silence_probability: number; // 0-1: вероятность паузы (низкая общая энергия)
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
  isListening: boolean;
  error: string | null;
}

const FFT_SIZE = 256;
const BAR_COUNT = 32;

function detectBPM(energyHistory: number[]): number {
  if (energyHistory.length < 43) return 0;
  const mean = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
  const beats: number[] = [];
  for (let i = 1; i < energyHistory.length; i++) {
    if (energyHistory[i] > mean * 1.4 && energyHistory[i - 1] <= mean * 1.4) {
      beats.push(i);
    }
  }
  if (beats.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i] - beats[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60 / (avgInterval / 60));
  return Math.min(200, Math.max(60, bpm));
}

function detectGenre(lowE: number, midE: number, highE: number, bpm: number): string {
  const total = lowE + midE + highE + 0.001;
  const lowR = lowE / total;
  const midR = midE / total;
  const highR = highE / total;
  if (bpm >= 130 && bpm <= 160 && lowR > 0.45) return "Techno";
  if (bpm >= 120 && bpm <= 135 && midR > 0.35) return "House";
  if (bpm >= 160 && lowR > 0.4) return "DnB";
  if (bpm >= 110 && bpm <= 140 && highR > 0.35) return "Pop";
  if (bpm >= 100 && bpm <= 140 && midR > 0.4 && highR > 0.25) return "Rock";
  if (bpm < 100 && midR > 0.45) return "Jazz";
  if (bpm < 90) return "Ambient";
  return "Electronic";
}

function detectMood(
  lowE: number, midE: number, highE: number,
  bpm: number, energy: number,
  trend: "rising" | "falling" | "stable"
): MoodType {
  const total = lowE + midE + highE + 0.001;
  const lowR = lowE / total;
  const midR = midE / total;
  const highR = highE / total;
  if (trend === "rising" && energy > 0.3 && energy < 0.75) return "tense";
  if (energy > 0.6 && bpm > 130 && lowR > 0.45) return "aggressive";
  if (energy > 0.55 && highR > 0.3 && bpm > 120) return "euphoric";
  if (energy > 0.6 && bpm > 100) return "energetic";
  if (lowR > 0.5 && highR < 0.15 && bpm >= 100 && bpm <= 145) return "dark";
  if (energy < 0.3 && midR > 0.45) return "melancholic";
  if (trend === "stable" && bpm >= 120 && bpm <= 145 && energy > 0.2 && energy < 0.5) return "hypnotic";
  if (energy < 0.25 && bpm < 110) return "relaxed";
  return "energetic";
}

function detectStructure(
  energyLongHistory: number[],
  energy: number,
  trend: "rising" | "falling" | "stable",
  secondsInSegment: number
): { structure: TrackStructure; progress: number } {
  if (energyLongHistory.length < 30) return { structure: "unknown", progress: 0 };
  const windowLen = energyLongHistory.length;
  const recent = energyLongHistory.slice(-30);
  const older = energyLongHistory.slice(0, Math.floor(windowLen / 2));
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
  const longMean = energyLongHistory.reduce((a, b) => a + b, 0) / windowLen;
  const variance = energyLongHistory.reduce((a, b) => a + (b - longMean) ** 2, 0) / windowLen;
  const stdDev = Math.sqrt(variance);
  const progress = Math.min(1, secondsInSegment / 32);
  if (avgRecent > 0.5 && stdDev > 0.08 && trend !== "rising") return { structure: "drop", progress };
  if (trend === "rising" && avgRecent > avgOlder * 1.15 && avgRecent < 0.75) return { structure: "buildup", progress };
  if (avgRecent < 0.2 && avgOlder > 0.35) return { structure: "breakdown", progress };
  if (avgRecent < 0.25 && avgOlder < 0.2 && trend !== "falling") return { structure: "intro", progress };
  if (trend === "falling" && avgRecent < longMean * 0.7 && avgRecent < 0.3) return { structure: "outro", progress };
  return { structure: "drop", progress };
}

// Вычисляем расширенные признаки трека из частотных данных
function computeTrackFeatures(
  freqData: Uint8Array,
  binSize: number,
  energyHistory: number[],
  energy: number,
  trend: "rising" | "falling" | "stable",
  structure: TrackStructure
): TrackFeatures {
  const len = freqData.length;

  // Kick density: суббас 40-100 Hz — резкие пики энергии
  const kickEnd = Math.floor(100 / binSize);
  const kickStart = Math.floor(40 / binSize);
  let kickSum = 0;
  for (let i = kickStart; i < Math.min(kickEnd, len); i++) kickSum += freqData[i];
  const kick_density = Math.min(1, (kickSum / Math.max(1, kickEnd - kickStart) / 255) * 2.5);

  // Snare density: 150-400 Hz
  const snareStart = Math.floor(150 / binSize);
  const snareEnd = Math.floor(400 / binSize);
  let snareSum = 0;
  for (let i = snareStart; i < Math.min(snareEnd, len); i++) snareSum += freqData[i];
  const snare_density = Math.min(1, (snareSum / Math.max(1, snareEnd - snareStart) / 255) * 2.0);

  // Bass energy: 20-250 Hz
  const bassEnd = Math.floor(250 / binSize);
  let bassSum = 0;
  for (let i = 0; i < Math.min(bassEnd, len); i++) bassSum += freqData[i];
  const bass_energy = Math.min(1, bassSum / Math.max(1, bassEnd) / 255 * 2.2);

  // Vocal presence: 800-3000 Hz (речь, вокал, основные инструменты)
  const vocalStart = Math.floor(800 / binSize);
  const vocalEnd = Math.floor(3000 / binSize);
  let vocalSum = 0;
  for (let i = vocalStart; i < Math.min(vocalEnd, len); i++) vocalSum += freqData[i];
  const vocal_presence = Math.min(1, vocalSum / Math.max(1, vocalEnd - vocalStart) / 255 * 2.5);

  // Spectral brightness: 5000+ Hz
  const brightStart = Math.floor(5000 / binSize);
  let brightSum = 0;
  for (let i = brightStart; i < len; i++) brightSum += freqData[i];
  const spectral_brightness = Math.min(1, brightSum / Math.max(1, len - brightStart) / 255 * 3.0);

  // Drop probability: нарастающая + высокий бас + kick density
  const drop_probability = trend === "rising"
    ? Math.min(1, (bass_energy * 0.5 + kick_density * 0.3 + energy * 0.2))
    : structure === "buildup"
    ? Math.min(1, bass_energy * 0.7 + energy * 0.3)
    : energy * 0.2;

  // Silence probability: очень низкая общая энергия
  const silence_probability = energy < 0.15 ? (0.15 - energy) / 0.15 : 0;

  return {
    kick_density,
    snare_density,
    bass_energy,
    vocal_presence,
    spectral_brightness,
    drop_probability,
    silence_probability,
  };
}

export function useWebAudio() {
  const [analysis, setAnalysis] = useState<AudioAnalysis>({
    bars: Array.from({ length: BAR_COUNT }, () => 0.02),
    bpm: 0,
    energy: 0,
    genre: "—",
    mood: "relaxed",
    structure: "unknown",
    structureProgress: 0,
    energyTrend: "stable",
    trackFeatures: {
      kick_density: 0, snare_density: 0, bass_energy: 0,
      vocal_presence: 0, spectral_brightness: 0,
      drop_probability: 0, silence_probability: 1,
    },
    isListening: false,
    error: null,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const energyHistoryRef = useRef<number[]>([]);
  const energyLongHistoryRef = useRef<number[]>([]);
  const energyTrendWindowRef = useRef<number[]>([]);

  const detectedBpmRef = useRef<number>(0);
  const bpmSmoothRef = useRef<number>(0);
  const genreRef = useRef<string>("—");
  const moodRef = useRef<MoodType>("relaxed");
  const structureRef = useRef<TrackStructure>("unknown");
  const structureProgressRef = useRef<number>(0);
  const energyTrendRef = useRef<"rising" | "falling" | "stable">("stable");
  const trackFeaturesRef = useRef<TrackFeatures>({
    kick_density: 0, snare_density: 0, bass_energy: 0,
    vocal_presence: 0, spectral_brightness: 0,
    drop_probability: 0, silence_probability: 1,
  });

  const segmentStartTimeRef = useRef<number>(Date.now());
  const lastStructureRef = useRef<TrackStructure>("unknown");

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    setAnalysis(prev => ({ ...prev, isListening: false }));
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const sampleRate = ctx.sampleRate;
      const binSize = sampleRate / FFT_SIZE;

      const lowEnd = Math.floor(200 / binSize);
      const midEnd = Math.floor(2000 / binSize);
      const highEnd = Math.floor(8000 / binSize);

      let frameCount = 0;

      const tick = () => {
        analyser.getByteFrequencyData(freqData);
        const binCount = freqData.length;

        const bars: number[] = [];
        const binsPerBar = Math.floor(binCount / BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < binsPerBar; j++) sum += freqData[i * binsPerBar + j];
          bars.push(sum / binsPerBar / 255);
        }

        let lowSum = 0, midSum = 0, highSum = 0;
        for (let i = 0; i < lowEnd; i++) lowSum += freqData[i];
        for (let i = lowEnd; i < midEnd; i++) midSum += freqData[i];
        for (let i = midEnd; i < Math.min(highEnd, binCount); i++) highSum += freqData[i];

        const lowE = lowSum / (lowEnd * 255);
        const midE = midSum / ((midEnd - lowEnd) * 255);
        const highE = highSum / ((Math.min(highEnd, binCount) - midEnd) * 255);
        const totalEnergy = lowE * 0.5 + midE * 0.35 + highE * 0.15;
        const displayEnergy = Math.min(1, totalEnergy * 2.5);

        energyHistoryRef.current.push(totalEnergy);
        if (energyHistoryRef.current.length > 180) energyHistoryRef.current.shift();

        energyLongHistoryRef.current.push(displayEnergy);
        if (energyLongHistoryRef.current.length > 600) energyLongHistoryRef.current.shift();

        energyTrendWindowRef.current.push(displayEnergy);
        if (energyTrendWindowRef.current.length > 60) energyTrendWindowRef.current.shift();

        frameCount++;

        if (frameCount % 90 === 0) {
          const raw = detectBPM(energyHistoryRef.current);
          if (raw > 0) detectedBpmRef.current = raw;
          if (detectedBpmRef.current > 0) {
            bpmSmoothRef.current = bpmSmoothRef.current === 0
              ? detectedBpmRef.current
              : Math.round(bpmSmoothRef.current * 0.7 + detectedBpmRef.current * 0.3);
          }

          genreRef.current = detectGenre(lowE, midE, highE, bpmSmoothRef.current);

          const tw = energyTrendWindowRef.current;
          if (tw.length >= 30) {
            const first = tw.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
            const last = tw.slice(-15).reduce((a, b) => a + b, 0) / 15;
            const diff = last - first;
            if (diff > 0.05) energyTrendRef.current = "rising";
            else if (diff < -0.05) energyTrendRef.current = "falling";
            else energyTrendRef.current = "stable";
          }

          moodRef.current = detectMood(lowE, midE, highE, bpmSmoothRef.current, displayEnergy, energyTrendRef.current);

          const secondsInSegment = (Date.now() - segmentStartTimeRef.current) / 1000;
          const { structure, progress } = detectStructure(
            energyLongHistoryRef.current, displayEnergy, energyTrendRef.current, secondsInSegment
          );
          structureRef.current = structure;
          structureProgressRef.current = progress;

          if (structure !== lastStructureRef.current) {
            segmentStartTimeRef.current = Date.now();
            lastStructureRef.current = structure;
          }

          trackFeaturesRef.current = computeTrackFeatures(
            freqData, binSize, energyHistoryRef.current,
            displayEnergy, energyTrendRef.current, structureRef.current
          );
        }

        setAnalysis({
          bars,
          bpm: bpmSmoothRef.current,
          energy: displayEnergy,
          genre: genreRef.current,
          mood: moodRef.current,
          structure: structureRef.current,
          structureProgress: structureProgressRef.current,
          energyTrend: energyTrendRef.current,
          trackFeatures: trackFeaturesRef.current,
          isListening: true,
          error: null,
        });

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
      setAnalysis(prev => ({ ...prev, isListening: true, error: null }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка доступа к микрофону";
      setAnalysis(prev => ({ ...prev, error: msg, isListening: false }));
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { analysis, start, stop };
}
