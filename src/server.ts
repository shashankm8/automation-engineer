// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import playwright, { Browser, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url'; // Import this helper

// Import tool registration functions from separate files
import { registerBrowserLifecycleTools } from './tools/browserLifecycle.js';
import { registerInteractionTools } from './tools/interactions.js';
import { registerAssertionTool } from './tools/assertions.js';
import { registerWaitsAndInfoTools } from './tools/waitsAndInfo.js'; // Added for Phase 5

console.error("Initializing MCP Playwright Server...");

// --- Shared State ---
// Encapsulate state in an object
interface PlaywrightState {
    browser: Browser | null;
    context: BrowserContext | null; // Use context for tracing/video
    page: Page | null;
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

// --- Directories (Calculate Absolute Paths) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..'); // Assumes server.js is in 'dist', so go up one level

export const SCREENSHOT_DIR = path.join(projectRootDir, 'screenshots');
export const TRACE_DIR = path.join(projectRootDir, 'traces');
export const VIDEO_DIR = path.join(projectRootDir, 'videos');

// Ensure directories exist on startup
async function ensureDirs() {
    try {
        await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
        await fs.mkdir(TRACE_DIR, { recursive: true });
        await fs.mkdir(VIDEO_DIR, { recursive: true });
        console.error(`Using absolute directories:`);
        console.error(`  Screenshots: ${SCREENSHOT_DIR}`);
        console.error(`  Traces:      ${TRACE_DIR}`);
        console.error(`  Videos:      ${VIDEO_DIR}`);
    } catch (error) {
        console.error("FATAL: Could not create necessary directories.", error);
        process.exit(1);
    }
}

// --- MCP Server Setup ---
const server = new McpServer({
    name: "Playwright Automation Server",
    version: "0.5.1", // Reflects Phase 5 features
    description: "An MCP server that controls Playwright with enhanced interactions, waits, info gathering, and automatic evidence capture."
});

console.error("MCP Server instance created.");

// --- Register Tools ---
// Pass the server instance and the state object to the registration functions
registerBrowserLifecycleTools(server, state);
registerInteractionTools(server, state);
registerAssertionTool(server, state);
registerWaitsAndInfoTools(server, state); // Register Phase 5 tools

console.error("MCP Tools registered: launchBrowser, goto, closeBrowser, click, fill, getElementText, assert, hover, pressKey, selectOption, waitForSelector, waitForNavigation, waitForTimeout, getCurrentURL, getCurrentTitle");


// --- Start the Server ---
async function start() {
    await ensureDirs(); // Make sure directories exist before starting
    try {
        console.error("Connecting to Stdio transport...");
        const transport = new StdioServerTransport();

        // Updated Cleanup function using the state object
        const cleanup = async (reason: string) => {
            console.error(`Cleanup triggered due to: ${reason}`);
            let traceSavedPath: string | null = null;

            // 1. Stop Tracing (if context exists and trace path known)
            if (state.context && state.tracePath) {
                console.error(`Attempting to stop trace and save to: ${state.tracePath}`);
                try {
                    if (state.browser?.isConnected()) {
                         await state.context.tracing.stop({ path: state.tracePath });
                         console.error(`Trace saved to: ${state.tracePath}`);
                         traceSavedPath = state.tracePath;
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
             try {
                 if (typeof transport.close === 'function') await transport.close();
                 else { console.warn("transport.close() not found. Triggering manual cleanup."); await cleanup("Process Signal (no transport.close)");}
             } catch (transportCloseError: any) {
                 console.error("Error during transport.close():", transportCloseError);
                 await cleanup("Process Signal (transport close error)");
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

// --- Helper: Generate File Path ---
// (Moved from evidence.ts as it's generally useful)
export function generateFilePath(dir: string, baseName: string | undefined | null, extension: string, prefix: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const actualBaseName = baseName || `${prefix}-${timestamp}`;
    // Basic sanitization
    const sanitizedBaseName = actualBaseName.replace(/[^a-z0-9_.\-]/gi, '_');
    return path.join(dir, `${sanitizedBaseName}.${extension}`);
}

// --- Helper: Take Screenshot on Error ---
// (Moved from evidence.ts)
export async function takeScreenshotOnError(
    state: PlaywrightState,
    errorType: string,
    details?: string | null
): Promise<string | null> {
    if (!state.page || !state.browser?.isConnected()) {
        console.warn(`[ScreenshotOnError] Cannot take screenshot, page/browser not available.`);
        return null;
    }
    try {
        const detailPart = details ? details.replace(/[^a-z0-9_\-]/gi, '_').substring(0, 50) : 'details';
        const fileNameBase = `error-${errorType}-${detailPart}`;
        const filePath = generateFilePath(SCREENSHOT_DIR, fileNameBase, 'png', 'error-screenshot');
        console.error(`[ScreenshotOnError] Attempting to save error screenshot to: ${filePath}`);
        await state.page.screenshot({ path: filePath, timeout: 5000 });
        console.error(`[ScreenshotOnError] Error screenshot saved successfully.`);
        return filePath;
    } catch (screenshotError: any) {
        console.error(`[ScreenshotOnError] Failed to take error screenshot: ${screenshotError.message}`);
        return null;
    }
}

// Export state type for use in tool files
export type { PlaywrightState };

// Start the server
start();