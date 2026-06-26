import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { GEMINI_DOMAIN, ensureGeminiPage } from './utils.js';

// ── Shared helpers (embedded in browser scripts) ──────────────────────────

function sharedHelpers() {
    return `
      const isVisible = (el) => {
        if (!el) return false;
        if (!(el instanceof HTMLElement) && !(el instanceof Element)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const VERSION_LABEL_RE = /\\d+\\.\\d+/;
    `;
}

function findModelPickerLogic() {
    return `
      // Patterns for detecting model/mode selector buttons by aria-label.
      const MODE_SELECTOR_PATTERNS = [
        /模式选择器/i,
        /mode[\\s-]*selector/i,
        /model[\\s-]*selector/i,
        /model[\\s-]*picker/i,
        /选择模型/i,
        /select[\\s-]+model/i,
        /choose[\\s-]+model/i,
        /switch[\\s-]+model/i,
        /change[\\s-]+model/i,
      ];

      const findModelPicker = () => {
        const buttons = Array.from(
          document.querySelectorAll('button, [role="button"]')
        ).filter(isVisible);

        // Method 1: Detect model/mode selector via aria-label patterns.
        for (const button of buttons) {
          const aria = normalize(button.getAttribute('aria-label') || '');
          for (const pattern of MODE_SELECTOR_PATTERNS) {
            if (pattern.test(aria)) return button;
          }
        }

        // Method 2: Detect buttons whose text contains a model-version pattern.
        const versionCandidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '') || normalize(b.getAttribute('aria-label') || '');
          return VERSION_LABEL_RE.test(text) && text.length < 80;
        });
        versionCandidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });
        if (versionCandidates.length > 0) return versionCandidates[0];

        // Method 3: Detect buttons showing a known model variant as their
        // sole text (e.g. "Pro", "Flash", "Flash-Lite").
        const MODEL_VARIANT_RE = /^(?:gemini\\s+)?(flash|lite|pro|ultra|nano|flash-lite|flash[\\s-]*thinking)$/i;
        const variantCandidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '');
          return MODEL_VARIANT_RE.test(text) && text.length < 30;
        });
        variantCandidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });
        if (variantCandidates.length > 0) return variantCandidates[0];

        // Method 4: Fallback — look for any element with model-related attributes.
        const attrEls = Array.from(
          document.querySelectorAll('[data-model-selector], [aria-label*="model" i], [aria-label*="模式" i]')
        ).filter(isVisible);
        if (attrEls.length > 0) return attrEls[0];

        return null;
      };
    `;
}

function modelParsingLogic() {
    return `
      /**
       * Best-effort extraction of a canonical model id from display text.
       * Handles patterns like "3.1 flash-lite", "3.5 flash", "3.1 pro",
       * "2.5-flash-thinking", "gemini 3.0 pro experimental", and entries with
       * trailing Chinese descriptions (e.g. "3.1 Flash-Lite 极速回答").
       */
      const canonicalModelId = (raw) => {
        const text = normalize(raw);
        if (!text) return '';

        // Remove leading decorative characters (e.g. checkmark icons).
        const cleaned = text.replace(/^[^a-z0-9]+/i, '').trim();

        // Known model-version patterns: "X.Y variant" or "X.Y-variant".
        const versionRe = /^((?:gemini[\\s-]*)?(\\d+(?:\\.\\d+)?)(?:[\\s-]+(flash|pro|lite|ultra|nano|thinking|experimental))(?:[\\s-]*(flash|pro|lite|ultra|nano|thinking|experimental))?)/i;
        const match = cleaned.match(versionRe);
        if (match) {
          const version = match[2];
          let variant = (match[3] || '').toLowerCase();
          const extra = (match[4] || '').toLowerCase();
          if (extra) variant = variant + '-' + extra;
          return version + '-' + variant;
        }

        // Fallback: if the text contains a version number and a known keyword.
        const fallbackRe = /(\\d+(?:\\.\\d+)?)\\s*(flash|pro|lite|ultra|nano|thinking|experimental)/i;
        const fallbackMatch = cleaned.match(fallbackRe);
        if (fallbackMatch) {
          return fallbackMatch[1] + '-' + fallbackMatch[2].toLowerCase();
        }

        // For experimental / custom models: use a cleaned version of the label.
        if (/\\d+(?:\\.\\d+)?/.test(cleaned) && cleaned.length < 60) {
          return cleaned.replace(/\\s+/g, '-').replace(/[^a-z0-9.-]/g, '');
        }

        return '';
      };
    `;
}

