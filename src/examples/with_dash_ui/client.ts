#!/usr/bin/env node

import { DemoClient } from "./demo_client.js";

// Configuration from environment variables
const BROKER_HOST = process.env.BROKER_HOST || "localhost";
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || "5555");
const SUBMISSION_INTERVAL = parseInt(process.env.SUBMISSION_INTERVAL_MS || "2000");
const MAX_JOBS = parseInt(process.env.MAX_JOBS || "1000");
const JOB_TYPES = (process.env.JOB_TYPES || "math,data-processing,image-resize").split(",");

/**
 * Demo client application
 */
class ClientApp {
  private demoClient: DemoClient;

  constructor() {
    const config = {
      brokerHost: BROKER_HOST,
      brokerPort: FRONTEND_PORT,
      jobSubmissionInterval: SUBMISSION_INTERVAL,
      jobTypes: JOB_TYPES,
      maxJobs: MAX_JOBS,
    };

    this.demoClient = new DemoClient(config);
  }

  async start(): Promise<void> {
    console.log("🚀 Starting demo client");
    console.log("=======================");
    console.log(`🔗 Broker: ${BROKER_HOST}:${FRONTEND_PORT}`);
    console.log(`⏱️  Job interval: ${SUBMISSION_INTERVAL}ms`);
    console.log(`📊 Job types: ${JOB_TYPES.join(", ")}`);
    console.log(`🎯 Max jobs: ${MAX_JOBS}`);
    console.log("=======================");

    try {
      await this.demoClient.start();
      console.log("✅ Demo client started successfully");
      
      // Log progress periodically
      const progressTimer = setInterval(() => {
        if (!this.demoClient.isActive()) {
          clearInterval(progressTimer);
          console.log("📊 Demo client completed all jobs");
          return;
        }
        
        const submitted = this.demoClient.getJobsSubmitted();
        console.log(`📈 Progress: ${submitted}/${MAX_JOBS} jobs submitted`);
      }, 10000); // Log every 10 seconds

    } catch (error) {
      console.error("❌ Failed to start demo client:", error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    console.log("🛑 Stopping demo client...");
    await this.demoClient.stop();
    console.log("✅ Demo client stopped");
  }

  getStats() {
    return {
      isActive: this.demoClient.isActive(),
      jobsSubmitted: this.demoClient.getJobsSubmitted(),
    };
  }
}

// Handle graceful shutdown
let isShuttingDown = false;
const app = new ClientApp();

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log("Force shutting down...");
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down client...`);
  
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

// Start the client
if (import.meta.url === `file://${process.argv[1]}`) {
  app.start().catch((error) => {
    console.error("Failed to start client:", error);
    process.exit(1);
  });
}

export { ClientApp };
