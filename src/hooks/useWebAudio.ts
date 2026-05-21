import { useState, useEffect, useRef, useCallback } from "react";

export type TrackStructure = "intro" | "buildup" | "drop" | "breakdown" | "outro" | "unknown";
export type MoodType =
  | "aggressive"   // высокая энергия, быстро, тяжёлый бас
  | "euphoric"     // высокая энергия, яркие верха, быстро
  | "dark"         // средняя энергия, низкий бас, мало верхов
  | "melancholic"  // низкая энергия, преобладают средние частоты
  | "tense"        // нарастающая энергия, bildup state
  | "relaxed"      // низкая энергия, плавные изменения
  | "hypnotic"     // монотонная повторяющаяся структура
  | "energetic";   // общая высокая энергия

export interface AudioAnalysis {
  bars: number[];
  bpm: number;
  energy: number;
  genre: string;
  mood: MoodType;
  structure: TrackStructure;
  structureProgress: number; // 0-1, насколько длится текущий сегмент
  energyTrend: "rising" | "falling" | "stable";
  isListening: boolean;
  error: string | null;
}

const FFT_SIZE = 256;
const BAR_COUNT = 32;

// BPM detection via beat tracking
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

// Genre detection
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

// Mood detection based on energy bands + bpm + energy level
function detectMood(
  lowE: number,
  midE: number,
  highE: number,
  bpm: number,
  energy: number,
  trend: "rising" | "falling" | "stable"
): MoodType {
  const total = lowE + midE + highE + 0.001;
  const lowR = lowE / total;
  const midR = midE / total;
  const highR = highE / total;

  // Нарастающее напряжение (buildup feeling)
  if (trend === "rising" && energy > 0.3 && energy < 0.75) return "tense";

  // Высокая энергия + быстрый темп + сильный бас = агрессия
  if (energy > 0.6 && bpm > 130 && lowR > 0.45) return "aggressive";

  // Высокая энергия + много верхов = эйфория (House/Pop drop)
  if (energy > 0.55 && highR > 0.3 && bpm > 120) return "euphoric";

  // Высокая общая энергия
  if (energy > 0.6 && bpm > 100) return "energetic";

  // Тёмный: средняя/низкая энергия, доминирует бас, мало верхов
  if (lowR > 0.5 && highR < 0.15 && bpm >= 100 && bpm <= 145) return "dark";

  // Меланхолия: низкая энергия, средние частоты преобладают
  if (energy < 0.3 && midR > 0.45) return "melancholic";

  // Монотонная гипнотическая: стабильная энергия, bpm 120-145
  if (trend === "stable" && bpm >= 120 && bpm <= 145 && energy > 0.2 && energy < 0.5) return "hypnotic";

  // Расслабленное: низкая энергия, низкий bpm
  if (energy < 0.25 && bpm < 110) return "relaxed";

  return "energetic";
}

