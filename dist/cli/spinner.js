// A one-line "working..." indicator on stderr. It only runs on an interactive terminal, so
// piped or redirected output, --json and --quiet never contain it.
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const noSpinner = { update() { }, stop() { } };
export function startSpinner(write, text, intervalMs = 80) {
    let frame = 0;
    let current = text;
    let stopped = false;
    // "\x1b[K" erases the rest of the line, so a shorter message fully replaces a longer one
    // and the cursor stays right after the text.
    const draw = () => {
        write(`\r${FRAMES[frame % FRAMES.length]} ${current}\x1b[K`);
        frame++;
    };
    draw();
    const timer = setInterval(draw, intervalMs);
    return {
        update(t) {
            current = t;
        },
        stop() {
            if (stopped)
                return;
            stopped = true;
            clearInterval(timer);
            write("\r\x1b[K");
        },
    };
}
