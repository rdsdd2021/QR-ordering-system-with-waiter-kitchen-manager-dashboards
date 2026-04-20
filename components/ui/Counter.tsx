"use client";
// Adapted from reactbits.dev/components/count-up (MIT)
import { MotionValue, motion, useSpring, useTransform } from 'motion/react';
import type React from 'react';
import { useEffect } from 'react';

type PlaceValue = number | '.';

function Number({ mv, number, height }: { mv: MotionValue<number>; number: number; height: number }) {
  const y = useTransform(mv, latest => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) memo -= 10 * height;
    return memo;
  });
  return (
    <motion.span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', y }}>
      {number}
    </motion.span>
  );
}

function Digit({ place, value, height }: { place: PlaceValue; value: number; height: number }) {
  if (place === '.') return <span style={{ height, display: 'inline-flex', alignItems: 'center' }}>.</span>;
  const rounded = Math.floor(value / place);
  const animatedValue = useSpring(rounded);
  useEffect(() => { animatedValue.set(rounded); }, [animatedValue, rounded]);
  return (
    <span style={{ height, position: 'relative', width: '1ch', overflow: 'hidden', display: 'inline-flex', fontVariantNumeric: 'tabular-nums' }}>
      {Array.from({ length: 10 }, (_, i) => <Number key={i} mv={animatedValue} number={i} height={height} />)}
    </span>
  );
}

interface CounterProps {
  value: number;
  fontSize?: number;
  textColor?: string;
  fontWeight?: React.CSSProperties['fontWeight'];
  className?: string;
}

export default function Counter({ value, fontSize = 16, textColor = 'inherit', fontWeight = 'inherit', className = '' }: CounterProps) {
  const height = fontSize * 1.2;
  const places: PlaceValue[] = [...value.toString()].map((ch, i, a) => {
    if (ch === '.') return '.';
    const dotIndex = a.indexOf('.');
    const isInteger = dotIndex === -1;
    const exponent = isInteger ? a.length - i - 1 : i < dotIndex ? dotIndex - i - 1 : -(i - dotIndex);
    return 10 ** exponent;
  });

  return (
    <span className={`inline-flex ${className}`} style={{ fontSize, color: textColor, fontWeight, lineHeight: 1 }}>
      {places.map((place, i) => <Digit key={i} place={place} value={value} height={height} />)}
    </span>
  );
}
