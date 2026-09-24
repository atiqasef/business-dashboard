"use client";

import { useEffect, useState } from "react";

export default function IsolatedSelectorTestPage() {
  const [value, setValue] = useState("");
  const [effectRan, setEffectRan] = useState(false);
  const [timerFired, setTimerFired] = useState(false);
  const [fetchStarted, setFetchStarted] = useState(false);
  const [fetchStatus, setFetchStatus] = useState("not started");
  const [fetchBody, setFetchBody] = useState<string>("none");

  const [directValue, setDirectValue] = useState("");
  const [directFetchStarted, setDirectFetchStarted] = useState(false);
  const [directFetchStatus, setDirectFetchStatus] = useState("not started");
  const [directFetchBody, setDirectFetchBody] = useState<string>("none");

  useEffect(() => {
    setEffectRan(true);

    if (!value.trim()) {
      setTimerFired(false);
      setFetchStarted(false);
      setFetchStatus("not started");
      setFetchBody("none");
      return;
    }

    const timeout = window.setTimeout(() => {
      setTimerFired(true);
      setFetchStarted(true);
      const url = `/api/customers?search=${encodeURIComponent(value.trim())}&page=1&pageSize=1`;
      fetch(url, { credentials: "include" })
        .then(async (response) => {
          setFetchStatus(`${response.status} ${response.ok ? "OK" : "ERROR"}`);
          const payload = await response.json().catch(() => ({}));
          setFetchBody(JSON.stringify(payload?.data?.slice?.(0, 1) ?? payload ?? null));
        })
        .catch((error) => {
          setFetchStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
          setFetchBody("fetch threw");
        });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [value]);

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Isolated selector test</h1>

      <section style={{ marginTop: 24, border: "1px solid #ccc", padding: 12 }}>
        <h2>State → effect → timer → fetch</h2>
        <input
          aria-label="isolated-input"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
          }}
          placeholder="Type Alpha"
          style={{ width: 260, padding: 8 }}
        />
        <div style={{ marginTop: 12 }}>
          <div>Input state: {value}</div>
          <div>Effect ran: {String(effectRan)}</div>
          <div>Timer fired: {String(timerFired)}</div>
          <div>Fetch started: {String(fetchStarted)}</div>
          <div>Fetch status: {fetchStatus}</div>
          <div>Fetch body: {fetchBody}</div>
        </div>
      </section>

      <section style={{ marginTop: 24, border: "1px solid #ccc", padding: 12 }}>
        <h2>Handler → direct fetch</h2>
        <input
          aria-label="direct-fetch-input"
          value={directValue}
          onChange={(event) => {
            const next = event.target.value;
            setDirectValue(next);
            const url = `/api/products?search=${encodeURIComponent(next.trim() || "x")}&page=1&pageSize=1`;
            setDirectFetchStarted(true);
            fetch(url, { credentials: "include" })
              .then(async (response) => {
                setDirectFetchStatus(`${response.status} ${response.ok ? "OK" : "ERROR"}`);
                const payload = await response.json().catch(() => ({}));
                setDirectFetchBody(JSON.stringify(payload?.data?.slice?.(0, 1) ?? payload ?? null));
              })
              .catch((error) => {
                setDirectFetchStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
                setDirectFetchBody("fetch threw");
              });
          }}
          placeholder="Type Widget A"
          style={{ width: 260, padding: 8 }}
        />
        <div style={{ marginTop: 12 }}>
          <div>Input state: {directValue}</div>
          <div>Direct fetch started: {String(directFetchStarted)}</div>
          <div>Direct fetch status: {directFetchStatus}</div>
          <div>Direct fetch body: {directFetchBody}</div>
        </div>
      </section>
    </main>
  );
}
