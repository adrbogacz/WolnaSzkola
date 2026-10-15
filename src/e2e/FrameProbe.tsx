import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

const E2E = process.env.EXPO_PUBLIC_E2E === '1';

/**
 * E2E builds only: records the longest gap between JS animation frames for `windowMs` after
 * mount and exposes it as text, so a test can assert that opening a screen never blocked the
 * JS thread. Renders nothing in normal builds.
 */
export function FrameProbe({ windowMs = 3000 }: { windowMs?: number }) {
  const [worstMs, setWorstMs] = useState<number | null>(null);

  useEffect(() => {
    if (!E2E) return;
    let last = performance.now();
    const until = last + windowMs;
    let worst = 0;
    let frame = 0;
    const tick = (now: number) => {
      worst = Math.max(worst, now - last);
      last = now;
      if (now < until) frame = requestAnimationFrame(tick);
      else setWorstMs(Math.round(worst));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [windowMs]);

  if (!E2E) return null;
  return (
    <Text testID="frame-probe" style={styles.probe} accessible={false}>
      {worstMs === null ? '' : String(worstMs)}
    </Text>
  );
}

const styles = StyleSheet.create({
  probe: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0.01 },
});
