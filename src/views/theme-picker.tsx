import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { animated, useSpring } from '@react-spring/web';
import { THEMES, getTheme, setTheme, type Theme } from '../lib/themes.js';
import { prefersReducedMotion } from '../lib/shell-motion.js';

function Swatch({ accent, selected, reduce }: { accent: string; selected: boolean; reduce: boolean }) {
  const spring = useSpring({
    scale: selected ? 1.14 : 1,
    immediate: reduce,
  });
  return (
    <animated.span
      className="theme-card-swatch"
      style={{ background: accent, scale: spring.scale }}
    />
  );
}

function ThemeCard({
  theme,
  selected,
  reduce,
  index,
  onPick,
}: {
  theme: Theme;
  selected: boolean;
  reduce: boolean;
  index: number;
  onPick: (name: string) => void;
}) {
  return (
    <motion.label
      className={`theme-card${selected ? ' theme-card--selected' : ''}`}
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { delay: reduce ? 0 : index * 0.04, duration: reduce ? 0 : 0.28 } },
      }}
    >
      <input
        type="radio"
        name="theme"
        value={theme.name}
        checked={selected}
        onChange={() => onPick(theme.name)}
      />
      <Swatch accent={theme.accent} selected={selected} reduce={reduce} />
      <span className="theme-card-label">{theme.label}</span>
    </motion.label>
  );
}

export function ThemePicker() {
  const [current, setCurrent] = useState(getTheme);
  const reduce = prefersReducedMotion();

  useEffect(() => {
    const sync = (): void => setCurrent(getTheme());
    window.addEventListener('grok-remote:theme-change', sync);
    return () => window.removeEventListener('grok-remote:theme-change', sync);
  }, []);

  function pick(name: string): void {
    setTheme(name);
    setCurrent(name);
    window.dispatchEvent(new CustomEvent('grok-remote:theme-change', { detail: { theme: name } }));
  }

  return (
    <motion.div
      className="theme-grid"
      initial={reduce ? 'show' : 'hidden'}
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduce ? 0 : 0.045 } },
      }}
    >
      {THEMES.map((theme, index) => (
        <ThemeCard
          key={theme.name}
          theme={theme}
          selected={theme.name === current}
          reduce={reduce}
          index={index}
          onPick={pick}
        />
      ))}
    </motion.div>
  );
}
