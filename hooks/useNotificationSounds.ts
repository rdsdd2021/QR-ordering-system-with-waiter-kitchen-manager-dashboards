"use client";

/**
 * useNotificationSounds
 *
 * Provides distinct audio tones and vibration patterns for different
 * restaurant events. Uses the Web Audio API to synthesise tones — no
 * audio files required, works offline.
 *
 * Sounds:
 *  - newOrder      : urgent double-beep (high pitch) — kitchen / waiter
 *  - orderReady    : pleasant ascending two-tone — waiter (food is ready)
 *  - orderUpdate   : single soft blip — status changed
 *  - waiterCall    : triple short beeps — someone called for a waiter
 *
 * Vibration patterns (Android Chrome only, silently ignored elsewhere):
 *  - newOrder      : [200, 100, 200]          — two firm pulses
 *  - orderReady    : [300, 100, 300, 100, 300] — three pulses
 *  - orderUpdate   : [100]                    — single short buzz
 *  - waiterCall    : [100, 80, 100, 80, 100]  — rapid triple tap
 *
 * Mute state is persisted to localStorage under the key
 * `notification_sounds_muted` so it survives page reloads.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationEvent =
  | "newOrder"
  | "orderReady"
  | "orderUpdate"
  | "waiterCall";

const STORAGE_KEY = "notification_sounds_muted";

// ── Vibration patterns ────────────────────────────────────────────────────────

const VIBRATION: Record<NotificationEvent, number[]> = {
  newOrder:    [200, 100, 200],
  orderReady:  [300, 100, 300, 100, 300],
  orderUpdate: [100],
  waiterCall:  [100, 80, 100, 80, 100],
};

// ── Audio synthesis helpers ───────────────────────────────────────────────────

/**
 * Play a sequence of beeps using the Web Audio API.
 * Each beep is defined by { freq, duration, startTime } (all in seconds).
 */
function playTone(
  ctx: AudioContext,
  beeps: Array<{ freq: number; duration: number; startAt: number; type?: OscillatorType }>
) {
  for (const { freq, duration, startAt, type = "sine" } of beeps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);

    // Smooth envelope: quick attack, short decay to avoid clicks
    gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);

    osc.start(ctx.currentTime + startAt);
    osc.stop(ctx.currentTime + startAt + duration + 0.05);
  }
}

function soundNewOrder(ctx: AudioContext) {
  // Two sharp high-pitched beeps — unmistakable "new order" alert
  playTone(ctx, [
    { freq: 880, duration: 0.12, startAt: 0,    type: "square" },
    { freq: 880, duration: 0.12, startAt: 0.22, type: "square" },
  ]);
}

function soundOrderReady(ctx: AudioContext) {
  // Ascending two-tone chime — pleasant "food is ready" signal
  playTone(ctx, [
    { freq: 523, duration: 0.18, startAt: 0,    type: "sine" }, // C5
    { freq: 784, duration: 0.25, startAt: 0.22, type: "sine" }, // G5
  ]);
}

function soundOrderUpdate(ctx: AudioContext) {
  // Single soft blip — subtle status change notification
  playTone(ctx, [
    { freq: 660, duration: 0.1, startAt: 0, type: "sine" },
  ]);
}

function soundWaiterCall(ctx: AudioContext) {
  // Triple short beeps — attention-grabbing waiter call
  playTone(ctx, [
    { freq: 740, duration: 0.1, startAt: 0,    type: "triangle" },
    { freq: 740, duration: 0.1, startAt: 0.18, type: "triangle" },
    { freq: 740, duration: 0.1, startAt: 0.36, type: "triangle" },
  ]);
}

const SOUND_FNS: Record<NotificationEvent, (ctx: AudioContext) => void> = {
  newOrder:    soundNewOrder,
  orderReady:  soundOrderReady,
  orderUpdate: soundOrderUpdate,
  waiterCall:  soundWaiterCall,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNotificationSounds() {
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  // AudioContext is created lazily on first user interaction to satisfy
  // browser autoplay policies (context must be resumed after a user gesture).
  const ctxRef = useRef<AudioContext | null>(null);

  // Persist mute preference
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(muted));
  }, [muted]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  /**
   * Play a notification for the given event type.
   * Safe to call unconditionally — respects mute state internally.
   */
  const notify = useCallback(
    (event: NotificationEvent) => {
      if (muted) return;

      // Vibrate (no-op on unsupported browsers)
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(VIBRATION[event]);
      }

      // Audio — create / resume AudioContext lazily
      try {
        if (!ctxRef.current) {
          ctxRef.current = new (window.AudioContext ||
            (window as any).webkitAudioContext)();
        }
        const ctx = ctxRef.current;
        // Resume if suspended (browser autoplay policy)
        const play = () => SOUND_FNS[event](ctx);
        if (ctx.state === "suspended") {
          ctx.resume().then(play).catch(() => {});
        } else {
          play();
        }
      } catch {
        // AudioContext not available — silently ignore
      }
    },
    [muted]
  );

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  return { notify, muted, toggleMute };
}
