// src/tools/waitsAndInfo.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaywrightState } from '../server.js';
import { takeScreenshotOnError } from '../server.js'; // Import error screenshot helper

const DEFAULT_WAIT_TIMEOUT = 30000; // Default timeout for waits

// Define expected return type for tool callbacks
type ToolResult = Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }>;

// Helper function
function checkPageAvailable(state: PlaywrightState): { content: { type: "text"; text: string; }[]; isError: true; } | null {
    if (!state.page || !state.browser?.isConnected()) {
        console.warn("[Check] No active page or browser disconnected.");
        return { content: [{ type: "text", text: "Error: No active page or browser disconnected. Use launchBrowser first." }], isError: true };
    }
    return null;
}

// Define argument types
type WaitForSelectorArgs = {
    selector: string;
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout: number;
};
type WaitForNavigationArgs = {
    timeout: number;
};
type WaitForTimeoutArgs = {
    milliseconds: number;
};

export function registerWaitsAndInfoTools(server: McpServer, state: PlaywrightState) {

    // --- Waiting Tools ---

    server.tool(
        "waitForSelector",
        {
            selector: z.string().min(1).describe("Selector for the element to wait for."),
            state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().default('visible')
                .describe("State to wait for ('attached', 'detached', 'visible', 'hidden'). Defaults to 'visible'."),
            timeout: z.number().int().positive().optional().default(DEFAULT_WAIT_TIMEOUT)
                .describe(`Timeout (ms). Defaults to ${DEFAULT_WAIT_TIMEOUT}ms.`)
        },
        async (args: WaitForSelectorArgs): ToolResult => {
            const { selector, state: desiredState, timeout } = args;
            console.error(`[Tool: waitForSelector] Request: selector=${selector}, state=${desiredState}, timeout=${timeout}`);
            const pageError = checkPageAvailable(state); if (pageError) return pageError;

            try {
                console.error(`[Tool: waitForSelector] Waiting for element '${selector}' to be ${desiredState}...`);
                // Use non-null assertion after check
                await state.page!.waitForSelector(selector, { state: desiredState, timeout });
                console.error(`[Tool: waitForSelector] Element '${selector}' reached state '${desiredState}'.`);
                return { content: [{ type: "text", text: `Element '${selector}' reached state '${desiredState}'.` }] };
            } catch (error: any) {
                console.error(`[Tool: waitForSelector] Error waiting for '${selector}' (state: ${desiredState}):`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'waitForSelector-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element '${selector}' to reach state '${desiredState}' within ${timeout}ms.`;
                let finalMessage = `Error waiting for selector '${selector}': ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    server.tool(
        "waitForNavigation",
        {
            timeout: z.number().int().positive().optional().default(DEFAULT_WAIT_TIMEOUT)
                .describe(`Timeout (ms) to wait for navigation to complete. Defaults to ${DEFAULT_WAIT_TIMEOUT}ms.`)
        },
        async (args: WaitForNavigationArgs): ToolResult => {
            const { timeout } = args;
            console.error(`[Tool: waitForNavigation] Request: timeout=${timeout}`);
            const pageError = checkPageAvailable(state); if (pageError) return pageError;

            try {
                console.error(`[Tool: waitForNavigation] Waiting for navigation to complete...`);
                // Waits for the next navigation following an action (like click)
                // Common options: 'load', 'domcontentloaded', 'networkidle', 'commit'
                await state.page!.waitForNavigation({ waitUntil: 'domcontentloaded', timeout });
                const newUrl = state.page!.url();
                console.error(`[Tool: waitForNavigation] Navigation completed. Current URL: ${newUrl}`);
                return { content: [{ type: "text", text: `Navigation completed. New URL: ${newUrl}` }] };
            } catch (error: any) {
                console.error(`[Tool: waitForNavigation] Error waiting for navigation:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'waitForNavigation-error', 'page');
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for navigation within ${timeout}ms.`;
                let finalMessage = `Error waiting for navigation: ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    server.tool(
        "waitForTimeout",
        {
            milliseconds: z.number().int().positive().max(60000) // Add a max to prevent excessive waits
                .describe("Duration to wait in milliseconds (e.g., 1000 for 1 second). Max 60000ms.")
        },
        async (args: WaitForTimeoutArgs): ToolResult => {
            const { milliseconds } = args;
            console.error(`[Tool: waitForTimeout] Request: ${milliseconds}ms`);
            const pageError = checkPageAvailable(state); if (pageError) return pageError; // Still check page exists

            try {
                console.error(`[Tool: waitForTimeout] Waiting for ${milliseconds}ms...`);
                await state.page!.waitForTimeout(milliseconds);
                console.error(`[Tool: waitForTimeout] Wait completed.`);
                return { content: [{ type: "text", text: `Waited for ${milliseconds}ms.` }] };
            } catch (error: any) {
                // This shouldn't really error unless the page closes unexpectedly
                console.error(`[Tool: waitForTimeout] Error during wait:`, error);
                return { content: [{ type: "text", text: `Error during waitForTimeout: ${error.message}` }], isError: true };
            }
        }
    );

    // --- Information Gathering Tools ---

    server.tool(
        "getCurrentURL",
        {}, // No arguments
        async (): ToolResult => {
            console.error(`[Tool: getCurrentURL] Request.`);
            const pageError = checkPageAvailable(state); if (pageError) return pageError;
            try {
                const currentUrl = state.page!.url();
                console.error(`[Tool: getCurrentURL] Current URL: ${currentUrl}`);
                return { content: [{ type: "text", text: currentUrl }] };
            } catch (error: any) {
                console.error(`[Tool: getCurrentURL] Error getting URL:`, error);
                return { content: [{ type: "text", text: `Error getting current URL: ${error.message}` }], isError: true };
            }
        }
    );

    server.tool(
        "getCurrentTitle",
        {}, // No arguments
        async (): ToolResult => {
            console.error(`[Tool: getCurrentTitle] Request.`);
            const pageError = checkPageAvailable(state); if (pageError) return pageError;
            try {
                const currentTitle = await state.page!.title();
                console.error(`[Tool: getCurrentTitle] Current Title: ${currentTitle}`);
                return { content: [{ type: "text", text: currentTitle }] };
            } catch (error: any) {
                console.error(`[Tool: getCurrentTitle] Error getting title:`, error);
                return { content: [{ type: "text", text: `Error getting current title: ${error.message}` }], isError: true };
            }
        }
    );
}