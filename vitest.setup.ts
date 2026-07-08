// vitest.setup.ts
//
// Runs once before the test suite. Pulls in jest-dom's matchers
// (`toBeInTheDocument`, `toHaveClass`, etc.) so component/hook tests can
// write readable assertions against the rendered DOM.

import "@testing-library/jest-dom/vitest";