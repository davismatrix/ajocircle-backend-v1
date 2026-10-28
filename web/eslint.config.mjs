import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  { ignores: [".next/**", ".next-e2e/**", ".next-live-e2e/**", ".test-build/**", "next-env.d.ts"] },
];

export default config;
