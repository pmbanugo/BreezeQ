#!/usr/bin/env node

import { spawn, ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ProcessConfig {
  name: string;
  script: string;
  env?: Record<string, string>;
  color: string;
  delay?: number;
}

/**
 * Process manager to run all components together
 */
class ProcessManager {
  private processes = new Map<string, ChildProcess>();
  private isShuttingDown = false;

  private configs: ProcessConfig[] = [
    {
      name: "broker",
      script: "broker_with_dashboard.ts",
      color: "\x1b[36m", // Cyan
      delay: 0,
    },
    {
      name: "math-workers",
      script: "workers.ts",
      env: {
        JOB_TYPE: "math",
        WORKER_COUNT: "2",
      },
      color: "\x1b[32m", // Green
      delay: 2000,
    },
    {
      name: "data-workers",
      script: "workers.ts",
      env: {
        JOB_TYPE: "data-processing",
        WORKER_COUNT: "2",
      },
      color: "\x1b[33m", // Yellow
      delay: 3000,
    },
    {
      name: "image-workers",
      script: "workers.ts",
      env: {
        JOB_TYPE: "image-resize",
        WORKER_COUNT: "1",
      },
      color: "\x1b[35m", // Magenta
      delay: 4000,
    },
    {
      name: "client",
      script: "client.ts",
      env: {
        SUBMISSION_INTERVAL_MS: "3000",
        MAX_JOBS: "100",
      },
      color: "\x1b[34m", // Blue
      delay: 6000,
    },
  ];

  async start(): Promise<void> {
    console.log("🚀 Starting BreezeQ Dashboard Demo");
    console.log("=====================================");
    console.log("This will start:");
    console.log("  • Broker with dashboard (port 3000)");
    console.log("  • Math workers (2 workers per process)");
    console.log("  • Data processing workers (2 workers per process)");
    console.log("  • Image resize workers (1 worker per process)");
    console.log("  • Demo client");
    console.log("=====================================");
    console.log("");

    // Start all processes with delays
    for (const config of this.configs) {
      if (config.delay && config.delay > 0) {
        console.log(`⏳ Waiting ${config.delay}ms before starting ${config.name}...`);
        await new Promise(resolve => setTimeout(resolve, config.delay));
      }

      if (this.isShuttingDown) break;

      await this.startProcess(config);
    }

    if (!this.isShuttingDown) {
      console.log("");
      console.log("✅ All processes started!");
      console.log("📊 Dashboard: http://localhost:3000");
      console.log("🔧 Use Ctrl+C to stop all processes");
    }
  }

  private async startProcess(config: ProcessConfig): Promise<void> {
    const scriptPath = join(__dirname, config.script);
    
    const env = {
      ...process.env,
      ...config.env,
    };

    const child = spawn("tsx", [scriptPath], {
      env,
      stdio: "pipe",
    });

    this.processes.set(config.name, child);

    // Handle process output
    child.stdout?.on("data", (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`${config.color}[${config.name}]\x1b[0m ${output}`);
      }
    });

    child.stderr?.on("data", (data) => {
      const error = data.toString().trim();
      if (error) {
        console.error(`${config.color}[${config.name}]\x1b[0m \x1b[31m${error}\x1b[0m`);
      }
    });

    child.on("exit", (code, signal) => {
      console.log(`${config.color}[${config.name}]\x1b[0m Process exited with code ${code} and signal ${signal}`);
      this.processes.delete(config.name);
      
      // If not shutting down and process crashed, restart it
      if (!this.isShuttingDown && code !== 0) {
        console.log(`${config.color}[${config.name}]\x1b[0m Restarting in 5 seconds...`);
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.startProcess(config);
          }
        }, 5000);
      }
    });

    // Give the process a moment to start
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log("\n🛑 Shutting down all processes...");

    const shutdownPromises: Promise<void>[] = [];

    for (const [name, child] of this.processes) {
      shutdownPromises.push(
        new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`⚠️  Force killing ${name}...`);
            child.kill("SIGKILL");
            resolve();
          }, 10000); // 10 second timeout

          child.on("exit", () => {
            clearTimeout(timeout);
            console.log(`✅ ${name} stopped`);
            resolve();
          });

          // Send SIGTERM for graceful shutdown
          child.kill("SIGTERM");
        })
      );
    }

    await Promise.all(shutdownPromises);
    console.log("✅ All processes stopped");
  }

  getRunningProcesses(): string[] {
    return Array.from(this.processes.keys());
  }
}

// Main execution
const manager = new ProcessManager();
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log("Force shutting down...");
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down all processes...`);
  
  try {
    await manager.stop();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

// Listen for shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});

// Start all processes
if (import.meta.url === `file://${process.argv[1]}`) {
  manager.start().catch((error) => {
    console.error("Failed to start processes:", error);
    process.exit(1);
  });
}

export { ProcessManager };
