import { JQPWorker } from "../worker.js";
import { JobOptions } from "../types.js";

/**
 * Example worker that performs mathematical operations
 */
export class MathWorker extends JQPWorker {
  constructor(brokerAddress: string) {
    super(brokerAddress, "math.calculate");
  }

  protected async processJob(payload: string, options: JobOptions): Promise<string> {
    try {
      const request = JSON.parse(payload);
      
      // Validate request format
      if (!request.operation || !Array.isArray(request.numbers)) {
        throw new Error("Invalid request format. Expected {operation: string, numbers: number[]}");
      }

      const { operation, numbers } = request;
      let result: number;

      switch (operation) {
        case "add":
          result = numbers.reduce((a: number, b: number) => a + b, 0);
          break;
        case "multiply":
          result = numbers.reduce((a: number, b: number) => a * b, 1);
          break;
        case "subtract":
          if (numbers.length < 2) {
            throw new Error("Subtraction requires at least 2 numbers");
          }
          result = numbers.reduce((a: number, b: number) => a - b);
          break;
        case "divide":
          if (numbers.length < 2) {
            throw new Error("Division requires at least 2 numbers");
          }
          result = numbers.reduce((a: number, b: number) => {
            if (b === 0) {
              throw new Error("Division by zero");
            }
            return a / b;
          });
          break;
        case "slow_add":
          // Simulate slow processing
          await new Promise(resolve => setTimeout(resolve, 2000));
          result = numbers.reduce((a: number, b: number) => a + b, 0);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      return JSON.stringify({ 
        result, 
        operation, 
        input: numbers,
        processed_at: new Date().toISOString()
      });
    } catch (error) {
      throw new Error(`Math calculation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