function thinkingExtractionLogic() {
    return `
      /**
       * Extract thinking values from the full set of visible menu items.
       * Gemini Web shows thinking levels as separate menu items
       * (e.g. "标准 最适合回答大多数问题", "扩展 擅长解决复杂问题").
       * Returns a deduplicated, stable-order array.
       */
      const extractAllThinkingValues = (menuItems) => {
        const found = new Map();

        const THINKING_PATTERNS = [
          { value: 'standard', patterns: [/\\bstandard\\b/i, /标准/i], priority: 1 },
          { value: 'extended', patterns: [/\\bextended\\b/i, /扩展/i], priority: 2 },
        ];

        for (const item of menuItems) {
          const itemText = normalize(item.textContent || '');
          const itemAria = normalize(item.getAttribute('aria-label') || '');
          const combined = itemText + ' ' + itemAria;

          // Skip model entries (contain a version like "3.1").
          if (/\\d+\\.\\d+/.test(combined)) continue;
          // Skip the thinking-section header itself (e.g. "思考等级").
          if (/^思考等级|^thinking level|^thinking mode/i.test(combined.trim())) continue;

          for (const { value, patterns } of THINKING_PATTERNS) {
            for (const re of patterns) {
              if (re.test(combined)) {
                found.set(value, true);
                break;
              }
            }
          }
        }

        const result = [];
        for (const { value } of THINKING_PATTERNS) {
          if (found.has(value)) result.push(value);
        }
        return result;
      };
    `;
}

function menuEnumerationLogic() {
    return `
      const MENU_SELECTORS = [
        '[role="menu"] [role="menuitem"]',
        '[role="menu"] [role="menuitemradio"]',
        '[role="listbox"] [role="option"]',
        '[role="menu"] button',
        '[role="listbox"] button',
        '[role="menu"] li',
        '[role="listbox"] li',
        '[role="dialog"] [role="menuitem"]',
        '[role="dialog"] [role="option"]',
        '[aria-modal="true"] [role="menuitem"]',
        '[aria-modal="true"] [role="option"]',
        'gem-menu-item',
        'GEM-MENU-ITEM',
        '[role="menu"] gem-menu-item',
        '[role="menu"] GEM-MENU-ITEM',
        '[role="listbox"] gem-menu-item',
        '[role="listbox"] GEM-MENU-ITEM',
        '[role="menu"] :not(script):not(style)',
        '[role="listbox"] :not(script):not(style)',
      ];

      const findVisibleMenuItems = () => {
        let menuItems = [];
        for (const sel of MENU_SELECTORS) {
          const items = Array.from(document.querySelectorAll(sel)).filter(isVisible);
          if (items.length >= 2) { menuItems = items; break; }
        }

        if (menuItems.length === 0) {
          const containers = Array.from(
            document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
          ).filter(isVisible);
          for (const container of containers) {
            const children = Array.from(
              container.querySelectorAll('button, [role="button"], li, [role="menuitem"], [role="option"], gem-menu-item, GEM-MENU-ITEM, :not(script):not(style)')
            ).filter(isVisible);
            if (children.length >= 2) { menuItems = children; break; }
          }
        }

        return menuItems;
      };
    `;
}

