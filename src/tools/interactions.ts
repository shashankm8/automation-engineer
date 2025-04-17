import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodTypeAny } from "zod"; // Import ZodTypeAny if needed for clarity
import type { PlaywrightState } from '../server.js';
import { takeScreenshotOnError } from '../server.js';

// Define expected return type for tool callbacks
type ToolResult = Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }>;

// Helper function (Ensure it returns the correct type on error)
function checkPageAvailable(state: PlaywrightState): { content: { type: "text"; text: string; }[]; isError: true; } | null {
    if (!state.page || !state.browser?.isConnected()) {
        console.warn("[Check] No active page or browser disconnected.");
        // This already returns the correct structure
        return { content: [{ type: "text", text: "Error: No active page or browser disconnected. Use launchBrowser first." }], isError: true };
    }
    return null;
}

// Define argument types inferred from schemas
// We use z.infer to derive types directly from the schemas below
const clickSchema = { selector: z.string().min(1).describe("Selector for the element to click.") };
type ClickArgs = z.infer<z.ZodObject<typeof clickSchema>>;

const fillSchema = {
    selector: z.string().min(1).describe("Selector for the input element."),
    text: z.string().describe("Text to fill into the element.")
};
type FillArgs = z.infer<z.ZodObject<typeof fillSchema>>;

const getElementTextSchema = { selector: z.string().min(1).describe("Selector for the element.") };
type GetElementTextArgs = z.infer<z.ZodObject<typeof getElementTextSchema>>;

const hoverSchema = { selector: z.string().min(1).describe("Selector for the element to hover over.") };
type HoverArgs = z.infer<z.ZodObject<typeof hoverSchema>>;

const pressKeySchema = {
    key: z.string().min(1).describe("Key to press (e.g., 'Enter', 'Tab', 'A')."),
    selector: z.string().optional().describe("Optional selector to focus first.")
};
type PressKeyArgs = z.infer<z.ZodObject<typeof pressKeySchema>>;

const selectOptionUnion = z.union([
    z.object({ value: z.string() }).describe("Select by option value attribute."),
    z.object({ label: z.string() }).describe("Select by option visible text label."),
    z.object({ index: z.number().int() }).describe("Select by option zero-based index.")
]);

const selectOptionSchema = {
    selector: z.string().min(1).describe("Selector for the <select> element."),
    // IMPROVED DESCRIPTION HERE:
    option: selectOptionUnion.describe("The option to select. MUST be an object specifying ONE of: { value: 'optionValue' }, { label: 'Visible Text' }, or { index: 0 }.")
};
type SelectOptionArgs = z.infer<z.ZodObject<typeof selectOptionSchema>>;


