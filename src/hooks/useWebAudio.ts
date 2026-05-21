import { useState, useEffect, useRef, useCallback } from "react";

export interface AudioAnalysis {
  bars: number[];
  bpm: number;
  energy: number;
  genre: string;
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
  // 60fps assumed, interval in frames → BPM
  const bpm = Math.round(60 / (avgInterval / 60));
  return Math.min(200, Math.max(60, bpm));
}

// Genre detection by frequency distribution
function detectGenre(
  lowEnergy: number,
  midEnergy: number,
  highEnergy: number,
  bpm: number
): string {
  const total = lowEnergy + midEnergy + highEnergy + 0.001;
  const lowR = lowEnergy / total;
  const midR = midEnergy / total;
  const highR = highEnergy / total;

  if (bpm >= 130 && bpm <= 160 && lowR > 0.45) return "Techno";
  if (bpm >= 120 && bpm <= 135 && midR > 0.35) return "House";
  if (bpm >= 160 && lowR > 0.4) return "DnB";
  if (bpm >= 110 && bpm <= 140 && highR > 0.35) return "Pop";
  if (bpm >= 100 && bpm <= 140 && midR > 0.4 && highR > 0.25) return "Rock";
  if (bpm < 100 && midR > 0.45) return "Jazz";
  if (bpm < 90) return "Ambient";
  return "Electronic";
}

export function useWebAudio() {
  const [analysis, setAnalysis] = useState<AudioAnalysis>({
    bars: Array.from({ length: BAR_COUNT }, () => 0.02),
    bpm: 0,
    energy: 0,
    genre: "—",
    isListening: false,
    error: null,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const energyHistoryRef = useRef<number[]>([]);
  const detectedBpmRef = useRef<number>(0);
  const bpmSmoothRef = useRef<number>(0);
  const genreRef = useRef<string>("—");

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

      // Frequency ranges (Hz)
      const lowEnd = Math.floor(200 / binSize);
      const midEnd = Math.floor(2000 / binSize);
      const highEnd = Math.floor(8000 / binSize);

      let frameCount = 0;

      const tick = () => {
        analyser.getByteFrequencyData(freqData);
        const binCount = freqData.length;

        // Build display bars (32 bars from freq data)
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
        const totalEnergy = (lowE * 0.5 + midE * 0.35 + highE * 0.15);

        // BPM via energy history
        energyHistoryRef.current.push(totalEnergy);
        if (energyHistoryRef.current.length > 180) energyHistoryRef.current.shift();

        frameCount++;
        if (frameCount % 90 === 0) {
          const raw = detectBPM(energyHistoryRef.current);
          if (raw > 0) detectedBpmRef.current = raw;
          // smooth BPM
          if (detectedBpmRef.current > 0) {
            bpmSmoothRef.current = bpmSmoothRef.current === 0
              ? detectedBpmRef.current
              : Math.round(bpmSmoothRef.current * 0.7 + detectedBpmRef.current * 0.3);
          }
          genreRef.current = detectGenre(lowE, midE, highE, bpmSmoothRef.current);
        }

        setAnalysis({
          bars,
          bpm: bpmSmoothRef.current,
          energy: Math.min(1, totalEnergy * 2.5),
          genre: genreRef.current,
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