function readMenuAndCloseLogic() {
    return `
      const menuItems = findVisibleMenuItems();

      // ── Parse models from menu items ──────────────────────────────────
      const results = [];
      const seen = new Set();

      for (const item of menuItems) {
        if (!item || (!(item instanceof HTMLElement) && !(item instanceof Element))) continue;
        const itemText = (item.textContent || '').replace(/\\s+/g, ' ').trim();
        const modelId = canonicalModelId(itemText);
        if (!modelId) continue;
        if (seen.has(modelId)) continue;
        seen.add(modelId);

        results.push({ model: modelId, thinkingValues: [] });
      }

      // Guard: only thinking options, no model entries → bail out.
      const hasModelEntries = results.some((r) => {
        return /\\d+\\.\\d+/.test(r.model) || /flash|pro|lite/i.test(r.model);
      });
      if (!hasModelEntries) {
        try { document.body.click(); } catch (_) {}
        return [];
      }

      // ── Expand thinking section ───────────────────────────────────────
      // Thinking levels are hidden behind a "思考等级" toggle.
      // Click it to reveal the thinking-level menu items.
      const thinkingToggle = menuItems.find((item) => {
        const text = normalize(item.textContent || '');
        return /思考等级|thinking level|thinking mode/i.test(text);
      });
      if (thinkingToggle) {
        try { thinkingToggle.click(); } catch (_) {}
        // Re-enumerate — React updates the DOM synchronously on click.
        const expandedItems = findVisibleMenuItems();
        if (expandedItems.length > menuItems.length) {
          // Use the expanded set for thinking extraction.
          const globalThinking = extractAllThinkingValues(expandedItems);
          if (globalThinking.length > 0) {
            for (const row of results) {
              row.thinkingValues = [...globalThinking];
            }
          }
        }
      } else {
        // No toggle found — try extracting thinking from the current items.
        const globalThinking = extractAllThinkingValues(menuItems);
        if (globalThinking.length > 0) {
          for (const row of results) {
            row.thinkingValues = [...globalThinking];
          }
        }
      }

      // ── Close the menu ────────────────────────────────────────────────
      try { document.body.click(); } catch (_) {}

      return results;
    `;
}

// ── Exported script builders ──────────────────────────────────────────────

/**
 * Complete discovery script that finds the model picker, opens it,
 * reads models and thinking values, and closes the menu.
 * Used by gemini ask for model/thinking discovery.
 * Uses .click() to trigger React event handlers on Gemini Web.
 */
export function discoverModelsScript() {
    return `
    (() => {
      ${sharedHelpers()}
      ${findModelPickerLogic()}
      ${modelParsingLogic()}
      ${thinkingExtractionLogic()}
      ${menuEnumerationLogic()}

      const picker = findModelPicker();
      if (!picker) return [];

      // Use native .click() — Gemini Web is a React app and synthetic
      // event dispatch may not trigger React's event handlers.
      try { picker.click(); } catch (_) { return []; }

      ${readMenuAndCloseLogic()}
    })()
    `;
}

/**
 * Script that only finds and clicks the model-picker button.
 * Does NOT read the menu — only locates and clicks the picker.
 */
export function pickModelPickerScript() {
    return `${sharedHelpers()}${findModelPickerLogic()}`;
}

/**
 * Script that reads models and thinking values from an already-open
 * Gemini Web model-picker menu, then closes the menu.
 */
export function readMenuScript() {
    return `
    (() => {
      ${sharedHelpers()}
      ${modelParsingLogic()}
      ${thinkingExtractionLogic()}
      ${menuEnumerationLogic()}
      ${readMenuAndCloseLogic()}
    })()
    `;
}

/**
 * Script that reads model entries from an open menu (no thinking extraction,
 * no menu close).  Returns {models: [...], hasThinkingToggle: bool}.
 */
