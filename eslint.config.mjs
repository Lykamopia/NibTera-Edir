// ESLint 9 flat config (replaces .eslintrc.json; `next lint` was removed in Next 16).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "vendor/**", "uploads/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
