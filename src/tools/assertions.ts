import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { expect } from '@playwright/test';
import type { PlaywrightState } from '../server.js';
import { takeScreenshotOnError } from '../server.js'; // Import the error screenshot helper

const DEFAULT_ASSERTION_TIMEOUT = 30000;

// Define expected return type for tool callbacks
type ToolResult = Promise<{ content: { type: "text"; text: string; }[]; isError?: boolean }>;

// --- Helper function (Copied here for now, consider moving to utils.ts later) ---
function checkPageAvailable(state: PlaywrightState): { content: { type: "text"; text: string; }[]; isError: true; } | null {
    if (!state.page || !state.browser?.isConnected()) {
        console.warn("[Check] No active page or browser disconnected.");
        return { content: [{ type: "text", text: "Error: No active page or browser disconnected. Use launchBrowser first." }], isError: true };
    }
    return null;
}

// Define argument types for the assert tool
type AssertArgs = {
    type: 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked' | 'unchecked' |
          'hasText' | 'containsText' | 'hasValue' | 'hasAttribute' | 'hasURL' | 'hasTitle';
    selector?: string; // Optional because not needed for hasURL/hasTitle
    value?: string;    // Optional
    attribute?: string; // Optional
    timeout: number;   // Defaulted, but always present after Zod parsing
};

export function registerAssertionTool(server: McpServer, state: PlaywrightState) {

    const assertionTypeEnum = z.enum([
        'visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked',
        'hasText', 'containsText', 'hasValue', 'hasAttribute', 'hasURL', 'hasTitle'
    ]).describe("The type of assertion.");

    server.tool(
        "assert",
        {
            type: assertionTypeEnum,
            selector: z.string().optional().describe("Selector for element assertions."),
            value: z.string().optional().describe("Expected value."),
            attribute: z.string().optional().describe("Attribute name for 'hasAttribute'."),
            timeout: z.number().int().positive().optional().default(DEFAULT_ASSERTION_TIMEOUT)
                .describe(`Timeout (ms). Defaults to ${DEFAULT_ASSERTION_TIMEOUT}ms.`)
        },
        // Add explicit types for args and return value
        async (args: AssertArgs): ToolResult => {
            // Destructure args correctly
            const { type, selector, value, attribute, timeout } = args;
            console.error(`[Tool: assert] Request: type=${type}, selector=${selector}, value=${value}, attribute=${attribute}, timeout=${timeout}`);

            // Use the checkPageAvailable function defined above
            const pageError = checkPageAvailable(state);
            if (pageError) return pageError; // Return error object directly

            try {
                const getLocator = () => {
                    if (!selector) throw new Error(`Selector is required for assertion type '${type}'.`);
                    // Use non-null assertion for page after check
                    return state.page!.locator(selector);
                };
                const checkValue = () => { if (value === undefined) throw new Error(`Value is required for assertion type '${type}'.`); }
                const checkAttribute = () => { if (attribute === undefined) throw new Error(`Attribute name is required for assertion type '${type}'.`); }

                switch (type) {
                    case "visible": await expect(getLocator()).toBeVisible({ timeout }); break;
                    case "hidden": await expect(getLocator()).toBeHidden({ timeout }); break;
                    case "enabled": await expect(getLocator()).toBeEnabled({ timeout }); break;
                    case "disabled": await expect(getLocator()).toBeDisabled({ timeout }); break;
                    case "checked": await expect(getLocator()).toBeChecked({ timeout }); break;
                    case "unchecked": await expect(getLocator()).not.toBeChecked({ timeout }); break;
                    case "hasText": checkValue(); await expect(getLocator()).toHaveText(value!, { timeout }); break;
                    case "containsText": checkValue(); await expect(getLocator()).toContainText(value!, { timeout }); break;
                    case "hasValue": checkValue(); await expect(getLocator()).toHaveValue(value!, { timeout }); break;
                    case "hasAttribute": checkValue(); checkAttribute(); await expect(getLocator()).toHaveAttribute(attribute!, value!, { timeout }); break;
                    // Use non-null assertion for page after check
                    case "hasURL": checkValue(); await expect(state.page!).toHaveURL(value!, { timeout }); break;
                    case "hasTitle": checkValue(); await expect(state.page!).toHaveTitle(value!, { timeout }); break;
                    default: const _exhaustiveCheck: never = type; throw new Error(`Unsupported type: ${_exhaustiveCheck}`);
                }

                const successMessage = `Assertion passed: ${type}` + (selector ? ` for '${selector}'` : '') + (value !== undefined ? ` value "${value}"` : '') + (attribute !== undefined ? ` attr "${attribute}"` : '');
                console.error(`[Tool: assert] ${successMessage}`);
                // Ensure return type matches
                return { content: [{ type: "text", text: successMessage }] };

            } catch (error: any) {
                const errorMessage = error.message || String(error);
                console.error(`[Tool: assert] Assertion failed: ${errorMessage}`);
                const screenshotPath = await takeScreenshotOnError(state, `assert-${type}-failed`, selector ?? 'page');
                let finalMessage = `Assertion failed: ${errorMessage}`;
                if (screenshotPath) finalMessage += ` Screenshot saved to: ${screenshotPath}`;
                // Ensure return type matches
                return { content: [{ type: "text", text: finalMessage }], isError: true };
            }
        }
    );
}