export function readMenuModelsScript() {
    return `
    (() => {
      ${sharedHelpers()}
      ${modelParsingLogic()}
      ${menuEnumerationLogic()}

      const menuItems = findVisibleMenuItems();

      const results = [];
      const seen = new Set();

      for (const item of menuItems) {
        if (!item || (!(item instanceof HTMLElement) && !(item instanceof Element))) continue;
        const itemText = (item.textContent || '').replace(/\\s+/g, ' ').trim();

        const modelId = canonicalModelId(itemText);
        if (!modelId) continue;
        if (seen.has(modelId)) continue;
        seen.add(modelId);

        results.push({ model: modelId, thinkingValues: [] });
      }

      const hasModelEntries = results.some((r) => {
        return /\\d+\\.\\d+/.test(r.model) || /flash|pro|lite/i.test(r.model);
      });
      if (!hasModelEntries) return [];

      return results;
    })()
    `;
}

/**
 * Script that clicks the "思考等级" / "Thinking level" toggle in the
 * currently-open menu to expand thinking options.
 * Returns true if the toggle was found and clicked.
 */
export function clickThinkingToggleScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!el) return false;
        if (!(el instanceof HTMLElement) && !(el instanceof Element)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const menuItems = Array.from(
        document.querySelectorAll('[role="menuitem"], gem-menu-item, GEM-MENU-ITEM')
      ).filter(isVisible);

      const thinkingToggle = menuItems.find((item) => {
        const text = (item.textContent || '').trim();
        return /思考等级|thinking level|thinking mode/i.test(text);
      });

      if (thinkingToggle) {
        try { thinkingToggle.click(); } catch (_) { return false; }
        return true;
      }
      return false;
    })()
    `;
}

/**
 * Script that extracts thinking values from the currently-open menu.
 * Looks for menu items whose text matches known thinking-level strings.
 */
export function extractThinkingScript() {
    return `
    (() => {
      ${sharedHelpers()}
      ${thinkingExtractionLogic()}
      ${menuEnumerationLogic()}

      const menuItems = findVisibleMenuItems();
      return extractAllThinkingValues(menuItems);
    })()
    `;
}

export const __test__ = {
    discoverModelsScript,
    pickModelPickerScript,
    readMenuScript,
    readMenuModelsScript,
    clickThinkingToggleScript,
    extractThinkingScript,
};

// ── Command registration ──────────────────────────────────────────────────

export const modelsCommand = cli({
    site: 'gemini',
    name: 'models',
    access: 'read',
    description: 'List available Gemini models and their supported thinking levels from the web UI',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['model', 'thinkingValues'],
    func: async (page) => {
        await ensureGeminiPage(page);

        // Step 1: Open the picker menu (click the model-picker button).
        await page.evaluate(`
          (() => {
            ${pickModelPickerScript()}
            const picker = findModelPicker();
            if (!picker) return { ok: false };
            try { picker.click(); } catch (_) { return { ok: false }; }
            return { ok: true };
          })()
        `);

        // Step 2: Wait for React to render the menu.
        await page.wait(1.0);

        // Step 3: Read model entries from the open menu.
        const raw = await page.evaluate(readMenuModelsScript());
        const result = typeof raw === 'object' && raw !== null && 'data' in raw && 'session' in raw
            ? raw.data
            : raw;

        if (!Array.isArray(result)) {
            throw new CommandExecutionError('Gemini models discovery returned unexpected data');
        }
        for (const row of result) {
            if (!row || typeof row.model !== 'string' || !Array.isArray(row.thinkingValues)) {
                throw new CommandExecutionError('Gemini models discovery returned a malformed row');
            }
        }

        // Step 4: Click the thinking toggle ("思考等级") to expand thinking options.
        const toggleClicked = await page.evaluate(clickThinkingToggleScript());

        if (toggleClicked) {
            // Step 5: Wait for React to render the expanded thinking items.
            await page.wait(0.5);

            // Step 6: Extract thinking values from the expanded menu.
            const thinkingValues = await page.evaluate(extractThinkingScript());
            if (Array.isArray(thinkingValues) && thinkingValues.length > 0) {
                for (const row of result) {
                    row.thinkingValues = thinkingValues;
                }
            }
        }

        // Step 7: Close the menu.
        await page.evaluate(`(() => { try { document.body.click(); } catch (_) {} })()`);

        return result;
    },
});
