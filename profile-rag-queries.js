#!/usr/bin/env node

/**
 * Profile RAG retrieval: run several queries against /api/retrieve and report
 * top results, timings, and basic quality signals.
 * Requires rag-server running on RAG_SERVER_PORT or 3002.
 */

const http = require("http");

const PORT = Number(process.env.RAG_SERVER_PORT || 3002);
const BASE = `http://127.0.0.1:${PORT}`;

const QUERIES = [
  "wheel alignment",
  "paint colour color code",
  "replace brake pads",
  "coolant antifreeze radiator",
  "torque hub nut",
  "clutch replacement",
  "front suspension camber",
  "electrical fuse box",
];

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const start = Date.now();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const elapsed = Date.now() - start;
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), elapsed });
          } catch (_) {
            resolve({ status: res.statusCode, body: data, elapsed });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log(`Profiling RAG at ${BASE} (port ${PORT})\n`);

  for (const query of QUERIES) {
    const { status, body, elapsed } = await post("/api/retrieve", {
      query,
      limit: 5,
    });
    const ok = status === 200 && body && body.ok;
    const retrieval = body && body.retrieval;
    const topChunks = retrieval && retrieval.topChunks ? retrieval.topChunks : [];
    const citations = retrieval && retrieval.citations ? retrieval.citations : [];
    const partsCount = retrieval && retrieval.matchedParts ? retrieval.matchedParts.length : 0;

    console.log(`--- "${query}" (${elapsed} ms) ${ok ? "OK" : "FAIL"}`);
    if (!ok) {
      console.log("  Error:", body && body.error ? body.error : status);
      continue;
    }
    console.log(`  Top chunks: ${topChunks.length}, Citations: ${citations.length}, Parts: ${partsCount}`);
    topChunks.slice(0, 3).forEach((c, i) => {
      const title = (c.title || c.docId || "").slice(0, 55);
      console.log(`    ${i + 1}. [${c.score}] ${title}`);
    });
    if (retrieval.warnings && retrieval.warnings.length) {
      console.log("  Warnings:", retrieval.warnings.join("; "));
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
