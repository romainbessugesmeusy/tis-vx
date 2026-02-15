/**
 * Netlify serverless function that exposes the RAG API (rag-server.js).
 * Requires copy-rag-for-netlify to have run so ./rag-server.js and ./rag-data/ exist.
 * Rewrites path from /.netlify/functions/rag-api/* to /api/* so Express routes match.
 */
const path = require("path");
const serverless = require("serverless-http");
const { createServer } = require("./rag-server.js");

const dataDir = path.join(__dirname, "rag-data");
const ragDir = path.join(__dirname, "rag-data", "rag");
const FUNCTION_BASE = "/.netlify/functions/rag-api";

const { app } = createServer({ dataDir, ragDir });
const sls = serverless(app);

module.exports = {
  handler: async (event, context) => {
    if (event.path && event.path.startsWith(FUNCTION_BASE)) {
      event.path = "/api" + (event.path.slice(FUNCTION_BASE.length) || "") || "/api";
    }
    return sls(event, context);
  },
};
