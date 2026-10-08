import TransitionDemo from "./components/TransitionDemo.tsx";

export default function App() {
  return (
    <main className="page-shell">
      <header className="site-header">
        <a
          className="wordmark"
          href="/"
          aria-label="Optical Noise Transition home"
        >
          <span className="wordmark-mark" aria-hidden="true">ON</span>
          <span>Optical Noise</span>
        </a>
        <span className="engine-label">
          <span className="status-dot" /> WEBGL 2.0 / CPU FALLBACK
        </span>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">WEBGL 2.0 · CPU FALLBACK</p>
        <h1 id="page-title">Noise Transition</h1>
        <p className="intro-copy">
          Compose positioned images into layers, then transition each composite
          on a resizable canvas.
        </p>
      </section>
      <TransitionDemo />
      <footer className="site-footer">
        <span>OPTICAL NOISE TRANSITION</span>
        <a href="https://deno.com">Built with Deno + React + Vite</a>
      </footer>
    </main>
  );
}
