import { useEffect, useState } from "react";

interface Greeting {
  message: string;
  service: string;
  environment: string;
  version: string;
  commit: string;
}

type State =
  | { status: "loading" }
  | { status: "ok"; greeting: Greeting }
  | { status: "error"; error: string };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/greeting", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return (await response.json()) as Greeting;
      })
      .then((greeting) => setState({ status: "ok", greeting }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="card">
      <p className="eyebrow">tarmac · paved road</p>
      {state.status === "loading" && <h1 className="muted">…</h1>}
      {state.status === "error" && (
        <>
          <h1 className="error">unavailable</h1>
          <p className="detail">{state.error}</p>
        </>
      )}
      {state.status === "ok" && (
        <>
          <h1>{state.greeting.message}</h1>
          <dl className="meta">
            <div>
              <dt>service</dt>
              <dd>{state.greeting.service}</dd>
            </div>
            <div>
              <dt>environment</dt>
              <dd>{state.greeting.environment}</dd>
            </div>
            <div>
              <dt>version</dt>
              <dd>{state.greeting.version}</dd>
            </div>
            <div>
              <dt>commit</dt>
              <dd className="mono">{state.greeting.commit}</dd>
            </div>
          </dl>
        </>
      )}
    </main>
  );
}
