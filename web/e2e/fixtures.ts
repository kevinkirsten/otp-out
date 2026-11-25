import { test as base, expect } from "@playwright/test";

// Em todo teste: registra violações de CSP e erros de JavaScript da página, e
// falha se aparecer algum. Assim um <style> injetado por biblioteca ou um
// fetch esquecido não passa despercebido.
export const test = base.extend<{ allowCspViolations: boolean; pageGuards: void }>({
  allowCspViolations: [false, { option: true }],
  pageGuards: [
    async ({ page, allowCspViolations }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      await page.addInitScript(() => {
        const w = window as unknown as { __csp: string[] };
        w.__csp = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          w.__csp.push(`${event.effectiveDirective} ${event.blockedURI}`);
        });
      });
      await use();
      if (!allowCspViolations) {
        const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
        expect(violations, "violações de CSP").toEqual([]);
        expect(errors, "erros na página").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
