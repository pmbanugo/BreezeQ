import uWS from "uWebSockets.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtendedBroker, BrokerStats } from "./extended_broker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WebServerConfig {
  port: number;
  host?: string;
}

/**
 * Web server that provides real-time dashboard for the broker
 */
export class DashboardWebServer {
  private app: uWS.TemplatedApp;
  private broker: ExtendedBroker;
  private config: WebServerConfig;
  private websockets = new Set<uWS.WebSocket<unknown>>();

  constructor(broker: ExtendedBroker, config: WebServerConfig) {
    this.broker = broker;
    this.config = config;
    this.app = uWS.App();
    this.setupRoutes();
    this.setupBrokerEventListeners();
  }

  private setupRoutes(): void {
    // Serve the dashboard HTML
    this.app.get("/", (res, req) => {
      try {
        const html = readFileSync(join(__dirname, "dashboard.html"), "utf8");
        res.writeHeader("Content-Type", "text/html").end(html);
      } catch (error) {
        console.error("Error serving dashboard:", error);
        res.writeStatus("500").end("Internal Server Error");
      }
    });

    // API endpoint for current stats
    this.app.get("/api/stats", async (res, req) => {
      try {
        const stats = await this.broker.getStats();
        res
          .writeHeader("Content-Type", "application/json")
          .end(JSON.stringify(stats));
      } catch (error) {
        console.error("Error getting stats:", error);
        res.writeStatus("500").end(JSON.stringify({ error: "Internal Server Error" }));
      }
    });

    // WebSocket endpoint for real-time updates
    this.app.ws("/ws", {
      compression: uWS.SHARED_COMPRESSOR,
      maxCompressedSize: 64 * 1024,
      maxBackpressure: 64 * 1024,
      idleTimeout: 16,
      maxPayloadLength: 16 * 1024,

      open: (ws) => {
        console.log("WebSocket client connected");
        this.websockets.add(ws);
        
        // Send initial stats to the new client
        this.broker.getStats().then(stats => {
          this.sendToWebSocket(ws, {
            type: "stats_update",
            data: stats
          });
        }).catch(error => {
          console.error("Error sending initial stats:", error);
        });
      },

      message: (ws, message, opCode) => {
        // Handle incoming WebSocket messages if needed
        try {
          const data = JSON.parse(Buffer.from(message).toString());
          console.log("Received WebSocket message:", data);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      },

      close: (ws, code, message) => {
        console.log("WebSocket client disconnected");
        this.websockets.delete(ws);
      }
    });
  }

  private setupBrokerEventListeners(): void {
    // Listen to broker events and broadcast to WebSocket clients
    this.broker.on("stats_updated", (stats) => {
      this.broadcastToWebSockets({
        type: "stats_update",
        data: stats
      });
    });

    this.broker.on("worker_connected", (worker) => {
      this.broadcastToWebSockets({
        type: "worker_connected",
        data: worker
      });
    });

    this.broker.on("worker_disconnected", (workerId) => {
      this.broadcastToWebSockets({
        type: "worker_disconnected",
        data: { workerId }
      });
    });

    this.broker.on("job_enqueued", (job) => {
      this.broadcastToWebSockets({
        type: "job_enqueued",
        data: job
      });
    });

    this.broker.on("job_dispatched", (jobUuid, workerId) => {
      this.broadcastToWebSockets({
        type: "job_dispatched",
        data: { jobUuid, workerId }
      });
    });

    this.broker.on("job_completed", (jobUuid, workerId, status) => {
      this.broadcastToWebSockets({
        type: "job_completed",
        data: { jobUuid, workerId, status }
      });
    });
  }

  private sendToWebSocket(ws: uWS.WebSocket<unknown>, message: any): void {
    try {
      const json = JSON.stringify(message);
      ws.send(json);
    } catch (error) {
      console.error("Error sending WebSocket message:", error);
    }
  }

  private broadcastToWebSockets(message: any): void {
    const json = JSON.stringify(message);
    this.websockets.forEach(ws => {
      try {
        ws.send(json);
      } catch (error) {
        console.error("Error broadcasting to WebSocket:", error);
        // Remove invalid websocket
        this.websockets.delete(ws);
      }
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.app.listen(this.config.port, (token) => {
        if (token) {
          console.log(`Dashboard server listening on http://localhost:${this.config.port}`);
          resolve();
        } else {
          reject(new Error(`Failed to listen on port ${this.config.port}`));
        }
      });
    });
  }

  getConnectedClientsCount(): number {
    return this.websockets.size;
  }
}
