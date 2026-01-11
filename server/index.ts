import { spawn } from "child_process";

const port = process.env.PORT || "5000";
const isDev = process.env.NODE_ENV !== "production";

console.log(`[launcher] Starting Python FastAPI backend on port ${port}...`);

const args = [
  "-m", "uvicorn", 
  "backend.main:app", 
  "--host", "0.0.0.0", 
  "--port", port
];

if (isDev) {
  args.push("--reload");
}

const pythonProcess = spawn("python", args, {
  stdio: "inherit",
  env: { ...process.env }
});

pythonProcess.on("error", (err) => {
  console.error("[launcher] Failed to start Python backend:", err);
  process.exit(1);
});

pythonProcess.on("close", (code) => {
  process.exit(code || 0);
});

process.on("SIGINT", () => {
  pythonProcess.kill("SIGINT");
});

process.on("SIGTERM", () => {
  pythonProcess.kill("SIGTERM");
});
