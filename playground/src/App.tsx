import { useEffect, useRef, useState } from "react";
import { DEMO_FIXTURES } from "./fixtures";
import { extractFromFigmaUrl } from "./figma";
import { runLoop, type IterationUpdate } from "./loop";
import type { PdsDocument } from "../../src/pds";

type Mode = "demo" | "url";
type Design = { kind: "html"; html: string } | { kind: "img"; url: string } | null;

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — fast, cheap (recommended for the loop)" },
  { id: "claude-opus-4-8", label: "Opus 4.8 — max fidelity" },
];

function ls(key: string, val?: string): string {
  if (val !== undefined) {
    localStorage.setItem(key, val);
    return val;
  }
  return localStorage.getItem(key) ?? "";
}

function decodeShare(): { html: string; score: number; label: string } | null {
  const h = location.hash.replace(/^#/, "");
  if (!h.startsWith("run=")) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(h.slice(4)))));
  } catch {
    return null;
  }
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => ls("plumb_anthropic_key"));
  const [figmaToken, setFigmaToken] = useState(() => ls("plumb_figma_token"));
  const [model, setModel] = useState(MODELS[0].id);
  const [mode, setMode] = useState<Mode>("demo");
  const [fixtureId, setFixtureId] = useState(DEMO_FIXTURES[0].id);
  const [figmaUrl, setFigmaUrl] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [design, setDesign] = useState<Design>(null);
  const [iterations, setIterations] = useState<IterationUpdate[]>([]);
  const [shared, setShared] = useState<{ html: string; score: number; label: string } | null>(null);

  const builtRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const current = iterations[iterations.length - 1] ?? null;

  // Replay a shared run, if the URL carries one.
  useEffect(() => {
    const s = decodeShare();
    if (s && builtRef.current) {
      setShared(s);
      builtRef.current.srcdoc = s.html;
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function plumb() {
    setError(null);
    setShared(null);
    setIterations([]);
    if (!apiKey.trim()) {
      setError("Enter your Anthropic API key first — it stays in your browser.");
      return;
    }
    ls("plumb_anthropic_key", apiKey.trim());

    let pds: PdsDocument;
    try {
      if (mode === "demo") {
        const fx = DEMO_FIXTURES.find((f) => f.id === fixtureId) ?? DEMO_FIXTURES[0];
        pds = fx.pds;
        setDesign({ kind: "html", html: fx.referenceHtml });
      } else {
        if (!figmaToken.trim()) {
          setError("Paste a Figma token for your own design (read-only is fine).");
          return;
        }
        ls("plumb_figma_token", figmaToken.trim());
        setStatus("Extracting the design from Figma…");
        const ex = await extractFromFigmaUrl(figmaUrl.trim(), figmaToken.trim());
        pds = ex.pds;
        setDesign(ex.imageUrl ? { kind: "img", url: ex.imageUrl } : null);
      }
    } catch (e) {
      setError(
        `${(e as Error).message}` +
          (mode === "url" ? " — Figma may block browser requests (CORS); try a demo design, or the `plumb fit` CLI locally." : ""),
      );
      return;
    }

    setRunning(true);
    setStatus("Generating the first build…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runLoop({
        pds,
        apiKey: apiKey.trim(),
        model,
        iframe: builtRef.current!,
        signal: ctrl.signal,
        onIteration: (u) => {
          setIterations((prev) => [...prev, u]);
          setStatus(u.fit.done ? "Pixel-perfect." : `Pass ${u.iteration}: ${u.fit.score.toFixed(1)}% — fixing ${u.fit.errors + u.fit.warns} delta(s)…`);
        },
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setStatus("Stopped.");
  }

  function share() {
    if (!current) return;
    const label = mode === "demo" ? DEMO_FIXTURES.find((f) => f.id === fixtureId)?.label ?? "design" : "Figma design";
    const payload = { html: current.html, score: current.fit.score, label };
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    location.hash = `run=${enc}`;
    navigator.clipboard?.writeText(location.href);
    setStatus("Share link copied to clipboard.");
  }

  const score = shared?.score ?? current?.fit.score ?? 0;
  const done = current?.fit.done ?? false;

  return (
    <div className="wrap">
      <header>
        <h1>
          Plumb <span className="dim">·</span> pixel-perfect, or it keeps going
        </h1>
        <p className="tagline">
          The self-healing design-to-code loop, live in your browser. It generates a build, measures how
          wrong it is against the design, fixes exactly that, and repeats until it matches.
        </p>
        <p className="cc">
          Use Claude Code or Cursor? Skip the key — run <code>plumb_fit</code> in your editor and it does this for free.
        </p>
      </header>

      <section className="controls">
        <label className="field">
          <span>Anthropic API key <em>(stays in your browser)</em></span>
          <input type="password" value={apiKey} placeholder="sk-ant-…" onChange={(e) => setApiKey(e.target.value)} />
        </label>

        <label className="field">
          <span>Generator model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        <div className="modes">
          <button className={mode === "demo" ? "tab on" : "tab"} onClick={() => setMode("demo")}>Demo design</button>
          <button className={mode === "url" ? "tab on" : "tab"} onClick={() => setMode("url")}>Your Figma URL</button>
        </div>

        {mode === "demo" ? (
          <label className="field">
            <span>Pick a design</span>
            <select value={fixtureId} onChange={(e) => setFixtureId(e.target.value)}>
              {DEMO_FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Figma URL (a frame's share link)</span>
              <input value={figmaUrl} placeholder="https://www.figma.com/design/…?node-id=…" onChange={(e) => setFigmaUrl(e.target.value)} />
            </label>
            <label className="field">
              <span>Figma token <em>(read-only, stays in your browser)</em></span>
              <input type="password" value={figmaToken} placeholder="figd_…" onChange={(e) => setFigmaToken(e.target.value)} />
            </label>
          </>
        )}

        <div className="actions">
          {running ? (
            <button className="primary stop" onClick={stop}>Stop</button>
          ) : (
            <button className="primary" onClick={plumb}>Plumb it →</button>
          )}
          {current && !running && (
            <>
              <button onClick={() => navigator.clipboard?.writeText(current.html)}>Copy code</button>
              <button onClick={share}>Share run</button>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {!error && status && <p className="status">{status}</p>}
      </section>

      <section className="scoreboard">
        <div className="bigscore">
          <span className={done ? "pct done" : "pct"}>{score.toFixed(1)}<small>%</small></span>
          <span className="scorelabel">{done ? "matches the design" : shared ? "shared run" : "match"}</span>
        </div>
        <div className="bar"><div className={done ? "fill done" : "fill"} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div>
      </section>

      <section className="stage">
        <figure>
          <figcaption>Design</figcaption>
          {design?.kind === "img" && <img src={design.url} alt="Figma design" />}
          {design?.kind === "html" && <iframe title="design" srcDoc={design.html} />}
          {!design && <div className="placeholder">{shared ? "(design not included in shared run)" : "Pick a design and press Plumb it"}</div>}
        </figure>
        <figure>
          <figcaption>Built {running && <span className="spin" />}</figcaption>
          <iframe title="built" ref={builtRef} />
        </figure>
      </section>

      {iterations.length > 0 && (
        <section className="log">
          <h2>Convergence</h2>
          <ol>
            {iterations.map((u) => (
              <li key={u.iteration}>
                <b>Pass {u.iteration}</b> — {u.fit.score.toFixed(1)}% · {u.fit.importantMatched}/{u.fit.importantTotal} key nodes · {u.fit.errors} err · {u.fit.warns} warn
                {u.iteration === current?.iteration && !u.fit.done && u.fit.topFixes.length > 0 && (
                  <ul className="fixes">{u.fit.topFixes.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}</ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer>
        <a href="/plumb-mcp/">Plumb docs</a> · <a href="https://github.com/tathagat22/plumb-mcp">GitHub</a> · runs entirely in your browser; keys never leave it
      </footer>
    </div>
  );
}