export function registerInteractionTools(server: McpServer, state: PlaywrightState) {

    // Tool: click
    server.tool(
        "click",
        clickSchema, // Pass the schema shape object
        async (args: ClickArgs): ToolResult => { // Use inferred type
            const { selector } = args;
            console.error(`[Tool: click] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError;

            try {
                console.error(`[Tool: click] Clicking element: ${selector}`);
                await state.page!.click(selector, { timeout: 5000 });
                console.error(`[Tool: click] Click successful on: ${selector}`);
                return { content: [{ type: "text", text: `Successfully clicked element: ${selector}` }] };
            } catch (error: any) {
                console.error(`[Tool: click] Error clicking ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'click-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                else if (error.message?.includes('selector resolved to hidden')) errorMessage = `Element '${selector}' found but hidden.`;
                let finalMessage = `Error clicking element '${selector}': ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: fill
    server.tool(
        "fill",
        fillSchema, // Pass the schema shape object
        async (args: FillArgs): ToolResult => { // Use inferred type
            const { selector, text } = args;
            console.error(`[Tool: fill] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError;

            try {
                console.error(`[Tool: fill] Filling element: ${selector} with text: "${text}"`);
                await state.page!.fill(selector, text, { timeout: 5000 });
                console.error(`[Tool: fill] Fill successful on: ${selector}`);
                return { content: [{ type: "text", text: `Successfully filled element '${selector}'.` }] };
            } catch (error: any) {
                console.error(`[Tool: fill] Error filling ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'fill-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                else if (error.message?.includes('Element is not an input')) errorMessage = `Element '${selector}' is not an input field.`;
                let finalMessage = `Error filling element '${selector}': ${errorMessage}`;
                 if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: getElementText
    server.tool(
        "getElementText",
        getElementTextSchema, // Pass the schema shape object
        async (args: GetElementTextArgs): ToolResult => { // Use inferred type
            const { selector } = args;
            console.error(`[Tool: getElementText] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError;

            try {
                console.error(`[Tool: getElementText] Getting text content for: ${selector}`);
                const actualTextContent = await state.page!.textContent(selector, { timeout: 5000 });
                console.error(`[Tool: getElementText] Text content for '${selector}': "${actualTextContent}"`);

                // Ensure return value is always string, even if null
                return { content: [{ type: "text", text: actualTextContent ?? "" }] };
            } catch (error: any) {
                console.error(`[Tool: getElementText] Error getting text for ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'getText-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                let finalMessage = `Error getting text for element '${selector}': ${errorMessage}`;
                 if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: hover
    server.tool(
        "hover",
        hoverSchema, // Pass the schema shape object
        async (args: HoverArgs): ToolResult => { // Use inferred type
            const { selector } = args;
            console.error(`[Tool: hover] Request for selector: ${selector}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError;

            try {
                console.error(`[Tool: hover] Hovering over element: ${selector}`);
                await state.page!.hover(selector, { timeout: 5000 });
                console.error(`[Tool: hover] Hover successful on: ${selector}`);
                return { content: [{ type: "text", text: `Successfully hovered over element: ${selector}` }] };
            } catch (error: any) {
                console.error(`[Tool: hover] Error hovering ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'hover-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element: ${selector}`;
                let finalMessage = `Error hovering over element '${selector}': ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: pressKey
    server.tool(
        "pressKey",
        pressKeySchema, // Pass the schema shape object
        async (args: PressKeyArgs): ToolResult => { // Use inferred type
            const { key, selector } = args;
            console.error(`[Tool: pressKey] Request: key=${key}, selector=${selector ?? 'none'}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError;

            try {
                if (selector) {
                    console.error(`[Tool: pressKey] Focusing ${selector} then pressing ${key}...`);
                    await state.page!.press(selector, key, { timeout: 5000 });
                } else {
                    console.error(`[Tool: pressKey] Pressing ${key} on page...`);
                    await state.page!.keyboard.press(key);
                }
                console.error(`[Tool: pressKey] Key press '${key}' successful.`);
                return { content: [{ type: "text", text: `Successfully pressed key '${key}'${selector ? ` on element '${selector}'` : ''}.` }] };
            } catch (error: any) {
                console.error(`[Tool: pressKey] Error pressing key '${key}'${selector ? ` on '${selector}'` : ''}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'pressKey-error', selector ?? 'page');
                let errorMessage = error.message;
                if (error.message?.includes('Timeout') && selector) errorMessage = `Timeout waiting for element: ${selector}`;
                let finalMessage = `Error pressing key '${key}'${selector ? ` on '${selector}'` : ''}: ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );

    // Tool: selectOption
    server.tool(
        "selectOption",
        selectOptionSchema, // Pass the schema shape object
        async (args: SelectOptionArgs): ToolResult => { // Use inferred type
            const { selector, option } = args;
            console.error(`[Tool: selectOption] Request for selector: ${selector}, option: ${JSON.stringify(option)}`);
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError;

            try {
                console.error(`[Tool: selectOption] Selecting option in: ${selector}`);
                // Pass the option object directly as Playwright expects { value: ... } or { label: ... } or { index: ... }
                const result = await state.page!.selectOption(selector, option, { timeout: 5000 });
                console.error(`[Tool: selectOption] Select successful on: ${selector}. Result: ${result}`);
                return { content: [{ type: "text", text: `Successfully selected option in '${selector}'.` }] };
            } catch (error: any) {
                console.error(`[Tool: selectOption] Error selecting option in ${selector}:`, error);
                const screenshotPath = await takeScreenshotOnError(state, 'selectOption-error', selector);
                let errorMessage = error.message;
                if (error.message?.includes('Timeout')) errorMessage = `Timeout waiting for element or option: ${selector}`;
                let finalMessage = `Error selecting option in '${selector}': ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );
}