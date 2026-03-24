import nextConfig from "eslint-config-next";

// eslint-config-next v16 bundles React Compiler lint rules via eslint-plugin-react-hooks v6.
// This project does not use React Compiler, so those rules produce false positives.
// We keep the essential hooks rules (rules-of-hooks, exhaustive-deps) and disable the rest.
const REACT_COMPILER_RULES = [
  "react-hooks/refs",
  "react-hooks/set-state-in-effect",
  "react-hooks/set-state-in-render",
  "react-hooks/immutability",
  "react-hooks/purity",
  "react-hooks/globals",
  "react-hooks/static-components",
  "react-hooks/use-memo",
  "react-hooks/void-use-memo",
  "react-hooks/component-hook-factories",
  "react-hooks/preserve-manual-memoization",
  "react-hooks/incompatible-library",
  "react-hooks/error-boundaries",
  "react-hooks/no-deriving-state-in-effects",
  "react-hooks/unsupported-syntax",
  "react-hooks/config",
  "react-hooks/gating",
  "react-hooks/automatic-effect-dependencies",
  "react-hooks/capitalized-calls",
  "react-hooks/hooks",
  "react-hooks/memoized-effect-dependencies",
  "react-hooks/invariant",
  "react-hooks/todo",
  "react-hooks/syntax",
  "react-hooks/rule-suppression",
  "react-hooks/fire",
  "react-hooks/fbt",
];

const disableCompilerRules = Object.fromEntries(REACT_COMPILER_RULES.map((r) => [r, "off"]));

export default [
  ...nextConfig,
  {
    rules: disableCompilerRules,
  },
];
