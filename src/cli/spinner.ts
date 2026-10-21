// A one-line "working..." indicator on stderr. It only runs on an interactive terminal, so
// piped or redirected output, --json and --quiet never contain it.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  update(text: string): void;
  stop(): void;
}

export const noSpinner: Spinner = { update() {}, stop() {} };

export function startSpinner(write: (s: string) => void, text: string, intervalMs = 80): Spinner {
  let frame = 0;
  let current = text;
  let width = 0;
  let stopped = false;
  const draw = () => {
    const line = `${FRAMES[frame % FRAMES.length]} ${current}`;
    // Pad with spaces so a shorter message fully covers a longer one.
    write(`\r${line.padEnd(width)}`);
    width = Math.max(width, line.length);
    frame++;
  };
  draw();
  const timer = setInterval(draw, intervalMs);
  return {
    update(t) {
      current = t;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      write(`\r${" ".repeat(width)}\r`);
    },
  };
}
