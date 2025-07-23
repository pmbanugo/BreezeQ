#!/usr/bin/env node

import { JQPWorker } from "../../worker.js";

// Configuration from environment variables
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || "3");
const BROKER_HOST = process.env.BROKER_HOST || "localhost";
const BROKER_BACKEND_PORT = parseInt(process.env.BACKEND_PORT || "5556");
const JOB_TYPE = process.env.JOB_TYPE || "math";

/**
 * Job processors for different job types
 */
const jobProcessors = {
  /**
   * Math operations processor
   */
  async math(payload: string): Promise<string> {
    const data = JSON.parse(payload);
    const { operation, values } = data;

    // Simulate some processing time
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 1000 + 500)
    );

    let result: number;

    switch (operation) {
      case "add":
        result = values.reduce((a: number, b: number) => a + b, 0);
        break;

      case "multiply":
        result = values.reduce((a: number, b: number) => a * b, 1);
        break;

      case "fibonacci":
        const n = Math.min(values[0] || 10, 40); // Limit to prevent long calculations
        result = fibonacci(n);
        break;

      case "factorial":
        const num = Math.min(values[0] || 5, 20); // Limit to prevent long calculations
        result = factorial(num);
        break;

      default:
        throw new Error(`Unknown math operation: ${operation}`);
    }

    return JSON.stringify({
      operation,
      values,
      result,
      processedAt: new Date().toISOString(),
    });
  },

  /**
   * Data processing operations
   */
  async "data-processing"(payload: string): Promise<string> {
    const data = JSON.parse(payload);
    const { action, data: inputData } = data;

    // Simulate processing time
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 800 + 300)
    );

    let result: any;

    switch (action) {
      case "sort":
        result = [...inputData].sort((a, b) => a - b);
        break;

      case "filter":
        const threshold = Math.floor(Math.random() * 500);
        result = inputData.filter((num: number) => num > threshold);
        break;

      case "transform":
        result = inputData.map((num: number) => num * 2 + 1);
        break;

      case "aggregate":
        result = {
          sum: inputData.reduce((a: number, b: number) => a + b, 0),
          avg:
            inputData.reduce((a: number, b: number) => a + b, 0) /
            inputData.length,
          min: Math.min(...inputData),
          max: Math.max(...inputData),
          count: inputData.length,
        };
        break;

      default:
        throw new Error(`Unknown data processing action: ${action}`);
    }

    return JSON.stringify({
      action,
      inputSize: inputData.length,
      result,
      processedAt: new Date().toISOString(),
    });
  },

  /**
   * Image processing simulator (doesn't actually process images)
   */
  async "image-resize"(payload: string): Promise<string> {
    const data = JSON.parse(payload);
    const { imageUrl, targetWidth, targetHeight, format } = data;

    // Simulate image processing time (proportional to target size)
    const processingTime = Math.max((targetWidth * targetHeight) / 10000, 500);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * processingTime + 200)
    );

    // Simulate occasional failures (5% chance)
    if (Math.random() < 0.05) {
      throw new Error("Image processing failed: Corrupted image data");
    }

    return JSON.stringify({
      originalUrl: imageUrl,
      targetDimensions: `${targetWidth}x${targetHeight}`,
      format: format || "jpg",
      processedSize: `${targetWidth}x${targetHeight}`,
      processedAt: new Date().toISOString(),
      processedBy: `worker-${process.pid}`,
    });
  },
};

// Helper functions
function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0,
    b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

/**
 * Individual worker class that extends JQPWorker
 */
class ProcessWorker extends JQPWorker {
  private jobProcessor: (payload: string) => Promise<string>;
  private workerId: number;

  constructor(
    workerId: number,
    jobType: string,
    brokerAddress: string,
    processor: (payload: string) => Promise<string>
  ) {
    super(brokerAddress, jobType, {
      heartbeatInterval: 5000,
      livenessFactor: 3,
    });

    this.workerId = workerId;
    this.jobProcessor = processor;
  }

  protected override async processJob(
    payload: string,
    options: any
  ): Promise<string> {
    console.log(
      `[Worker ${this.workerId}] Processing job with payload length: ${payload.length}`
    );

    try {
      const result = await this.jobProcessor(payload);
      console.log(`[Worker ${this.workerId}] Job completed successfully`);
      return result;
    } catch (error) {
      console.error(`[Worker ${this.workerId}] Job failed:`, error);
      throw error;
    }
  }
}

/**
 * Worker manager application that runs multiple workers in the same process
 */
class WorkerApp {
  private workers: ProcessWorker[] = [];
  private jobType: string;
  private isRunning = false;

  constructor(jobType: string) {
    this.jobType = jobType;

    const processor = jobProcessors[jobType as keyof typeof jobProcessors];
    if (!processor) {
      throw new Error(
        `Unknown job type: ${jobType}. Available types: ${Object.keys(
          jobProcessors
        ).join(", ")}`
      );
    }

    const brokerAddress = `tcp://${BROKER_HOST}:${BROKER_BACKEND_PORT}`;

    // Create multiple workers in the same process
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new ProcessWorker(
        i + 1,
        jobType,
        brokerAddress,
        processor
      );
      this.workers.push(worker);
    }
  }

  async start(): Promise<void> {
    console.log(
      `🔧 Starting ${WORKER_COUNT} workers for job type: ${this.jobType}`
    );
    console.log(
      `🔗 Connecting to broker at ${BROKER_HOST}:${BROKER_BACKEND_PORT}`
    );

    try {
      this.isRunning = true;

      // Start all workers
      const startPromises = this.workers.map(async (worker, index) => {
        try {
          await worker.start();
          console.log(`✅ Worker ${index + 1} started successfully`);
        } catch (error) {
          console.error(`❌ Worker ${index + 1} failed to start:`, error);
          throw error;
        }
      });

      await Promise.all(startPromises);
      console.log(
        `✅ All ${WORKER_COUNT} workers started successfully and ready to process "${this.jobType}" jobs`
      );
    } catch (error) {
      console.error("❌ Failed to start workers:", error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("🛑 Stopping workers...");
    this.isRunning = false;

    const stopPromises = this.workers.map(async (worker, index) => {
      try {
        await worker.stop();
        console.log(`✅ Worker ${index + 1} stopped`);
      } catch (error) {
        console.error(`❌ Error stopping worker ${index + 1}:`, error);
      }
    });

    await Promise.all(stopPromises);
    console.log("✅ All workers stopped");
  }

  getStats() {
    return {
      jobType: this.jobType,
      workerCount: this.workers.length,
      isActive: this.isRunning,
    };
  }
}

// Handle graceful shutdown
let isShuttingDown = false;
const app = new WorkerApp(JOB_TYPE);

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log("Force shutting down...");
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down workers...`);

  try {
    await app.stop();
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

// Start the workers
if (import.meta.url === `file://${process.argv[1]}`) {
  app.start().catch((error) => {
    console.error("Failed to start workers:", error);
    process.exit(1);
  });
}

export { WorkerApp };
