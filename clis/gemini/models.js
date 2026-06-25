import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { GEMINI_DOMAIN, ensureGeminiPage } from './utils.js';

/**
 * Evaluate script that discovers available Gemini models and their supported
 * thinking levels from the visible web UI controls.
 *
 * Steps:
 *  1. Find the model-picker button (contains a model-version label).
 *  2. Open the picker menu.
 *  3. Read every visible menu item, extracting the canonical model name and
 *     any supported thinking values.
 *  4. Close the menu by clicking the document body.
 *  5. Return an array of {model, thinkingValues}.
 *
 * The script is intentionally read-only: it never selects a model, changes a
 * thinking level, starts a new chat, or submits a prompt.
 */
function discoverModelsScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
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

      // ── Canonical model-id helpers ──────────────────────────────────────
      // The Gemini web UI displays user-facing labels such as "2.5 Flash".
      // We map those labels to canonical short ids like "2.5-flash" that
      // later 'gemini ask' selection will consume.

      /**
       * Best-effort extraction of a canonical model id from display text.
       * Returns an empty string when the text does not look like a model entry.
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
          // Normalise "thinking" models: if the variant already includes
          // "thinking", keep the whole variant (e.g. "flash-thinking").
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

      // ── Thinking-value extraction ───────────────────────────────────────
      // The Gemini model picker may show thinking levels as a separate toggle
      // or as radio-like items within a model sub-group. We look for control
      // labels that match known thinking-level strings.

      const THINKING_LABEL_PATTERNS = [
        { value: 'standard', re: /standard/i, priority: 1 },
        { value: 'extended', re: /extended/i, priority: 2 },
      ];

      /**
       * Extract thinking values from a model menu item and its surrounding
       * controls / siblings. Returns a deduplicated, stable-order array of
       * English thinking-level strings.
       */
      const extractThinkingValues = (item) => {
        const found = new Map();

        // 1. Check the item's own text / aria-label.
        const selfText = normalize(
          (item.textContent || '') + ' ' +
          (item.getAttribute('aria-label') || '')
        );
        for (const { value, re } of THINKING_LABEL_PATTERNS) {
          if (re.test(selfText)) {
            found.set(value, true);
          }
        }

        // 2. Walk children of the item itself and direct siblings at the
        // same level for thinking toggles.  We deliberately do NOT use
        // parent.querySelectorAll which would cross into unrelated menu items.
        const parent = item.parentElement;
        if (parent) {
          const ownChildren = Array.from(item.querySelectorAll(
            'button, [role="button"], [role="radio"], [role="menuitemradio"], ' +
            'label, span, [role="switch"], input[type="radio"], input[type="checkbox"]'
          ));
          const directSiblings = Array.from(parent.children).filter(
            (c) => c !== item && c instanceof HTMLElement &&
              // Exclude other model entries (they carry their own model id).
              !/\\d+\\.\\d+/.test((c.textContent || '').trim()) &&
              !/flash|pro|lite|ultra|nano/i.test((c.textContent || '').trim())
          );
          const candidates = [...ownChildren, ...directSiblings];
          for (const candidate of candidates) {
            const sibText = normalize(
              (candidate.textContent || '') + ' ' +
              (candidate.getAttribute('aria-label') || '')
            );
            for (const { value, re } of THINKING_LABEL_PATTERNS) {
              if (re.test(sibText)) {
                found.set(value, true);
              }
            }
          }
        }

        // 3. Return stable-order array (standard first, then extended).
        const result = [];
        for (const { value } of THINKING_LABEL_PATTERNS) {
          if (found.has(value)) result.push(value);
        }
        return result;
      };

      // ── Model-picker discovery ──────────────────────────────────────────
      const VERSION_LABEL_RE = /\\d+\\.\\d+/;

      const findModelPicker = () => {
        const buttons = Array.from(
          document.querySelectorAll('button, [role="button"]')
        ).filter(isVisible);

        // Prefer buttons whose text matches a model-version pattern.
        const candidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '') || normalize(b.getAttribute('aria-label') || '');
          return VERSION_LABEL_RE.test(text) && text.length < 80;
        });

        // Sort by Y position ascending (top-first), then left.
        candidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });

        if (candidates.length > 0) return candidates[0];

        // Fallback: look for any element with model-related attributes.
        const attrEls = Array.from(
          document.querySelectorAll('[data-model-selector], [aria-label*="model" i]')
        ).filter(isVisible);
        if (attrEls.length > 0) return attrEls[0];

        return null;
      };

      const picker = findModelPicker();
      if (!picker) return [];

      // ── Open the picker menu ────────────────────────────────────────────
      try {
        const rect = picker.getBoundingClientRect();
        const init = {
          bubbles: true, cancelable: true, button: 0, buttons: 1,
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
        };
        picker.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
        picker.dispatchEvent(new MouseEvent('mousedown', init));
        picker.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
        picker.dispatchEvent(new MouseEvent('mouseup', init));
        picker.dispatchEvent(new MouseEvent('click', init));
      } catch (_) {
        return [];
      }

      // ── Find visible menu items ─────────────────────────────────────────
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
      ];

      let menuItems = [];
      for (const sel of MENU_SELECTORS) {
        const items = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        if (items.length >= 2) { menuItems = items; break; }
      }

      // Fallback: if structured menu roles aren't present, look for any
      // menu/dialog container and grab all its interactive children.
      if (menuItems.length === 0) {
        const containers = Array.from(
          document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
        ).filter(isVisible);
        for (const container of containers) {
          const children = Array.from(
            container.querySelectorAll('button, [role="button"], li, [role="menuitem"], [role="option"]')
          ).filter(isVisible);
          if (children.length >= 2) { menuItems = children; break; }
        }
      }

      // ── Parse models from menu items ────────────────────────────────────
      const results = [];
      const seen = new Set();

      for (const item of menuItems) {
        const modelId = canonicalModelId(item.textContent || '');
        if (!modelId) continue;
        if (seen.has(modelId)) continue;
        seen.add(modelId);

        const thinkingValues = extractThinkingValues(item);

        results.push({
          model: modelId,
          thinkingValues: thinkingValues,
        });
      }

      // If the picker menu only showed thinking options (e.g. "Standard" /
      // "Extended") rather than model names, return empty — the user needs
      // to first select a model before thinking levels are relevant.
      const hasModelEntries = results.some((r) => {
        return /\\d+\\.\\d+/.test(r.model) || /flash|pro|lite/i.test(r.model);
      });
      if (!hasModelEntries) {
        // Close the menu before returning.
        try { document.body.click(); } catch (_) {}
        return [];
      }

      // ── Close the menu ──────────────────────────────────────────────────
      try { document.body.click(); } catch (_) {}

      return results;
    })()
    `;
}

export const __test__ = {
    discoverModelsScript,
};

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
        const raw = await page.evaluate(discoverModelsScript());
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
        return result;
    },
});
