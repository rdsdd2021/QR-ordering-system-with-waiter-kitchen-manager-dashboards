"use client";
// Adapted from reactbits.dev/text-animations/shiny-text (MIT)
import React, { useState, useRef } from 'react';
import { motion, useMotionValue, useAnimationFrame, useTransform } from 'motion/react';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
  color?: string;
  shineColor?: string;
  spread?: number;
}

const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  disabled = false,
  speed = 3,
  className = '',
  color = 'currentColor',
  shineColor = 'rgba(255,255,255,0.85)',
  spread = 120,
}) => {
  const progress = useMotionValue(0);
  const elapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  useAnimationFrame(time => {
    if (disabled) return;
    if (lastTimeRef.current === null) { lastTimeRef.current = time; return; }
    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;
    elapsedRef.current += delta;
    const p = (elapsedRef.current % (speed * 1000)) / (speed * 1000) * 100;
    progress.set(p);
  });

  const backgroundPosition = useTransform(progress, p => `${150 - p * 2}% center`);

  return (
    <motion.span
      className={`inline-block ${className}`}
      style={{
        backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundPosition,
      }}
    >
      {text}
    </motion.span>
  );
};

export default ShinyText;
