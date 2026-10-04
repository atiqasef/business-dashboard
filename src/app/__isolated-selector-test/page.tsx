"use client";

import { useEffect, useState } from "react";

type AsyncFetchState = {
  timerFired: boolean;
  fetchStarted: boolean;
  fetchStatus: string;
  fetchBody: string;
};

const idleFetchState: AsyncFetchState = {
  timerFired: false,
  fetchStarted: false,
  fetchStatus: "not started",
  fetchBody: "none",
};

export default function IsolatedSelectorTestPage() {
  const [value, setValue] = useState("");
  const [asyncFetch, setAsyncFetch] = useState<AsyncFetchState>(idleFetchState);

  const [directValue, setDirectValue] = useState("");
  const [directFetchStarted, setDirectFetchStarted] = useState(false);
  const [directFetchStatus, setDirectFetchStatus] = useState("not started");
  const [directFetchBody, setDirectFetchBody] = useState<string>("none");

  const trimmedValue = value.trim();
  const displayedFetch = trimmedValue ? asyncFetch : idleFetchState;

  useEffect(() => {
    if (!trimmedValue) return;

    const timeout = window.setTimeout(() => {
      setAsyncFetch({
        timerFired: true,
        fetchStarted: true,
        fetchStatus: "loading",
        fetchBody: "pending",
      });

      const url = `/api/customers?search=${encodeURIComponent(trimmedValue)}&page=1&pageSize=1`;
      fetch(url, { credentials: "include" })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          setAsyncFetch({
            timerFired: true,
            fetchStarted: true,
            fetchStatus: `${response.status} ${response.ok ? "OK" : "ERROR"}`,
            fetchBody: JSON.stringify(payload?.data?.slice?.(0, 1) ?? payload ?? null),
          });
        })
        .catch((error) => {
          setAsyncFetch({
            timerFired: true,
            fetchStarted: true,
            fetchStatus: `error: ${error instanceof Error ? error.message : String(error)}`,
            fetchBody: "fetch threw",
          });
        });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [trimmedValue]);

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
            setAsyncFetch(idleFetchState);
          }}
          placeholder="Type Alpha"
          style={{ width: 260, padding: 8 }}
        />
        <div style={{ marginTop: 12 }}>
          <div>Input state: {value}</div>
          <div>Timer fired: {String(displayedFetch.timerFired)}</div>
          <div>Fetch started: {String(displayedFetch.fetchStarted)}</div>
          <div>Fetch status: {displayedFetch.fetchStatus}</div>
          <div>Fetch body: {displayedFetch.fetchBody}</div>
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
