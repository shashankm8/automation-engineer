import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaywrightState } from '../server.js';
import { takeScreenshotOnError } from '../server.js'; // Import the error screenshot helper

// Define expected return type for tool callbacks
type ToolResult = Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }>;

// Helper function (Unchanged)
function checkPageAvailable(state: PlaywrightState): { content: { type: "text"; text: string; }[]; isError: true; } | null {
    if (!state.page || !state.browser?.isConnected()) {
        console.warn("[Check] No active page or browser disconnected.");
        return { content: [{ type: "text", text: "Error: No active page or browser disconnected. Use launchBrowser first." }], isError: true };
    }
    return null;
}

// Define argument types
type ClickArgs = { selector: string };
type FillArgs = { selector: string; text: string };
type GetElementTextArgs = { selector: string };


export function registerInteractionTools(server: McpServer, state: PlaywrightState) {

    // Tool: click
    server.tool(
        "click",
        { selector: z.string().min(1).describe("Selector for the element to click.") },
        // Add explicit types for args and return value
        async (args: ClickArgs): ToolResult => {
            const { selector } = args; // Destructure args
            console.error(`[Tool: click] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError; // Return error object directly

            try {
                console.error(`[Tool: click] Clicking element: ${selector}`);
                // Use non-null assertion after check
                await state.page!.click(selector, { timeout: 5000 });
                console.error(`[Tool: click] Click successful on: ${selector}`);
                // Ensure return type matches
                return { content: [{ type: "text", text: `Successfully clicked element: ${selector}` }] };
            } catch (error: any) {
                console.error(`[Tool: click] Error clicking ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'click-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                else if (error.message?.includes('selector resolved to hidden')) errorMessage = `Element '${selector}' found but hidden.`;
                let finalMessage = `Error clicking element '${selector}': ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                // Ensure return type matches
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: fill
    server.tool(
        "fill",
        {
            selector: z.string().min(1).describe("Selector for the input element."),
            text: z.string().describe("Text to fill into the element.")
        },
         // Add explicit types for args and return value
        async (args: FillArgs): ToolResult => {
            const { selector, text } = args; // Destructure args
            console.error(`[Tool: fill] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError; // Return error object directly

            try {
                console.error(`[Tool: fill] Filling element: ${selector} with text: "${text}"`);
                 // Use non-null assertion after check
                await state.page!.fill(selector, text, { timeout: 5000 });
                console.error(`[Tool: fill] Fill successful on: ${selector}`);
                 // Ensure return type matches
                return { content: [{ type: "text", text: `Successfully filled element '${selector}'.` }] };
            } catch (error: any) {
                console.error(`[Tool: fill] Error filling ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'fill-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                else if (error.message?.includes('Element is not an input')) errorMessage = `Element '${selector}' is not an input field.`;
                let finalMessage = `Error filling element '${selector}': ${errorMessage}`;
                 if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                 // Ensure return type matches
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: getElementText
    server.tool(
        "getElementText",
        { selector: z.string().min(1).describe("Selector for the element.") },
         // Add explicit types for args and return value
        async (args: GetElementTextArgs): ToolResult => {
            const { selector } = args; // Destructure args
            console.error(`[Tool: getElementText] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError; // Return error object directly

            try {
                console.error(`[Tool: getElementText] Getting text content for: ${selector}`);
                 // Use non-null assertion after check
                // Assign result to a variable
                const actualTextContent = await state.page!.textContent(selector, { timeout: 5000 });
                console.error(`[Tool: getElementText] Text content for '${selector}': "${actualTextContent}"`);

                if (actualTextContent === null) {
                    console.warn(`[Tool: getElementText] Element found for '${selector}', but has no text.`);
                     // Ensure return type matches
                    return { content: [{ type: "text", text: "" }] }; // Return empty string if null
                }
                 // Ensure return type matches
                return { content: [{ type: "text", text: actualTextContent }] }; // Use the variable here
            } catch (error: any) {
                console.error(`[Tool: getElementText] Error getting text for ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'getText-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                let finalMessage = `Error getting text for element '${selector}': ${errorMessage}`;
                 if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                 // Ensure return type matches
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );
}