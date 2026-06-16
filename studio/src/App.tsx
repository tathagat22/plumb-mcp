import { useEffect, useRef, useState } from "react";
import type { Incoming, StudioEvent } from "./types";

type Mode = "mirror" | "drive";
type Status = "connecting" | "open" | "closed";

// In production the cockpit is served by the bridge at the server root, so the
// WS lives at the same host. In dev (vite on :5173) point at the default bridge.
const WS_URL = import.meta.env.DEV
  ? "ws://127.0.0.1:31337/studio"
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/studio`;

function useStudioSocket() {
  const [status, setStatus] = useState<Status>("connecting");
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setStatus("open");
      ws.onmessage = (e) => {
        let msg: Incoming;
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (msg.t === "studio-hello") setEvents(msg.backlog);
        else if (msg.t === "studio-event") setEvents((prev) => [...prev, msg.event]);
      };
      ws.onclose = () => {
        setStatus("closed");
        if (!closed) retry.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry.current) clearTimeout(retry.current);
      ws?.close();
    };
  }, []);

  return { status, events };
}

function pct(n: number | undefined): string {
  return n === undefined ? "—" : n.toFixed(1);
}

function timeAgo(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default function App() {
  const { status, events } = useStudioSocket();
  const [mode, setMode] = useState<Mode>("mirror");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lastFit = [...events].reverse().find((e) => e.kind === "fit");
  const lastConverged = [...events].reverse().find((e) => e.deltas && e.deltas.length >= 0 && (e.kind === "fit" || e.tool === "plumb_verify"));
  const screen =
    [...events].reverse().find((e) => e.screen)?.screen ?? null;
  const score = lastFit?.score;
  const done = lastFit?.done ?? false;
  const designImage = [...events].reverse().find((e) => e.image)?.image ?? null;
  const build = [...events].reverse().find((e) => e.buildHtml || e.buildUrl) ?? null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">◆</span> Plumb <span className="dim">Studio</span>
        </div>
        <div className="conn">
          <span className={`dot ${status}`} />
          {status === "open" ? "connected" : status === "connecting" ? "connecting…" : "reconnecting…"}
          {screen && <span className="screen">· {screen}</span>}
        </div>
        <div className="modes">
          <button className={mode === "mirror" ? "on" : ""} onClick={() => setMode("mirror")}>Mirror</button>
          <button className={mode === "drive" ? "on" : ""} onClick={() => setMode("drive")}>Drive</button>
        </div>
      </header>

      <section className="score">
        <div className="big">
          <span className={done ? "n done" : "n"}>{pct(score)}<small>%</small></span>
          <span className="lbl">{done ? "matches the design" : "live match"}</span>
        </div>
        <div className="bar">
          <div className={done ? "fill done" : "fill"} style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }} />
        </div>
        {lastFit && (
          <div className="meta">
            {lastFit.importantMatched}/{lastFit.importantTotal} key nodes built
          </div>
        )}
      </section>

      <section className="stage">
        <figure>
          <figcaption>Design</figcaption>
          {designImage ? (
            <img src={designImage} alt="Figma design" />
          ) : (
            <div className="ph">waiting for the design…</div>
          )}
        </figure>
        <figure>
          <figcaption>
            Built
            {build && !done && <span className="spin" />}
            {build && (done ? <span className="ok"> matched ✓</span> : <span className="dim"> converging…</span>)}
          </figcaption>
          {build?.buildHtml ? (
            <iframe title="built" srcDoc={build.buildHtml} />
          ) : build?.buildUrl ? (
            <iframe title="built" src={build.buildUrl} />
          ) : (
            <div className="ph">what Plumb builds will render here</div>
          )}
        </figure>
      </section>

      {mode === "mirror" ? (
        <div className="grid">
          <section className="panel deltas">
            <h2>Outstanding deltas</h2>
            {lastConverged?.deltas && lastConverged.deltas.length > 0 ? (
              <ul>
                {lastConverged.deltas.map((d, i) => (
                  <li key={i}>
                    <span className={`sev ${d.severity}`}>{d.severity[0].toUpperCase()}</span>
                    <code>{d.el}</code> · {d.kind}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">{lastConverged ? "Clean — no deltas." : "No fit/verify yet. They'll appear as your agent checks its work."}</p>
            )}
          </section>

          <section className="panel timeline">
            <h2>Activity</h2>
            {events.length === 0 ? (
              <p className="empty">Waiting for your agent… run a tool like <code>plumb_node</code> or <code>plumb_fit</code>.</p>
            ) : (
              <ol>
                {[...events].reverse().map((e, i) => (
                  <li key={events.length - i}>
                    <span className={`tag ${e.kind}`}>{e.tool ?? e.kind}</span>
                    <span className="sum">{e.summary ?? e.kind}</span>
                    <span className="ago">{timeAgo(e.t, now)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : (
        <section className="panel drive">
          <h2>Drive mode</h2>
          <p className="empty">
            Drive mode runs <b>Plumb's own self-healing loop</b> right here — type a change, watch it
            regenerate and re-fit, and approve file writes in-UI. It's the next slice; for now,
            <b> Mirror</b> shows your editor agent live.
          </p>
          <div className="cmdrow">
            <input disabled placeholder="e.g. make the CTA bigger, fix the contrast…" />
            <button disabled>Run loop</button>
          </div>
        </section>
      )}

      <footer className="foot">
        Live cockpit · served locally by the Plumb bridge · keys & designs never leave your machine
      </footer>
    </div>
  );
}
