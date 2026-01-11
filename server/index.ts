import { spawn } from "child_process";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const port = process.env.PORT || "5000";

console.log(`[launcher] Starting Python backend on port ${port}...`);

if (isDev) {
  const viteProcess = spawn("npx", ["vite", "--host", "0.0.0.0", "--port", "5173"], {
    cwd: path.join(process.cwd(), "client"),
    stdio: "inherit",
    env: { ...process.env }
  });

  viteProcess.on("error", (err) => {
    console.error("[launcher] Vite error:", err);
  });
}

const pythonProcess = spawn("python", ["-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", port, isDev ? "--reload" : ""], {
  stdio: "inherit",
  env: { ...process.env }
});

pythonProcess.on("error", (err) => {
  console.error("[launcher] Python error:", err);
  process.exit(1);
});

pythonProcess.on("close", (code) => {
  console.log(`[launcher] Python process exited with code ${code}`);
  process.exit(code || 0);
});

process.on("SIGINT", () => {
  pythonProcess.kill("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  pythonProcess.kill("SIGTERM");
  process.exit(0);
});
