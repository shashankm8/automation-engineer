import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import playwright, { BrowserContextOptions } from 'playwright'; // Import BrowserContextOptions
import path from 'path';
import type { PlaywrightState } from '../server.js';
import { VIDEO_DIR, TRACE_DIR, generateFilePath } from '../server.js';

const defaultLaunchArgs: string[] = ['--no-sandbox'];

// Define argument types explicitly for clarity and to help TS
type LaunchBrowserArgs = {
    browserType: "chromium" | "firefox" | "webkit";
    headless: boolean;
    args: string[];
    recordVideo: boolean;
};

type GotoArgs = {
    url: string;
};

export function registerBrowserLifecycleTools(server: McpServer, state: PlaywrightState) {

    // Tool: launchBrowser
    server.tool(
        "launchBrowser",
        {
            browserType: z.enum(['chromium', 'firefox', 'webkit']).describe("Browser type."),
            headless: z.boolean().optional().default(false).describe("Run headless? Defaults false."),
            args: z.array(z.string()).optional().default(defaultLaunchArgs).describe("Optional launch arguments."),
            recordVideo: z.boolean().optional().default(true).describe("Record video? Defaults true.") // Default video to true now
        },
        // Explicitly type args and ensure a valid return object is always returned
        async (args: LaunchBrowserArgs): Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }> => {
            const { browserType, headless, args: launchArgs, recordVideo } = args; // Destructure with rename for clarity
            console.error(`[Tool: launchBrowser] Request: ${browserType}, headless=${headless}, args=${launchArgs.join(' ')}, recordVideo=${recordVideo}`);
            if (state.browser) {
                console.warn("[Tool: launchBrowser] Browser already launched.");
                return { content: [{ type: "text", text: "Error: Browser already launched. Use closeBrowser first." }], isError: true };
            }
            try {
                console.error(`[Tool: launchBrowser] Launching ${browserType}...`);
                state.browser = await playwright[browserType].launch({ headless, args: launchArgs });

                let contextOptions: BrowserContextOptions = {};
                state.videoPath = null; // Reset video path

                // Always record video now
                const videoFileNameBase = `session-${browserType}`;
                state.videoPath = generateFilePath(VIDEO_DIR, videoFileNameBase, 'webm', 'video');
                contextOptions.recordVideo = { dir: VIDEO_DIR, size: { width: 1280, height: 720 } };
                console.error(`[Tool: launchBrowser] Automatic video recording enabled. Expected save path (on close): ${state.videoPath}`);

                state.context = await state.browser.newContext(contextOptions);

                // Always start tracing now
                state.tracePath = generateFilePath(TRACE_DIR, `session-${browserType}`, 'zip', 'trace');
                console.error(`[Tool: launchBrowser] Starting trace. Will save to: ${state.tracePath} on close.`);
                await state.context.tracing.start({
                    name: `trace-${browserType}-${Date.now()}`,
                    screenshots: true, snapshots: true, sources: true
                });

                state.page = await state.context.newPage();

                console.error(`[Tool: launchBrowser] ${browserType} launched successfully. Video+Tracing started.`);
                let message = `${browserType} launched successfully (headless: ${headless}, args: ${launchArgs.join(', ')}). Video/Trace active.`;
                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: message }] };

            } catch (error: any) {
                console.error("[Tool: launchBrowser] Error launching browser:", error);
                state.browser = null; state.context = null; state.page = null; state.videoPath = null; state.tracePath = null; // Reset state
                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: `Error launching browser: ${error.message}` }], isError: true };
            }
        }
    );

    // Tool: goto
    server.tool(
        "goto",
        { url: z.string().url({ message: "Invalid URL." }).describe("The absolute URL.") },
        // Explicitly type args and ensure a valid return object is always returned
        async (args: GotoArgs): Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }> => {
            const { url } = args;
            console.error(`[Tool: goto] Request: ${url}`);
            // Check page existence explicitly
            if (!state.page || !state.browser?.isConnected()) {
                 console.warn("[Tool: goto] No active page/browser.");
                 return { content: [{ type: "text", text: "Error: No active page or browser. Use launchBrowser first." }], isError: true };
            }
            try {
                console.error(`[Tool: goto] Navigating to ${url}...`);
                // Use non-null assertion as we checked above
                const response = await state.page!.goto(url, { waitUntil: 'domcontentloaded' });
                const status = response?.status();
                console.error(`[Tool: goto] Navigation completed with status: ${status ?? 'unknown'}.`);
                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: `Successfully navigated to ${url}. Page status: ${status ?? 'unknown'}.` }] };
            } catch (error: any) {
                console.error(`[Tool: goto] Error navigating:`, error);
                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: `Error navigating to ${url}: ${error.message}` }], isError: true };
            }
        }
    );

    // Tool: closeBrowser
    server.tool(
        "closeBrowser",
        {},
        // Ensure a valid return object is always returned
        async (): Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }> => {
            console.error("[Tool: closeBrowser] Request.");
            // Check browser existence explicitly
            if (!state.browser) {
                console.warn("[Tool: closeBrowser] No browser instance exists.");
                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: "Info: No browser was open." }] };
            }

            let traceSavedPath: string | null = null;
            let videoSavedPath: string | null = state.videoPath; // Get expected path

            try {
                // Stop Tracing first - check context explicitly
                if (state.context && state.tracePath) {
                    console.error(`[Tool: closeBrowser] Stopping trace and saving to: ${state.tracePath}`);
                    // Check browser connection before stopping trace
                    if (state.browser.isConnected()) { // Check browser directly here
                        // Use non-null assertion for context as we checked above
                        await state.context!.tracing.stop({ path: state.tracePath });
                        console.error(`[Tool: closeBrowser] Trace saved successfully.`);
                        traceSavedPath = state.tracePath;
                    } else {
                         console.warn("[Tool: closeBrowser] Browser disconnected before trace could be stopped.");
                    }
                } else if (state.tracePath) {
                     console.warn("[Tool: closeBrowser] Trace path set, but context missing.");
                }

                // Close Browser
                console.error("[Tool: closeBrowser] Closing browser...");
                // Use non-null assertion for browser as we checked above
                await state.browser!.close();
                console.error("[Tool: closeBrowser] Browser closed successfully.");

                let message = "Browser closed successfully.";
                if (videoSavedPath) message += ` Video saved near: ${videoSavedPath}.`;
                if (traceSavedPath) message += ` Trace saved to: ${traceSavedPath}.`;

                // Reset state AFTER successful close
                state.browser = null; state.context = null; state.page = null; state.tracePath = null; state.videoPath = null;

                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: message }] };

            } catch (error: any) {
                console.error("[Tool: closeBrowser] Error closing browser:", error);
                // Attempt to reset state even on error
                state.browser = null; state.context = null; state.page = null; state.tracePath = null; state.videoPath = null;
                // Ensure return type matches expected structure
                return { content: [{ type: "text", text: `Error closing browser: ${error.message}` }], isError: true };
            }
        }
    );
}