// Track structure detection
// Анализирует долгосрочную историю энергии для определения структурного момента
function detectStructure(
  energyLongHistory: number[], // ~10 секунд истории
  energy: number,
  trend: "rising" | "falling" | "stable",
  secondsInSegment: number
): { structure: TrackStructure; progress: number } {
  if (energyLongHistory.length < 30) return { structure: "unknown", progress: 0 };

  const windowLen = energyLongHistory.length;
  const recent = energyLongHistory.slice(-30); // последние ~0.5с
  const older = energyLongHistory.slice(0, Math.floor(windowLen / 2));

  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
  const longMean = energyLongHistory.reduce((a, b) => a + b, 0) / windowLen;

  // Разброс энергии (вариативность)
  const variance = energyLongHistory.reduce((a, b) => a + (b - longMean) ** 2, 0) / windowLen;
  const stdDev = Math.sqrt(variance);

  // Нормализованный прогресс сегмента (0-1, max 32 секунды)
  const progress = Math.min(1, secondsInSegment / 32);

  // DROP: высокая энергия, много вариативности (биты), пришли после buildup
  if (avgRecent > 0.5 && stdDev > 0.08 && trend !== "rising") {
    return { structure: "drop", progress };
  }

  // BUILDUP: энергия нарастает к пику
  if (trend === "rising" && avgRecent > avgOlder * 1.15 && avgRecent < 0.75) {
    return { structure: "buildup", progress };
  }

  // BREAKDOWN: низкая энергия после дропа (тихий участок)
  if (avgRecent < 0.2 && avgOlder > 0.35) {
    return { structure: "breakdown", progress };
  }

  // INTRO: начало трека — нарастает с нуля, долго низкая энергия
  if (avgRecent < 0.25 && avgOlder < 0.2 && trend !== "falling") {
    return { structure: "intro", progress };
  }

  // OUTRO: падающая энергия к концу
  if (trend === "falling" && avgRecent < longMean * 0.7 && avgRecent < 0.3) {
    return { structure: "outro", progress };
  }

  // По умолчанию: drop (активная часть)
  return { structure: "drop", progress };
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
    isListening: false,
    error: null,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  // Short-term energy history (3 sec ~180 frames for BPM)
  const energyHistoryRef = useRef<number[]>([]);
  // Long-term energy history (~10 sec ~600 frames for structure)
  const energyLongHistoryRef = useRef<number[]>([]);
  // Trend detection: last 60 frames (~1 sec)
  const energyTrendWindowRef = useRef<number[]>([]);

  const detectedBpmRef = useRef<number>(0);
  const bpmSmoothRef = useRef<number>(0);
  const genreRef = useRef<string>("—");
  const moodRef = useRef<MoodType>("relaxed");
  const structureRef = useRef<TrackStructure>("unknown");
  const structureProgressRef = useRef<number>(0);
  const energyTrendRef = useRef<"rising" | "falling" | "stable">("stable");

  // Segment timer: сколько секунд в текущем структурном состоянии
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

        // Build display bars
        const bars: number[] = [];
        const binsPerBar = Math.floor(binCount / BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < binsPerBar; j++) {
            sum += freqData[i * binsPerBar + j];
          }
          bars.push(sum / binsPerBar / 255);
        }

        // Energy bands
        let lowSum = 0, midSum = 0, highSum = 0;
        for (let i = 0; i < lowEnd; i++) lowSum += freqData[i];
        for (let i = lowEnd; i < midEnd; i++) midSum += freqData[i];
        for (let i = midEnd; i < Math.min(highEnd, binCount); i++) highSum += freqData[i];

        const lowE = lowSum / (lowEnd * 255);
        const midE = midSum / ((midEnd - lowEnd) * 255);
        const highE = highSum / ((Math.min(highEnd, binCount) - midEnd) * 255);
        const totalEnergy = lowE * 0.5 + midE * 0.35 + highE * 0.15;
        const displayEnergy = Math.min(1, totalEnergy * 2.5);

        // BPM history (3 sec)
        energyHistoryRef.current.push(totalEnergy);
        if (energyHistoryRef.current.length > 180) energyHistoryRef.current.shift();

        // Long-term history (10 sec)
        energyLongHistoryRef.current.push(displayEnergy);
        if (energyLongHistoryRef.current.length > 600) energyLongHistoryRef.current.shift();

        // Trend window (1 sec)
        energyTrendWindowRef.current.push(displayEnergy);
        if (energyTrendWindowRef.current.length > 60) energyTrendWindowRef.current.shift();

        frameCount++;

        // Every 90 frames (~1.5 sec): update BPM, genre, mood, structure
        if (frameCount % 90 === 0) {
          // BPM
          const raw = detectBPM(energyHistoryRef.current);
          if (raw > 0) detectedBpmRef.current = raw;
          if (detectedBpmRef.current > 0) {
            bpmSmoothRef.current = bpmSmoothRef.current === 0
              ? detectedBpmRef.current
              : Math.round(bpmSmoothRef.current * 0.7 + detectedBpmRef.current * 0.3);
          }

          // Genre
          genreRef.current = detectGenre(lowE, midE, highE, bpmSmoothRef.current);

          // Energy trend (rising/falling/stable)
          const tw = energyTrendWindowRef.current;
          if (tw.length >= 30) {
            const first = tw.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
            const last = tw.slice(-15).reduce((a, b) => a + b, 0) / 15;
            const diff = last - first;
            if (diff > 0.05) energyTrendRef.current = "rising";
            else if (diff < -0.05) energyTrendRef.current = "falling";
            else energyTrendRef.current = "stable";
          }

          // Mood
          moodRef.current = detectMood(
            lowE, midE, highE,
            bpmSmoothRef.current,
            displayEnergy,
            energyTrendRef.current
          );

          // Structure
          const secondsInSegment = (Date.now() - segmentStartTimeRef.current) / 1000;
          const { structure, progress } = detectStructure(
            energyLongHistoryRef.current,
            displayEnergy,
            energyTrendRef.current,
            secondsInSegment
          );
          structureRef.current = structure;
          structureProgressRef.current = progress;

          // Сбрасываем таймер сегмента при смене структуры
          if (structure !== lastStructureRef.current) {
            segmentStartTimeRef.current = Date.now();
            lastStructureRef.current = structure;
          }
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
