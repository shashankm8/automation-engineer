// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import playwright, { Browser, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

// Import updated tool registration functions
import { registerBrowserLifecycleTools } from './tools/browserLifecycle.js';
import { registerInteractionTools } from './tools/interactions.js';
import { registerAssertionTool } from './tools/assertions.js';
// Evidence tools are now integrated, no separate registration

console.error("Initializing MCP Playwright Server...");

// --- Shared State ---
interface PlaywrightState {
    browser: Browser | null;
    context: BrowserContext | null;
    page: Page | null;
    // No longer need isTracing state, it's tied to context lifetime
    tracePath: string | null; // Store expected trace path
    videoPath: string | null; // Store expected video path
}

// Make state exportable for tools
export const state: PlaywrightState = {
    browser: null,
    context: null,
    page: null,
    tracePath: null,
    videoPath: null,
};

// --- Directories ---
export const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots');
export const TRACE_DIR = path.join(process.cwd(), 'traces');
export const VIDEO_DIR = path.join(process.cwd(), 'videos');

// Ensure directories exist on startup (Unchanged)
async function ensureDirs() { /* ... implementation ... */ }

// --- MCP Server Setup ---
const server = new McpServer({
    name: "Playwright Automation Server",
    version: "0.5.0", // Incremented version for automatic evidence
    description: "An MCP server that controls Playwright with automatic video, tracing, and error screenshots."
});

console.error("MCP Server instance created.");

// --- Register Tools ---
// Pass the server instance and the state object
registerBrowserLifecycleTools(server, state);
registerInteractionTools(server, state);
registerAssertionTool(server, state);
// No separate evidence tool registration

console.error("MCP Tools registered.");

// --- Start the Server ---
async function start() {
    await ensureDirs();
    try {
        console.error("Connecting to Stdio transport...");
        const transport = new StdioServerTransport();

        // Updated Cleanup function
        const cleanup = async (reason: string) => {
            console.error(`Cleanup triggered due to: ${reason}`);
            let traceSavedPath: string | null = null;

            // 1. Stop Tracing (if context exists)
            if (state.context && state.tracePath) {
                console.error(`Attempting to stop trace and save to: ${state.tracePath}`);
                try {
                    // Ensure context is still usable before stopping trace
                    // Checking browser connection state might be a proxy for this
                    if (state.browser?.isConnected()) {
                         await state.context.tracing.stop({ path: state.tracePath });
                         console.error(`Trace saved to: ${state.tracePath}`);
                         traceSavedPath = state.tracePath; // Store for logging later
                    } else {
                         console.warn("Browser disconnected before trace could be stopped.");
                    }
                } catch(traceError) {
                     console.error("Error stopping trace during shutdown:", traceError);
                }
            } else if (state.tracePath) {
                 console.warn("Trace path was set, but context is missing. Cannot stop trace.");
            }

            // 2. Close Browser (saves video implicitly)
            if (state.browser?.isConnected()) {
                console.error("Attempting graceful browser shutdown...");
                try {
                    await state.browser.close();
                    console.error("Browser closed during shutdown.");
                    if (state.videoPath) {
                         console.error(`Video (if recording started) should be saved near: ${state.videoPath}`);
                    }
                    if (traceSavedPath) {
                         console.error(`Trace file saved at: ${traceSavedPath}`);
                    }
                } catch (closeError: any) {
                    console.error("Error closing browser during shutdown:", closeError);
                }
            } else {
                 console.error("No connected browser to close during shutdown.");
            }

            // 3. Reset state fully
            state.browser = null;
            state.context = null;
            state.page = null;
            state.tracePath = null;
            state.videoPath = null;
        };

        transport.onclose = () => cleanup("Transport closed");

        const shutdown = async (signal: string) => {
             console.error(`Received ${signal}. Initiating shutdown...`);
             // Transport close should trigger cleanup via onclose handler
             try {
                 if (typeof transport.close === 'function') await transport.close();
                 else { console.warn("transport.close() not found. Cleanup might be incomplete."); await cleanup("Process Signal (no transport.close)");}
             } catch (transportCloseError: any) {
                 console.error("Error during transport.close():", transportCloseError);
                 await cleanup("Process Signal (transport close error)"); // Fallback cleanup
             } finally {
                 console.error("Exiting process.");
                 process.exit(0);
             }
         };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        await server.connect(transport);
        console.error("✅ MCP Playwright Server is running and connected via Stdio.");
        console.error("   Waiting for MCP client commands...");

    } catch (error) {
        console.error("❌ Failed to start MCP server:", error);
        process.exit(1);
    }
}

start();

// Export state type for use in tool files
export type { PlaywrightState };

// --- Helper: Generate File Path (Moved here for potential reuse) ---
export function generateFilePath(dir: string, baseName: string | undefined | null, extension: string, prefix: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const actualBaseName = baseName || `${prefix}-${timestamp}`;
    const sanitizedBaseName = actualBaseName.replace(/[^a-z0-9_.\-]/gi, '_');
    return path.join(dir, `${sanitizedBaseName}.${extension}`);
}

// --- Helper: Take Screenshot on Error ---
export async function takeScreenshotOnError(
    state: PlaywrightState,
    errorType: string, // e.g., 'click-error', 'assertion-failed'
    details?: string | null // e.g., selector or assertion details
): Promise<string | null> {
    if (!state.page || !state.browser?.isConnected()) {
        console.warn(`[ScreenshotOnError] Cannot take screenshot, page/browser not available.`);
        return null;
    }
    try {
        const detailPart = details ? details.replace(/[^a-z0-9_\-]/gi, '_').substring(0, 50) : 'details'; // Sanitize & shorten details
        const fileNameBase = `error-${errorType}-${detailPart}`;
        const filePath = generateFilePath(SCREENSHOT_DIR, fileNameBase, 'png', 'error-screenshot');
        console.error(`[ScreenshotOnError] Attempting to save error screenshot to: ${filePath}`);
        await state.page.screenshot({ path: filePath, timeout: 5000 }); // Short timeout for error screenshot
        console.error(`[ScreenshotOnError] Error screenshot saved successfully.`);
        return filePath;
    } catch (screenshotError: any) {
        console.error(`[ScreenshotOnError] Failed to take error screenshot: ${screenshotError.message}`);
        return null; // Don't let screenshot failure block reporting the original error
    }
}