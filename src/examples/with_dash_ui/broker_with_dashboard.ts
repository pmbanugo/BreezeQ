#!/usr/bin/env node

import { ExtendedBroker } from "./extended_broker.js";
import { DashboardWebServer } from "./web_server.js";
import { MemoryPersistence } from "../../memory_persistence.js";
import { BrokerConfig } from "../../types.js";

// Configuration
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || "5555");
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || "5556");
const WEB_PORT = parseInt(process.env.WEB_PORT || "3000");
const WEB_HOST = process.env.WEB_HOST || "localhost";

const brokerConfig: BrokerConfig = {
  frontend_port: FRONTEND_PORT,
  backend_port: BACKEND_PORT,
  database_path: ":memory:",
  heartbeat_interval: 5000,
  liveness_factor: 3,
  default_job_timeout: 30000,
  default_retry_count: 2,
};

const webServerConfig = {
  port: WEB_PORT,
  host: WEB_HOST,
};

/**
 * Main application that runs the extended broker with dashboard
 */
class BrokerWithDashboard {
  private broker: ExtendedBroker;
  private webServer: DashboardWebServer;
  private persistence: MemoryPersistence;

  constructor() {
    this.persistence = new MemoryPersistence();
    this.broker = new ExtendedBroker(brokerConfig, this.persistence);
    this.webServer = new DashboardWebServer(this.broker, webServerConfig);
  }

  async start(): Promise<void> {
    console.log("🚀 Starting BreezeQ Broker with Dashboard");
    console.log("=========================================");
    console.log(`Frontend (clients): tcp://*:${FRONTEND_PORT}`);
    console.log(`Backend (workers): tcp://*:${BACKEND_PORT}`);
    console.log(`Dashboard: http://${WEB_HOST}:${WEB_PORT}`);
    console.log("=========================================");

    try {
      // Start the broker first
      await this.broker.start();
      console.log("✅ Broker started successfully");

      // Start the web server
      await this.webServer.start();
      console.log("✅ Dashboard web server started successfully");

      console.log("\n📊 Dashboard is available at:", `http://${WEB_HOST}:${WEB_PORT}`);
      console.log("\n🔄 Broker is ready to accept jobs and workers");

    } catch (error) {
      console.error("❌ Failed to start application:", error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    console.log("\n🛑 Shutting down BreezeQ Broker with Dashboard...");
    
    try {
      await this.broker.stop();
      console.log("✅ Broker stopped");
    } catch (error) {
      console.error("❌ Error stopping broker:", error);
    }

    console.log("✅ Application stopped");
  }

  getStats() {
    return {
      broker: this.broker.getStats(),
      webConnections: this.webServer.getConnectedClientsCount(),
    };
  }
}

// Handle graceful shutdown
const app = new BrokerWithDashboard();
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log("Force shutting down...");
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  
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

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  app.start().catch((error) => {
    console.error("Failed to start application:", error);
    process.exit(1);
  });
}

export { BrokerWithDashboard };
